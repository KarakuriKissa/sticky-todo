mod commands;
mod db;
mod models;

use db::Database;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .expect("Cannot resolve app data dir");
            std::fs::create_dir_all(&data_dir)?;
            let db_path = data_dir.join("sticky-todo.db");
            let db = Database::new(db_path.to_str().unwrap())
                .expect("Failed to initialize database");
            app.manage(db);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_kv_setting,
            commands::set_kv_setting,
            commands::get_all_notes,
            commands::get_note_items,
            commands::create_note,
            commands::duplicate_note,
            commands::save_note,
            commands::delete_note,
            commands::save_item,
            commands::save_items,
            commands::delete_item,
            commands::get_categories,
            commands::save_category,
            commands::delete_category,
            commands::get_statuses,
            commands::save_status,
            commands::delete_status,
            commands::get_assignee_groups,
            commands::save_assignee_group,
            commands::delete_assignee_group,
            commands::get_assignee_persons,
            commands::save_assignee_person,
            commands::delete_assignee_person,
            commands::get_settings,
            commands::save_settings,
            commands::open_note_window,
            commands::close_note_window,
            commands::set_always_on_top,
            commands::start_dragging,
            commands::get_dirty_data,
            commands::mark_synced,
            commands::generate_id,
            commands::current_timestamp,
            commands::export_database,
            commands::import_database,
            commands::delete_database,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
