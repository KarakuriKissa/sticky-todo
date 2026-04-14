use rusqlite::{params, Connection, Result};
use std::sync::Mutex;
use uuid::Uuid;

use crate::models::*;

pub struct Database {
    pub conn: Mutex<Connection>,
}

impl Database {
    pub fn new(path: &str) -> Result<Self> {
        let conn = Connection::open(path)?;
        let db = Database {
            conn: Mutex::new(conn),
        };
        db.init()?;
        Ok(db)
    }

    fn init(&self) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute_batch("
            PRAGMA journal_mode=WAL;
            PRAGMA foreign_keys=ON;

            CREATE TABLE IF NOT EXISTS notes (
                id            TEXT PRIMARY KEY,
                title         TEXT NOT NULL DEFAULT '',
                category_id   TEXT,
                window_x      REAL DEFAULT 100,
                window_y      REAL DEFAULT 100,
                window_width  REAL DEFAULT 420,
                window_height REAL DEFAULT 520,
                always_on_top INTEGER DEFAULT 0,
                color         TEXT DEFAULT '#fef08a',
                sort_order    INTEGER DEFAULT 0,
                updated_at    TEXT NOT NULL,
                dirty         INTEGER DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS todo_items (
                id          TEXT PRIMARY KEY,
                note_id     TEXT NOT NULL,
                parent_id   TEXT,
                text        TEXT NOT NULL DEFAULT '',
                checked     INTEGER DEFAULT 0,
                indent      INTEGER DEFAULT 0,
                collapsed   INTEGER DEFAULT 0,
                status      TEXT,
                assignees   TEXT DEFAULT '[]',
                start_date  TEXT,
                end_date    TEXT,
                limit_date  TEXT,
                item_type   TEXT DEFAULT 'normal',
                sort_order  INTEGER DEFAULT 0,
                archived    INTEGER DEFAULT 0,
                updated_at  TEXT NOT NULL,
                dirty       INTEGER DEFAULT 1,
                FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS categories (
                id         TEXT PRIMARY KEY,
                name       TEXT NOT NULL,
                color      TEXT DEFAULT '#6366f1',
                sort_order INTEGER DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS statuses (
                id         TEXT PRIMARY KEY,
                name       TEXT NOT NULL,
                color      TEXT DEFAULT '#94a3b8',
                sort_order INTEGER DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS settings (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
        ")?;

        // Seed default statuses once
        let count: i64 =
            conn.query_row("SELECT COUNT(*) FROM statuses", [], |r| r.get(0))?;
        if count == 0 {
            let defaults = [
                ("開始前", "#94a3b8"),
                ("新規",   "#60a5fa"),
                ("作業中", "#34d399"),
                ("リテイク", "#f87171"),
                ("中断",   "#fb923c"),
                ("完了",   "#4ade80"),
                ("終了",   "#a3a3a3"),
                ("確認待ち", "#c084fc"),
                ("中止",   "#71717a"),
            ];
            for (i, (name, color)) in defaults.iter().enumerate() {
                conn.execute(
                    "INSERT INTO statuses (id,name,color,sort_order) VALUES (?1,?2,?3,?4)",
                    params![Uuid::new_v4().to_string(), name, color, i as i64],
                )?;
            }
        }
        Ok(())
    }

    // ── Notes ────────────────────────────────────────────────────────────────

    pub fn get_all_notes(&self) -> Result<Vec<Note>> {
        let conn = self.conn.lock().unwrap();
        let mut s = conn.prepare(
            "SELECT id,title,category_id,window_x,window_y,window_width,window_height,
                    always_on_top,color,sort_order,updated_at,dirty
             FROM notes ORDER BY sort_order, updated_at DESC"
        )?;
        let rows = s.query_map([], |r| Ok(note_from_row(r)))??;
        Ok(rows.collect())
    }

    pub fn upsert_note(&self, n: &Note) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO notes
             (id,title,category_id,window_x,window_y,window_width,window_height,
              always_on_top,color,sort_order,updated_at,dirty)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
            params![
                n.id, n.title, n.category_id,
                n.window_x, n.window_y, n.window_width, n.window_height,
                n.always_on_top as i32, n.color,
                n.sort_order, n.updated_at, n.dirty as i32
            ],
        )?;
        Ok(())
    }

    pub fn delete_note(&self, id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM notes WHERE id=?1", [id])?;
        Ok(())
    }

    // ── Items ─────────────────────────────────────────────────────────────────

    pub fn get_items(&self, note_id: &str) -> Result<Vec<TodoItem>> {
        let conn = self.conn.lock().unwrap();
        let mut s = conn.prepare(
            "SELECT id,note_id,parent_id,text,checked,indent,collapsed,status,
                    assignees,start_date,end_date,limit_date,item_type,
                    sort_order,archived,updated_at,dirty
             FROM todo_items WHERE note_id=?1 AND archived=0
             ORDER BY sort_order"
        )?;
        let rows = s.query_map([note_id], |r| Ok(item_from_row(r)))??;
        Ok(rows.collect())
    }

    pub fn upsert_item(&self, it: &TodoItem) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO todo_items
             (id,note_id,parent_id,text,checked,indent,collapsed,status,
              assignees,start_date,end_date,limit_date,item_type,
              sort_order,archived,updated_at,dirty)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17)",
            params![
                it.id, it.note_id, it.parent_id, it.text,
                it.checked as i32, it.indent, it.collapsed as i32,
                it.status, it.assignees,
                it.start_date, it.end_date, it.limit_date,
                it.item_type, it.sort_order, it.archived as i32,
                it.updated_at, it.dirty as i32
            ],
        )?;
        Ok(())
    }

    pub fn delete_item(&self, id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM todo_items WHERE id=?1", [id])?;
        Ok(())
    }

    // ── Categories ────────────────────────────────────────────────────────────

    pub fn get_categories(&self) -> Result<Vec<Category>> {
        let conn = self.conn.lock().unwrap();
        let mut s = conn.prepare("SELECT id,name,color,sort_order FROM categories ORDER BY sort_order")?;
        let rows = s.query_map([], |r| {
            Ok(Category { id: r.get(0)?, name: r.get(1)?, color: r.get(2)?, sort_order: r.get(3)? })
        })??;
        Ok(rows.collect())
    }

    pub fn upsert_category(&self, c: &Category) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO categories (id,name,color,sort_order) VALUES (?1,?2,?3,?4)",
            params![c.id, c.name, c.color, c.sort_order],
        )?;
        Ok(())
    }

    pub fn delete_category(&self, id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM categories WHERE id=?1", [id])?;
        Ok(())
    }

    // ── Statuses ──────────────────────────────────────────────────────────────

    pub fn get_statuses(&self) -> Result<Vec<Status>> {
        let conn = self.conn.lock().unwrap();
        let mut s = conn.prepare("SELECT id,name,color,sort_order FROM statuses ORDER BY sort_order")?;
        let rows = s.query_map([], |r| {
            Ok(Status { id: r.get(0)?, name: r.get(1)?, color: r.get(2)?, sort_order: r.get(3)? })
        })??;
        Ok(rows.collect())
    }

    pub fn upsert_status(&self, s: &Status) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        self.conn.lock().unwrap().execute(
            "INSERT OR REPLACE INTO statuses (id,name,color,sort_order) VALUES (?1,?2,?3,?4)",
            params![s.id, s.name, s.color, s.sort_order],
        )?;
        Ok(())
    }

    pub fn delete_status(&self, id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM statuses WHERE id=?1", [id])?;
        Ok(())
    }

    // ── Settings ──────────────────────────────────────────────────────────────

    pub fn get_setting(&self, key: &str) -> Result<Option<String>> {
        let conn = self.conn.lock().unwrap();
        Ok(conn.query_row("SELECT value FROM settings WHERE key=?1", [key], |r| r.get(0)).ok())
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO settings (key,value) VALUES (?1,?2)",
            [key, value],
        )?;
        Ok(())
    }

    // ── Sync helpers ──────────────────────────────────────────────────────────

    pub fn get_dirty_notes(&self) -> Result<Vec<Note>> {
        let conn = self.conn.lock().unwrap();
        let mut s = conn.prepare(
            "SELECT id,title,category_id,window_x,window_y,window_width,window_height,
                    always_on_top,color,sort_order,updated_at,dirty
             FROM notes WHERE dirty=1"
        )?;
        let rows = s.query_map([], |r| Ok(note_from_row(r)))??;
        Ok(rows.collect())
    }

    pub fn get_dirty_items(&self) -> Result<Vec<TodoItem>> {
        let conn = self.conn.lock().unwrap();
        let mut s = conn.prepare(
            "SELECT id,note_id,parent_id,text,checked,indent,collapsed,status,
                    assignees,start_date,end_date,limit_date,item_type,
                    sort_order,archived,updated_at,dirty
             FROM todo_items WHERE dirty=1"
        )?;
        let rows = s.query_map([], |r| Ok(item_from_row(r)))??;
        Ok(rows.collect())
    }

    pub fn mark_all_clean(&self) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("UPDATE notes SET dirty=0", [])?;
        conn.execute("UPDATE todo_items SET dirty=0", [])?;
        Ok(())
    }
}

// ── Row helpers ───────────────────────────────────────────────────────────────

fn note_from_row(r: &rusqlite::Row) -> Note {
    Note {
        id:            r.get(0).unwrap(),
        title:         r.get(1).unwrap(),
        category_id:   r.get(2).unwrap(),
        window_x:      r.get(3).unwrap(),
        window_y:      r.get(4).unwrap(),
        window_width:  r.get(5).unwrap(),
        window_height: r.get(6).unwrap(),
        always_on_top: r.get::<_, i32>(7).unwrap() != 0,
        color:         r.get(8).unwrap(),
        sort_order:    r.get(9).unwrap(),
        updated_at:    r.get(10).unwrap(),
        dirty:         r.get::<_, i32>(11).unwrap() != 0,
    }
}

fn item_from_row(r: &rusqlite::Row) -> TodoItem {
    TodoItem {
        id:         r.get(0).unwrap(),
        note_id:    r.get(1).unwrap(),
        parent_id:  r.get(2).unwrap(),
        text:       r.get(3).unwrap(),
        checked:    r.get::<_, i32>(4).unwrap() != 0,
        indent:     r.get(5).unwrap(),
        collapsed:  r.get::<_, i32>(6).unwrap() != 0,
        status:     r.get(7).unwrap(),
        assignees:  r.get::<_, String>(8).unwrap_or_else(|_| "[]".into()),
        start_date: r.get(9).unwrap(),
        end_date:   r.get(10).unwrap(),
        limit_date: r.get(11).unwrap(),
        item_type:  r.get(12).unwrap(),
        sort_order: r.get(13).unwrap(),
        archived:   r.get::<_, i32>(14).unwrap() != 0,
        updated_at: r.get(15).unwrap(),
        dirty:      r.get::<_, i32>(16).unwrap() != 0,
    }
}
