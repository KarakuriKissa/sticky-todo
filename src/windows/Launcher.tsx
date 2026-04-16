import { useEffect, useRef, useState, KeyboardEvent } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { CategoryList } from '../components/CategoryList';
import { NoteList } from '../components/NoteList';
import { useAppStore } from '../store/appStore';
import type { AppSettings, AssigneeGroup, AssigneePerson, SortMode, Status } from '../types';

const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: 'manual', label: '手動' },
  { value: 'name',   label: '名前順' },
];

export function Launcher() {
  const {
    load, reopenSavedWindows, createNote,
    searchQuery, setSearchQuery, settings, saveSettings,
    selectedCategoryId,
  } = useAppStore();
  const [showSettings, setShowSettings] = useState(false);
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

  const handleNew = async () => {
    if (!selectedCategoryId) {
      // "すべて" selected — require category
      alert('カテゴリを選択してからリストを作成してください。');
      return;
    }
    // Create note but do NOT auto-open the window
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

  return (
    <div className="launcher">
      <CategoryList />

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
            value={settings.sort_mode}
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
type SettingsTab = 'statuses' | 'assignees' | 'language' | 'sync';

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
    { id: 'language',  label: '言語' },
    { id: 'sync',      label: '同期' },
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

            <h3 style={{ marginTop: 20 }}>期日警告（グローバル）</h3>
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
            <h3>担当者グループと メンバー</h3>
            <div className="assignee-split">
              {/* LEFT: group list */}
              <div className="assignee-left">
                <div className="assignee-left-header">グループ</div>
                <div className="assignee-group-list">
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
                          if (confirm(`グループ「${g.name}」を削除しますか？`)) {
                            deleteAssigneeGroup(g.id);
                            if (selectedGroupId === g.id) setSelectedGroupId(assigneeGroups[0]?.id ?? '');
                          }
                        }}
                      >×</button>
                    </div>
                  ))}
                </div>
                <div className="assignee-add-group">
                  <input
                    value={newGroupName}
                    onChange={(e) => setNewGroupName(e.target.value)}
                    placeholder="グループ名"
                    className="assignee-input"
                    onKeyDown={(e) => e.key === 'Enter' && addGroup()}
                  />
                  <button className="btn-primary" onClick={addGroup} style={{ fontSize: 12, padding: '3px 8px' }}>追加</button>
                </div>
              </div>

              {/* RIGHT: member list */}
              <div className="assignee-right">
                <div className="assignee-right-header">
                  {selectedGroupId
                    ? `${assigneeGroups.find((g) => g.id === selectedGroupId)?.name ?? ''} のメンバー`
                    : 'グループを選択'}
                </div>
                {selectedGroupId && (
                  <>
                    <div className="status-list">
                      {groupPersons.map((p) => (
                        <div key={p.id} className="status-row">
                          <span className="status-dot" style={{ background: p.color }} />
                          <span style={{ flex: 1 }}>{p.name}</span>
                          <button className="btn-icon" style={{ fontSize: 11 }} onClick={() => deleteAssigneePerson(p.id)}>×</button>
                        </div>
                      ))}
                      {groupPersons.length === 0 && (
                        <div style={{ color: 'var(--muted)', fontSize: 12, padding: 4 }}>メンバーなし</div>
                      )}
                    </div>
                    <div className="status-add-row" style={{ marginTop: 8 }}>
                      <input
                        value={newPersonName}
                        onChange={(e) => setNewPersonName(e.target.value)}
                        placeholder="メンバー名"
                        onKeyDown={(e) => e.key === 'Enter' && addPerson()}
                      />
                      <input type="color" value={newPersonColor} onChange={(e) => setNewPersonColor(e.target.value)} />
                      <button className="btn-primary" onClick={addPerson}>追加</button>
                    </div>

                    <h3 style={{ marginTop: 14 }}>使用グループ</h3>
                    <select
                      className="sort-select"
                      value={draft.active_group_id ?? ''}
                      onChange={(e) => setDraft((d) => ({ ...d, active_group_id: e.target.value || null }))}
                      style={{ width: '100%' }}
                    >
                      <option value="">（自動 - 先頭グループ）</option>
                      {assigneeGroups.map((g) => (
                        <option key={g.id} value={g.id}>{g.name}</option>
                      ))}
                    </select>
                  </>
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
              <p style={{ marginTop: 12, fontSize: 12 }}>
                データは現在ローカルに保存されています。<br />
                場所: <code style={{ fontSize: 11, background: 'var(--bg)', padding: '1px 4px', borderRadius: 3 }}>
                  %APPDATA%\sticky-todo\sticky-todo.db
                </code>
              </p>
            </div>
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
