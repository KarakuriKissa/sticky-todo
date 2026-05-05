import { useEffect, useRef, useState, KeyboardEvent } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { CategoryList } from '../components/CategoryList';
import { NoteList } from '../components/NoteList';
import { useAppStore } from '../store/appStore';
import type { AppSettings, AssigneeGroup, AssigneePerson, SortMode, Status } from '../types';

const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: 'manual',       label: '手動' },
  { value: 'name_asc',     label: '名前 昇順' },
  { value: 'name_desc',    label: '名前 降順' },
  { value: 'created_asc',  label: '作成日 古い順' },
  { value: 'created_desc', label: '作成日 新しい順' },
  { value: 'group_asc',    label: 'グループ 昇順' },
  { value: 'group_desc',   label: 'グループ 降順' },
];

export function Launcher() {
  const {
    load, reopenSavedWindows, createNote,
    searchQuery, setSearchQuery, settings, saveSettings,
    selectedCategoryId, categories, saveCategory, setSelectedCategory,
  } = useAppStore();
  const [showSettings, setShowSettings] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(180);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    load().then(() => {
      reopenSavedWindows();
    });
  }, []);

  // The launcher search is GLOBAL: it filters notes by title AND by task content.
  // This Set of note IDs is populated by an async invoke to search_all_items
  // whenever the search query changes. NoteList reads this from appStore to
  // include those notes in the filter result.
  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'k')) {
        e.preventDefault();
        searchRef.current?.focus();
      }
      // Escape from anywhere closes the search popup.
      if (e.key === 'Escape' && useAppStore.getState().searchQuery) {
        useAppStore.getState().setSearchQuery('');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Whenever the search query changes, run a global item search and store the
  // matching note IDs in appStore. NoteList uses this to expand its filter.
  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) {
      useAppStore.setState({ itemMatchNoteIds: new Set(), itemMatches: [] });
      return;
    }
    const handle = setTimeout(async () => {
      const ql = q.toLowerCase();
      // 1) Primary source: SQLite via Rust (covers all closed lists too).
      let rows: [any, string][] = [];
      try {
        rows = await invoke<[any, string][]>('search_all_items', { query: q });
      } catch (e) { console.error('[search] DB query failed:', e); }
      const merged = new Map<string, { item: any; noteTitle: string }>();
      rows.forEach(([item, noteTitle]) => merged.set(item.id, { item, noteTitle }));

      // 2) Fallback / supplement: localStorage backups (in case any save failed).
      try {
        const allNotes = useAppStore.getState().notes;
        const titleByNoteId = new Map(allNotes.map((n) => [n.id, n.title]));
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (!k || !k.startsWith('sticky-todo:note-items:')) continue;
          const noteId = k.split(':')[2];
          try {
            const arr = JSON.parse(localStorage.getItem(k) || '[]');
            if (!Array.isArray(arr)) continue;
            arr.forEach((item: any) => {
              if (!item.text || !String(item.text).toLowerCase().includes(ql)) return;
              if (item.archived) return;
              if (!merged.has(item.id)) {
                merged.set(item.id, { item, noteTitle: titleByNoteId.get(noteId) ?? '(不明なリスト)' });
              }
            });
          } catch {}
        }
      } catch {}

      const all = Array.from(merged.values());
      useAppStore.setState({
        itemMatchNoteIds: new Set(all.map((r) => r.item.note_id)),
        itemMatches: all,
      });
    }, 150);
    return () => clearTimeout(handle);
  }, [searchQuery]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    import('@tauri-apps/api/event').then(({ listen }) => {
      listen<{ id: string; title: string; color: string }>('note-updated', (event) => {
        const { id, title, color } = event.payload;
        useAppStore.setState((s) => ({
          notes: s.notes.map((n) => (n.id === id ? { ...n, title, color } : n)),
        }));
      }).then((fn) => { unlisten = fn; }).catch(() => {});
    });
    return () => { unlisten?.(); };
  }, []);

  const handleNew = async () => {
    let catId = selectedCategoryId;
    if (!catId) {
      if (categories.length === 0) {
        // No categories at all — create a default one
        const id = await invoke<string>('generate_id');
        await saveCategory({ id, name: '新しいカテゴリ', color: '#6366f1', sort_order: 0 });
        setSelectedCategory(id);
        catId = id;
      } else {
        alert('カテゴリを選択してからリストを作成してください。');
        return;
      }
    }
    await createNote();
  };

  const handleSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      const notes = useAppStore.getState().filteredNotes();
      if (notes.length === 1) useAppStore.getState().openNote(notes[0]);
    }
    if (e.key === 'Escape') setSearchQuery('');
  };

  const setSort = async (mode: SortMode) => {
    await saveSettings({ ...settings, sort_mode: mode });
  };

  const onResizerMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebarWidth;
    const onMove = (ev: MouseEvent) => {
      const w = Math.min(320, Math.max(120, startW + ev.clientX - startX));
      setSidebarWidth(w);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <div className="launcher">
      <div style={{ width: sidebarWidth, flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
        <CategoryList />
      </div>
      <div className="sidebar-resizer" onMouseDown={onResizerMouseDown} />

      <main className="launcher-main">
        <header className="launcher-toolbar">
          <input
            ref={searchRef}
            className="search-input"
            placeholder="🌐 リスト名・タスクを横断検索… (Ctrl+F)"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleSearchKey}
          />

          <button
            className="btn-new"
            onClick={handleNew}
            title={selectedCategoryId ? '新規リスト作成' : 'カテゴリを選択してから作成'}
            style={{ opacity: selectedCategoryId ? 1 : 0.5 }}
          >＋</button>

          <select
            className="sort-select"
            value={(settings.sort_mode as string) === 'name' ? 'name_asc' : settings.sort_mode}
            onChange={(e) => setSort(e.target.value as SortMode)}
            title="並び替え"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>

          <button className="btn-icon" onClick={() => setShowSettings(true)} title="設定">⚙</button>
        </header>

        {/* The note list always renders. Search results pop up as an overlay
            anchored to the search bar so users still see their lists behind. */}
        <NoteList onNew={handleNew} />
        {searchQuery.trim() && <SearchPopup onClose={() => setSearchQuery('')} />}
      </main>

      {showSettings && (
        <SettingsModal
          settings={settings}
          onSave={saveSettings}
          onClose={() => setShowSettings(false)}
        />
      )}

    </div>
  );
}

// ── Search results popup (overlay anchored under the search bar) ─────────────
function SearchPopup({ onClose }: { onClose: () => void }) {
  const { itemMatches, searchQuery, notes, openNote, filteredNotes } = useAppStore();
  const matchedNotes = filteredNotes();

  return (
    <div className="search-popup-backdrop" onClick={onClose}>
      <div className="search-popup" onClick={(e) => e.stopPropagation()}>
        <div className="search-popup-header">
          🔍 <strong>「{searchQuery}」</strong> の検索結果：
          リスト <b>{matchedNotes.length}</b> / タスク <b>{itemMatches.length}</b>
          <button className="search-popup-close" onClick={onClose} title="閉じる (Esc)">✕</button>
        </div>
        <div className="search-popup-body">
          {matchedNotes.length > 0 && (
            <>
              <div className="search-popup-section-label">📋 リスト</div>
              {matchedNotes.map((n) => (
                <div
                  key={n.id}
                  className="search-popup-row"
                  style={{ borderLeft: `3px solid ${n.color || '#fef08a'}` }}
                  onClick={() => openNote(n)}    /* keep popup open after click */
                >
                  📋 {n.title || '(無題)'}
                </div>
              ))}
            </>
          )}
          {itemMatches.length > 0 && (
            <>
              <div className="search-popup-section-label">✅ タスク</div>
              {itemMatches.map(({ item, noteTitle }) => {
                const note = notes.find((nn) => nn.id === item.note_id);
                return (
                  <div
                    key={item.id}
                    className="search-popup-row"
                    onClick={async () => {
                      if (!note) return;
                      await openNote(note);
                      // Highlight the task in the opened window. The popup
                      // STAYS OPEN — user closes it with Esc, the ✕ button,
                      // or by clicking outside.
                      setTimeout(async () => {
                        try {
                          const { emitTo } = await import('@tauri-apps/api/event');
                          await emitTo(`note-${note.id}`, 'jump-to-task', {
                            taskId: item.id,
                            query: searchQuery,
                          });
                        } catch (e) { console.error('[search] emit failed:', e); }
                      }, 600);
                    }}
                  >
                    <div className="search-popup-meta">📋 {noteTitle}</div>
                    <div>{item.checked ? '☑' : '☐'} {item.text}</div>
                  </div>
                );
              })}
            </>
          )}
          {matchedNotes.length === 0 && itemMatches.length === 0 && (
            <div className="search-popup-empty">該当するリスト・タスクがありません</div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Settings Modal ────────────────────────────────────────────────────────────
type SettingsTab = 'statuses' | 'assignees' | 'advanced';

function SettingsModal({
  settings,
  onSave,
  onClose,
}: {
  settings: AppSettings;
  onSave: (s: AppSettings) => Promise<void>;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<SettingsTab>('statuses');
  const [draft, setDraft] = useState<AppSettings>({ ...settings });

  const {
    statuses, saveStatus, deleteStatus,
    assigneeGroups, saveAssigneeGroup, deleteAssigneeGroup,
    assigneePersons, saveAssigneePerson, deleteAssigneePerson,
  } = useAppStore();

  // Status
  const [newStatusName, setNewStatusName] = useState('');
  const [newStatusColor, setNewStatusColor] = useState('#6366f1');

  // Assignee
  const [selectedGroupId, setSelectedGroupId] = useState<string>(assigneeGroups[0]?.id ?? '');
  const [newGroupName, setNewGroupName] = useState('');
  const [newPersonName, setNewPersonName] = useState('');
  const [newPersonColor, setNewPersonColor] = useState('#6366f1');

  const save = async () => {
    await onSave(draft);
    onClose();
  };

  const addStatus = async () => {
    if (!newStatusName.trim()) return;
    const id = await invoke<string>('generate_id');
    await saveStatus({ id, name: newStatusName.trim(), color: newStatusColor, sort_order: statuses.length });
    setNewStatusName('');
  };

  const addGroup = async () => {
    if (!newGroupName.trim()) return;
    const id = await invoke<string>('generate_id');
    const group: AssigneeGroup = { id, name: newGroupName.trim(), sort_order: assigneeGroups.length };
    await saveAssigneeGroup(group);
    setNewGroupName('');
    setSelectedGroupId(id);
  };

  const addPerson = async () => {
    if (!newPersonName.trim() || !selectedGroupId) return;
    const id = await invoke<string>('generate_id');
    const groupPersons = assigneePersons.filter((p) => p.group_id === selectedGroupId);
    const person: AssigneePerson = {
      id, group_id: selectedGroupId, name: newPersonName.trim(),
      color: newPersonColor, sort_order: groupPersons.length,
    };
    await saveAssigneePerson(person);
    setNewPersonName('');
  };

  const groupPersons = assigneePersons.filter((p) => p.group_id === selectedGroupId);

  const TABS: { id: SettingsTab; label: string }[] = [
    { id: 'statuses',  label: 'ステータス' },
    { id: 'assignees', label: '担当者' },
    { id: 'advanced',  label: '詳細設定' },
  ];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal settings-modal" onClick={(e) => e.stopPropagation()}>
        <h2>設定</h2>

        <div className="settings-tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`settings-tab${tab === t.id ? ' active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="settings-body">

          {/* ── Status tab ── */}
          {tab === 'statuses' && (
            <section>
              <h3>ステータス管理</h3>
              <p style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8 }}>
                ダブルクリックで名前を編集
              </p>
              <div className="status-list">
                {statuses.map((s) => (
                  <StatusRow
                    key={s.id}
                    status={s}
                    onEdit={(name) => saveStatus({ ...s, name })}
                    onDelete={() => deleteStatus(s.id)}
                  />
                ))}
              </div>
              <div className="status-add-row">
                <input
                  value={newStatusName}
                  onChange={(e) => setNewStatusName(e.target.value)}
                  placeholder="ステータス名"
                  onKeyDown={(e) => e.key === 'Enter' && addStatus()}
                />
                <input type="color" value={newStatusColor} onChange={(e) => setNewStatusColor(e.target.value)} />
                <button className="btn-primary" onClick={addStatus}>追加</button>
              </div>
            </section>
          )}

          {/* ── Assignee tab ── */}
          {tab === 'assignees' && (
            <section>
              <h3>担当者グループとメンバー</h3>
              <div className="assignee-split">
                {/* LEFT: group list */}
                <div className="assignee-col">
                  <div className="assignee-col-header">グループ</div>
                  <div className="assignee-col-list">
                    {assigneeGroups.map((g) => (
                      <div
                        key={g.id}
                        className={`assignee-group-item${selectedGroupId === g.id ? ' active' : ''}`}
                        onClick={() => setSelectedGroupId(g.id)}
                      >
                        <span className="assignee-group-name">{g.name}</span>
                        <button
                          className="btn-icon"
                          style={{ fontSize: 11 }}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (window.confirm(`グループ「${g.name}」を削除しますか？`)) {
                              deleteAssigneeGroup(g.id);
                              if (selectedGroupId === g.id) setSelectedGroupId(assigneeGroups.filter(x => x.id !== g.id)[0]?.id ?? '');
                            }
                          }}
                        >×</button>
                      </div>
                    ))}
                  </div>
                  <div className="assignee-col-add">
                    <input
                      value={newGroupName}
                      onChange={(e) => setNewGroupName(e.target.value)}
                      placeholder="グループ名"
                      className="assignee-input"
                      onKeyDown={(e) => e.key === 'Enter' && addGroup()}
                    />
                    <button className="btn-primary" onClick={addGroup} style={{ fontSize: 12, padding: '3px 10px', flexShrink: 0 }}>追加</button>
                  </div>
                </div>

                {/* RIGHT: member list */}
                <div className="assignee-col">
                  <div className="assignee-col-header">
                    {selectedGroupId
                      ? `${assigneeGroups.find((g) => g.id === selectedGroupId)?.name ?? ''} のメンバー`
                      : 'グループを選択'}
                  </div>
                  {selectedGroupId ? (
                    <>
                      <div className="assignee-col-list">
                        {groupPersons.map((p) => (
                          <div key={p.id} className="assignee-group-item">
                            <span className="status-dot" style={{ background: p.color }} />
                            <span style={{ flex: 1 }}>{p.name}</span>
                            <button className="btn-icon" style={{ fontSize: 11 }} onClick={() => deleteAssigneePerson(p.id)}>×</button>
                          </div>
                        ))}
                        {groupPersons.length === 0 && (
                          <div style={{ color: 'var(--muted)', fontSize: 12, padding: '8px 10px' }}>メンバーなし</div>
                        )}
                      </div>
                      <div className="assignee-col-add">
                        <input
                          value={newPersonName}
                          onChange={(e) => setNewPersonName(e.target.value)}
                          placeholder="メンバー名"
                          className="assignee-input"
                          onKeyDown={(e) => e.key === 'Enter' && addPerson()}
                        />
                        <input type="color" value={newPersonColor} onChange={(e) => setNewPersonColor(e.target.value)} style={{ width: 32, height: 28, cursor: 'pointer', border: 'none', borderRadius: 4, flexShrink: 0 }} />
                        <button className="btn-primary" onClick={addPerson} style={{ fontSize: 12, padding: '3px 10px', flexShrink: 0 }}>追加</button>
                      </div>
                    </>
                  ) : (
                    <div className="assignee-col-list" style={{ color: 'var(--muted)', fontSize: 12, padding: '8px 10px' }}>
                      グループを選択してください
                    </div>
                  )}
                </div>
              </div>
            </section>
          )}

          {/* ── Advanced tab (deadline + language + sync + db) ── */}
          {tab === 'advanced' && (
            <section>
              <h3>期日警告</h3>
              <p style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 10, lineHeight: 1.6 }}>
                期日が近いタスクに警告色を表示します。各リストで個別に上書き可能です。
              </p>
              <label className="toggle-row" style={{ gap: 6, marginBottom: 4 }}>
                期限の
                <input
                  type="number"
                  min={0} max={30}
                  value={draft.deadline_warn_days}
                  onChange={(e) => setDraft((d) => ({ ...d, deadline_warn_days: Number(e.target.value) }))}
                  style={{ width: 48, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text)', padding: '2px 6px', outline: 'none' }}
                />
                日前から警告色を表示
              </label>

              <h3 style={{ marginTop: 20 }}>デスクトップ通知</h3>
              <p style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 10, lineHeight: 1.6 }}>
                リストを開いている間、期限切れ・期日が近いタスクを Windows 通知で知らせます。<br />
                <strong>0 にすると通知を無効化</strong>します。
              </p>
              <label className="toggle-row" style={{ gap: 6 }}>
                チェック間隔
                <input
                  type="number"
                  min={0} max={1440}
                  value={draft.reminder_interval_min ?? 30}
                  onChange={(e) => setDraft((d) => ({ ...d, reminder_interval_min: Number(e.target.value) }))}
                  style={{ width: 64, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text)', padding: '2px 6px', outline: 'none' }}
                />
                分ごと（0 で無効）
              </label>

              <h3 style={{ marginTop: 20 }}>言語 / Language</h3>
              <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.8 }}>
                現在の言語: <strong style={{ color: 'var(--text)' }}>日本語</strong>
              </p>
              <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6, lineHeight: 1.6 }}>
                多言語対応は今後のバージョンで追加予定です。<br />
                Language support (English etc.) will be added in a future update.
              </p>

              <h3 style={{ marginTop: 20 }}>同期</h3>
              <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.8 }}>
                現在、同期機能は利用できません。
              </p>
              <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6, lineHeight: 1.6 }}>
                将来的に以下の同期機能を追加予定:<br />
                • クラウドストレージへの自動バックアップ<br />
                • 複数デバイス間でのリスト共有<br />
                • チームメンバーとのリアルタイム同期
              </p>

              <h3 style={{ marginTop: 20 }}>データベース</h3>
              <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8, lineHeight: 1.6 }}>
                すべてのデータはローカルの SQLite データベースに保存されています。<br />
                エクスポートでバックアップを作成、インポートで別のデータベースに置き換えできます。
              </p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  className="btn-secondary"
                  style={{ fontSize: 12, padding: '5px 12px' }}
                  onClick={async () => {
                    const { save } = await import('@tauri-apps/plugin-dialog');
                    const ts = new Date().toISOString().slice(0, 10);
                    const path = await save({
                      title: 'データベースをエクスポート',
                      defaultPath: `sticky-todo-${ts}.db`,
                      filters: [{ name: 'SQLite Database', extensions: ['db'] }],
                    });
                    if (!path) return;
                    try {
                      await invoke('export_database', { destPath: path });
                      alert('エクスポートが完了しました');
                    } catch (e) {
                      alert('エクスポート失敗: ' + e);
                    }
                  }}
                >📤 エクスポート</button>
                <button
                  className="btn-secondary"
                  style={{ fontSize: 12, padding: '5px 12px' }}
                  onClick={async () => {
                    const { open, confirm } = await import('@tauri-apps/plugin-dialog');
                    const path = await open({
                      title: 'データベースをインポート',
                      multiple: false,
                      directory: false,
                      filters: [{ name: 'SQLite Database', extensions: ['db'] }],
                    });
                    if (!path || typeof path !== 'string') return;
                    const ok = await confirm(
                      '現在のデータをインポートしたデータで完全に置き換えます。\nこの操作は取り消せません。続行しますか？',
                      { title: 'インポートの確認', kind: 'warning' },
                    );
                    if (!ok) return;
                    try {
                      await invoke('import_database', { srcPath: path });
                      // app.restart() will reload the app
                    } catch (e) {
                      alert('インポート失敗: ' + e);
                    }
                  }}
                >📥 インポート</button>
                <button
                  className="btn-secondary"
                  style={{ fontSize: 12, padding: '5px 12px', color: '#ef4444', borderColor: '#ef4444' }}
                  onClick={async () => {
                    const { confirm } = await import('@tauri-apps/plugin-dialog');
                    const ok = await confirm(
                      'すべてのリスト・タスク・設定が完全に削除されます。\nこの操作は取り消せません。本当に削除しますか？',
                      { title: 'データベース削除の確認', kind: 'warning' },
                    );
                    if (!ok) return;
                    try {
                      await invoke('delete_database');
                    } catch (e) {
                      alert('削除失敗: ' + e);
                    }
                  }}
                >🗑️ データベースを削除</button>
              </div>
            </section>
          )}

        </div>{/* /settings-body */}

        <div className="modal-actions">
          <button className="btn-primary" onClick={save}>保存</button>
          <button className="btn-secondary" onClick={onClose}>キャンセル</button>
        </div>
      </div>
    </div>
  );
}

// ── StatusRow (editable inline) ───────────────────────────────────────────────
function StatusRow({
  status,
  onEdit,
  onDelete,
}: {
  status: Status;
  onEdit: (name: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(status.name);

  const commit = () => {
    if (name.trim()) onEdit(name.trim());
    setEditing(false);
  };

  return (
    <div className="status-row">
      <span className="status-dot" style={{ background: status.color }} />
      {editing ? (
        <input
          autoFocus
          className="cat-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
          style={{ flex: 1 }}
        />
      ) : (
        <span style={{ flex: 1, cursor: 'pointer' }} onDoubleClick={() => setEditing(true)}>
          {status.name}
        </span>
      )}
      <button className="btn-icon" onClick={onDelete}>×</button>
    </div>
  );
}
