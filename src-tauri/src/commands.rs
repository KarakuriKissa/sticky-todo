use chrono::Utc;
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder};
use uuid::Uuid;

use crate::db::Database;
use crate::models::*;

fn now() -> String {
    Utc::now().to_rfc3339()
}

// ── KV Settings ────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_kv_setting(key: String, db: State<'_, Database>) -> Result<Option<String>, String> {
    db.get_setting(&key).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_kv_setting(key: String, value: String, db: State<'_, Database>) -> Result<(), String> {
    db.set_setting(&key, &value).map_err(|e| e.to_string())
}

// ── Notes ──────────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_all_notes(db: State<'_, Database>) -> Result<Vec<Note>, String> {
    db.get_all_notes().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_note_items(note_id: String, db: State<'_, Database>) -> Result<Vec<TodoItem>, String> {
    db.get_items(&note_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_note(
    title: String,
    category_id: Option<String>,
    db: State<'_, Database>,
) -> Result<Note, String> {
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
        locked: false,
        warn_days: None,
        created_at: now(),
        updated_at: now(),
        dirty: true,
    };
    db.upsert_note(&note).map_err(|e| e.to_string())?;
    Ok(note)
}

#[tauri::command]
pub fn duplicate_note(
    source_id: String,
    db: State<'_, Database>,
) -> Result<Note, String> {
    let notes = db.get_all_notes().map_err(|e| e.to_string())?;
    let source = notes.iter().find(|n| n.id == source_id)
        .ok_or_else(|| "Note not found".to_string())?;

    let new_note = Note {
        id: Uuid::new_v4().to_string(),
        title: format!("{} (コピー)", source.title),
        category_id: source.category_id.clone(),
        window_x: source.window_x + 20.0,
        window_y: source.window_y + 20.0,
        window_width: source.window_width,
        window_height: source.window_height,
        always_on_top: false,
        color: source.color.clone(),
        sort_order: source.sort_order + 1,
        locked: false,
        warn_days: source.warn_days,
        created_at: now(),
        updated_at: now(),
        dirty: true,
    };
    db.upsert_note(&new_note).map_err(|e| e.to_string())?;

    let items = db.get_items(&source_id).map_err(|e| e.to_string())?;
    for item in &items {
        let new_item = TodoItem {
            id: Uuid::new_v4().to_string(),
            note_id: new_note.id.clone(),
            ..item.clone()
        };
        db.upsert_item(&new_item).map_err(|e| e.to_string())?;
    }

    Ok(new_note)
}

#[tauri::command]
pub fn save_note(note: Note, db: State<'_, Database>) -> Result<(), String> {
    db.upsert_note(&note).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_note(id: String, db: State<'_, Database>) -> Result<(), String> {
    db.delete_note(&id).map_err(|e| e.to_string())
}

// ── Items ───────────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn save_item(item: TodoItem, db: State<'_, Database>) -> Result<(), String> {
    db.upsert_item(&item).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_items(items: Vec<TodoItem>, db: State<'_, Database>) -> Result<(), String> {
    for item in &items {
        db.upsert_item(item).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn delete_item(id: String, db: State<'_, Database>) -> Result<(), String> {
    db.delete_item(&id).map_err(|e| e.to_string())
}

// ── Categories ─────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_categories(db: State<'_, Database>) -> Result<Vec<Category>, String> {
    db.get_categories().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_category(category: Category, db: State<'_, Database>) -> Result<(), String> {
    db.upsert_category(&category).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_category(id: String, db: State<'_, Database>) -> Result<(), String> {
    db.delete_category(&id).map_err(|e| e.to_string())
}

// ── Statuses ───────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_statuses(db: State<'_, Database>) -> Result<Vec<Status>, String> {
    db.get_statuses().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_status(status: Status, db: State<'_, Database>) -> Result<(), String> {
    db.upsert_status(&status).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_status(id: String, db: State<'_, Database>) -> Result<(), String> {
    db.delete_status(&id).map_err(|e| e.to_string())
}

// ── Assignee Groups ────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_assignee_groups(db: State<'_, Database>) -> Result<Vec<AssigneeGroup>, String> {
    db.get_assignee_groups().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_assignee_group(group: AssigneeGroup, db: State<'_, Database>) -> Result<(), String> {
    db.upsert_assignee_group(&group).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_assignee_group(id: String, db: State<'_, Database>) -> Result<(), String> {
    db.delete_assignee_group(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_assignee_persons(db: State<'_, Database>) -> Result<Vec<AssigneePerson>, String> {
    db.get_assignee_persons().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_assignee_person(person: AssigneePerson, db: State<'_, Database>) -> Result<(), String> {
    db.upsert_assignee_person(&person).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_assignee_person(id: String, db: State<'_, Database>) -> Result<(), String> {
    db.delete_assignee_person(&id).map_err(|e| e.to_string())
}

// ── Settings ───────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_settings(db: State<'_, Database>) -> Result<AppSettings, String> {
    let json = db
        .get_setting("app_settings")
        .map_err(|e| e.to_string())?
        .unwrap_or_else(|| serde_json::to_string(&AppSettings::default()).unwrap());
    serde_json::from_str(&json).map_err(|_| "".to_string())
        .or_else(|_| Ok(AppSettings::default()))
}

#[tauri::command]
pub fn save_settings(settings: AppSettings, db: State<'_, Database>) -> Result<(), String> {
    let json = serde_json::to_string(&settings).map_err(|e| e.to_string())?;
    db.set_setting("app_settings", &json).map_err(|e| e.to_string())
}

// ── Windows ────────────────────────────────────────────────────────────────────

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
        label,
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
        win.destroy().map_err(|e| e.to_string())?;
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

// ── Sync ───────────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_dirty_data(
    db: State<'_, Database>,
) -> Result<(Vec<Note>, Vec<TodoItem>), String> {
    let notes = db.get_dirty_notes().map_err(|e| e.to_string())?;
    let items = db.get_dirty_items().map_err(|e| e.to_string())?;
    Ok((notes, items))
}

#[tauri::command]
pub fn mark_synced(db: State<'_, Database>) -> Result<(), String> {
    db.mark_all_clean().map_err(|e| e.to_string())
}

// ── Utility ────────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn generate_id() -> String {
    Uuid::new_v4().to_string()
}

#[tauri::command]
pub fn current_timestamp() -> String {
    now()
}

// ── Database management ────────────────────────────────────────────────────

fn db_file_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join("sticky-todo.db"))
}

#[tauri::command]
pub fn export_database(
    app: AppHandle,
    dest_path: String,
    db: State<'_, Database>,
) -> Result<(), String> {
    // Force a WAL checkpoint so all data is written into the main DB file.
    {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        let _ = conn.execute("PRAGMA wal_checkpoint(TRUNCATE)", []);
    }
    let src = db_file_path(&app)?;
    std::fs::copy(&src, &dest_path).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn import_database(app: AppHandle, src_path: String) -> Result<(), String> {
    // Verify the source is a valid (non-empty) SQLite file before scheduling.
    let meta = std::fs::metadata(&src_path).map_err(|e| format!("ファイルが読めません: {}", e))?;
    if meta.len() < 100 {
        return Err("インポートファイルが小さすぎます（壊れている可能性）".into());
    }
    // Don't try to overwrite the live DB while it's open. Write a marker file
    // and let the next startup do the swap (see lib.rs setup hook).
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let marker = data_dir.join(".import-pending");
    std::fs::write(&marker, &src_path).map_err(|e| e.to_string())?;
    app.restart();
}

// Global search across every (non-archived) item in every note.
#[tauri::command]
pub fn search_all_items(
    query: String,
    db: State<'_, Database>,
) -> Result<Vec<(TodoItem, String)>, String> {
    let q = query.trim().to_lowercase();
    if q.is_empty() {
        return Ok(vec![]);
    }
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT i.id,i.note_id,i.parent_id,i.text,i.checked,i.indent,i.collapsed,i.locked,
                    i.status,i.assignees,i.assignee_person_id,i.memo,i.bold,i.priority,
                    i.start_date,i.end_date,i.limit_date,i.item_type,i.sort_order,i.archived,
                    i.updated_at,i.dirty,n.title
             FROM todo_items i JOIN notes n ON n.id = i.note_id
             WHERE i.archived = 0 AND lower(i.text) LIKE '%' || ?1 || '%'
             LIMIT 200",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([&q], |r| {
            Ok((
                TodoItem {
                    id: r.get(0)?,
                    note_id: r.get(1)?,
                    parent_id: r.get(2)?,
                    text: r.get(3)?,
                    checked: r.get::<_, i32>(4)? != 0,
                    indent: r.get(5)?,
                    collapsed: r.get::<_, i32>(6)? != 0,
                    locked: r.get::<_, i32>(7)? != 0,
                    status: r.get(8)?,
                    assignees: r.get::<_, Option<String>>(9)?.unwrap_or_else(|| "[]".into()),
                    assignee_person_id: r.get(10)?,
                    memo: r.get(11)?,
                    bold: r.get::<_, i32>(12)? != 0,
                    priority: r.get(13)?,
                    start_date: r.get(14)?,
                    end_date: r.get(15)?,
                    limit_date: r.get(16)?,
                    item_type: r.get(17)?,
                    sort_order: r.get(18)?,
                    archived: r.get::<_, i32>(19)? != 0,
                    updated_at: r.get(20)?,
                    dirty: r.get::<_, i32>(21)? != 0,
                },
                r.get::<_, String>(22)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        if let Ok(r) = row {
            out.push(r);
        }
    }
    Ok(out)
}

#[tauri::command]
pub fn delete_database(app: AppHandle) -> Result<(), String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let marker = data_dir.join(".delete-pending");
    std::fs::write(&marker, "").map_err(|e| e.to_string())?;
    app.restart();
}
