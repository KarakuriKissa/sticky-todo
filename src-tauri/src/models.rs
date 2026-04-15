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
    pub locked: bool,
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
    pub assignees: String, // legacy JSON array string
    pub assignee_person_id: Option<String>,
    pub memo: Option<String>,
    pub bold: bool,
    pub priority: Option<String>, // "high" | "medium" | "low" | null
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub limit_date: Option<String>,
    pub item_type: String, // "normal" | "heading" | "separator"
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
pub struct AssigneeGroup {
    pub id: String,
    pub name: String,
    pub sort_order: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AssigneePerson {
    pub id: String,
    pub group_id: String,
    pub name: String,
    pub color: String,
    pub sort_order: i64,
}

fn default_sort_mode() -> String { "manual".into() }
fn default_true() -> bool { true }
fn default_false() -> bool { false }

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppSettings {
    #[serde(default = "default_sort_mode")]
    pub sort_mode: String,
    #[serde(default = "default_true")]
    pub feature_status: bool,
    #[serde(default = "default_false")]
    pub feature_assignee: bool,
    #[serde(default = "default_true")]
    pub feature_date: bool,
    #[serde(default = "default_false")]
    pub feature_memo: bool,
    #[serde(default = "default_false")]
    pub feature_priority: bool,
    #[serde(default)]
    pub active_group_id: Option<String>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            sort_mode: "manual".into(),
            feature_status: true,
            feature_assignee: false,
            feature_date: true,
            feature_memo: false,
            feature_priority: false,
            active_group_id: None,
        }
    }
}
