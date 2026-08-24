use rusqlite::{params, Connection, Result};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use uuid::Uuid;

use crate::models::*;

pub struct Database {
    pub conn: Mutex<Connection>,
    pub db_path: PathBuf,
}

// True if `table` already has a column named `col` (used to make schema
// migrations idempotent and to detect whether a migration actually landed).
fn column_exists(conn: &Connection, table: &str, col: &str) -> Result<bool> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({})", table))?;
    let mut rows = stmt.query([])?;
    while let Some(r) = rows.next()? {
        let name: String = r.get(1)?;
        if name == col {
            return Ok(true);
        }
    }
    Ok(false)
}

// One-time safety copy of the whole DB (main file + WAL/SHM sidecars) before
// altering the schema, so a botched migration can always be recovered by hand.
fn backup_before_migration(db_path: &Path) {
    if !db_path.exists() {
        return;
    }
    let Some(dir) = db_path.parent() else { return };
    let backup_dir = dir.join("backups");
    if std::fs::create_dir_all(&backup_dir).is_err() {
        return;
    }
    let ts = chrono::Local::now().format("%Y%m%d-%H%M%S").to_string();
    let _ = std::fs::copy(db_path, backup_dir.join(format!("backup-premigration-{}.db", ts)));
    for ext in ["-wal", "-shm"] {
        let side = PathBuf::from(format!("{}{}", db_path.display(), ext));
        if side.exists() {
            let _ = std::fs::copy(&side, backup_dir.join(format!("backup-premigration-{}.db{}", ts, ext)));
        }
    }
}

impl Database {
    pub fn new(path: &str) -> Result<Self> {
        let conn = Connection::open(path)?;
        let db = Database { conn: Mutex::new(conn), db_path: PathBuf::from(path) };
        db.init()?;
        Ok(db)
    }

    fn init(&self) -> Result<()> {
        let conn = self.conn.lock().unwrap();

        // Sync schema (Phase 1) hasn't landed yet on this file — back it up
        // once before we touch anything below.
        if !column_exists(&conn, "notes", "rev").unwrap_or(false) {
            backup_before_migration(&self.db_path);
        }

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
                 strikethrough      INTEGER DEFAULT 0,
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
        let _ = conn.execute("ALTER TABLE todo_items ADD COLUMN strikethrough INTEGER DEFAULT 0", []);

        // Sync (Phase 1): logical delete + server-assigned revision counter.
        let _ = conn.execute("ALTER TABLE notes ADD COLUMN deleted_at TEXT", []);
        let _ = conn.execute("ALTER TABLE notes ADD COLUMN rev INTEGER DEFAULT 0", []);
        let _ = conn.execute("ALTER TABLE todo_items ADD COLUMN deleted_at TEXT", []);

        // If the sync columns didn't land for some reason (disk full, locked
        // file, etc.) force sync off rather than let the app crash on the
        // next sync-related query. The app must still start normally.
        let sync_schema_ok = column_exists(&conn, "notes", "deleted_at")?
            && column_exists(&conn, "notes", "rev")?
            && column_exists(&conn, "todo_items", "deleted_at")?;
        if !sync_schema_ok {
            conn.execute(
                "INSERT OR REPLACE INTO settings (key,value) VALUES ('sync_enabled','0')",
                [],
            )?;
        }

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
             FROM notes WHERE deleted_at IS NULL ORDER BY sort_order, updated_at DESC",
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

    // Logical delete — physical DELETE was replaced so the tombstone can be
    // synced to other devices. UI reads all filter WHERE deleted_at IS NULL.
    pub fn delete_note(&self, id: &str, now: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE notes SET deleted_at=?2, updated_at=?2, dirty=1 WHERE id=?1",
            params![id, now],
        )?;
        Ok(())
    }

    // ── Items ──────────────────────────────────────────────────────────────────

    pub fn get_items(&self, note_id: &str) -> Result<Vec<TodoItem>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id,note_id,parent_id,text,checked,indent,collapsed,locked,status,
                    assignees,assignee_person_id,memo,bold,priority,
                    start_date,end_date,limit_date,item_type,
                    sort_order,archived,updated_at,dirty,strikethrough
             FROM todo_items WHERE note_id=?1 AND deleted_at IS NULL ORDER BY sort_order",
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
                strikethrough:      r.get::<_, i32>(22).unwrap_or(0) != 0,
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
              sort_order,archived,updated_at,dirty,strikethrough)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23)",
            params![
                it.id, it.note_id, it.parent_id, it.text,
                it.checked as i32, it.indent, it.collapsed as i32, it.locked as i32,
                it.status, it.assignees, it.assignee_person_id,
                it.memo, it.bold as i32, it.priority,
                it.start_date, it.end_date, it.limit_date,
                it.item_type, it.sort_order, it.archived as i32,
                it.updated_at, it.dirty as i32, it.strikethrough as i32,
            ],
        )?;
        Ok(())
    }

    pub fn delete_item(&self, id: &str, now: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE todo_items SET deleted_at=?2, updated_at=?2, dirty=1 WHERE id=?1",
            params![id, now],
        )?;
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
            "INSERT INTO categories (id,name,color,sort_order) VALUES (?1,?2,?3,?4)
             ON CONFLICT(id) DO UPDATE SET name=excluded.name, color=excluded.color, sort_order=excluded.sort_order",
            params![c.id, c.name, c.color, c.sort_order],
        )?;
        Ok(())
    }

    pub fn delete_category_with_orphan_cleanup(&self, id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("UPDATE notes SET category_id=NULL WHERE category_id=?1", [id])?;
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
            "INSERT INTO statuses (id,name,color,sort_order) VALUES (?1,?2,?3,?4)
             ON CONFLICT(id) DO UPDATE SET name=excluded.name, color=excluded.color, sort_order=excluded.sort_order",
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
        // CRITICAL: INSERT OR REPLACE would DELETE then INSERT, cascading via
        // assignee_persons.group_id ON DELETE CASCADE and wiping all members.
        // Use ON CONFLICT DO UPDATE to preserve child rows.
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO assignee_groups (id,name,sort_order) VALUES (?1,?2,?3)
             ON CONFLICT(id) DO UPDATE SET
                name=excluded.name,
                sort_order=excluded.sort_order",
            params![g.id, g.name, g.sort_order],
        )?;
        Ok(())
    }

    pub fn delete_assignee_group(&self, id: &str) -> Result<()> {
        // Clean up dangling references in todo_items before cascading.
        // (todo_items.assignee_person_id has no FK, so CASCADE doesn't reach there.)
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE todo_items SET assignee_person_id=NULL
             WHERE assignee_person_id IN (SELECT id FROM assignee_persons WHERE group_id=?1)",
            [id],
        )?;
        conn.execute("DELETE FROM assignee_groups WHERE id=?1", [id])?;
        Ok(())
    }

    pub fn delete_assignee_person(&self, _id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("UPDATE todo_items SET assignee_person_id=NULL WHERE assignee_person_id=?1", [_id])?;
        conn.execute("DELETE FROM assignee_persons WHERE id=?1", [_id])?;
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
            "INSERT INTO assignee_persons (id,group_id,name,color,sort_order) VALUES (?1,?2,?3,?4,?5)
             ON CONFLICT(id) DO UPDATE SET
                group_id=excluded.group_id,
                name=excluded.name,
                color=excluded.color,
                sort_order=excluded.sort_order",
            params![p.id, p.group_id, p.name, p.color, p.sort_order],
        )?;
        Ok(())
    }

    // (delete_assignee_person is defined above with orphan cleanup; this is
    // intentionally left out to avoid a duplicate definition.)

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

    // ── Sync (Phase 1) ───────────────────────────────────────────────────────────
    // Note-scoped snapshot sync. get_dirty_notes/get_dirty_items/mark_all_clean
    // were removed: mark_all_clean cleared dirty on EVERY row, including ones
    // edited concurrently during the network round-trip, silently dropping
    // those edits. mark_note_synced below guards against that per-row.

    // One row per note: rev/deleted_at (for push/pull decisions) and whether
    // the note itself or any of its items still needs pushing.
    pub fn list_note_revs(&self) -> Result<Vec<NoteRevInfo>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT n.id, n.rev, n.updated_at, n.deleted_at,
                    (n.dirty=1 OR EXISTS(SELECT 1 FROM todo_items i WHERE i.note_id=n.id AND i.dirty=1)) AS is_dirty
             FROM notes n",
        )?;
        let mut rows = stmt.query([])?;
        let mut out = Vec::new();
        while let Some(r) = rows.next()? {
            out.push(NoteRevInfo {
                id:         r.get(0)?,
                rev:        r.get(1)?,
                updated_at: r.get(2)?,
                deleted_at: r.get(3)?,
                dirty:      r.get::<_, i32>(4)? != 0,
            });
        }
        Ok(out)
    }

    // Full wire snapshot for one note — ALL of its items regardless of dirty
    // state (dirty is local bookkeeping only) and regardless of deleted_at
    // (tombstones must travel too, or a deletion would never sync).
    pub fn get_note_snapshot(&self, note_id: &str) -> Result<NoteSnapshot> {
        let conn = self.conn.lock().unwrap();
        let note = conn.query_row(
            "SELECT id,title,category_id,color,sort_order,locked,warn_days,
                    created_at,updated_at,deleted_at,rev
             FROM notes WHERE id=?1",
            [note_id],
            |r| {
                Ok(SyncNoteMeta {
                    id:          r.get(0)?,
                    title:       r.get(1)?,
                    category_id: r.get(2)?,
                    color:       r.get(3)?,
                    sort_order:  r.get(4)?,
                    locked:      r.get::<_, i32>(5)? != 0,
                    warn_days:   r.get(6)?,
                    created_at:  r.get::<_, Option<String>>(7)?.unwrap_or_else(default_created_at),
                    updated_at:  r.get(8)?,
                    deleted_at:  r.get(9)?,
                    rev:         r.get(10)?,
                })
            },
        )?;

        let mut stmt = conn.prepare(
            "SELECT id,note_id,parent_id,text,checked,indent,collapsed,locked,status,
                    assignees,assignee_person_id,memo,bold,priority,
                    start_date,end_date,limit_date,item_type,
                    sort_order,archived,strikethrough,updated_at,deleted_at
             FROM todo_items WHERE note_id=?1",
        )?;
        let mut rows = stmt.query([note_id])?;
        let mut items = Vec::new();
        while let Some(r) = rows.next()? {
            items.push(SyncItem {
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
                strikethrough:      r.get::<_, i32>(20)? != 0,
                updated_at:         r.get(21)?,
                deleted_at:         r.get(22)?,
            });
        }
        Ok(NoteSnapshot { note, items })
    }

    // Writes a snapshot (fresh pull, or a locally-reconciled conflict merge)
    // into the local DB. Window geometry / always_on_top are local-only and
    // are deliberately left untouched (they're absent from the column list,
    // so new rows get the schema defaults and existing rows keep their value).
    // `mark_dirty` controls whether the written rows should be picked up by
    // the next push (true for merge results that may still differ from the
    // server, false for a plain pull that now matches the server exactly).
    pub fn apply_remote_note(&self, snap: &NoteSnapshot, mark_dirty: bool) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let n = &snap.note;
        conn.execute(
            "INSERT INTO notes
             (id,title,category_id,color,sort_order,locked,warn_days,created_at,updated_at,deleted_at,rev,dirty)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)
             ON CONFLICT(id) DO UPDATE SET
                title=excluded.title,
                category_id=excluded.category_id,
                color=excluded.color,
                sort_order=excluded.sort_order,
                locked=excluded.locked,
                warn_days=excluded.warn_days,
                created_at=excluded.created_at,
                updated_at=excluded.updated_at,
                deleted_at=excluded.deleted_at,
                rev=excluded.rev,
                dirty=excluded.dirty",
            params![
                n.id, n.title, n.category_id, n.color, n.sort_order,
                n.locked as i32, n.warn_days, n.created_at, n.updated_at,
                n.deleted_at, n.rev, mark_dirty as i32,
            ],
        )?;

        for it in &snap.items {
            conn.execute(
                "INSERT INTO todo_items
                 (id,note_id,parent_id,text,checked,indent,collapsed,locked,status,
                  assignees,assignee_person_id,memo,bold,priority,
                  start_date,end_date,limit_date,item_type,
                  sort_order,archived,strikethrough,updated_at,deleted_at,dirty)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?24)
                 ON CONFLICT(id) DO UPDATE SET
                    note_id=excluded.note_id, parent_id=excluded.parent_id, text=excluded.text,
                    checked=excluded.checked, indent=excluded.indent, collapsed=excluded.collapsed,
                    locked=excluded.locked, status=excluded.status, assignees=excluded.assignees,
                    assignee_person_id=excluded.assignee_person_id, memo=excluded.memo, bold=excluded.bold,
                    priority=excluded.priority, start_date=excluded.start_date, end_date=excluded.end_date,
                    limit_date=excluded.limit_date, item_type=excluded.item_type, sort_order=excluded.sort_order,
                    archived=excluded.archived, strikethrough=excluded.strikethrough, updated_at=excluded.updated_at,
                    deleted_at=excluded.deleted_at, dirty=excluded.dirty",
                params![
                    it.id, it.note_id, it.parent_id, it.text,
                    it.checked as i32, it.indent, it.collapsed as i32, it.locked as i32,
                    it.status, it.assignees, it.assignee_person_id,
                    it.memo, it.bold as i32, it.priority,
                    it.start_date, it.end_date, it.limit_date,
                    it.item_type, it.sort_order, it.archived as i32, it.strikethrough as i32,
                    it.updated_at, it.deleted_at, mark_dirty as i32,
                ],
            )?;
        }
        Ok(())
    }

    // Clears dirty + records the server-assigned rev after a successful push.
    // Guarded by `updated_at <= synced_at`: a row edited DURING the push's
    // network round-trip must stay dirty so it gets re-pushed next time,
    // instead of the edit being silently lost (this was the mark_all_clean bug).
    pub fn mark_note_synced(&self, note_id: &str, rev: i64, synced_at: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE notes SET dirty=0, rev=?2 WHERE id=?1 AND updated_at<=?3",
            params![note_id, rev, synced_at],
        )?;
        conn.execute(
            "UPDATE todo_items SET dirty=0 WHERE note_id=?1 AND updated_at<=?2",
            params![note_id, synced_at],
        )?;
        Ok(())
    }
}

// ── Tests ────────────────────────────────────────────────────────────────────
// This project has no existing Rust test suite, but the sync migration + the
// concurrent-edit guard in mark_note_synced are exactly the kind of thing that
// silently corrupts data if wrong, so they get direct coverage here.
#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn tmp_path(name: &str) -> String {
        let mut p = std::env::temp_dir();
        p.push(format!("sticky_todo_test_{}_{}.db", name, std::process::id()));
        p.to_str().unwrap().to_string()
    }

    #[test]
    fn migration_preserves_existing_data_and_adds_columns() {
        let path = tmp_path("migration");
        let _ = fs::remove_file(&path);

        // Simulate a pre-Phase1 database (no deleted_at/rev columns at all).
        {
            let conn = Connection::open(&path).unwrap();
            conn.execute_batch(
                "CREATE TABLE notes (
                    id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', category_id TEXT,
                    window_x REAL DEFAULT 100, window_y REAL DEFAULT 100,
                    window_width REAL DEFAULT 420, window_height REAL DEFAULT 520,
                    always_on_top INTEGER DEFAULT 0, color TEXT DEFAULT '#fef08a',
                    sort_order INTEGER DEFAULT 0, locked INTEGER DEFAULT 0, warn_days INTEGER,
                    created_at TEXT, updated_at TEXT NOT NULL, dirty INTEGER DEFAULT 0
                );
                CREATE TABLE todo_items (
                    id TEXT PRIMARY KEY, note_id TEXT NOT NULL, parent_id TEXT,
                    text TEXT NOT NULL DEFAULT '', checked INTEGER DEFAULT 0, indent INTEGER DEFAULT 0,
                    collapsed INTEGER DEFAULT 0, locked INTEGER DEFAULT 0, status TEXT,
                    assignees TEXT DEFAULT '[]', assignee_person_id TEXT, memo TEXT,
                    bold INTEGER DEFAULT 0, priority TEXT, start_date TEXT, end_date TEXT, limit_date TEXT,
                    item_type TEXT DEFAULT 'normal', sort_order INTEGER DEFAULT 0, archived INTEGER DEFAULT 0,
                    strikethrough INTEGER DEFAULT 0, updated_at TEXT NOT NULL, dirty INTEGER DEFAULT 1
                );
                CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
            )
            .unwrap();
            conn.execute(
                "INSERT INTO notes (id,title,updated_at) VALUES ('n-old','existing note','2026-01-01T00:00:00Z')",
                [],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO todo_items (id,note_id,text,updated_at) VALUES ('i-old','n-old','existing task','2026-01-01T00:00:00Z')",
                [],
            )
            .unwrap();
        }

        let db = Database::new(&path).unwrap();

        // Existing data survived the migration.
        let notes = db.get_all_notes().unwrap();
        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0].title, "existing note");
        let items = db.get_items("n-old").unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].text, "existing task");

        // New columns exist and sync wasn't force-disabled.
        {
            let conn = db.conn.lock().unwrap();
            assert!(column_exists(&conn, "notes", "deleted_at").unwrap());
            assert!(column_exists(&conn, "notes", "rev").unwrap());
            assert!(column_exists(&conn, "todo_items", "deleted_at").unwrap());
        }
        assert_eq!(db.get_setting("sync_enabled").unwrap(), None);

        // A pre-migration backup was made exactly once.
        let backup_dir = Path::new(&path).parent().unwrap().join("backups");
        let has_backup = fs::read_dir(&backup_dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .any(|e| e.file_name().to_string_lossy().starts_with("backup-premigration-"));
        assert!(has_backup, "expected a pre-migration backup file");

        let _ = fs::remove_file(&path);
        let _ = fs::remove_file(format!("{}-wal", path));
        let _ = fs::remove_file(format!("{}-shm", path));
        let _ = fs::remove_dir_all(&backup_dir);
    }

    fn mk_note(id: &str) -> Note {
        Note {
            id: id.into(), title: "t".into(), category_id: None,
            window_x: 0.0, window_y: 0.0, window_width: 1.0, window_height: 1.0,
            always_on_top: false, color: "#fff".into(), sort_order: 0,
            locked: false, warn_days: None, created_at: "2026-01-01T00:00:00Z".into(),
            updated_at: "2026-01-01T00:00:00Z".into(), dirty: true,
        }
    }

    #[test]
    fn soft_delete_hides_from_reads_but_keeps_the_row() {
        let path = tmp_path("softdelete");
        let _ = fs::remove_file(&path);
        let db = Database::new(&path).unwrap();

        db.upsert_note(&mk_note("n1")).unwrap();
        assert_eq!(db.get_all_notes().unwrap().len(), 1);

        db.delete_note("n1", "2026-01-02T00:00:00Z").unwrap();
        assert_eq!(db.get_all_notes().unwrap().len(), 0, "deleted note must not appear in reads");

        // Row still exists as a tombstone so it can be synced.
        let snap = db.get_note_snapshot("n1").unwrap();
        assert_eq!(snap.note.deleted_at.as_deref(), Some("2026-01-02T00:00:00Z"));

        let _ = fs::remove_file(&path);
    }

    #[test]
    fn mark_note_synced_keeps_dirty_on_concurrent_edit() {
        let path = tmp_path("syncedguard");
        let _ = fs::remove_file(&path);
        let db = Database::new(&path).unwrap();

        let note = mk_note("n1");
        db.upsert_note(&note).unwrap();

        // Simulate: the sync round-trip captured a snapshot at synced_at, but
        // the row's updated_at moved PAST synced_at (user kept typing) before
        // mark_note_synced runs.
        let synced_at = "2026-01-01T00:00:01Z";
        let edited_after = Note { updated_at: "2026-01-01T00:00:02Z".into(), ..note };
        db.upsert_note(&edited_after).unwrap();

        db.mark_note_synced("n1", 1, synced_at).unwrap();

        let info = db.list_note_revs().unwrap().into_iter().find(|r| r.id == "n1").unwrap();
        assert!(info.dirty, "an edit made during the sync round-trip must stay dirty");
        assert_eq!(info.rev, 0, "rev must not advance for a row that outran the sync guard");

        let _ = fs::remove_file(&path);
    }

    #[test]
    fn mark_note_synced_clears_dirty_when_nothing_changed_since() {
        let path = tmp_path("syncedok");
        let _ = fs::remove_file(&path);
        let db = Database::new(&path).unwrap();

        db.upsert_note(&mk_note("n1")).unwrap(); // updated_at = ...00:00:00Z
        db.mark_note_synced("n1", 7, "2026-01-01T00:00:00Z").unwrap();

        let info = db.list_note_revs().unwrap().into_iter().find(|r| r.id == "n1").unwrap();
        assert!(!info.dirty);
        assert_eq!(info.rev, 7);

        let _ = fs::remove_file(&path);
    }

    #[test]
    fn apply_remote_note_preserves_local_window_geometry() {
        let path = tmp_path("applyremote");
        let _ = fs::remove_file(&path);
        let db = Database::new(&path).unwrap();

        let mut note = mk_note("n1");
        note.window_x = 321.0;
        note.window_y = 654.0;
        note.always_on_top = true;
        note.dirty = false;
        db.upsert_note(&note).unwrap();

        let snap = NoteSnapshot {
            note: SyncNoteMeta {
                id: "n1".into(), title: "from server".into(), category_id: None,
                color: "#abc".into(), sort_order: 5, locked: false, warn_days: None,
                created_at: "2026-01-01T00:00:00Z".into(), updated_at: "2026-01-02T00:00:00Z".into(),
                deleted_at: None, rev: 3,
            },
            items: vec![],
        };
        db.apply_remote_note(&snap, false).unwrap();

        let n = db.get_all_notes().unwrap().into_iter().find(|n| n.id == "n1").unwrap();
        assert_eq!(n.title, "from server");
        assert_eq!(n.window_x, 321.0, "window geometry is local-only and must survive a pull");
        assert!(n.always_on_top, "always_on_top is local-only and must survive a pull");
        assert!(!n.dirty);

        let _ = fs::remove_file(&path);
    }

    #[test]
    fn apply_remote_note_mark_dirty_true_makes_it_a_push_candidate() {
        let path = tmp_path("applyremotedirty");
        let _ = fs::remove_file(&path);
        let db = Database::new(&path).unwrap();

        let snap = NoteSnapshot {
            note: SyncNoteMeta {
                id: "n1".into(), title: "merged".into(), category_id: None,
                color: "#abc".into(), sort_order: 0, locked: false, warn_days: None,
                created_at: "2026-01-01T00:00:00Z".into(), updated_at: "2026-01-02T00:00:00Z".into(),
                deleted_at: None, rev: 4,
            },
            items: vec![],
        };
        db.apply_remote_note(&snap, true).unwrap();

        let info = db.list_note_revs().unwrap().into_iter().find(|r| r.id == "n1").unwrap();
        assert!(info.dirty);
        assert_eq!(info.rev, 4);

        let _ = fs::remove_file(&path);
    }

    // End-to-end against a REAL local `wrangler dev` worker (not run by default —
    // requires `cd worker && npx wrangler dev --port 8787` running separately).
    // Exercises: get_note_snapshot -> HTTP push -> mark_note_synced, then, from
    // a completely fresh (simulated "other PC") Database, HTTP pull -> apply_remote_note,
    // proving a note survives a round-trip through the actual sync worker.
    // Run with: cargo test --lib -- --ignored e2e_sync_roundtrip_against_local_worker
    #[test]
    #[ignore]
    fn e2e_sync_roundtrip_against_local_worker() {
        use std::process::Command;

        let base = "http://127.0.0.1:8787";
        let space_id = "zzzz11112222333344z9";
        let passphrase = "rust-integration-test-pass";

        let curl_json = |args: &[&str]| -> serde_json::Value {
            let out = Command::new("curl").arg("-s").args(args).output().expect("curl failed to run");
            serde_json::from_slice(&out.stdout)
                .unwrap_or_else(|e| panic!("curl did not return JSON ({}): {}", e, String::from_utf8_lossy(&out.stdout)))
        };

        // ── Login (registers the passphrase on first use) ──
        let login_body = format!(r#"{{"spaceId":"{}","passphrase":"{}"}}"#, space_id, passphrase);
        let login = curl_json(&[
            "-X", "POST", &format!("{}/api/login", base),
            "-H", "Content-Type: application/json", "-d", &login_body,
        ]);
        let token = login["token"].as_str().expect("login did not return a token — is `wrangler dev` running on :8787?").to_string();

        // ── Device A: create + push a note ──
        let path_a = tmp_path("e2e_device_a");
        let _ = fs::remove_file(&path_a);
        let db_a = Database::new(&path_a).unwrap();
        db_a.upsert_note(&mk_note("n-e2e")).unwrap();
        db_a.upsert_item(&crate::models::TodoItem {
            id: "i-e2e".into(), note_id: "n-e2e".into(), parent_id: None,
            text: "integration test task".into(), checked: false, indent: 0,
            collapsed: false, locked: false, status: None, assignees: "[]".into(),
            assignee_person_id: None, memo: None, bold: false, priority: None,
            start_date: None, end_date: None, limit_date: None, item_type: "normal".into(),
            sort_order: 0, archived: false, strikethrough: false,
            updated_at: "2026-01-01T00:00:00Z".into(), dirty: true,
        }).unwrap();

        let snapshot = db_a.get_note_snapshot("n-e2e").unwrap();
        let push_body = serde_json::json!({ "expectedRev": 0, "snapshot": snapshot }).to_string();
        let push_res = curl_json(&[
            "-X", "PUT", &format!("{}/api/space/{}/note/n-e2e", base, space_id),
            "-H", &format!("Authorization: Bearer {}", token),
            "-H", "Content-Type: application/json", "-d", &push_body,
        ]);
        let rev = push_res["rev"].as_i64().unwrap_or_else(|| panic!("push failed: {}", push_res));
        db_a.mark_note_synced("n-e2e", rev, "2026-01-01T00:00:00Z").unwrap();

        // ── Device B: simulates a fresh install (DB was deleted) — pull via the SAME code ──
        let path_b = tmp_path("e2e_device_b");
        let _ = fs::remove_file(&path_b);
        let db_b = Database::new(&path_b).unwrap();
        assert_eq!(db_b.get_all_notes().unwrap().len(), 0, "device B must start empty");

        let index = curl_json(&[
            &format!("{}/api/space/{}/index", base, space_id),
            "-H", &format!("Authorization: Bearer {}", token),
        ]);
        let notes = index["notes"].as_array().unwrap();
        assert!(notes.iter().any(|n| n["id"] == "n-e2e"), "pushed note missing from index: {}", index);

        let note_env = curl_json(&[
            &format!("{}/api/space/{}/note/n-e2e", base, space_id),
            "-H", &format!("Authorization: Bearer {}", token),
        ]);
        let pulled: NoteSnapshot = serde_json::from_value(note_env["body"].clone()).unwrap();
        db_b.apply_remote_note(&pulled, false).unwrap();

        let restored = db_b.get_all_notes().unwrap();
        assert_eq!(restored.len(), 1, "note did not restore on device B");
        assert_eq!(restored[0].title, "t");
        let restored_items = db_b.get_items("n-e2e").unwrap();
        assert_eq!(restored_items.len(), 1);
        assert_eq!(restored_items[0].text, "integration test task");

        // ── No token -> 401 ──
        let out = Command::new("curl")
            .args(["-s", "-o", "/dev/null", "-w", "%{http_code}", &format!("{}/api/space/{}/index", base, space_id)])
            .output().unwrap();
        assert_eq!(String::from_utf8_lossy(&out.stdout), "401");

        let _ = fs::remove_file(&path_a);
        let _ = fs::remove_file(&path_b);
    }
}
