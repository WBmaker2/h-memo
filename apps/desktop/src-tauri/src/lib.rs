use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::process::Command;
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use anyhow::{Context, Result as AnyhowResult};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use chrono::Utc;
use rand::RngCore;
use rusqlite::{
  types::Type,
  params, Connection, Row,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tauri::{
  menu::{Menu, MenuItem},
  tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
  AppHandle, Emitter, Manager, State,
};
use tauri_plugin_dialog::DialogExt;
use url::{form_urlencoded, Url};

const WINDOW_LABEL: &str = "main";
const OPEN_ALL_MEMOS_LABEL: &str = "open_all_memos";
const NEW_MEMO_LABEL: &str = "new_memo";
const QUIT_LABEL: &str = "quit";
const TRAY_OPEN_ALL_MEMOS_EVENT: &str = "h-memo:tray-open-all-memos";
const TRAY_CREATE_MEMO_EVENT: &str = "h-memo:tray-create-memo";
const GOOGLE_OAUTH_AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_OAUTH_TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const GOOGLE_OAUTH_SCOPE: &str = "openid email profile";
const GOOGLE_OAUTH_TIMEOUT: Duration = Duration::from_secs(180);
const MAX_CANCELLED_RESTORE_ACQUIRES: usize = 256;
const MAX_RESTORE_ACQUIRE_REQUEST_WINDOW_MS: u64 = 30_000;
const MAX_RESTORE_ACQUIRE_CLOCK_SKEW_MS: u64 = 250;
const MAX_RESTORE_RENEWAL_CLEANUP_GRACE_MS: u64 = 30_000;
const MEMO_WINDOW_CREATION_TIMEOUT_MS: u64 = 10_000;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct MemoRecord {
  id: String,
  title: String,
  plain_text: String,
  rich_content: Value,
  style: Value,
  window_state: Value,
  created_at: String,
  updated_at: String,
  deleted_at: Option<String>,
  sync_state: String,
}

struct DatabaseState(Mutex<Connection>);

#[derive(Default)]
struct RestoreLockLeaseData {
  lease: Option<RestoreLockLease>,
  cancelled_acquires: HashMap<String, RestoreAcquireCancellation>,
}

struct RestoreLockLeaseState {
  process_origin: Instant,
  data: Mutex<RestoreLockLeaseData>,
}

impl Default for RestoreLockLeaseState {
  fn default() -> Self {
    Self {
      process_origin: Instant::now(),
      data: Mutex::new(RestoreLockLeaseData::default()),
    }
  }
}

impl RestoreLockLeaseState {
  fn clock_snapshot(&self) -> RestoreClockSnapshot {
    RestoreClockSnapshot {
      wall_ms: system_time_millis(SystemTime::now()),
      monotonic_ms: self.process_origin.elapsed().as_millis() as u64,
    }
  }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct RestoreClockSnapshot {
  wall_ms: u64,
  monotonic_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct RestoreAcquireRequest {
  deadline_ms: u64,
  window_ms: u64,
}

#[derive(Debug, Clone, Copy)]
struct RestoreLockLeaseRequest<'a> {
  token: &'a str,
  owner: &'a str,
  renewal_session_id: &'a str,
  ttl_ms: u64,
  request_deadline_ms: u64,
  request_window_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct RestoreAcquireCancellation {
  request: RestoreAcquireRequest,
  expires_at_monotonic_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct RestoreLockLease {
  token: String,
  owner: String,
  renewal_session_id: String,
  renewal_enabled: bool,
  expires_at_ms: u64,
  expires_at_monotonic_ms: u64,
  acquire_request: Option<RestoreAcquireRequest>,
  operation_active: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct RestoreLockLeaseRecord {
  token: String,
  owner: String,
  renewal_session_id: String,
  expires_at_ms: u64,
  operation_active: bool,
}

#[derive(Default)]
struct MemoWindowRegistry(Mutex<HashMap<String, MemoWindowOwner>>);

#[derive(Debug, PartialEq)]
enum MemoWindowOwnerState {
  Pending,
  Live,
}

struct MemoWindowOwner {
  window_label: String,
  claim_token: String,
  state: MemoWindowOwnerState,
  pending_created_at_monotonic_ms: Option<u64>,
  pending_expires_at_monotonic_ms: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MemoWindowClaim {
  claimed: bool,
  should_create: bool,
  window_label: String,
  claim_token: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GoogleOAuthTokens {
  id_token: String,
  access_token: String,
  expires_in: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
struct GoogleTokenResponse {
  id_token: Option<String>,
  access_token: Option<String>,
  expires_in: Option<u64>,
  error: Option<String>,
  error_description: Option<String>,
}

#[tauri::command]
fn list_memos(database: State<'_, DatabaseState>) -> Result<Vec<MemoRecord>, String> {
  let connection = database
    .0
    .lock()
    .map_err(|_| "database lock is unavailable".to_string())?;
  list_memos_from_connection(&connection).map_err(|error| error.to_string())
}

fn list_memos_from_connection(connection: &Connection) -> AnyhowResult<Vec<MemoRecord>> {
  let mut statement = connection
    .prepare(
      r#"
      SELECT id, title, plain_text, rich_content, style, window_state, created_at, updated_at, deleted_at, sync_state
      FROM memos
      ORDER BY updated_at DESC
      "#,
    )
    ?;

  let rows = statement
    .query_map([], parse_memo_row)
    ?;

  let memos = rows
    .collect::<Result<Vec<MemoRecord>, rusqlite::Error>>()
    ?;

  Ok(memos)
}

#[tauri::command]
fn save_memo(
  database: State<'_, DatabaseState>,
  restore_lock: State<'_, RestoreLockLeaseState>,
  memo: MemoRecord,
  restore_token: Option<String>,
) -> Result<MemoRecord, String> {
  let mut restore_state = restore_lock
    .data
    .lock()
    .map_err(|_| "restore lock lease is unavailable".to_string())?;
  let connection = database
    .0
    .lock()
    .map_err(|_| "database lock is unavailable".to_string())?;
  let clock = restore_lock.clock_snapshot();
  save_memo_inner_at(
    &connection,
    &mut restore_state.lease,
    &memo,
    restore_token.as_deref(),
    clock,
  )
}

fn save_memo_inner_at(
  connection: &Connection,
  lease: &mut Option<RestoreLockLease>,
  memo: &MemoRecord,
  restore_token: Option<&str>,
  clock: RestoreClockSnapshot,
) -> Result<MemoRecord, String> {
  authorize_restore_save(lease, restore_token, clock)?;
  let updated = normalize_record(memo);
  upsert_memo(connection, &updated).map_err(|error| error.to_string())?;
  Ok(updated)
}

#[cfg(test)]
fn save_memo_inner(
  connection: &Connection,
  lease: &mut Option<RestoreLockLease>,
  memo: &MemoRecord,
  restore_token: Option<&str>,
  now: SystemTime,
) -> Result<MemoRecord, String> {
  save_memo_inner_at(connection, lease, memo, restore_token, test_restore_clock(now))
}

fn authorize_restore_save(
  lease: &mut Option<RestoreLockLease>,
  restore_token: Option<&str>,
  clock: RestoreClockSnapshot,
) -> Result<(), String> {
  prune_restore_lock_lease(lease, clock.monotonic_ms);
  match (lease.as_ref(), restore_token) {
    (None, None) => Ok(()),
    (None, Some(_)) => Err("복원 잠금 lease가 없어 restore token을 사용할 수 없습니다.".to_string()),
    (Some(current), None) if !current.operation_active => Ok(()),
    (Some(_), None) => Err("복원 잠금 중에는 restore token이 필요합니다.".to_string()),
    (Some(current), Some(token)) if current.operation_active && current.token == token => Ok(()),
    (Some(_), Some(_)) => Err("복원 잠금 restore token이 일치하지 않습니다.".to_string()),
  }
}

#[tauri::command]
fn acquire_restore_lock_lease(
  state: State<'_, RestoreLockLeaseState>,
  token: String,
  owner: String,
  renewal_session_id: String,
  ttl_ms: u64,
  request_deadline_ms: u64,
  request_window_ms: u64,
) -> Result<RestoreLockLeaseRecord, String> {
  let mut restore_state = state
    .data
    .lock()
    .map_err(|_| "restore lock lease is unavailable".to_string())?;
  acquire_restore_lock_lease_fenced_inner_at(
    &mut restore_state,
    RestoreLockLeaseRequest {
      token: &token,
      owner: &owner,
      renewal_session_id: &renewal_session_id,
      ttl_ms,
      request_deadline_ms,
      request_window_ms,
    },
    state.clock_snapshot(),
  )
}

#[tauri::command]
fn cancel_abandoned_restore_lock_acquire(
  state: State<'_, RestoreLockLeaseState>,
  token: String,
  request_deadline_ms: u64,
  request_window_ms: u64,
) -> Result<(), String> {
  let mut restore_state = state
    .data
    .lock()
    .map_err(|_| "restore lock lease is unavailable".to_string())?;
  cancel_abandoned_restore_lock_acquire_inner_at(
    &mut restore_state,
    &token,
    request_deadline_ms,
    request_window_ms,
    state.clock_snapshot(),
  )
  .map(|_| ())
}

#[tauri::command]
fn current_restore_lock_lease(
  state: State<'_, RestoreLockLeaseState>,
) -> Result<Option<RestoreLockLeaseRecord>, String> {
  let mut restore_state = state
    .data
    .lock()
    .map_err(|_| "restore lock lease is unavailable".to_string())?;
  let clock = state.clock_snapshot();
  prune_cancelled_restore_acquires(
    &mut restore_state.cancelled_acquires,
    clock.monotonic_ms,
  );
  Ok(current_restore_lock_lease_inner_at(
    &mut restore_state.lease,
    clock,
  ))
}

#[tauri::command]
fn renew_restore_lock_lease(
  state: State<'_, RestoreLockLeaseState>,
  token: String,
  owner: String,
  renewal_session_id: String,
  ttl_ms: u64,
  request_deadline_ms: u64,
  request_window_ms: u64,
) -> Result<RestoreLockLeaseRecord, String> {
  let mut restore_state = state
    .data
    .lock()
    .map_err(|_| "restore lock lease is unavailable".to_string())?;
  renew_restore_lock_lease_fenced_inner_at(
    &mut restore_state.lease,
    RestoreLockLeaseRequest {
      token: &token,
      owner: &owner,
      renewal_session_id: &renewal_session_id,
      ttl_ms,
      request_deadline_ms,
      request_window_ms,
    },
    state.clock_snapshot(),
  )
}

#[tauri::command]
fn invalidate_restore_lock_renewal_session(
  state: State<'_, RestoreLockLeaseState>,
  token: String,
  owner: String,
  renewal_session_id: String,
  cleanup_grace_ms: u64,
) -> Result<bool, String> {
  let mut restore_state = state
    .data
    .lock()
    .map_err(|_| "restore lock lease is unavailable".to_string())?;
  invalidate_restore_lock_renewal_session_inner_at(
    &mut restore_state.lease,
    &token,
    &owner,
    &renewal_session_id,
    cleanup_grace_ms,
    state.clock_snapshot(),
  )
}

#[tauri::command]
fn activate_restore_lock_lease(
  state: State<'_, RestoreLockLeaseState>,
  token: String,
  owner: String,
) -> Result<RestoreLockLeaseRecord, String> {
  let mut restore_state = state
    .data
    .lock()
    .map_err(|_| "restore lock lease is unavailable".to_string())?;
  activate_restore_lock_lease_inner_at(
    &mut restore_state.lease,
    &token,
    &owner,
    state.clock_snapshot(),
  )
}

#[tauri::command]
fn finish_restore_lock_lease(
  state: State<'_, RestoreLockLeaseState>,
  token: String,
  owner: String,
  cleanup_ttl_ms: u64,
) -> Result<RestoreLockLeaseRecord, String> {
  let mut restore_state = state
    .data
    .lock()
    .map_err(|_| "restore lock lease is unavailable".to_string())?;
  finish_restore_lock_lease_inner_at(
    &mut restore_state.lease,
    &token,
    &owner,
    cleanup_ttl_ms,
    state.clock_snapshot(),
  )
}

#[tauri::command]
fn release_restore_lock_lease(
  state: State<'_, RestoreLockLeaseState>,
  token: String,
  owner: String,
) -> Result<bool, String> {
  let mut restore_state = state
    .data
    .lock()
    .map_err(|_| "restore lock lease is unavailable".to_string())?;
  Ok(release_restore_lock_lease_inner_at(
    &mut restore_state.lease,
    &token,
    &owner,
    state.clock_snapshot(),
  ))
}

fn acquire_restore_lock_lease_fenced_inner_at(
  state: &mut RestoreLockLeaseData,
  lease_request: RestoreLockLeaseRequest<'_>,
  clock: RestoreClockSnapshot,
) -> Result<RestoreLockLeaseRecord, String> {
  validate_restore_lock_identity(lease_request.token, lease_request.owner)?;
  validate_restore_renewal_session_id(lease_request.renewal_session_id)?;
  let (acquire_request, cancellation_deadline) = validate_restore_acquire_request(
    lease_request.request_deadline_ms,
    lease_request.request_window_ms,
    clock,
  )?;
  prune_cancelled_restore_acquires(
    &mut state.cancelled_acquires,
    clock.monotonic_ms,
  );
  let Some(_) = cancellation_deadline else {
    state.cancelled_acquires.remove(lease_request.token);
    return Err("복원 잠금 acquire 요청 마감시각이 지났습니다.".to_string());
  };
  if state.cancelled_acquires.contains_key(lease_request.token) {
    return Err("취소된 복원 잠금 acquire token은 다시 사용할 수 없습니다.".to_string());
  }
  acquire_restore_lock_lease_with_renewal_session_inner_at(
    &mut state.lease,
    lease_request.token,
    lease_request.owner,
    lease_request.renewal_session_id,
    lease_request.ttl_ms,
    Some(acquire_request),
    clock,
  )
}

#[cfg(test)]
fn acquire_restore_lock_lease_fenced_inner(
  state: &mut RestoreLockLeaseData,
  token: &str,
  owner: &str,
  ttl_ms: u64,
  request_deadline_ms: u64,
  now: SystemTime,
) -> Result<RestoreLockLeaseRecord, String> {
  acquire_restore_lock_lease_fenced_inner_at(
    state,
    RestoreLockLeaseRequest {
      token,
      owner,
      renewal_session_id: &test_renewal_session_id(token),
      ttl_ms,
      request_deadline_ms,
      request_window_ms: MAX_RESTORE_ACQUIRE_REQUEST_WINDOW_MS,
    },
    test_restore_clock(now),
  )
}

fn cancel_abandoned_restore_lock_acquire_inner_at(
  state: &mut RestoreLockLeaseData,
  token: &str,
  request_deadline_ms: u64,
  request_window_ms: u64,
  clock: RestoreClockSnapshot,
) -> Result<bool, String> {
  if token.trim().is_empty() {
    return Err("복원 잠금 token은 비어 있을 수 없습니다.".to_string());
  }
  let (request, cancellation_deadline) = validate_restore_acquire_request(
    request_deadline_ms,
    request_window_ms,
    clock,
  )?;
  prune_cancelled_restore_acquires(
    &mut state.cancelled_acquires,
    clock.monotonic_ms,
  );
  prune_restore_lock_lease(&mut state.lease, clock.monotonic_ms);

  if state
    .cancelled_acquires
    .get(token)
    .is_some_and(|current| current.request != request)
  {
    return Err("복원 잠금 acquire 취소 요청의 마감시각이 일치하지 않습니다.".to_string());
  }
  if state.lease.as_ref().is_some_and(|current| {
    current.token == token && current.acquire_request.as_ref() != Some(&request)
  }) {
    return Err("복원 잠금 acquire 취소 요청의 마감시각이 일치하지 않습니다.".to_string());
  }

  let removed = state
    .lease
    .as_ref()
    .is_some_and(|current| current.token == token);
  if removed {
    state.lease = None;
  }
  let Some(expires_at_monotonic_ms) = cancellation_deadline else {
    state.cancelled_acquires.remove(token);
    return Ok(removed);
  };
  if !state.cancelled_acquires.contains_key(token)
    && state.cancelled_acquires.len() >= MAX_CANCELLED_RESTORE_ACQUIRES
  {
    return Err("복원 잠금 acquire 취소 기록이 가득 차 정리 후 재시도가 필요합니다.".to_string());
  }
  if !state.cancelled_acquires.contains_key(token) {
    state
      .cancelled_acquires
      .insert(token.to_string(), RestoreAcquireCancellation {
        request,
        expires_at_monotonic_ms,
      });
  }
  Ok(removed)
}

#[cfg(test)]
fn cancel_abandoned_restore_lock_acquire_inner(
  state: &mut RestoreLockLeaseData,
  token: &str,
  request_deadline_ms: u64,
  now: SystemTime,
) -> Result<bool, String> {
  cancel_abandoned_restore_lock_acquire_inner_at(
    state,
    token,
    request_deadline_ms,
    MAX_RESTORE_ACQUIRE_REQUEST_WINDOW_MS,
    test_restore_clock(now),
  )
}

fn prune_cancelled_restore_acquires(
  cancelled_acquires: &mut HashMap<String, RestoreAcquireCancellation>,
  monotonic_now_ms: u64,
) {
  cancelled_acquires.retain(|_, current| {
    current.expires_at_monotonic_ms > monotonic_now_ms
  });
}

fn acquire_restore_lock_lease_with_renewal_session_inner_at(
  lease: &mut Option<RestoreLockLease>,
  token: &str,
  owner: &str,
  renewal_session_id: &str,
  ttl_ms: u64,
  acquire_request: Option<RestoreAcquireRequest>,
  clock: RestoreClockSnapshot,
) -> Result<RestoreLockLeaseRecord, String> {
  validate_restore_lock_identity(token, owner)?;
  validate_restore_renewal_session_id(renewal_session_id)?;
  prune_restore_lock_lease(lease, clock.monotonic_ms);

  if let Some(current) = lease {
    if current.token == token && current.owner == owner {
      if current.acquire_request != acquire_request {
        return Err("복원 잠금 acquire 요청의 마감시각이 일치하지 않습니다.".to_string());
      }
      if current.renewal_session_id != renewal_session_id || !current.renewal_enabled {
        return Err("복원 잠금 renewal session이 일치하지 않거나 종료되었습니다.".to_string());
      }
      update_restore_lock_expiry(current, ttl_ms, clock);
      return Ok(to_restore_lock_lease_record(current));
    }
    return Err("다른 복원 작업이 이미 진행 중입니다.".to_string());
  }

  let next = RestoreLockLease {
    token: token.to_string(),
    owner: owner.to_string(),
    renewal_session_id: renewal_session_id.to_string(),
    renewal_enabled: true,
    expires_at_ms: clock.wall_ms.saturating_add(ttl_ms),
    expires_at_monotonic_ms: clock.monotonic_ms.saturating_add(ttl_ms),
    acquire_request,
    operation_active: false,
  };
  let record = to_restore_lock_lease_record(&next);
  *lease = Some(next);
  Ok(record)
}

#[cfg(test)]
fn acquire_restore_lock_lease_inner_at(
  lease: &mut Option<RestoreLockLease>,
  token: &str,
  owner: &str,
  ttl_ms: u64,
  acquire_request: Option<RestoreAcquireRequest>,
  clock: RestoreClockSnapshot,
) -> Result<RestoreLockLeaseRecord, String> {
  acquire_restore_lock_lease_with_renewal_session_inner_at(
    lease,
    token,
    owner,
    &test_renewal_session_id(token),
    ttl_ms,
    acquire_request,
    clock,
  )
}

#[cfg(test)]
fn acquire_restore_lock_lease_inner(
  lease: &mut Option<RestoreLockLease>,
  token: &str,
  owner: &str,
  ttl_ms: u64,
  now: SystemTime,
) -> Result<RestoreLockLeaseRecord, String> {
  acquire_restore_lock_lease_inner_at(
    lease,
    token,
    owner,
    ttl_ms,
    None,
    test_restore_clock(now),
  )
}

fn current_restore_lock_lease_inner_at(
  lease: &mut Option<RestoreLockLease>,
  clock: RestoreClockSnapshot,
) -> Option<RestoreLockLeaseRecord> {
  prune_restore_lock_lease(lease, clock.monotonic_ms);
  lease.as_ref().map(to_restore_lock_lease_record)
}

#[cfg(test)]
fn current_restore_lock_lease_inner(
  lease: &mut Option<RestoreLockLease>,
  now: SystemTime,
) -> Option<RestoreLockLeaseRecord> {
  current_restore_lock_lease_inner_at(lease, test_restore_clock(now))
}

fn renew_restore_lock_lease_fenced_inner_at(
  lease: &mut Option<RestoreLockLease>,
  lease_request: RestoreLockLeaseRequest<'_>,
  clock: RestoreClockSnapshot,
) -> Result<RestoreLockLeaseRecord, String> {
  validate_restore_lock_identity(lease_request.token, lease_request.owner)?;
  validate_restore_renewal_session_id(lease_request.renewal_session_id)?;
  let (_, request_deadline) = validate_restore_acquire_request(
    lease_request.request_deadline_ms,
    lease_request.request_window_ms,
    clock,
  )?;
  if request_deadline.is_none() {
    return Err("복원 잠금 renew 요청 마감시각이 지났습니다.".to_string());
  }
  prune_restore_lock_lease(lease, clock.monotonic_ms);

  let current = lease
    .as_mut()
    .filter(|current| {
      current.token == lease_request.token && current.owner == lease_request.owner
    })
    .ok_or_else(|| "복원 잠금 lease가 없거나 소유자가 다릅니다.".to_string())?;
  if !current.renewal_enabled
    || current.renewal_session_id != lease_request.renewal_session_id
  {
    return Err("복원 잠금 renewal session이 일치하지 않거나 종료되었습니다.".to_string());
  }
  update_restore_lock_expiry(current, lease_request.ttl_ms, clock);
  Ok(to_restore_lock_lease_record(current))
}

#[cfg(test)]
fn renew_restore_lock_lease_inner_at(
  lease: &mut Option<RestoreLockLease>,
  token: &str,
  owner: &str,
  ttl_ms: u64,
  clock: RestoreClockSnapshot,
) -> Result<RestoreLockLeaseRecord, String> {
  let renewal_session_id = lease
    .as_ref()
    .map(|current| current.renewal_session_id.clone())
    .unwrap_or_else(|| test_renewal_session_id(token));
  renew_restore_lock_lease_fenced_inner_at(
    lease,
    RestoreLockLeaseRequest {
      token,
      owner,
      renewal_session_id: &renewal_session_id,
      ttl_ms,
      request_deadline_ms: clock
        .wall_ms
        .saturating_add(MAX_RESTORE_ACQUIRE_REQUEST_WINDOW_MS),
      request_window_ms: MAX_RESTORE_ACQUIRE_REQUEST_WINDOW_MS,
    },
    clock,
  )
}

#[cfg(test)]
fn renew_restore_lock_lease_inner(
  lease: &mut Option<RestoreLockLease>,
  token: &str,
  owner: &str,
  ttl_ms: u64,
  now: SystemTime,
) -> Result<RestoreLockLeaseRecord, String> {
  renew_restore_lock_lease_inner_at(
    lease,
    token,
    owner,
    ttl_ms,
    test_restore_clock(now),
  )
}

fn invalidate_restore_lock_renewal_session_inner_at(
  lease: &mut Option<RestoreLockLease>,
  token: &str,
  owner: &str,
  renewal_session_id: &str,
  cleanup_grace_ms: u64,
  clock: RestoreClockSnapshot,
) -> Result<bool, String> {
  validate_restore_lock_identity(token, owner)?;
  validate_restore_renewal_session_id(renewal_session_id)?;
  if cleanup_grace_ms == 0 || cleanup_grace_ms > MAX_RESTORE_RENEWAL_CLEANUP_GRACE_MS {
    return Err("복원 잠금 renewal 정리 유예 시간이 유효하지 않습니다.".to_string());
  }
  prune_restore_lock_lease(lease, clock.monotonic_ms);

  let Some(current) = lease
    .as_mut()
    .filter(|current| current.token == token && current.owner == owner)
  else {
    return Ok(false);
  };
  if current.renewal_session_id != renewal_session_id {
    return Err("복원 잠금 renewal session이 일치하지 않습니다.".to_string());
  }

  current.renewal_enabled = false;
  clamp_restore_lock_expiry(current, cleanup_grace_ms, clock);
  Ok(true)
}

fn activate_restore_lock_lease_inner_at(
  lease: &mut Option<RestoreLockLease>,
  token: &str,
  owner: &str,
  clock: RestoreClockSnapshot,
) -> Result<RestoreLockLeaseRecord, String> {
  validate_restore_lock_identity(token, owner)?;
  prune_restore_lock_lease(lease, clock.monotonic_ms);

  let current = lease
    .as_mut()
    .filter(|current| current.token == token && current.owner == owner)
    .ok_or_else(|| "복원 잠금 lease가 없거나 소유자가 다릅니다.".to_string())?;
  if !current.renewal_enabled {
    return Err("종료된 복원 잠금 renewal session은 활성화할 수 없습니다.".to_string());
  }
  current.operation_active = true;
  Ok(to_restore_lock_lease_record(current))
}

#[cfg(test)]
fn activate_restore_lock_lease_inner(
  lease: &mut Option<RestoreLockLease>,
  token: &str,
  owner: &str,
  now: SystemTime,
) -> Result<RestoreLockLeaseRecord, String> {
  activate_restore_lock_lease_inner_at(lease, token, owner, test_restore_clock(now))
}

fn finish_restore_lock_lease_inner_at(
  lease: &mut Option<RestoreLockLease>,
  token: &str,
  owner: &str,
  cleanup_ttl_ms: u64,
  clock: RestoreClockSnapshot,
) -> Result<RestoreLockLeaseRecord, String> {
  validate_restore_lock_identity(token, owner)?;
  prune_restore_lock_lease(lease, clock.monotonic_ms);

  let current = lease
    .as_mut()
    .filter(|current| current.token == token && current.owner == owner)
    .ok_or_else(|| "복원 잠금 lease가 없거나 소유자가 다릅니다.".to_string())?;
  let renewal_was_enabled = current.renewal_enabled;
  current.renewal_enabled = false;
  current.operation_active = false;
  if renewal_was_enabled {
    update_restore_lock_expiry(current, cleanup_ttl_ms, clock);
  } else {
    clamp_restore_lock_expiry(current, cleanup_ttl_ms, clock);
  }
  Ok(to_restore_lock_lease_record(current))
}

#[cfg(test)]
fn finish_restore_lock_lease_inner(
  lease: &mut Option<RestoreLockLease>,
  token: &str,
  owner: &str,
  cleanup_ttl_ms: u64,
  now: SystemTime,
) -> Result<RestoreLockLeaseRecord, String> {
  finish_restore_lock_lease_inner_at(
    lease,
    token,
    owner,
    cleanup_ttl_ms,
    test_restore_clock(now),
  )
}

fn release_restore_lock_lease_inner_at(
  lease: &mut Option<RestoreLockLease>,
  token: &str,
  owner: &str,
  clock: RestoreClockSnapshot,
) -> bool {
  prune_restore_lock_lease(lease, clock.monotonic_ms);
  if lease.as_ref().is_some_and(|current| {
    current.token == token && current.owner == owner
  }) {
    *lease = None;
    true
  } else {
    false
  }
}

#[cfg(test)]
fn release_restore_lock_lease_inner(
  lease: &mut Option<RestoreLockLease>,
  token: &str,
  owner: &str,
  now: SystemTime,
) -> bool {
  release_restore_lock_lease_inner_at(lease, token, owner, test_restore_clock(now))
}

fn validate_restore_lock_identity(token: &str, owner: &str) -> Result<(), String> {
  if token.trim().is_empty() || owner.trim().is_empty() {
    return Err("복원 잠금 token과 owner는 비어 있을 수 없습니다.".to_string());
  }
  Ok(())
}

fn validate_restore_renewal_session_id(renewal_session_id: &str) -> Result<(), String> {
  if renewal_session_id.trim().is_empty() {
    return Err("복원 잠금 renewal session은 비어 있을 수 없습니다.".to_string());
  }
  Ok(())
}

fn validate_restore_acquire_request(
  request_deadline_ms: u64,
  request_window_ms: u64,
  clock: RestoreClockSnapshot,
) -> Result<(RestoreAcquireRequest, Option<u64>), String> {
  if request_window_ms == 0 || request_window_ms > MAX_RESTORE_ACQUIRE_REQUEST_WINDOW_MS {
    return Err("복원 잠금 acquire 요청 허용 시간이 유효하지 않습니다.".to_string());
  }
  let request = RestoreAcquireRequest {
    deadline_ms: request_deadline_ms,
    window_ms: request_window_ms,
  };
  if request_deadline_ms <= clock.wall_ms {
    return Ok((request, None));
  }
  let future_ms = request_deadline_ms - clock.wall_ms;
  if future_ms > request_window_ms.saturating_add(MAX_RESTORE_ACQUIRE_CLOCK_SKEW_MS) {
    return Err("복원 잠금 acquire 요청 마감시각이 허용 범위보다 너무 멉니다.".to_string());
  }
  Ok((
    request,
    Some(
      clock
        .monotonic_ms
        .saturating_add(future_ms.min(request_window_ms)),
    ),
  ))
}

fn update_restore_lock_expiry(
  lease: &mut RestoreLockLease,
  ttl_ms: u64,
  clock: RestoreClockSnapshot,
) {
  lease.expires_at_ms = clock.wall_ms.saturating_add(ttl_ms);
  lease.expires_at_monotonic_ms = clock.monotonic_ms.saturating_add(ttl_ms);
}

fn clamp_restore_lock_expiry(
  lease: &mut RestoreLockLease,
  cleanup_grace_ms: u64,
  clock: RestoreClockSnapshot,
) {
  lease.expires_at_ms = lease
    .expires_at_ms
    .min(clock.wall_ms.saturating_add(cleanup_grace_ms));
  lease.expires_at_monotonic_ms = lease
    .expires_at_monotonic_ms
    .min(clock.monotonic_ms.saturating_add(cleanup_grace_ms));
}

fn system_time_millis(time: SystemTime) -> u64 {
  time
    .duration_since(UNIX_EPOCH)
    .unwrap_or_default()
    .as_millis() as u64
}

fn prune_restore_lock_lease(
  lease: &mut Option<RestoreLockLease>,
  monotonic_now_ms: u64,
) {
  if lease
    .as_ref()
    .is_some_and(|current| current.expires_at_monotonic_ms <= monotonic_now_ms)
  {
    *lease = None;
  }
}

fn to_restore_lock_lease_record(lease: &RestoreLockLease) -> RestoreLockLeaseRecord {
  RestoreLockLeaseRecord {
    token: lease.token.clone(),
    owner: lease.owner.clone(),
    renewal_session_id: lease.renewal_session_id.clone(),
    expires_at_ms: lease.expires_at_ms,
    operation_active: lease.operation_active,
  }
}

#[cfg(test)]
fn test_restore_clock(now: SystemTime) -> RestoreClockSnapshot {
  let milliseconds = system_time_millis(now);
  RestoreClockSnapshot {
    wall_ms: milliseconds,
    monotonic_ms: milliseconds,
  }
}

#[cfg(test)]
fn test_renewal_session_id(token: &str) -> String {
  format!("renewal-{token}")
}

#[tauri::command]
fn claim_memo_window(
  app: AppHandle,
  registry: State<'_, MemoWindowRegistry>,
  restore_lock: State<'_, RestoreLockLeaseState>,
  memo_id: String,
  window_label: String,
) -> Result<MemoWindowClaim, String> {
  let mut restore_state = restore_lock
    .data
    .lock()
    .map_err(|_| "restore lock lease is unavailable".to_string())?;
  ensure_no_live_restore_lock_at(
    &mut restore_state.lease,
    restore_lock.clock_snapshot(),
  )?;

  let claim = {
    let mut owners = registry
      .0
      .lock()
      .map_err(|_| "memo window registry lock is unavailable".to_string())?;
    let now_monotonic_ms = restore_lock.clock_snapshot().monotonic_ms;
    owners.retain(|_, owner| {
      let native_window_exists = app.get_webview_window(&owner.window_label).is_some();
      match owner.state {
        MemoWindowOwnerState::Live => native_window_exists,
        MemoWindowOwnerState::Pending if native_window_exists => {
          owner.state = MemoWindowOwnerState::Live;
          owner.pending_created_at_monotonic_ms = None;
          owner.pending_expires_at_monotonic_ms = None;
          true
        }
        MemoWindowOwnerState::Pending => owner
          .pending_expires_at_monotonic_ms
          .is_some_and(|expires_at| expires_at > now_monotonic_ms),
      }
    });
    let native_window_exists = app.get_webview_window(&window_label).is_some();
    claim_memo_window_owner_locked(
      &mut owners,
      &memo_id,
      &window_label,
      &random_urlsafe(16),
      native_window_exists,
      now_monotonic_ms,
    )
  };

  if !claim.claimed {
    if let Some(window) = app.get_webview_window(&claim.window_label) {
      focus_memo_window(&window)?;
    }
    return Ok(claim);
  }

  Ok(claim)
}

fn ensure_no_live_restore_lock_at(
  lease: &mut Option<RestoreLockLease>,
  clock: RestoreClockSnapshot,
) -> Result<(), String> {
  if current_restore_lock_lease_inner_at(lease, clock).is_some() {
    return Err("복원 잠금 중에는 메모 창을 열 수 없습니다.".to_string());
  }
  Ok(())
}

#[cfg(test)]
fn ensure_no_live_restore_lock(
  lease: &mut Option<RestoreLockLease>,
  now: SystemTime,
) -> Result<(), String> {
  ensure_no_live_restore_lock_at(lease, test_restore_clock(now))
}

#[tauri::command]
fn complete_memo_window(
  registry: State<'_, MemoWindowRegistry>,
  memo_id: String,
  window_label: String,
  claim_token: String,
) -> Result<(), String> {
  if complete_memo_window_owner(&registry, &memo_id, &window_label, &claim_token) {
    Ok(())
  } else {
    Err("memo window reservation is no longer pending".to_string())
  }
}

#[tauri::command]
fn release_memo_window(
  registry: State<'_, MemoWindowRegistry>,
  memo_id: String,
  window_label: String,
  claim_token: String,
) -> Result<(), String> {
  release_memo_window_owner(&registry, &memo_id, &window_label, &claim_token);
  Ok(())
}

#[tauri::command]
fn show_main_window(app: AppHandle) -> Result<(), String> {
  show_main_window_inner(&app)
}

#[tauri::command]
fn quit_app(app: AppHandle) -> Result<(), String> {
  app.exit(0);
  Ok(())
}

#[tauri::command]
async fn export_text_file(
  app: AppHandle,
  file_name: String,
  contents: String,
) -> Result<Option<String>, String> {
  let selected = app
    .dialog()
    .file()
    .add_filter("텍스트 파일", &["txt"])
    .set_file_name(&file_name)
    .blocking_save_file();

  let file_path = match selected {
    Some(path) => path,
    None => return Ok(None),
  };

  let file_system_path = file_path
    .into_path()
    .map_err(|error| format!("선택한 경로는 로컬 파일 경로로 해석할 수 없습니다: {error}"))?;

  fs::write(&file_system_path, contents).map_err(|error| error.to_string())?;
  Ok(Some(file_system_path.to_string_lossy().to_string()))
}

#[tauri::command]
async fn export_json_file(
  app: AppHandle,
  file_name: String,
  contents: String,
) -> Result<Option<String>, String> {
  let selected = app
    .dialog()
    .file()
    .add_filter("JSON 파일", &["json"])
    .set_file_name(&file_name)
    .blocking_save_file();

  let file_path = match selected {
    Some(path) => path,
    None => return Ok(None),
  };

  let file_system_path = file_path
    .into_path()
    .map_err(|error| format!("선택한 경로는 로컬 파일 경로로 해석할 수 없습니다: {error}"))?;

  fs::write(&file_system_path, contents).map_err(|error| error.to_string())?;
  Ok(Some(file_system_path.to_string_lossy().to_string()))
}

#[tauri::command]
async fn import_json_file(app: AppHandle) -> Result<Option<String>, String> {
  let selected = app
    .dialog()
    .file()
    .add_filter("JSON 파일", &["json"])
    .blocking_pick_file();

  let file_path = match selected {
    Some(path) => path,
    None => return Ok(None),
  };

  let file_system_path = file_path
    .into_path()
    .map_err(|error| format!("선택한 경로는 로컬 파일 경로로 해석할 수 없습니다: {error}"))?;

  fs::read_to_string(&file_system_path).map(Some).map_err(|error| error.to_string())
}

#[tauri::command]
async fn start_google_desktop_oauth(client_id: String) -> Result<GoogleOAuthTokens, String> {
  let client_id = client_id.trim().to_string();
  if client_id.is_empty() {
    return Err("Google OAuth Client ID가 비어 있습니다.".to_string());
  }

  tauri::async_runtime::spawn_blocking(move || run_google_desktop_oauth(client_id))
    .await
    .map_err(|error| format!("Google 로그인 작업을 완료하지 못했습니다: {error}"))?
    .map_err(|error| error.to_string())
}

fn run_google_desktop_oauth(client_id: String) -> AnyhowResult<GoogleOAuthTokens> {
  let listener = TcpListener::bind("127.0.0.1:0").context("failed to start loopback listener")?;
  listener
    .set_nonblocking(true)
    .context("failed to configure loopback listener")?;
  let port = listener.local_addr()?.port();
  let redirect_uri = format!("http://127.0.0.1:{port}");
  let state = random_urlsafe(16);
  let code_verifier = random_urlsafe(32);
  let code_challenge = pkce_challenge(&code_verifier);
  let auth_url = build_google_auth_url(
    &client_id,
    &redirect_uri,
    &state,
    &code_challenge,
  );

  open_system_browser(&auth_url)?;

  let (mut stream, _) = accept_loopback_connection(&listener)?;
  let callback_path = read_callback_path(&mut stream)?;
  let callback_url = Url::parse(&format!("{redirect_uri}{callback_path}"))
    .context("failed to parse Google OAuth callback")?;
  let query = callback_url.query_pairs().collect::<Vec<_>>();

  if let Some((_, error)) = query.iter().find(|(key, _)| key == "error") {
    respond_to_browser(&mut stream, false)?;
    return Err(anyhow::anyhow!("Google 로그인이 취소되었거나 실패했습니다: {error}"));
  }

  let returned_state = query
    .iter()
    .find(|(key, _)| key == "state")
    .map(|(_, value)| value.to_string())
    .unwrap_or_default();
  if returned_state != state {
    respond_to_browser(&mut stream, false)?;
    return Err(anyhow::anyhow!("Google 로그인 보안 확인 값이 일치하지 않습니다."));
  }

  let code = query
    .iter()
    .find(|(key, _)| key == "code")
    .map(|(_, value)| value.to_string())
    .filter(|value| !value.is_empty())
    .context("Google 로그인 응답에 인증 코드가 없습니다.")?;

  respond_to_browser(&mut stream, true)?;
  exchange_google_code(&client_id, &redirect_uri, &code, &code_verifier)
}

fn random_urlsafe(byte_count: usize) -> String {
  let mut bytes = vec![0_u8; byte_count];
  rand::thread_rng().fill_bytes(&mut bytes);
  URL_SAFE_NO_PAD.encode(bytes)
}

fn pkce_challenge(code_verifier: &str) -> String {
  let digest = Sha256::digest(code_verifier.as_bytes());
  URL_SAFE_NO_PAD.encode(digest)
}

fn build_google_auth_url(
  client_id: &str,
  redirect_uri: &str,
  state: &str,
  code_challenge: &str,
) -> String {
  let mut serializer = form_urlencoded::Serializer::new(String::new());
  serializer.append_pair("client_id", client_id);
  serializer.append_pair("redirect_uri", redirect_uri);
  serializer.append_pair("response_type", "code");
  serializer.append_pair("scope", GOOGLE_OAUTH_SCOPE);
  serializer.append_pair("state", state);
  serializer.append_pair("code_challenge", code_challenge);
  serializer.append_pair("code_challenge_method", "S256");
  serializer.append_pair("prompt", "select_account");
  let query = serializer.finish();

  format!("{GOOGLE_OAUTH_AUTH_URL}?{query}")
}

fn open_system_browser(url: &str) -> AnyhowResult<()> {
  #[cfg(target_os = "windows")]
  let status = Command::new("rundll32")
    .args(["url.dll,FileProtocolHandler", url])
    .status()
    .context("failed to open system browser")?;

  #[cfg(target_os = "macos")]
  let status = Command::new("open")
    .arg(url)
    .status()
    .context("failed to open system browser")?;

  #[cfg(all(unix, not(target_os = "macos")))]
  let status = Command::new("xdg-open")
    .arg(url)
    .status()
    .context("failed to open system browser")?;

  if status.success() {
    Ok(())
  } else {
    Err(anyhow::anyhow!("system browser command failed"))
  }
}

fn accept_loopback_connection(listener: &TcpListener) -> AnyhowResult<(TcpStream, std::net::SocketAddr)> {
  let deadline = Instant::now() + GOOGLE_OAUTH_TIMEOUT;

  loop {
    match listener.accept() {
      Ok(connection) => return Ok(connection),
      Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
        if Instant::now() >= deadline {
          return Err(anyhow::anyhow!("Google 로그인 시간이 초과되었습니다."));
        }
        std::thread::sleep(Duration::from_millis(100));
      }
      Err(error) => return Err(error).context("failed to receive Google OAuth callback"),
    }
  }
}

fn read_callback_path(stream: &mut TcpStream) -> AnyhowResult<String> {
  stream
    .set_read_timeout(Some(Duration::from_secs(10)))
    .context("failed to configure callback reader")?;

  let mut buffer = [0_u8; 8192];
  let size = stream
    .read(&mut buffer)
    .context("failed to read Google OAuth callback")?;
  let request = String::from_utf8_lossy(&buffer[..size]);
  let request_line = request
    .lines()
    .next()
    .context("Google OAuth callback request is empty")?;
  let path = request_line
    .split_whitespace()
    .nth(1)
    .context("Google OAuth callback path is missing")?;

  Ok(path.to_string())
}

fn respond_to_browser(stream: &mut TcpStream, success: bool) -> AnyhowResult<()> {
  let message = if success {
    "H Memo 구글 로그인이 완료되었습니다. 이 창을 닫고 앱으로 돌아가세요."
  } else {
    "H Memo 구글 로그인을 완료하지 못했습니다. 이 창을 닫고 앱으로 돌아가세요."
  };
  let body = format!(
    "<!doctype html><html lang=\"ko\"><meta charset=\"utf-8\"><title>H Memo</title><body style=\"font-family:system-ui,sans-serif;padding:32px\"><h1>{message}</h1></body></html>"
  );
  respond_with_html(stream, &body)
}

fn respond_with_html(stream: &mut TcpStream, body: &str) -> AnyhowResult<()> {
  let response = format!(
    "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
    body.len(),
    body
  );
  stream
    .write_all(response.as_bytes())
    .context("failed to write Google OAuth browser response")
}

fn exchange_google_code(
  client_id: &str,
  redirect_uri: &str,
  code: &str,
  code_verifier: &str,
) -> AnyhowResult<GoogleOAuthTokens> {
  let client = reqwest::blocking::Client::new();
  let token_form = build_google_token_form(client_id, redirect_uri, code, code_verifier);
  let response = client
    .post(GOOGLE_OAUTH_TOKEN_URL)
    .form(&token_form)
    .send()
    .context("failed to exchange Google OAuth code")?;

  let status = response.status();
  let token_response: GoogleTokenResponse = response
    .json()
    .context("failed to parse Google OAuth token response")?;

  if !status.is_success() || token_response.error.is_some() {
    let error = token_response
      .error_description
      .or(token_response.error)
      .unwrap_or_else(|| format!("HTTP {status}"));
    return Err(anyhow::anyhow!("Google 토큰 교환 실패: {error}"));
  }

  let id_token = token_response
    .id_token
    .filter(|value| !value.is_empty())
    .context("Google 토큰 응답에 ID 토큰이 없습니다.")?;

  Ok(GoogleOAuthTokens {
    id_token,
    access_token: token_response.access_token.unwrap_or_default(),
    expires_in: token_response.expires_in,
  })
}

fn build_google_token_form<'a>(
  client_id: &'a str,
  redirect_uri: &'a str,
  code: &'a str,
  code_verifier: &'a str,
) -> Vec<(&'static str, &'a str)> {
  vec![
    ("client_id", client_id),
    ("redirect_uri", redirect_uri),
    ("grant_type", "authorization_code"),
    ("code", code),
    ("code_verifier", code_verifier),
  ]
}

fn show_main_window_inner(app: &AppHandle) -> Result<(), String> {
  let window = app
    .get_webview_window(WINDOW_LABEL)
    .ok_or_else(|| "main window not found".to_string())?;

  focus_memo_window(&window)
}

fn focus_memo_window(window: &tauri::WebviewWindow) -> Result<(), String> {
  window.unminimize().map_err(|error| error.to_string())?;
  window.show().map_err(|error| error.to_string())?;
  window.set_focus().map_err(|error| error.to_string())?;
  Ok(())
}

fn send_tray_event_to_main(app: &AppHandle, event: &str) -> Result<(), String> {
  show_main_window_inner(app)?;
  app.emit_to(WINDOW_LABEL, event, ()).map_err(|error| error.to_string())
}

fn normalize_record(memo: &MemoRecord) -> MemoRecord {
  let now = Utc::now().to_rfc3339();
  let created_at = memo.created_at.clone();
  let updated_at = memo.updated_at.clone();

  MemoRecord {
    created_at: if created_at.is_empty() { now.clone() } else { created_at },
    updated_at: if updated_at.is_empty() { now } else { updated_at },
    ..memo.clone()
  }
}

fn parse_memo_row(row: &Row<'_>) -> rusqlite::Result<MemoRecord> {
  let rich_content: String = row.get(3)?;
  let style: String = row.get(4)?;
  let window_state: String = row.get(5)?;

  Ok(MemoRecord {
    id: row.get(0)?,
    title: row.get(1)?,
    plain_text: row.get(2)?,
    rich_content: serde_json::from_str(&rich_content).map_err(|error| {
      rusqlite::Error::FromSqlConversionFailure(3, Type::Text, Box::new(error))
    })?,
    style: serde_json::from_str(&style).map_err(|error| {
      rusqlite::Error::FromSqlConversionFailure(4, Type::Text, Box::new(error))
    })?,
    window_state: serde_json::from_str(&window_state).map_err(|error| {
      rusqlite::Error::FromSqlConversionFailure(5, Type::Text, Box::new(error))
    })?,
    created_at: row.get(6)?,
    updated_at: row.get(7)?,
    deleted_at: row.get(8)?,
    sync_state: row.get(9)?,
  })
}

fn upsert_memo(connection: &Connection, memo: &MemoRecord) -> AnyhowResult<()> {
  let rich_content = serde_json::to_string(&memo.rich_content)?;
  let style = serde_json::to_string(&memo.style)?;
  let window_state = serde_json::to_string(&memo.window_state)?;

  connection.execute(
    r#"
    INSERT INTO memos (
      id, title, plain_text, rich_content, style, window_state, created_at, updated_at, deleted_at, sync_state
    )
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      plain_text = excluded.plain_text,
      rich_content = excluded.rich_content,
      style = excluded.style,
      window_state = excluded.window_state,
      updated_at = excluded.updated_at,
      deleted_at = excluded.deleted_at,
      sync_state = excluded.sync_state
    "#,
    params![
      memo.id,
      memo.title,
      memo.plain_text,
      rich_content,
      style,
      window_state,
      memo.created_at,
      memo.updated_at,
      memo.deleted_at,
      memo.sync_state
    ],
  )
  .context("failed to upsert memo")?;

  Ok(())
}

#[cfg(test)]
fn claim_memo_window_owner(
  registry: &MemoWindowRegistry,
  memo_id: &str,
  window_label: &str,
  claim_token: &str,
) -> MemoWindowClaim {
  claim_memo_window_owner_at(registry, memo_id, window_label, claim_token, false, 0)
}

#[cfg(test)]
fn claim_memo_window_owner_at(
  registry: &MemoWindowRegistry,
  memo_id: &str,
  window_label: &str,
  claim_token: &str,
  native_window_exists: bool,
  now_monotonic_ms: u64,
) -> MemoWindowClaim {
  let mut owners = registry
    .0
    .lock()
    .expect("memo window registry lock should not be poisoned");
  claim_memo_window_owner_locked(
    &mut owners,
    memo_id,
    window_label,
    claim_token,
    native_window_exists,
    now_monotonic_ms,
  )
}

#[cfg(test)]
fn claim_memo_window_owner_with_native_window(
  registry: &MemoWindowRegistry,
  memo_id: &str,
  window_label: &str,
  claim_token: &str,
) -> MemoWindowClaim {
  claim_memo_window_owner_at(registry, memo_id, window_label, claim_token, true, 0)
}

fn claim_memo_window_owner_locked(
  owners: &mut HashMap<String, MemoWindowOwner>,
  memo_id: &str,
  window_label: &str,
  claim_token: &str,
  native_window_exists: bool,
  now_monotonic_ms: u64,
) -> MemoWindowClaim {
  let expired_pending = owners.get(memo_id).is_some_and(|owner| {
    owner.state == MemoWindowOwnerState::Pending
      && !native_window_exists
      && owner
        .pending_expires_at_monotonic_ms
        .is_some_and(|expires_at| expires_at <= now_monotonic_ms)
  });
  if expired_pending {
    owners.remove(memo_id);
  }

  match owners.get_mut(memo_id) {
    Some(owner) if owner.window_label != window_label => MemoWindowClaim {
      claimed: false,
      should_create: false,
      window_label: owner.window_label.clone(),
      claim_token: None,
    },
    Some(owner) if owner.state == MemoWindowOwnerState::Pending => {
      if native_window_exists {
        owner.state = MemoWindowOwnerState::Live;
        owner.pending_created_at_monotonic_ms = None;
        owner.pending_expires_at_monotonic_ms = None;
        MemoWindowClaim {
          claimed: true,
          should_create: false,
          window_label: owner.window_label.clone(),
          claim_token: Some(owner.claim_token.clone()),
        }
      } else {
        MemoWindowClaim {
          claimed: true,
          should_create: false,
          window_label: owner.window_label.clone(),
          claim_token: None,
        }
      }
    }
    Some(owner) => MemoWindowClaim {
      claimed: true,
      should_create: false,
      window_label: owner.window_label.clone(),
      claim_token: Some(owner.claim_token.clone()),
    },
    None => {
      let state = if native_window_exists {
        MemoWindowOwnerState::Live
      } else {
        MemoWindowOwnerState::Pending
      };
      owners.insert(
        memo_id.to_string(),
        MemoWindowOwner {
          window_label: window_label.to_string(),
          claim_token: claim_token.to_string(),
          pending_created_at_monotonic_ms: (state == MemoWindowOwnerState::Pending)
            .then_some(now_monotonic_ms),
          pending_expires_at_monotonic_ms: (state == MemoWindowOwnerState::Pending)
            .then_some(now_monotonic_ms.saturating_add(MEMO_WINDOW_CREATION_TIMEOUT_MS)),
          state,
        },
      );
      MemoWindowClaim {
        claimed: true,
        should_create: !native_window_exists,
        window_label: window_label.to_string(),
        claim_token: Some(claim_token.to_string()),
      }
    }
  }
}

fn complete_memo_window_owner(
  registry: &MemoWindowRegistry,
  memo_id: &str,
  window_label: &str,
  claim_token: &str,
) -> bool {
  let mut owners = registry
    .0
    .lock()
    .expect("memo window registry lock should not be poisoned");
  let Some(owner) = owners.get_mut(memo_id) else {
    return false;
  };
  if owner.window_label != window_label || owner.claim_token != claim_token {
    return false;
  }

  if owner.state == MemoWindowOwnerState::Pending {
    owner.state = MemoWindowOwnerState::Live;
    owner.pending_created_at_monotonic_ms = None;
    owner.pending_expires_at_monotonic_ms = None;
  }
  true
}

fn release_memo_window_owner(
  registry: &MemoWindowRegistry,
  memo_id: &str,
  window_label: &str,
  claim_token: &str,
) {
  let mut owners = registry
    .0
    .lock()
    .expect("memo window registry lock should not be poisoned");
  if owners.get(memo_id).is_some_and(|owner| {
    owner.window_label == window_label && owner.claim_token == claim_token
  }) {
    owners.remove(memo_id);
  }
}

fn open_database(app: &AppHandle) -> AnyhowResult<Connection> {
  let data_dir = app
    .path()
    .app_data_dir()
    .context("app data dir unavailable")?;
  let mut db_path = data_dir;
  db_path.push("h-memo.sqlite3");

  std::fs::create_dir_all(db_path.parent().context("invalid db path")?)?;
  Connection::open(&db_path).context("failed to open memo database")
}

fn initialize_database(connection: &Connection) -> AnyhowResult<()> {
  connection.execute(
    r#"
    CREATE TABLE IF NOT EXISTS memos (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      plain_text TEXT NOT NULL,
      rich_content TEXT NOT NULL,
      style TEXT NOT NULL,
      window_state TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      sync_state TEXT NOT NULL
    )
    "#,
    [],
  )?;

  connection.pragma_update(None, "journal_mode", "WAL")?;
  connection.busy_timeout(Duration::from_secs(5))?;

  Ok(())
}

fn build_tray(app: &AppHandle) -> AnyhowResult<()> {
  let show_item =
    MenuItem::with_id(app, OPEN_ALL_MEMOS_LABEL, "메모 모두 열기", true, None::<&str>)?;
  let new_memo_item =
    MenuItem::with_id(app, NEW_MEMO_LABEL, "새 메모", true, None::<&str>)?;
  let quit_item = MenuItem::with_id(app, QUIT_LABEL, "종료", true, None::<&str>)?;

  let menu = Menu::with_items(app, &[&show_item, &new_memo_item, &quit_item])?;

  TrayIconBuilder::new()
    .icon(tauri::include_image!("./icons/32x32.png"))
    .menu(&menu)
    .on_menu_event(|app, event| {
      let id = event.id.as_ref();
      match id {
        OPEN_ALL_MEMOS_LABEL => {
          if let Err(error) = send_tray_event_to_main(app, TRAY_OPEN_ALL_MEMOS_EVENT) {
            eprintln!("failed to open all memo windows: {error}");
          }
        }
        NEW_MEMO_LABEL => {
          if let Err(error) = send_tray_event_to_main(app, TRAY_CREATE_MEMO_EVENT) {
            eprintln!("failed to create memo from tray: {error}");
          }
        }
        QUIT_LABEL => {
          app.exit(0);
        }
        _ => {}
      }
    })
    .on_tray_icon_event(|tray, event| {
      let app = tray.app_handle();
      if let TrayIconEvent::DoubleClick {
        button: MouseButton::Left,
        ..
      } = event
      {
        if let Err(error) = send_tray_event_to_main(app, TRAY_OPEN_ALL_MEMOS_EVENT) {
          eprintln!("failed to open all memo windows from tray double click: {error}");
        }
      }
    })
    .build(app)?;

  let _ = menu;
  Ok(())
}

pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_autostart::Builder::new().build())
    .plugin(tauri_plugin_dialog::init())
    .setup(|app| {
      let connection = open_database(app.handle())?;
      initialize_database(&connection)?;
      app.manage(DatabaseState(Mutex::new(connection)));
      app.manage(MemoWindowRegistry::default());
      app.manage(RestoreLockLeaseState::default());
      build_tray(app.handle())?;
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      list_memos,
      save_memo,
      acquire_restore_lock_lease,
      cancel_abandoned_restore_lock_acquire,
      current_restore_lock_lease,
      renew_restore_lock_lease,
      invalidate_restore_lock_renewal_session,
      activate_restore_lock_lease,
      finish_restore_lock_lease,
      release_restore_lock_lease,
      claim_memo_window,
      complete_memo_window,
      release_memo_window,
      show_main_window,
      quit_app,
      export_text_file,
      export_json_file,
      import_json_file,
      start_google_desktop_oauth
    ])
    .run(tauri::generate_context!())
    .expect("failed to run H Memo");
}

#[cfg(test)]
mod tests {
  use super::*;

  fn lease_time(milliseconds: u64) -> SystemTime {
    UNIX_EPOCH + Duration::from_millis(milliseconds)
  }

  fn test_memo(id: &str, plain_text: &str, updated_at: &str) -> MemoRecord {
    MemoRecord {
      id: id.to_string(),
      title: String::new(),
      plain_text: plain_text.to_string(),
      rich_content: serde_json::json!({ "type": "doc", "content": [] }),
      style: serde_json::json!({}),
      window_state: serde_json::json!({}),
      created_at: "2026-07-11T00:00:00Z".to_string(),
      updated_at: updated_at.to_string(),
      deleted_at: None,
      sync_state: "queued".to_string(),
    }
  }

  #[test]
  fn database_initialization_configures_a_compatible_journal_and_busy_timeout() {
    let connection = Connection::open_in_memory().expect("in-memory database should open");

    initialize_database(&connection).expect("database should initialize");

    let journal_mode: String = connection
      .query_row("PRAGMA journal_mode", [], |row| row.get(0))
      .expect("journal mode should be readable");
    let busy_timeout: u64 = connection
      .query_row("PRAGMA busy_timeout", [], |row| row.get(0))
      .expect("busy timeout should be readable");

    assert!(matches!(journal_mode.as_str(), "wal" | "memory"));
    assert_eq!(busy_timeout, 5_000);
  }

  #[test]
  fn restore_lock_lease_requires_matching_identity_and_prunes_expired_state() {
    let mut lease = None;
    let first = acquire_restore_lock_lease_inner(
      &mut lease,
      "token-1",
      "main",
      100,
      lease_time(1_000),
    )
    .expect("first lease should be acquired");
    assert_eq!(first.token, "token-1");
    assert_eq!(first.owner, "main");

    let conflict = acquire_restore_lock_lease_inner(
      &mut lease,
      "token-2",
      "memo-1",
      100,
      lease_time(1_050),
    );
    assert!(conflict.is_err());

    let stale_release = release_restore_lock_lease_inner(
      &mut lease,
      "token-2",
      "memo-1",
      lease_time(1_050),
    );
    assert!(!stale_release);
    assert!(current_restore_lock_lease_inner(&mut lease, lease_time(1_050)).is_some());

    assert!(current_restore_lock_lease_inner(&mut lease, lease_time(1_101)).is_none());
    assert!(renew_restore_lock_lease_inner(
      &mut lease,
      "token-1",
      "main",
      100,
      lease_time(1_102),
    )
    .is_err());
  }

  #[test]
  fn restore_lock_lease_renew_and_release_require_the_current_token() {
    let mut lease = None;
    acquire_restore_lock_lease_inner(
      &mut lease,
      "token-1",
      "main",
      100,
      lease_time(2_000),
    )
    .expect("lease should be acquired");

    let renewed = renew_restore_lock_lease_inner(
      &mut lease,
      "token-1",
      "main",
      500,
      lease_time(2_050),
    )
    .expect("matching owner should renew the lease");
    assert_eq!(renewed.expires_at_ms, 2_550);

    assert!(!release_restore_lock_lease_inner(
      &mut lease,
      "token-old",
      "main",
      lease_time(2_100),
    ));
    assert!(current_restore_lock_lease_inner(&mut lease, lease_time(2_100)).is_some());
    assert!(release_restore_lock_lease_inner(
      &mut lease,
      "token-1",
      "main",
      lease_time(2_100),
    ));
    assert!(current_restore_lock_lease_inner(&mut lease, lease_time(2_100)).is_none());
  }

  #[test]
  fn invalidation_before_late_renew_rejects_and_clamps_the_session() {
    let mut lease = None;
    acquire_restore_lock_lease_with_renewal_session_inner_at(
      &mut lease,
      "invalidate-first-token",
      "main",
      "renewal-session-1",
      1_000,
      None,
      RestoreClockSnapshot {
        wall_ms: 1_000,
        monotonic_ms: 1_000,
      },
    )
    .expect("lease should acquire with a renewal session");

    assert!(invalidate_restore_lock_renewal_session_inner_at(
      &mut lease,
      "invalidate-first-token",
      "main",
      "renewal-session-1",
      50,
      RestoreClockSnapshot {
        wall_ms: 1_010,
        monotonic_ms: 1_010,
      },
    )
    .expect("matching invalidation should settle"));
    let invalidated = lease.clone();
    assert_eq!(invalidated.as_ref().unwrap().expires_at_monotonic_ms, 1_060);
    assert!(!invalidated.as_ref().unwrap().renewal_enabled);

    let late_renew = renew_restore_lock_lease_fenced_inner_at(
      &mut lease,
      RestoreLockLeaseRequest {
        token: "invalidate-first-token",
        owner: "main",
        renewal_session_id: "renewal-session-1",
        ttl_ms: 1_000,
        request_deadline_ms: 1_050,
        request_window_ms: 50,
      },
      RestoreClockSnapshot {
        wall_ms: 1_020,
        monotonic_ms: 1_020,
      },
    );

    assert!(late_renew.is_err());
    assert_eq!(lease, invalidated);
  }

  #[test]
  fn renew_before_invalidation_is_clamped_to_cleanup_grace() {
    let mut lease = None;
    acquire_restore_lock_lease_with_renewal_session_inner_at(
      &mut lease,
      "renew-first-token",
      "main",
      "renewal-session-2",
      100,
      None,
      RestoreClockSnapshot {
        wall_ms: 2_000,
        monotonic_ms: 2_000,
      },
    )
    .expect("lease should acquire with a renewal session");
    renew_restore_lock_lease_fenced_inner_at(
      &mut lease,
      RestoreLockLeaseRequest {
        token: "renew-first-token",
        owner: "main",
        renewal_session_id: "renewal-session-2",
        ttl_ms: 1_000,
        request_deadline_ms: 2_075,
        request_window_ms: 50,
      },
      RestoreClockSnapshot {
        wall_ms: 2_050,
        monotonic_ms: 2_050,
      },
    )
    .expect("live session should renew before invalidation");

    assert!(invalidate_restore_lock_renewal_session_inner_at(
      &mut lease,
      "renew-first-token",
      "main",
      "renewal-session-2",
      40,
      RestoreClockSnapshot {
        wall_ms: 2_060,
        monotonic_ms: 2_060,
      },
    )
    .expect("invalidation should clamp the renewed lease"));

    let current = lease.as_ref().unwrap();
    assert_eq!(current.expires_at_ms, 2_100);
    assert_eq!(current.expires_at_monotonic_ms, 2_100);
    assert!(!current.renewal_enabled);
  }

  #[test]
  fn expired_renew_deadline_does_not_change_the_lease() {
    let mut lease = None;
    acquire_restore_lock_lease_with_renewal_session_inner_at(
      &mut lease,
      "expired-renew-token",
      "main",
      "renewal-session-3",
      500,
      None,
      RestoreClockSnapshot {
        wall_ms: 3_000,
        monotonic_ms: 3_000,
      },
    )
    .expect("lease should acquire with a renewal session");
    let before = lease.clone();

    let expired = renew_restore_lock_lease_fenced_inner_at(
      &mut lease,
      RestoreLockLeaseRequest {
        token: "expired-renew-token",
        owner: "main",
        renewal_session_id: "renewal-session-3",
        ttl_ms: 1_000,
        request_deadline_ms: 3_050,
        request_window_ms: 50,
      },
      RestoreClockSnapshot {
        wall_ms: 3_060,
        monotonic_ms: 3_060,
      },
    );

    assert!(expired.is_err());
    assert_eq!(lease, before);
  }

  #[test]
  fn live_renewal_session_extends_until_finish_and_release_invalidate_it() {
    let mut lease = None;
    let acquired = acquire_restore_lock_lease_with_renewal_session_inner_at(
      &mut lease,
      "live-session-token",
      "main",
      "renewal-session-4",
      100,
      None,
      RestoreClockSnapshot {
        wall_ms: 4_000,
        monotonic_ms: 4_000,
      },
    )
    .expect("lease should acquire with a renewal session");
    assert_eq!(acquired.renewal_session_id, "renewal-session-4");

    let renewed = renew_restore_lock_lease_fenced_inner_at(
      &mut lease,
      RestoreLockLeaseRequest {
        token: "live-session-token",
        owner: "main",
        renewal_session_id: "renewal-session-4",
        ttl_ms: 500,
        request_deadline_ms: 4_075,
        request_window_ms: 50,
      },
      RestoreClockSnapshot {
        wall_ms: 4_050,
        monotonic_ms: 4_050,
      },
    )
    .expect("matching live session should renew");
    assert_eq!(renewed.expires_at_ms, 4_550);

    finish_restore_lock_lease_inner_at(
      &mut lease,
      "live-session-token",
      "main",
      50,
      RestoreClockSnapshot {
        wall_ms: 4_060,
        monotonic_ms: 4_060,
      },
    )
    .expect("finish should invalidate renewal and retain bounded cleanup");
    assert!(!lease.as_ref().unwrap().renewal_enabled);
    assert!(renew_restore_lock_lease_fenced_inner_at(
      &mut lease,
      RestoreLockLeaseRequest {
        token: "live-session-token",
        owner: "main",
        renewal_session_id: "renewal-session-4",
        ttl_ms: 500,
        request_deadline_ms: 4_090,
        request_window_ms: 50,
      },
      RestoreClockSnapshot {
        wall_ms: 4_070,
        monotonic_ms: 4_070,
      },
    )
    .is_err());
    assert!(release_restore_lock_lease_inner_at(
      &mut lease,
      "live-session-token",
      "main",
      RestoreClockSnapshot {
        wall_ms: 4_080,
        monotonic_ms: 4_080,
      },
    ));
    assert!(lease.is_none());
  }

  #[test]
  fn finish_after_invalidation_cannot_extend_past_the_cleanup_grace() {
    let mut lease = None;
    acquire_restore_lock_lease_with_renewal_session_inner_at(
      &mut lease,
      "finish-after-invalidate-token",
      "main",
      "renewal-session-5",
      100,
      None,
      RestoreClockSnapshot {
        wall_ms: 5_000,
        monotonic_ms: 5_000,
      },
    )
    .expect("lease should acquire with a renewal session");
    renew_restore_lock_lease_fenced_inner_at(
      &mut lease,
      RestoreLockLeaseRequest {
        token: "finish-after-invalidate-token",
        owner: "main",
        renewal_session_id: "renewal-session-5",
        ttl_ms: 1_000,
        request_deadline_ms: 5_075,
        request_window_ms: 50,
      },
      RestoreClockSnapshot {
        wall_ms: 5_050,
        monotonic_ms: 5_050,
      },
    )
    .expect("live session should renew before stop invalidation");
    invalidate_restore_lock_renewal_session_inner_at(
      &mut lease,
      "finish-after-invalidate-token",
      "main",
      "renewal-session-5",
      40,
      RestoreClockSnapshot {
        wall_ms: 5_060,
        monotonic_ms: 5_060,
      },
    )
    .expect("stop invalidation should clamp the lease");

    let finished = finish_restore_lock_lease_inner_at(
      &mut lease,
      "finish-after-invalidate-token",
      "main",
      5_000,
      RestoreClockSnapshot {
        wall_ms: 5_070,
        monotonic_ms: 5_070,
      },
    )
    .expect("late operation settlement should still finish the lease");

    assert_eq!(finished.expires_at_ms, 5_100);
    assert!(!finished.operation_active);
    assert!(renew_restore_lock_lease_fenced_inner_at(
      &mut lease,
      RestoreLockLeaseRequest {
        token: "finish-after-invalidate-token",
        owner: "main",
        renewal_session_id: "renewal-session-5",
        ttl_ms: 1_000,
        request_deadline_ms: 5_080,
        request_window_ms: 50,
      },
      RestoreClockSnapshot {
        wall_ms: 5_080,
        monotonic_ms: 5_080,
      },
    )
    .is_err());
  }

  #[test]
  fn wall_clock_rollback_cannot_extend_a_lease_past_monotonic_ttl() {
    let connection = Connection::open_in_memory().expect("in-memory database should open");
    initialize_database(&connection).expect("database should initialize");
    let mut lease = None;
    let memo = test_memo("memo-clock-rollback", "after rollback", "2026-07-13T00:00:00Z");

    acquire_restore_lock_lease_inner_at(
      &mut lease,
      "rollback-token",
      "main",
      100,
      None,
      RestoreClockSnapshot {
        wall_ms: 3_600_000,
        monotonic_ms: 1_000,
      },
    )
    .expect("lease should acquire before the wall clock rollback");

    let after_ttl = RestoreClockSnapshot {
      wall_ms: 0,
      monotonic_ms: 1_101,
    };
    assert!(current_restore_lock_lease_inner_at(&mut lease, after_ttl).is_none());
    save_memo_inner_at(
      &connection,
      &mut lease,
      &memo,
      None,
      after_ttl,
    )
    .expect("ordinary saves should recover from monotonic expiry");
    ensure_no_live_restore_lock_at(&mut lease, after_ttl)
      .expect("claims should recover from monotonic expiry");
  }

  #[test]
  fn renew_finish_and_release_use_monotonic_time_after_wall_clock_rollback() {
    let mut lease = None;
    acquire_restore_lock_lease_inner_at(
      &mut lease,
      "rollback-cleanup-token",
      "main",
      100,
      None,
      RestoreClockSnapshot {
        wall_ms: 3_600_000,
        monotonic_ms: 1_000,
      },
    )
    .expect("lease should acquire before rollback");

    let renewed = renew_restore_lock_lease_inner_at(
      &mut lease,
      "rollback-cleanup-token",
      "main",
      100,
      RestoreClockSnapshot {
        wall_ms: 0,
        monotonic_ms: 1_050,
      },
    )
    .expect("renewal should use monotonic liveness");
    assert_eq!(renewed.expires_at_ms, 100);

    let finished = finish_restore_lock_lease_inner_at(
      &mut lease,
      "rollback-cleanup-token",
      "main",
      50,
      RestoreClockSnapshot {
        wall_ms: 0,
        monotonic_ms: 1_100,
      },
    )
    .expect("finish should create a monotonic cleanup deadline");
    assert_eq!(finished.expires_at_ms, 50);
    assert!(current_restore_lock_lease_inner_at(
      &mut lease,
      RestoreClockSnapshot {
        wall_ms: 0,
        monotonic_ms: 1_149,
      }
    )
    .is_some());
    assert!(!release_restore_lock_lease_inner_at(
      &mut lease,
      "rollback-cleanup-token",
      "main",
      RestoreClockSnapshot {
        wall_ms: 0,
        monotonic_ms: 1_151,
      },
    ));
    assert!(lease.is_none());
  }

  #[test]
  fn acquire_rejects_implausible_future_deadline_after_wall_clock_rollback() {
    let mut state = RestoreLockLeaseData::default();

    let result = acquire_restore_lock_lease_fenced_inner_at(
      &mut state,
      RestoreLockLeaseRequest {
        token: "future-skew-token",
        owner: "main",
        renewal_session_id: "renewal-future-skew-token",
        ttl_ms: 100,
        request_deadline_ms: 3_601_100,
        request_window_ms: 100,
      },
      RestoreClockSnapshot {
        wall_ms: 1_000,
        monotonic_ms: 500,
      },
    );

    assert!(result
      .expect_err("one-hour future skew must fail closed")
      .contains("마감"));
    assert!(state.lease.is_none());
  }

  #[test]
  fn acquire_accepts_small_wall_skew_within_bounded_request_window() {
    let mut state = RestoreLockLeaseData::default();
    let clock = RestoreClockSnapshot {
      wall_ms: 1_000,
      monotonic_ms: 500,
    };

    let acquired = acquire_restore_lock_lease_fenced_inner_at(
      &mut state,
      RestoreLockLeaseRequest {
        token: "small-skew-token",
        owner: "main",
        renewal_session_id: "renewal-small-skew-token",
        ttl_ms: 100,
        request_deadline_ms: 1_150,
        request_window_ms: 100,
      },
      clock,
    )
    .expect("50ms wall skew should remain within the strict allowance");

    assert_eq!(acquired.expires_at_ms, 1_100);
    assert_eq!(state.lease.as_ref().unwrap().expires_at_monotonic_ms, 600);
    assert!(acquire_restore_lock_lease_fenced_inner_at(
      &mut RestoreLockLeaseData::default(),
      RestoreLockLeaseRequest {
        token: "zero-window-token",
        owner: "main",
        renewal_session_id: "renewal-zero-window-token",
        ttl_ms: 100,
        request_deadline_ms: 1_100,
        request_window_ms: 0,
      },
      clock,
    )
    .is_err());
    assert!(acquire_restore_lock_lease_fenced_inner_at(
      &mut RestoreLockLeaseData::default(),
      RestoreLockLeaseRequest {
        token: "oversized-window-token",
        owner: "main",
        renewal_session_id: "renewal-oversized-window-token",
        ttl_ms: 100,
        request_deadline_ms: 31_001,
        request_window_ms: MAX_RESTORE_ACQUIRE_REQUEST_WINDOW_MS + 1,
      },
      clock,
    )
    .is_err());
  }

  #[test]
  fn cancelled_restore_acquire_rejects_when_cancel_wins_before_acquire() {
    let mut state = RestoreLockLeaseData::default();

    let removed = cancel_abandoned_restore_lock_acquire_inner(
      &mut state,
      "cancel-before-acquire",
      2_300,
      lease_time(2_200),
    )
    .expect("cancellation tombstone should be recorded");
    assert!(!removed);

    let late_acquire = acquire_restore_lock_lease_fenced_inner(
      &mut state,
      "cancel-before-acquire",
      "main",
      500,
      2_300,
      lease_time(2_250),
    );
    assert!(late_acquire
      .expect_err("cancelled token must reject a late acquire")
      .contains("취소"));
    assert!(state.lease.is_none());
  }

  #[test]
  fn expired_request_deadline_rejects_acquire_after_tombstone_pruning() {
    let mut state = RestoreLockLeaseData::default();
    let request_deadline_ms = 2_300;

    cancel_abandoned_restore_lock_acquire_inner(
      &mut state,
      "deadline-fenced-token",
      request_deadline_ms,
      lease_time(2_200),
    )
    .expect("cancellation should retain the acquire deadline");
    prune_cancelled_restore_acquires(
      &mut state.cancelled_acquires,
      70_000,
    );
    assert!(state.cancelled_acquires.is_empty());

    let late_acquire = acquire_restore_lock_lease_fenced_inner(
      &mut state,
      "deadline-fenced-token",
      "main",
      500,
      request_deadline_ms,
      lease_time(70_000),
    );

    assert!(late_acquire
      .expect_err("the absolute request deadline must reject a very late acquire")
      .contains("마감"));
    assert!(current_restore_lock_lease_inner(
      &mut state.lease,
      lease_time(70_000)
    )
    .is_none());
  }

  #[test]
  fn cancelled_restore_acquire_removes_existing_lease_and_prunes_tombstone() {
    let mut state = RestoreLockLeaseData::default();
    acquire_restore_lock_lease_fenced_inner(
      &mut state,
      "cancel-after-acquire",
      "main",
      500,
      2_800,
      lease_time(2_300),
    )
    .expect("lease should acquire before cancellation");

    let removed = cancel_abandoned_restore_lock_acquire_inner(
      &mut state,
      "cancel-after-acquire",
      2_800,
      lease_time(2_310),
    )
    .expect("existing lease cancellation should succeed");
    assert!(removed);
    assert!(state.lease.is_none());
    assert!(acquire_restore_lock_lease_fenced_inner(
      &mut state,
      "cancel-after-acquire",
      "main",
      500,
      2_800,
      lease_time(2_350),
    )
    .is_err());
    assert_eq!(state.cancelled_acquires.len(), 1);

    prune_cancelled_restore_acquires(
      &mut state.cancelled_acquires,
      2_801,
    );
    assert!(state.cancelled_acquires.is_empty());
    acquire_restore_lock_lease_fenced_inner(
      &mut state,
      "new-unique-token",
      "main",
      500,
      3_300,
      lease_time(2_801),
    )
    .expect("pruned tombstones must not block unique future tokens");
  }

  #[test]
  fn cancellation_deadline_mismatch_preserves_matching_lease_and_fence() {
    let mut state = RestoreLockLeaseData::default();
    acquire_restore_lock_lease_fenced_inner_at(
      &mut state,
      RestoreLockLeaseRequest {
        token: "deadline-mismatch-token",
        owner: "main",
        renewal_session_id: "renewal-deadline-mismatch-token",
        ttl_ms: 500,
        request_deadline_ms: 2_800,
        request_window_ms: 500,
      },
      RestoreClockSnapshot {
        wall_ms: 2_300,
        monotonic_ms: 1_000,
      },
    )
    .expect("matching lease should acquire");
    state
      .cancelled_acquires
      .insert(
        "deadline-mismatch-token".to_string(),
        RestoreAcquireCancellation {
          request: RestoreAcquireRequest {
            deadline_ms: 2_800,
            window_ms: 500,
          },
          expires_at_monotonic_ms: 1_500,
        },
      );
    let original_lease = state.lease.clone();
    let original_fence = state.cancelled_acquires.clone();

    let error = cancel_abandoned_restore_lock_acquire_inner_at(
      &mut state,
      "deadline-mismatch-token",
      2_801,
      500,
      RestoreClockSnapshot {
        wall_ms: 2_310,
        monotonic_ms: 1_010,
      },
    )
    .expect_err("deadline mismatch must fail before mutation");

    assert!(error.contains("일치하지"));
    assert_eq!(state.lease, original_lease);
    assert_eq!(state.cancelled_acquires, original_fence);
  }

  #[test]
  fn cancelled_restore_acquire_capacity_fails_closed_without_evicting_live_deadlines() {
    let mut state = RestoreLockLeaseData::default();
    let request_deadline_ms = 20_000;
    let clock = RestoreClockSnapshot {
      wall_ms: 10_000,
      monotonic_ms: 5_000,
    };

    for index in 0..MAX_CANCELLED_RESTORE_ACQUIRES {
      cancel_abandoned_restore_lock_acquire_inner_at(
        &mut state,
        &format!("capacity-token-{index}"),
        20_000,
        10_000,
        clock,
      )
      .expect("each cancellation within capacity should be recorded");
    }

    assert!(state
      .cancelled_acquires
      .values()
      .all(|current| {
        current.request.deadline_ms == request_deadline_ms
          && current.expires_at_monotonic_ms == 15_000
      }));
    let capacity_error = cancel_abandoned_restore_lock_acquire_inner_at(
      &mut state,
      "capacity-token-overflow",
      20_000,
      10_000,
      clock,
    )
    .expect_err("the 257th live cancellation must fail closed");

    assert!(capacity_error.contains("가득"));
    assert_eq!(
      state.cancelled_acquires.len(),
      MAX_CANCELLED_RESTORE_ACQUIRES
    );
    for index in 0..MAX_CANCELLED_RESTORE_ACQUIRES {
      assert!(state
        .cancelled_acquires
        .contains_key(&format!("capacity-token-{index}")));
    }
    assert!(!state
      .cancelled_acquires
      .contains_key("capacity-token-overflow"));

    prune_cancelled_restore_acquires(&mut state.cancelled_acquires, 15_001);
    assert!(state.cancelled_acquires.is_empty());
  }

  #[test]
  fn database_serial_upserts_return_the_newest_memo() {
    let connection = Connection::open_in_memory().expect("in-memory database should open");
    initialize_database(&connection).expect("database should initialize");
    let first = test_memo("memo-1", "first", "2026-07-11T00:00:00Z");
    let newest = test_memo("memo-1", "newest", "2026-07-11T00:01:00Z");

    upsert_memo(&connection, &first).expect("first memo should save");
    upsert_memo(&connection, &newest).expect("newer memo should save");

    let memos = list_memos_from_connection(&connection).expect("memos should list");
    assert_eq!(memos.len(), 1);
    assert_eq!(memos[0].plain_text, "newest");
    assert_eq!(memos[0].updated_at, "2026-07-11T00:01:00Z");
  }

  #[test]
  fn save_memo_enforces_the_restore_token_matrix_before_mutating_the_database() {
    let connection = Connection::open_in_memory().expect("in-memory database should open");
    initialize_database(&connection).expect("database should initialize");
    let mut lease = None;
    let initial = test_memo("memo-save-boundary", "initial", "2026-07-12T09:00:00Z");
    let active = test_memo("memo-save-boundary", "active", "2026-07-12T09:01:00Z");

    save_memo_inner(
      &connection,
      &mut lease,
      &initial,
      None,
      lease_time(3_000),
    )
    .expect("ordinary saves should work without a lease");
    assert!(save_memo_inner(
      &connection,
      &mut lease,
      &active,
      Some("token-before-lease"),
      lease_time(3_001),
    )
    .is_err());

    acquire_restore_lock_lease_inner(
      &mut lease,
      "token-current",
      "main",
      100,
      lease_time(3_010),
    )
    .expect("lease should be acquired");

    save_memo_inner(
      &connection,
      &mut lease,
      &active,
      None,
      lease_time(3_020),
    )
    .expect("ordinary queued saves should drain while the lease is inactive");
    assert!(save_memo_inner(
      &connection,
      &mut lease,
      &active,
      Some("token-current"),
      lease_time(3_021),
    )
    .is_err());
    assert!(save_memo_inner(
      &connection,
      &mut lease,
      &active,
      Some("token-stale"),
      lease_time(3_022),
    )
    .is_err());

    let drained = list_memos_from_connection(&connection).expect("memos should list");
    assert_eq!(drained[0].plain_text, "active");

    activate_restore_lock_lease_inner(&mut lease, "token-current", "main", lease_time(3_025))
      .expect("restore operation should activate after the drain");
    assert!(save_memo_inner(
      &connection,
      &mut lease,
      &active,
      None,
      lease_time(3_026),
    )
    .is_err());

    save_memo_inner(
      &connection,
      &mut lease,
      &active,
      Some("token-current"),
      lease_time(3_030),
    )
    .expect("the exact live lease token should authorize the save");
    assert_eq!(
      list_memos_from_connection(&connection).expect("memos should list")[0].plain_text,
      "active"
    );

    let expired = test_memo("memo-save-boundary", "expired", "2026-07-12T09:02:00Z");
    assert!(save_memo_inner(
      &connection,
      &mut lease,
      &expired,
      Some("token-current"),
      lease_time(3_111),
    )
    .is_err());
    save_memo_inner(
      &connection,
      &mut lease,
      &expired,
      None,
      lease_time(3_112),
    )
    .expect("ordinary saves should resume after owner liveness expires");
    assert!(!release_restore_lock_lease_inner(
      &mut lease,
      "token-current",
      "main",
      lease_time(3_113),
    ));
    save_memo_inner(
      &connection,
      &mut lease,
      &expired,
      None,
      lease_time(3_112),
    )
    .expect("ordinary saves should resume after lease expiry");
  }

  #[test]
  fn memo_window_claim_rejects_a_live_restore_lease_atomically() {
    let mut lease = None;
    ensure_no_live_restore_lock(&mut lease, lease_time(4_000))
      .expect("a claim should be allowed without a live lease");
    acquire_restore_lock_lease_inner(
      &mut lease,
      "claim-lock",
      "main",
      100,
      lease_time(4_000),
    )
    .expect("lease should be acquired");

    assert!(ensure_no_live_restore_lock(&mut lease, lease_time(4_050)).is_err());
    ensure_no_live_restore_lock(&mut lease, lease_time(4_101))
      .expect("claims should resume after the lease expires");
  }

  #[test]
  fn active_restore_operation_remains_authoritative_while_renewed() {
    let connection = Connection::open_in_memory().expect("in-memory database should open");
    initialize_database(&connection).expect("database should initialize");
    let mut lease = None;
    let initial = test_memo("memo-active-operation", "initial", "2026-07-12T09:00:00Z");
    let replacement = test_memo("memo-active-operation", "replacement", "2026-07-12T09:01:00Z");

    save_memo_inner(
      &connection,
      &mut lease,
      &initial,
      None,
      lease_time(5_000),
    )
    .expect("ordinary save should work before the lease");
    acquire_restore_lock_lease_inner(
      &mut lease,
      "active-token",
      "main",
      100,
      lease_time(5_000),
    )
    .expect("lease should be acquired");
    activate_restore_lock_lease_inner(&mut lease, "active-token", "main", lease_time(5_050))
      .expect("operation should become active");
    renew_restore_lock_lease_inner(
      &mut lease,
      "active-token",
      "main",
      500,
      lease_time(5_090),
    )
    .expect("live owner renewal should extend the active deadline");

    let current = current_restore_lock_lease_inner(&mut lease, lease_time(5_500))
      .expect("renewed active lease should remain live");
    assert!(current.operation_active);
    assert!(save_memo_inner(
      &connection,
      &mut lease,
      &replacement,
      None,
      lease_time(5_500),
    )
    .is_err());
    save_memo_inner(
      &connection,
      &mut lease,
      &replacement,
      Some("active-token"),
      lease_time(5_500),
    )
      .expect("matching token should remain controlled while the renewed operation is active");
    assert!(ensure_no_live_restore_lock(&mut lease, lease_time(5_500)).is_err());

    assert!(release_restore_lock_lease_inner(
      &mut lease,
      "active-token",
      "main",
      lease_time(5_520),
    ));
    assert!(current_restore_lock_lease_inner(&mut lease, lease_time(5_520)).is_none());
    save_memo_inner(
      &connection,
      &mut lease,
      &replacement,
      None,
      lease_time(5_521),
    )
    .expect("ordinary saves should resume after matching release");
  }

  #[test]
  fn active_restore_lease_requires_live_owner_renewal() {
    let connection = Connection::open_in_memory().expect("in-memory database should open");
    initialize_database(&connection).expect("database should initialize");
    let mut lease = None;
    let memo = test_memo("memo-owner-loss", "after owner loss", "2026-07-12T09:03:00Z");

    acquire_restore_lock_lease_inner(
      &mut lease,
      "owner-loss-token",
      "main",
      100,
      lease_time(5_700),
    )
    .expect("lease should be acquired");
    activate_restore_lock_lease_inner(
      &mut lease,
      "owner-loss-token",
      "main",
      lease_time(5_710),
    )
    .expect("operation should activate");
    renew_restore_lock_lease_inner(
      &mut lease,
      "owner-loss-token",
      "main",
      100,
      lease_time(5_750),
    )
    .expect("a live owner should extend the active deadline");

    assert!(current_restore_lock_lease_inner(&mut lease, lease_time(5_849)).is_some());
    assert!(ensure_no_live_restore_lock(&mut lease, lease_time(5_849)).is_err());

    assert!(current_restore_lock_lease_inner(&mut lease, lease_time(5_851)).is_none());
    save_memo_inner(
      &connection,
      &mut lease,
      &memo,
      None,
      lease_time(5_851),
    )
    .expect("ordinary saves should recover after owner heartbeat expiry");
    ensure_no_live_restore_lock(&mut lease, lease_time(5_851))
      .expect("window claims should recover after owner heartbeat expiry");
  }

  #[test]
  fn completed_active_restore_lease_expires_from_bounded_cleanup_state() {
    let mut lease = None;
    acquire_restore_lock_lease_inner(
      &mut lease,
      "cleanup-token",
      "main",
      100,
      lease_time(6_000),
    )
    .expect("lease should be acquired");
    activate_restore_lock_lease_inner(&mut lease, "cleanup-token", "main", lease_time(6_050))
      .expect("operation should activate");
    renew_restore_lock_lease_inner(
      &mut lease,
      "cleanup-token",
      "main",
      500,
      lease_time(6_090),
    )
    .expect("active callback should still have a live owner heartbeat");

    let finished = finish_restore_lock_lease_inner(
      &mut lease,
      "cleanup-token",
      "main",
      50,
      lease_time(6_500),
    )
    .expect("settled callback should enter bounded cleanup");
    assert!(!finished.operation_active);
    assert_eq!(finished.expires_at_ms, 6_550);
    assert!(current_restore_lock_lease_inner(&mut lease, lease_time(6_549)).is_some());
    assert!(ensure_no_live_restore_lock(&mut lease, lease_time(6_549)).is_err());

    assert!(current_restore_lock_lease_inner(&mut lease, lease_time(6_551)).is_none());
    ensure_no_live_restore_lock(&mut lease, lease_time(6_551))
      .expect("claims should resume after bounded cleanup expiry");
  }

  #[test]
  fn window_registry_creates_a_pending_reservation_for_an_unowned_memo() {
    let registry = MemoWindowRegistry::default();

    let claim = claim_memo_window_owner(&registry, "memo-1", "main", "token-1");

    assert!(claim.claimed);
    assert!(claim.should_create);
    assert_eq!(claim.window_label, "main");
    assert_eq!(claim.claim_token.as_deref(), Some("token-1"));
  }

  #[test]
  fn window_registry_prevents_a_second_pending_owner_from_creating_the_same_label() {
    let registry = MemoWindowRegistry::default();
    let first = claim_memo_window_owner(&registry, "memo-1", "memo_memo-1", "token-1");
    let second = claim_memo_window_owner(&registry, "memo-1", "memo_memo-1", "token-2");

    assert!(first.should_create);
    assert!(second.claimed);
    assert!(!second.should_create);
    assert_eq!(second.window_label, "memo_memo-1");
    assert_eq!(second.claim_token, None);
  }

  #[test]
  fn window_registry_promotes_a_pending_child_when_its_native_window_exists() {
    let registry = MemoWindowRegistry::default();
    let parent = claim_memo_window_owner(&registry, "memo-1", "memo_memo-1", "token-1");

    let child = claim_memo_window_owner_with_native_window(
      &registry,
      "memo-1",
      "memo_memo-1",
      "token-2",
    );
    let parent_completion = complete_memo_window_owner(
      &registry,
      "memo-1",
      "memo_memo-1",
      "token-1",
    );

    assert!(parent.should_create);
    assert!(child.claimed);
    assert!(!child.should_create);
    assert_eq!(child.claim_token.as_deref(), Some("token-1"));
    assert!(parent_completion);
  }

  #[test]
  fn window_registry_transitions_a_matching_pending_token_to_live() {
    let registry = MemoWindowRegistry::default();
    claim_memo_window_owner(&registry, "memo-1", "main", "token-1");

    complete_memo_window_owner(&registry, "memo-1", "main", "token-1");
    let claim = claim_memo_window_owner(&registry, "memo-1", "main", "token-2");

    assert!(claim.claimed);
    assert!(!claim.should_create);
    assert_eq!(claim.window_label, "main");
    assert_eq!(claim.claim_token.as_deref(), Some("token-1"));
  }

  #[test]
  fn window_registry_rejects_a_different_owner() {
    let registry = MemoWindowRegistry::default();
    claim_memo_window_owner(&registry, "memo-1", "main", "token-1");

    let claim = claim_memo_window_owner(&registry, "memo-1", "memo_memo-1", "token-2");

    assert!(!claim.claimed);
    assert!(!claim.should_create);
    assert_eq!(claim.window_label, "main");
    assert_eq!(claim.claim_token, None);
  }

  #[test]
  fn window_registry_releases_only_the_matching_pending_token() {
    let registry = MemoWindowRegistry::default();
    claim_memo_window_owner(&registry, "memo-1", "memo_memo-1", "token-1");

    release_memo_window_owner(&registry, "memo-1", "memo_memo-1", "token-2");
    let blocked = claim_memo_window_owner(&registry, "memo-1", "memo_memo-1", "token-3");
    release_memo_window_owner(&registry, "memo-1", "memo_memo-1", "token-1");
    let claimed = claim_memo_window_owner(&registry, "memo-1", "memo_memo-1", "token-4");

    assert!(!blocked.should_create);
    assert!(claimed.claimed);
    assert!(claimed.should_create);
    assert_eq!(claimed.claim_token.as_deref(), Some("token-4"));
  }

  #[test]
  fn pending_window_reservation_expires_without_a_native_creation_event() {
    let registry = MemoWindowRegistry::default();
    let first = claim_memo_window_owner_at(&registry, "memo-timeout", "memo-timeout", "token-1", false, 0);
    let blocked = claim_memo_window_owner_at(
      &registry,
      "memo-timeout",
      "memo-timeout",
      "token-2",
      false,
      MEMO_WINDOW_CREATION_TIMEOUT_MS - 1,
    );
    let replacement = claim_memo_window_owner_at(
      &registry,
      "memo-timeout",
      "memo-timeout",
      "token-3",
      false,
      MEMO_WINDOW_CREATION_TIMEOUT_MS,
    );

    assert!(first.should_create);
    assert!(blocked.claimed);
    assert!(!blocked.should_create);
    assert!(replacement.should_create);
    assert_eq!(replacement.claim_token.as_deref(), Some("token-3"));
    assert!(!complete_memo_window_owner(&registry, "memo-timeout", "memo-timeout", "token-1"));
    release_memo_window_owner(&registry, "memo-timeout", "memo-timeout", "token-1");
    assert!(!complete_memo_window_owner(&registry, "memo-timeout", "memo-timeout", "token-1"));
    assert!(complete_memo_window_owner(&registry, "memo-timeout", "memo-timeout", "token-3"));
  }

  #[test]
  fn live_native_window_owner_is_preserved_while_pending_expiry_is_recoverable() {
    let registry = MemoWindowRegistry::default();
    claim_memo_window_owner(&registry, "memo-live", "main", "live-token");
    assert!(complete_memo_window_owner(&registry, "memo-live", "main", "live-token"));

    let other_owner = claim_memo_window_owner_at(
      &registry,
      "memo-live",
      "memo-live-child",
      "new-token",
      false,
      MEMO_WINDOW_CREATION_TIMEOUT_MS + 10_000,
    );

    assert!(!other_owner.claimed);
    assert_eq!(other_owner.window_label, "main");
  }

  #[test]
  fn parses_google_token_response_snake_case() {
    let response: GoogleTokenResponse = serde_json::from_str(
      r#"{
        "id_token": "google-id-token",
        "access_token": "google-access-token",
        "expires_in": 3600
      }"#,
    )
    .expect("token response should parse");

    assert_eq!(response.id_token.as_deref(), Some("google-id-token"));
    assert_eq!(response.access_token.as_deref(), Some("google-access-token"));
    assert_eq!(response.expires_in, Some(3600));
  }

  #[test]
  fn parses_google_token_error_description() {
    let response: GoogleTokenResponse = serde_json::from_str(
      r#"{
        "error": "invalid_request",
        "error_description": "client_secret is missing"
      }"#,
    )
    .expect("token error response should parse");

    assert_eq!(response.error.as_deref(), Some("invalid_request"));
    assert_eq!(
      response.error_description.as_deref(),
      Some("client_secret is missing")
    );
  }

  #[test]
  fn builds_token_form_without_client_secret() {
    let form = build_google_token_form(
      "client-id",
      "http://127.0.0.1:9004",
      "auth-code",
      "code-verifier",
    );

    assert_eq!(form.len(), 5);
    assert!(!form.iter().any(|(key, _)| *key == "client_secret"));
    assert!(form.contains(&("client_id", "client-id")));
    assert!(form.contains(&("redirect_uri", "http://127.0.0.1:9004")));
    assert!(form.contains(&("grant_type", "authorization_code")));
    assert!(form.contains(&("code", "auth-code")));
    assert!(form.contains(&("code_verifier", "code-verifier")));
  }
}
