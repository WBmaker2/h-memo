use std::path::PathBuf;

use anyhow::{Context, Result as AnyhowResult};
use chrono::Utc;
use rusqlite::{params, Connection, Row};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{
  menu::{Menu, MenuItem},
  tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
  AppHandle, Manager,
};

const WINDOW_LABEL: &str = "main";
const SHOW_MEMO_LABEL: &str = "show_memo";
const NEW_MEMO_LABEL: &str = "new_memo";
const QUIT_LABEL: &str = "quit";

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
    rich_content: serde_json::from_str(&rich_content).unwrap_or(Value::Null),
    style: serde_json::from_str(&style).unwrap_or(Value::Null),
    window_state: serde_json::from_str(&window_state).unwrap_or(Value::Null),
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
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_opener::init())
    .setup(|app| {
      let app_handle = app.handle();
      build_tray(app_handle)?;
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![list_memos, save_memo, show_main_window])
    .run(tauri::generate_context!())
    .expect("failed to run H Memo");
}
