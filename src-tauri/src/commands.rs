use chrono::Utc;
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder};
use uuid::Uuid;

use crate::db::Database;
use crate::models::*;

type Db<'a> = State<'a, Database>;

fn now() -> String {
    Utc::now().to_rfc3339()
}

// ── Note commands ─────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_all_notes(db: Db) -> Result<Vec<Note>, String> {
    db.get_all_notes().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_note_items(note_id: String, db: Db) -> Result<Vec<TodoItem>, String> {
    db.get_items(&note_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_note(title: String, category_id: Option<String>, db: Db) -> Result<Note, String> {
    let note = Note {
        id: Uuid::new_v4().to_string(),
        title,
        category_id,
        window_x: 120.0,
        window_y: 120.0,
        window_width: 420.0,
        window_height: 520.0,
        always_on_top: false,
        color: "#fef08a".into(),
        sort_order: 0,
        updated_at: now(),
        dirty: true,
    };
    db.upsert_note(&note).map_err(|e| e.to_string())?;
    Ok(note)
}

#[tauri::command]
pub fn save_note(note: Note, db: Db) -> Result<(), String> {
    db.upsert_note(&note).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_note(id: String, db: Db) -> Result<(), String> {
    db.delete_note(&id).map_err(|e| e.to_string())
}

// ── Item commands ─────────────────────────────────────────────────────────────

#[tauri::command]
pub fn save_item(item: TodoItem, db: Db) -> Result<(), String> {
    db.upsert_item(&item).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_items(items: Vec<TodoItem>, db: Db) -> Result<(), String> {
    for item in &items {
        db.upsert_item(item).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn delete_item(id: String, db: Db) -> Result<(), String> {
    db.delete_item(&id).map_err(|e| e.to_string())
}

// ── Category commands ─────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_categories(db: Db) -> Result<Vec<Category>, String> {
    db.get_categories().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_category(category: Category, db: Db) -> Result<(), String> {
    db.upsert_category(&category).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_category(id: String, db: Db) -> Result<(), String> {
    db.delete_category(&id).map_err(|e| e.to_string())
}

// ── Status commands ───────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_statuses(db: Db) -> Result<Vec<Status>, String> {
    db.get_statuses().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_status(status: Status, db: Db) -> Result<(), String> {
    db.upsert_status(&status).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_status(id: String, db: Db) -> Result<(), String> {
    db.delete_status(&id).map_err(|e| e.to_string())
}

// ── Settings commands ─────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_settings(db: Db) -> Result<AppSettings, String> {
    let json = db
        .get_setting("app_settings")
        .map_err(|e| e.to_string())?
        .unwrap_or_else(|| serde_json::to_string(&AppSettings::default()).unwrap());
    serde_json::from_str(&json).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_settings(settings: AppSettings, db: Db) -> Result<(), String> {
    let json = serde_json::to_string(&settings).map_err(|e| e.to_string())?;
    db.set_setting("app_settings", &json).map_err(|e| e.to_string())
}

// ── Window commands ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn open_note_window(
    app: AppHandle,
    note_id: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let label = format!("note-{}", note_id);
    if let Some(win) = app.get_webview_window(&label) {
        win.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }
    WebviewWindowBuilder::new(
        &app,
        &label,
        WebviewUrl::App(format!("/?window=note&id={}", note_id).into()),
    )
    .title("Note")
    .inner_size(width, height)
    .position(x, y)
    .decorations(false)
    .transparent(true)
    .resizable(true)
    .min_inner_size(200.0, 150.0)
    .build()
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn close_note_window(app: AppHandle, note_id: String) -> Result<(), String> {
    let label = format!("note-{}", note_id);
    if let Some(win) = app.get_webview_window(&label) {
        win.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn set_always_on_top(
    app: AppHandle,
    note_id: String,
    on_top: bool,
) -> Result<(), String> {
    let label = format!("note-{}", note_id);
    if let Some(win) = app.get_webview_window(&label) {
        win.set_always_on_top(on_top).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn start_dragging(app: AppHandle, note_id: String) -> Result<(), String> {
    let label = format!("note-{}", note_id);
    if let Some(win) = app.get_webview_window(&label) {
        win.start_dragging().map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ── Sync commands ─────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_dirty_data(db: Db) -> Result<(Vec<Note>, Vec<TodoItem>), String> {
    let notes = db.get_dirty_notes().map_err(|e| e.to_string())?;
    let items = db.get_dirty_items().map_err(|e| e.to_string())?;
    Ok((notes, items))
}

#[tauri::command]
pub fn mark_synced(db: Db) -> Result<(), String> {
    db.mark_all_clean().map_err(|e| e.to_string())
}

// ── Utility ───────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn generate_id() -> String {
    Uuid::new_v4().to_string()
}

#[tauri::command]
pub fn current_timestamp() -> String {
    now()
}
