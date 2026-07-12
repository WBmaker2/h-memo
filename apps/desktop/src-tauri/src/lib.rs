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
struct RestoreLockLeaseState(Mutex<Option<RestoreLockLease>>);

#[derive(Debug, Clone, PartialEq, Eq)]
struct RestoreLockLease {
  token: String,
  owner: String,
  expires_at: SystemTime,
  operation_active: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct RestoreLockLeaseRecord {
  token: String,
  owner: String,
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
  let mut lease = restore_lock
    .0
    .lock()
    .map_err(|_| "restore lock lease is unavailable".to_string())?;
  let connection = database
    .0
    .lock()
    .map_err(|_| "database lock is unavailable".to_string())?;
  save_memo_inner(
    &connection,
    &mut lease,
    &memo,
    restore_token.as_deref(),
    SystemTime::now(),
  )
}

fn save_memo_inner(
  connection: &Connection,
  lease: &mut Option<RestoreLockLease>,
  memo: &MemoRecord,
  restore_token: Option<&str>,
  now: SystemTime,
) -> Result<MemoRecord, String> {
  authorize_restore_save(lease, restore_token, now)?;
  let updated = normalize_record(memo);
  upsert_memo(connection, &updated).map_err(|error| error.to_string())?;
  Ok(updated)
}

fn authorize_restore_save(
  lease: &mut Option<RestoreLockLease>,
  restore_token: Option<&str>,
  now: SystemTime,
) -> Result<(), String> {
  prune_restore_lock_lease(lease, now);
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
  ttl_ms: u64,
) -> Result<RestoreLockLeaseRecord, String> {
  let mut lease = state
    .0
    .lock()
    .map_err(|_| "restore lock lease is unavailable".to_string())?;
  acquire_restore_lock_lease_inner(&mut lease, &token, &owner, ttl_ms, SystemTime::now())
}

#[tauri::command]
fn current_restore_lock_lease(
  state: State<'_, RestoreLockLeaseState>,
) -> Result<Option<RestoreLockLeaseRecord>, String> {
  let mut lease = state
    .0
    .lock()
    .map_err(|_| "restore lock lease is unavailable".to_string())?;
  Ok(current_restore_lock_lease_inner(&mut lease, SystemTime::now()))
}

#[tauri::command]
fn renew_restore_lock_lease(
  state: State<'_, RestoreLockLeaseState>,
  token: String,
  owner: String,
  ttl_ms: u64,
) -> Result<RestoreLockLeaseRecord, String> {
  let mut lease = state
    .0
    .lock()
    .map_err(|_| "restore lock lease is unavailable".to_string())?;
  renew_restore_lock_lease_inner(&mut lease, &token, &owner, ttl_ms, SystemTime::now())
}

#[tauri::command]
fn activate_restore_lock_lease(
  state: State<'_, RestoreLockLeaseState>,
  token: String,
  owner: String,
) -> Result<RestoreLockLeaseRecord, String> {
  let mut lease = state
    .0
    .lock()
    .map_err(|_| "restore lock lease is unavailable".to_string())?;
  activate_restore_lock_lease_inner(&mut lease, &token, &owner, SystemTime::now())
}

#[tauri::command]
fn release_restore_lock_lease(
  state: State<'_, RestoreLockLeaseState>,
  token: String,
  owner: String,
) -> Result<bool, String> {
  let mut lease = state
    .0
    .lock()
    .map_err(|_| "restore lock lease is unavailable".to_string())?;
  Ok(release_restore_lock_lease_inner(
    &mut lease,
    &token,
    &owner,
    SystemTime::now(),
  ))
}

fn acquire_restore_lock_lease_inner(
  lease: &mut Option<RestoreLockLease>,
  token: &str,
  owner: &str,
  ttl_ms: u64,
  now: SystemTime,
) -> Result<RestoreLockLeaseRecord, String> {
  validate_restore_lock_identity(token, owner)?;
  prune_restore_lock_lease(lease, now);

  if let Some(current) = lease {
    if current.token == token && current.owner == owner {
      current.expires_at = expires_at(now, ttl_ms);
      return Ok(to_restore_lock_lease_record(current));
    }
    return Err("다른 복원 작업이 이미 진행 중입니다.".to_string());
  }

  let next = RestoreLockLease {
    token: token.to_string(),
    owner: owner.to_string(),
    expires_at: expires_at(now, ttl_ms),
    operation_active: false,
  };
  let record = to_restore_lock_lease_record(&next);
  *lease = Some(next);
  Ok(record)
}

fn current_restore_lock_lease_inner(
  lease: &mut Option<RestoreLockLease>,
  now: SystemTime,
) -> Option<RestoreLockLeaseRecord> {
  prune_restore_lock_lease(lease, now);
  lease.as_ref().map(to_restore_lock_lease_record)
}

fn renew_restore_lock_lease_inner(
  lease: &mut Option<RestoreLockLease>,
  token: &str,
  owner: &str,
  ttl_ms: u64,
  now: SystemTime,
) -> Result<RestoreLockLeaseRecord, String> {
  validate_restore_lock_identity(token, owner)?;
  prune_restore_lock_lease(lease, now);

  let current = lease
    .as_mut()
    .filter(|current| current.token == token && current.owner == owner)
    .ok_or_else(|| "복원 잠금 lease가 없거나 소유자가 다릅니다.".to_string())?;
  current.expires_at = expires_at(now, ttl_ms);
  Ok(to_restore_lock_lease_record(current))
}

fn activate_restore_lock_lease_inner(
  lease: &mut Option<RestoreLockLease>,
  token: &str,
  owner: &str,
  now: SystemTime,
) -> Result<RestoreLockLeaseRecord, String> {
  validate_restore_lock_identity(token, owner)?;
  prune_restore_lock_lease(lease, now);

  let current = lease
    .as_mut()
    .filter(|current| current.token == token && current.owner == owner)
    .ok_or_else(|| "복원 잠금 lease가 없거나 소유자가 다릅니다.".to_string())?;
  current.operation_active = true;
  Ok(to_restore_lock_lease_record(current))
}

fn release_restore_lock_lease_inner(
  lease: &mut Option<RestoreLockLease>,
  token: &str,
  owner: &str,
  now: SystemTime,
) -> bool {
  prune_restore_lock_lease(lease, now);
  if lease.as_ref().is_some_and(|current| {
    current.token == token && current.owner == owner
  }) {
    *lease = None;
    true
  } else {
    false
  }
}

fn validate_restore_lock_identity(token: &str, owner: &str) -> Result<(), String> {
  if token.trim().is_empty() || owner.trim().is_empty() {
    return Err("복원 잠금 token과 owner는 비어 있을 수 없습니다.".to_string());
  }
  Ok(())
}

fn expires_at(now: SystemTime, ttl_ms: u64) -> SystemTime {
  now + Duration::from_millis(ttl_ms)
}

fn prune_restore_lock_lease(lease: &mut Option<RestoreLockLease>, now: SystemTime) {
  if lease
    .as_ref()
    .is_some_and(|current| current.expires_at <= now && !current.operation_active)
  {
    *lease = None;
  }
}

fn to_restore_lock_lease_record(lease: &RestoreLockLease) -> RestoreLockLeaseRecord {
  RestoreLockLeaseRecord {
    token: lease.token.clone(),
    owner: lease.owner.clone(),
    expires_at_ms: lease
      .expires_at
      .duration_since(UNIX_EPOCH)
      .unwrap_or_default()
      .as_millis() as u64,
    operation_active: lease.operation_active,
  }
}

#[tauri::command]
fn claim_memo_window(
  app: AppHandle,
  registry: State<'_, MemoWindowRegistry>,
  restore_lock: State<'_, RestoreLockLeaseState>,
  memo_id: String,
  window_label: String,
) -> Result<MemoWindowClaim, String> {
  let mut lease = restore_lock
    .0
    .lock()
    .map_err(|_| "restore lock lease is unavailable".to_string())?;
  ensure_no_live_restore_lock(&mut lease, SystemTime::now())?;

  let claim = {
    let mut owners = registry
      .0
      .lock()
      .map_err(|_| "memo window registry lock is unavailable".to_string())?;
    owners.retain(|_, owner| {
      owner.state == MemoWindowOwnerState::Pending
        || app.get_webview_window(&owner.window_label).is_some()
    });
    let native_window_exists = app.get_webview_window(&window_label).is_some();
    claim_memo_window_owner_locked(
      &mut owners,
      &memo_id,
      &window_label,
      &random_urlsafe(16),
      native_window_exists,
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

fn ensure_no_live_restore_lock(
  lease: &mut Option<RestoreLockLease>,
  now: SystemTime,
) -> Result<(), String> {
  if current_restore_lock_lease_inner(lease, now).is_some() {
    return Err("복원 잠금 중에는 메모 창을 열 수 없습니다.".to_string());
  }
  Ok(())
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
  let mut owners = registry
    .0
    .lock()
    .expect("memo window registry lock should not be poisoned");
  claim_memo_window_owner_locked(&mut owners, memo_id, window_label, claim_token, false)
}

#[cfg(test)]
fn claim_memo_window_owner_with_native_window(
  registry: &MemoWindowRegistry,
  memo_id: &str,
  window_label: &str,
  claim_token: &str,
) -> MemoWindowClaim {
  let mut owners = registry
    .0
    .lock()
    .expect("memo window registry lock should not be poisoned");
  claim_memo_window_owner_locked(&mut owners, memo_id, window_label, claim_token, true)
}

fn claim_memo_window_owner_locked(
  owners: &mut HashMap<String, MemoWindowOwner>,
  memo_id: &str,
  window_label: &str,
  claim_token: &str,
  native_window_exists: bool,
) -> MemoWindowClaim {
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
      owners.insert(
        memo_id.to_string(),
        MemoWindowOwner {
          window_label: window_label.to_string(),
          claim_token: claim_token.to_string(),
          state: MemoWindowOwnerState::Pending,
        },
      );
      MemoWindowClaim {
        claimed: true,
        should_create: true,
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
      current_restore_lock_lease,
      renew_restore_lock_lease,
      activate_restore_lock_lease,
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
    save_memo_inner(
      &connection,
      &mut lease,
      &expired,
      Some("token-current"),
      lease_time(3_111),
    )
    .expect("the exact live lease token should remain valid after ttl expiry");
    assert!(save_memo_inner(
      &connection,
      &mut lease,
      &expired,
      None,
      lease_time(3_112),
    )
    .is_err());
    assert!(release_restore_lock_lease_inner(
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
  fn active_restore_operation_remains_authoritative_after_lease_expiry() {
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

    let current = current_restore_lock_lease_inner(&mut lease, lease_time(5_500))
      .expect("active lease should survive ttl expiry");
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
    .expect("matching token should remain controlled while operation is active");
    assert!(ensure_no_live_restore_lock(&mut lease, lease_time(5_500)).is_err());

    assert!(release_restore_lock_lease_inner(
      &mut lease,
      "active-token",
      "main",
      lease_time(5_600),
    ));
    assert!(current_restore_lock_lease_inner(&mut lease, lease_time(5_600)).is_none());
    save_memo_inner(
      &connection,
      &mut lease,
      &replacement,
      None,
      lease_time(5_601),
    )
    .expect("ordinary saves should resume after matching release");
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
