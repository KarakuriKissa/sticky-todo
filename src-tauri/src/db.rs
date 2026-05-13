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
        let db = Database { conn: Mutex::new(conn) };
        db.init()?;
        Ok(db)
    }

    fn init(&self) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute_batch(
            "PRAGMA journal_mode=WAL;
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
                 locked        INTEGER DEFAULT 0,
                 warn_days     INTEGER,
                 created_at    TEXT,
                 updated_at    TEXT NOT NULL,
                 dirty         INTEGER DEFAULT 0
             );
             CREATE TABLE IF NOT EXISTS todo_items (
                 id                 TEXT PRIMARY KEY,
                 note_id            TEXT NOT NULL,
                 parent_id          TEXT,
                 text               TEXT NOT NULL DEFAULT '',
                 checked            INTEGER DEFAULT 0,
                 indent             INTEGER DEFAULT 0,
                 collapsed          INTEGER DEFAULT 0,
                 locked             INTEGER DEFAULT 0,
                 status             TEXT,
                 assignees          TEXT DEFAULT '[]',
                 assignee_person_id TEXT,
                 memo               TEXT,
                 bold               INTEGER DEFAULT 0,
                 priority           TEXT,
                 start_date         TEXT,
                 end_date           TEXT,
                 limit_date         TEXT,
                 item_type          TEXT DEFAULT 'normal',
                 sort_order         INTEGER DEFAULT 0,
                 archived           INTEGER DEFAULT 0,
                 updated_at         TEXT NOT NULL,
                 dirty              INTEGER DEFAULT 1,
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
             CREATE TABLE IF NOT EXISTS assignee_groups (
                 id         TEXT PRIMARY KEY,
                 name       TEXT NOT NULL,
                 sort_order INTEGER DEFAULT 0
             );
             CREATE TABLE IF NOT EXISTS assignee_persons (
                 id         TEXT PRIMARY KEY,
                 group_id   TEXT NOT NULL,
                 name       TEXT NOT NULL,
                 color      TEXT DEFAULT '#6366f1',
                 sort_order INTEGER DEFAULT 0,
                 FOREIGN KEY (group_id) REFERENCES assignee_groups(id) ON DELETE CASCADE
             );
             CREATE TABLE IF NOT EXISTS settings (
                 key   TEXT PRIMARY KEY,
                 value TEXT NOT NULL
             );",
        )?;

        // Migrations (silently ignored if column already exists)
        let _ = conn.execute("ALTER TABLE notes ADD COLUMN locked INTEGER DEFAULT 0", []);
        let _ = conn.execute("ALTER TABLE notes ADD COLUMN warn_days INTEGER", []);
        conn.execute("ALTER TABLE notes ADD COLUMN created_at TEXT", []).ok();
        let _ = conn.execute("ALTER TABLE todo_items ADD COLUMN locked INTEGER DEFAULT 0", []);
        let _ = conn.execute("ALTER TABLE todo_items ADD COLUMN assignee_person_id TEXT", []);
        let _ = conn.execute("ALTER TABLE todo_items ADD COLUMN memo TEXT", []);
        let _ = conn.execute("ALTER TABLE todo_items ADD COLUMN bold INTEGER DEFAULT 0", []);
        let _ = conn.execute("ALTER TABLE todo_items ADD COLUMN priority TEXT", []);

        // Seed default categories
        let cat_count: i64 =
            conn.query_row("SELECT COUNT(*) FROM categories", [], |r| r.get(0))?;
        if cat_count == 0 {
            let defaults = [
                ("個人", "#60a5fa"),
                ("仕事", "#34d399"),
                ("プロジェクト", "#c084fc"),
            ];
            for (i, (name, color)) in defaults.iter().enumerate() {
                conn.execute(
                    "INSERT INTO categories (id,name,color,sort_order) VALUES (?1,?2,?3,?4)",
                    params![Uuid::new_v4().to_string(), name, color, i as i64],
                )?;
            }
        }

        // Seed default statuses
        let count: i64 =
            conn.query_row("SELECT COUNT(*) FROM statuses", [], |r| r.get(0))?;
        if count == 0 {
            let defaults = [
                ("開始前",   "#94a3b8"),
                ("新規",     "#60a5fa"),
                ("作業中",   "#34d399"),
                ("リテイク", "#f87171"),
                ("中断",     "#fb923c"),
                ("完了",     "#4ade80"),
                ("終了",     "#a3a3a3"),
                ("確認待ち", "#c084fc"),
                ("中止",     "#71717a"),
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

    // ── Notes ─────────────────────────────────────────────────────────────────

    pub fn get_all_notes(&self) -> Result<Vec<Note>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id,title,category_id,window_x,window_y,window_width,window_height,
                    always_on_top,color,sort_order,locked,warn_days,created_at,updated_at,dirty
             FROM notes ORDER BY sort_order, updated_at DESC",
        )?;
        let mut rows = stmt.query([])?;
        let mut out = Vec::new();
        while let Some(r) = rows.next()? {
            out.push(Note {
                id:            r.get(0)?,
                title:         r.get(1)?,
                category_id:   r.get(2)?,
                window_x:      r.get(3)?,
                window_y:      r.get(4)?,
                window_width:  r.get(5)?,
                window_height: r.get(6)?,
                always_on_top: r.get::<_, i32>(7)? != 0,
                color:         r.get(8)?,
                sort_order:    r.get(9)?,
                locked:        r.get::<_, i32>(10)? != 0,
                warn_days:     r.get(11)?,
                created_at:    r.get::<_, Option<String>>(12)?.unwrap_or_else(default_created_at),
                updated_at:    r.get(13)?,
                dirty:         r.get::<_, i32>(14)? != 0,
            });
        }
        Ok(out)
    }

    pub fn upsert_note(&self, n: &Note) -> Result<()> {
        // IMPORTANT: Must NOT use "INSERT OR REPLACE" — that would DELETE then
        // INSERT, which cascades through the ON DELETE CASCADE foreign key on
        // todo_items.note_id and wipes all tasks belonging to this note.
        // Use INSERT ... ON CONFLICT DO UPDATE which preserves child rows.
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO notes
             (id,title,category_id,window_x,window_y,window_width,window_height,
              always_on_top,color,sort_order,locked,warn_days,created_at,updated_at,dirty)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)
             ON CONFLICT(id) DO UPDATE SET
                title=excluded.title,
                category_id=excluded.category_id,
                window_x=excluded.window_x,
                window_y=excluded.window_y,
                window_width=excluded.window_width,
                window_height=excluded.window_height,
                always_on_top=excluded.always_on_top,
                color=excluded.color,
                sort_order=excluded.sort_order,
                locked=excluded.locked,
                warn_days=excluded.warn_days,
                created_at=excluded.created_at,
                updated_at=excluded.updated_at,
                dirty=excluded.dirty",
            params![
                n.id, n.title, n.category_id,
                n.window_x, n.window_y, n.window_width, n.window_height,
                n.always_on_top as i32, n.color,
                n.sort_order, n.locked as i32, n.warn_days,
                n.created_at, n.updated_at, n.dirty as i32,
            ],
        )?;
        Ok(())
    }

    pub fn delete_note(&self, id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM notes WHERE id=?1", [id])?;
        Ok(())
    }

    // ── Items ──────────────────────────────────────────────────────────────────

    pub fn get_items(&self, note_id: &str) -> Result<Vec<TodoItem>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id,note_id,parent_id,text,checked,indent,collapsed,locked,status,
                    assignees,assignee_person_id,memo,bold,priority,
                    start_date,end_date,limit_date,item_type,
                    sort_order,archived,updated_at,dirty
             FROM todo_items WHERE note_id=?1 ORDER BY sort_order",
        )?;
        let mut rows = stmt.query([note_id])?;
        let mut out = Vec::new();
        while let Some(r) = rows.next()? {
            out.push(TodoItem {
                id:                 r.get(0)?,
                note_id:            r.get(1)?,
                parent_id:          r.get(2)?,
                text:               r.get(3)?,
                checked:            r.get::<_, i32>(4)? != 0,
                indent:             r.get(5)?,
                collapsed:          r.get::<_, i32>(6)? != 0,
                locked:             r.get::<_, i32>(7)? != 0,
                status:             r.get(8)?,
                assignees:          r.get::<_, Option<String>>(9)?.unwrap_or_else(|| "[]".into()),
                assignee_person_id: r.get(10)?,
                memo:               r.get(11)?,
                bold:               r.get::<_, i32>(12)? != 0,
                priority:           r.get(13)?,
                start_date:         r.get(14)?,
                end_date:           r.get(15)?,
                limit_date:         r.get(16)?,
                item_type:          r.get(17)?,
                sort_order:         r.get(18)?,
                archived:           r.get::<_, i32>(19)? != 0,
                updated_at:         r.get(20)?,
                dirty:              r.get::<_, i32>(21)? != 0,
            });
        }
        Ok(out)
    }

    pub fn upsert_item(&self, it: &TodoItem) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO todo_items
             (id,note_id,parent_id,text,checked,indent,collapsed,locked,status,
              assignees,assignee_person_id,memo,bold,priority,
              start_date,end_date,limit_date,item_type,
              sort_order,archived,updated_at,dirty)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22)",
            params![
                it.id, it.note_id, it.parent_id, it.text,
                it.checked as i32, it.indent, it.collapsed as i32, it.locked as i32,
                it.status, it.assignees, it.assignee_person_id,
                it.memo, it.bold as i32, it.priority,
                it.start_date, it.end_date, it.limit_date,
                it.item_type, it.sort_order, it.archived as i32,
                it.updated_at, it.dirty as i32,
            ],
        )?;
        Ok(())
    }

    pub fn delete_item(&self, id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM todo_items WHERE id=?1", [id])?;
        Ok(())
    }

    // ── Categories ─────────────────────────────────────────────────────────────

    pub fn get_categories(&self) -> Result<Vec<Category>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id,name,color,sort_order FROM categories ORDER BY sort_order",
        )?;
        let mut rows = stmt.query([])?;
        let mut out = Vec::new();
        while let Some(r) = rows.next()? {
            out.push(Category {
                id:         r.get(0)?,
                name:       r.get(1)?,
                color:      r.get(2)?,
                sort_order: r.get(3)?,
            });
        }
        Ok(out)
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

    // ── Statuses ───────────────────────────────────────────────────────────────

    pub fn get_statuses(&self) -> Result<Vec<Status>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id,name,color,sort_order FROM statuses ORDER BY sort_order",
        )?;
        let mut rows = stmt.query([])?;
        let mut out = Vec::new();
        while let Some(r) = rows.next()? {
            out.push(Status {
                id:         r.get(0)?,
                name:       r.get(1)?,
                color:      r.get(2)?,
                sort_order: r.get(3)?,
            });
        }
        Ok(out)
    }

    pub fn upsert_status(&self, s: &Status) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
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

    // ── Assignee Groups ────────────────────────────────────────────────────────

    pub fn get_assignee_groups(&self) -> Result<Vec<AssigneeGroup>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id,name,sort_order FROM assignee_groups ORDER BY sort_order",
        )?;
        let mut rows = stmt.query([])?;
        let mut out = Vec::new();
        while let Some(r) = rows.next()? {
            out.push(AssigneeGroup {
                id:         r.get(0)?,
                name:       r.get(1)?,
                sort_order: r.get(2)?,
            });
        }
        Ok(out)
    }

    pub fn upsert_assignee_group(&self, g: &AssigneeGroup) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO assignee_groups (id,name,sort_order) VALUES (?1,?2,?3)",
            params![g.id, g.name, g.sort_order],
        )?;
        Ok(())
    }

    pub fn delete_assignee_group(&self, id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM assignee_groups WHERE id=?1", [id])?;
        Ok(())
    }

    pub fn get_assignee_persons(&self) -> Result<Vec<AssigneePerson>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id,group_id,name,color,sort_order FROM assignee_persons ORDER BY group_id, sort_order",
        )?;
        let mut rows = stmt.query([])?;
        let mut out = Vec::new();
        while let Some(r) = rows.next()? {
            out.push(AssigneePerson {
                id:         r.get(0)?,
                group_id:   r.get(1)?,
                name:       r.get(2)?,
                color:      r.get(3)?,
                sort_order: r.get(4)?,
            });
        }
        Ok(out)
    }

    pub fn upsert_assignee_person(&self, p: &AssigneePerson) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO assignee_persons (id,group_id,name,color,sort_order) VALUES (?1,?2,?3,?4,?5)",
            params![p.id, p.group_id, p.name, p.color, p.sort_order],
        )?;
        Ok(())
    }

    pub fn delete_assignee_person(&self, id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM assignee_persons WHERE id=?1", [id])?;
        Ok(())
    }

    // ── Settings ───────────────────────────────────────────────────────────────

    pub fn get_setting(&self, key: &str) -> Result<Option<String>> {
        let conn = self.conn.lock().unwrap();
        Ok(conn
            .query_row("SELECT value FROM settings WHERE key=?1", [key], |r| r.get(0))
            .ok())
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO settings (key,value) VALUES (?1,?2)",
            [key, value],
        )?;
        Ok(())
    }

    // ── Sync ───────────────────────────────────────────────────────────────────

    pub fn get_dirty_notes(&self) -> Result<Vec<Note>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id,title,category_id,window_x,window_y,window_width,window_height,
                    always_on_top,color,sort_order,locked,warn_days,created_at,updated_at,dirty
             FROM notes WHERE dirty=1",
        )?;
        let mut rows = stmt.query([])?;
        let mut out = Vec::new();
        while let Some(r) = rows.next()? {
            out.push(Note {
                id:            r.get(0)?,
                title:         r.get(1)?,
                category_id:   r.get(2)?,
                window_x:      r.get(3)?,
                window_y:      r.get(4)?,
                window_width:  r.get(5)?,
                window_height: r.get(6)?,
                always_on_top: r.get::<_, i32>(7)? != 0,
                color:         r.get(8)?,
                sort_order:    r.get(9)?,
                locked:        r.get::<_, i32>(10)? != 0,
                warn_days:     r.get(11)?,
                created_at:    r.get::<_, Option<String>>(12)?.unwrap_or_else(default_created_at),
                updated_at:    r.get(13)?,
                dirty:         r.get::<_, i32>(14)? != 0,
            });
        }
        Ok(out)
    }

    pub fn get_dirty_items(&self) -> Result<Vec<TodoItem>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id,note_id,parent_id,text,checked,indent,collapsed,locked,status,
                    assignees,assignee_person_id,memo,bold,priority,
                    start_date,end_date,limit_date,item_type,
                    sort_order,archived,updated_at,dirty
             FROM todo_items WHERE dirty=1",
        )?;
        let mut rows = stmt.query([])?;
        let mut out = Vec::new();
        while let Some(r) = rows.next()? {
            out.push(TodoItem {
                id:                 r.get(0)?,
                note_id:            r.get(1)?,
                parent_id:          r.get(2)?,
                text:               r.get(3)?,
                checked:            r.get::<_, i32>(4)? != 0,
                indent:             r.get(5)?,
                collapsed:          r.get::<_, i32>(6)? != 0,
                locked:             r.get::<_, i32>(7)? != 0,
                status:             r.get(8)?,
                assignees:          r.get::<_, Option<String>>(9)?.unwrap_or_else(|| "[]".into()),
                assignee_person_id: r.get(10)?,
                memo:               r.get(11)?,
                bold:               r.get::<_, i32>(12)? != 0,
                priority:           r.get(13)?,
                start_date:         r.get(14)?,
                end_date:           r.get(15)?,
                limit_date:         r.get(16)?,
                item_type:          r.get(17)?,
                sort_order:         r.get(18)?,
                archived:           r.get::<_, i32>(19)? != 0,
                updated_at:         r.get(20)?,
                dirty:              r.get::<_, i32>(21)? != 0,
            });
        }
        Ok(out)
    }

    pub fn mark_all_clean(&self) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("UPDATE notes SET dirty=0", [])?;
        conn.execute("UPDATE todo_items SET dirty=0", [])?;
        Ok(())
    }
}
