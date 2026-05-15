use std::fs;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::Command;
use std::time::{Duration, Instant};

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
  tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
  AppHandle, Manager,
};
use tauri_plugin_dialog::DialogExt;
use url::{form_urlencoded, Url};

const WINDOW_LABEL: &str = "main";
const SHOW_MEMO_LABEL: &str = "show_memo";
const NEW_MEMO_LABEL: &str = "new_memo";
const QUIT_LABEL: &str = "quit";
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GoogleOAuthTokens {
  id_token: String,
  access_token: String,
  expires_in: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GoogleTokenResponse {
  id_token: Option<String>,
  access_token: Option<String>,
  expires_in: Option<u64>,
  error: Option<String>,
  error_description: Option<String>,
}

#[tauri::command]
async fn list_memos(app: AppHandle) -> Result<Vec<MemoRecord>, String> {
  let connection = open_db(&app).map_err(|error| error.to_string())?;
  let mut statement = connection
    .prepare(
      r#"
      SELECT id, title, plain_text, rich_content, style, window_state, created_at, updated_at, deleted_at, sync_state
      FROM memos
      ORDER BY updated_at DESC
      "#,
    )
    .map_err(|error| error.to_string())?;

  let rows = statement
    .query_map([], parse_memo_row)
    .map_err(|error| error.to_string())?;

  let memos = rows
    .collect::<Result<Vec<MemoRecord>, rusqlite::Error>>()
    .map_err(|error| error.to_string())?;

  Ok(memos)
}

#[tauri::command]
async fn save_memo(app: AppHandle, memo: MemoRecord) -> Result<MemoRecord, String> {
  let connection = open_db(&app).map_err(|error| error.to_string())?;
  let updated = normalize_record(&memo);
  upsert_memo(&connection, &updated).map_err(|error| error.to_string())?;
  Ok(updated)
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
    body.as_bytes().len(),
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
  let response = client
    .post(GOOGLE_OAUTH_TOKEN_URL)
    .form(&[
      ("client_id", client_id),
      ("redirect_uri", redirect_uri),
      ("grant_type", "authorization_code"),
      ("code", code),
      ("code_verifier", code_verifier),
    ])
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

fn show_main_window_inner(app: &AppHandle) -> Result<(), String> {
  let window = app
    .get_webview_window(WINDOW_LABEL)
    .ok_or_else(|| "main window not found".to_string())?;

  window.unminimize().ok();
  window.show().map_err(|error| error.to_string())?;
  window.set_focus().map_err(|error| error.to_string())?;
  Ok(())
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

fn open_db(app: &AppHandle) -> AnyhowResult<Connection> {
  let data_dir = app
    .path()
    .app_data_dir()
    .context("app data dir unavailable")?;
  let mut db_path = PathBuf::from(data_dir);
  db_path.push("h-memo.sqlite3");

  std::fs::create_dir_all(&db_path.parent().context("invalid db path")?)?;
  let connection = Connection::open(&db_path)?;

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

  Ok(connection)
}

fn build_tray(app: &AppHandle) -> AnyhowResult<()> {
  let show_item =
    MenuItem::with_id(app, SHOW_MEMO_LABEL, "메모 열기", true, None::<&str>)?;
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
        SHOW_MEMO_LABEL => {
          if let Err(error) = show_main_window_inner(app) {
            eprintln!("failed to open main window: {error}");
          }
        }
        NEW_MEMO_LABEL => {
          if let Err(error) = show_main_window_inner(app) {
            eprintln!("failed to open main window: {error}");
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
      if let TrayIconEvent::Click {
        button: MouseButton::Left,
        button_state: MouseButtonState::Up,
        ..
      } = event
      {
        if let Err(error) = show_main_window_inner(app) {
          eprintln!("failed to focus main window: {error}");
        }
      }
    })
    .build(app)?;

  let _ = menu;
  Ok(())
}

pub fn run() {
  let _ = tauri::Builder::default()
    .plugin(tauri_plugin_autostart::Builder::new().build())
    .plugin(tauri_plugin_dialog::init())
    .setup(|app| {
      let app_handle = app.handle();
      build_tray(app_handle)?;
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      list_memos,
      save_memo,
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
