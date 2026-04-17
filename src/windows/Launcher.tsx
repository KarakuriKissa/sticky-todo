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

  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

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
            placeholder="検索… (Ctrl+F)"
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
            value={settings.sort_mode === 'name' as string ? 'name_asc' : settings.sort_mode}
            onChange={(e) => setSort(e.target.value as SortMode)}
            title="並び替え"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>

          <button className="btn-icon" onClick={() => setShowSettings(true)} title="設定">⚙</button>
        </header>

        <NoteList onNew={handleNew} />
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

// ── Settings Modal ────────────────────────────────────────────────────────────
type SettingsTab = 'statuses' | 'deadline' | 'assignees' | 'language' | 'sync' | 'advanced';

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
    { id: 'deadline',  label: '期日警告' },
    { id: 'assignees', label: '担当者' },
    { id: 'language',  label: '言語' },
    { id: 'sync',      label: '同期' },
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

        {/* ── Deadline tab ── */}
        {tab === 'deadline' && (
          <section>
            <h3>期日警告（グローバル設定）</h3>
            <p style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 12 }}>
              期日が近いタスクに警告色を表示します。各リストで個別に上書き可能です。
            </p>
            <label className="toggle-row" style={{ gap: 6 }}>
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

        {/* ── Language tab ── */}
        {tab === 'language' && (
          <section>
            <h3>言語 / Language</h3>
            <div style={{ padding: '16px 0', color: 'var(--muted)', fontSize: 13, lineHeight: 1.8 }}>
              <p>現在の言語: <strong style={{ color: 'var(--text)' }}>日本語</strong></p>
              <p style={{ marginTop: 12, fontSize: 12 }}>
                多言語対応は今後のバージョンで追加予定です。<br />
                Language support (English etc.) will be added in a future update.
              </p>
            </div>
          </section>
        )}

        {/* ── Sync tab ── */}
        {tab === 'sync' && (
          <section>
            <h3>同期</h3>
            <div style={{ padding: '16px 0', color: 'var(--muted)', fontSize: 13, lineHeight: 1.8 }}>
              <p style={{ marginBottom: 12 }}>
                現在、同期機能は利用できません。
              </p>
              <p style={{ fontSize: 12 }}>
                将来的に以下の同期機能を追加予定:<br />
                • クラウドストレージへの自動バックアップ<br />
                • 複数デバイス間でのリスト共有<br />
                • チームメンバーとのリアルタイム同期
              </p>
            </div>
          </section>
        )}

        {/* ── Advanced tab ── */}
        {tab === 'advanced' && (
          <section>
            <h3>データベース</h3>
            <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8, lineHeight: 1.6 }}>
              すべてのデータはローカルのSQLiteデータベースに保存されています。
            </p>
            <div className="db-path-box">
              <code className="db-path-text">%APPDATA%\com.stickytodo.app\sticky-todo.db</code>
              <button
                className="btn-secondary"
                style={{ fontSize: 11, padding: '3px 10px', flexShrink: 0 }}
                onClick={() => {
                  const path = `${String.fromCharCode(37)}APPDATA${String.fromCharCode(37)}\\com.stickytodo.app\\sticky-todo.db`;
                  navigator.clipboard.writeText(path).catch(() => {});
                }}
                title="パスをコピー"
              >📋 コピー</button>
            </div>
            <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 12, lineHeight: 1.6 }}>
              データを完全にリセットするにはこのファイルを削除してください。
            </p>
          </section>
        )}

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
