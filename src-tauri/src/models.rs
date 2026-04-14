use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Note {
    pub id: String,
    pub title: String,
    pub category_id: Option<String>,
    pub window_x: f64,
    pub window_y: f64,
    pub window_width: f64,
    pub window_height: f64,
    pub always_on_top: bool,
    pub color: String,
    pub sort_order: i64,
    pub updated_at: String,
    pub dirty: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TodoItem {
    pub id: String,
    pub note_id: String,
    pub parent_id: Option<String>,
    pub text: String,
    pub checked: bool,
    pub indent: i32,
    pub collapsed: bool,
    pub status: Option<String>,
    pub assignees: String, // JSON array string e.g. '["Alice","Bob"]'
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub limit_date: Option<String>,
    pub item_type: String, // "normal" | "heading" | "separator" | "group"
    pub sort_order: i64,
    pub archived: bool,
    pub updated_at: String,
    pub dirty: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Category {
    pub id: String,
    pub name: String,
    pub color: String,
    pub sort_order: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Status {
    pub id: String,
    pub name: String,
    pub color: String,
    pub sort_order: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppSettings {
    pub sync_enabled: bool,
    pub sync_token: Option<String>,
    pub sort_mode: String, // "manual"|"deadline"|"start_date"|"status"|"name"
    pub feature_sync: bool,
    pub feature_status: bool,
    pub feature_assignee: bool,
    pub feature_date: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            sync_enabled: false,
            sync_token: None,
            sort_mode: "manual".into(),
            feature_sync: false,
            feature_status: true,
            feature_assignee: false,
            feature_date: true,
        }
    }
}
