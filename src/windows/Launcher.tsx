import { useEffect, useRef, useState, KeyboardEvent } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { CategoryList } from '../components/CategoryList';
import { NoteList } from '../components/NoteList';
import { useAppStore } from '../store/appStore';
import type {
  AppSettings, AssigneeGroup, AssigneePerson, SortMode, Status,
} from '../types';

const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: 'manual',     label: '手動' },
  { value: 'name',       label: '名前順' },
  { value: 'deadline',   label: '期限順' },
  { value: 'start_date', label: '開始日順' },
  { value: 'status',     label: 'ステータス順' },
  { value: 'priority',   label: '優先度順' },
];

export function Launcher() {
  const {
    load, createNote, openNote, searchQuery, setSearchQuery,
    settings, saveSettings,
  } = useAppStore();
  const [showSettings, setShowSettings] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    load();
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
    const note = await createNote();
    await openNote(note);
  };

  const handleSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      const notes = useAppStore.getState().filteredNotes();
      if (notes.length === 1) openNote(notes[0]);
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
        {/* ── Toolbar ── */}
        <header className="launcher-toolbar">
          <input
            ref={searchRef}
            className="search-input"
            placeholder="検索… (Ctrl+F)"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleSearchKey}
          />

          <button className="btn-new" onClick={handleNew} title="新規リスト作成">
            ＋
          </button>

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

          <button className="btn-icon" onClick={() => setShowSettings(true)} title="設定">
            ⚙
          </button>
        </header>

        {/* ── Note list ── */}
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
function SettingsModal({
  settings,
  onSave,
  onClose,
}: {
  settings: AppSettings;
  onSave: (s: AppSettings) => Promise<void>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<AppSettings>({ ...settings });
  const {
    statuses, saveStatus, deleteStatus,
    assigneeGroups, saveAssigneeGroup, deleteAssigneeGroup,
    assigneePersons, saveAssigneePerson, deleteAssigneePerson,
  } = useAppStore();

  // Status management
  const [newStatusName, setNewStatusName] = useState('');
  const [newStatusColor, setNewStatusColor] = useState('#6366f1');

  // Assignee group management
  const [newGroupName, setNewGroupName] = useState('');
  const [selectedGroupId, setSelectedGroupId] = useState<string>(
    assigneeGroups[0]?.id ?? ''
  );
  const [newPersonName, setNewPersonName] = useState('');
  const [newPersonColor, setNewPersonColor] = useState('#6366f1');

  // Active tab
  const [tab, setTab] = useState<'features' | 'statuses' | 'assignees'>('features');

  const toggle = (key: keyof AppSettings) =>
    setDraft((d) => ({ ...d, [key]: !d[key as keyof AppSettings] }));

  const save = async () => {
    await onSave(draft);
    onClose();
  };

  const addStatus = async () => {
    if (!newStatusName.trim()) return;
    const id = await invoke<string>('generate_id');
    await saveStatus({
      id,
      name: newStatusName.trim(),
      color: newStatusColor,
      sort_order: statuses.length,
    });
    setNewStatusName('');
  };

  const editStatus = async (s: Status, newName: string) => {
    if (newName.trim()) {
      await saveStatus({ ...s, name: newName.trim() });
    }
  };

  const addGroup = async () => {
    if (!newGroupName.trim()) return;
    const id = await invoke<string>('generate_id');
    const group: AssigneeGroup = {
      id,
      name: newGroupName.trim(),
      sort_order: assigneeGroups.length,
    };
    await saveAssigneeGroup(group);
    setNewGroupName('');
    setSelectedGroupId(id);
  };

  const addPerson = async () => {
    if (!newPersonName.trim() || !selectedGroupId) return;
    const id = await invoke<string>('generate_id');
    const groupPersons = assigneePersons.filter((p) => p.group_id === selectedGroupId);
    const person: AssigneePerson = {
      id,
      group_id: selectedGroupId,
      name: newPersonName.trim(),
      color: newPersonColor,
      sort_order: groupPersons.length,
    };
    await saveAssigneePerson(person);
    setNewPersonName('');
  };

  const groupPersons = assigneePersons.filter((p) => p.group_id === selectedGroupId);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal settings-modal" onClick={(e) => e.stopPropagation()}>
        <h2>設定</h2>

        {/* Tabs */}
        <div className="settings-tabs">
          {(['features', 'statuses', 'assignees'] as const).map((t) => (
            <button
              key={t}
              className={`settings-tab${tab === t ? ' active' : ''}`}
              onClick={() => setTab(t)}
            >
              {{ features: '機能', statuses: 'ステータス', assignees: '担当者' }[t]}
            </button>
          ))}
        </div>

        {/* Features tab */}
        {tab === 'features' && (
          <section>
            <h3>表示機能のON/OFF</h3>
            {(
              [
                ['feature_status',   'ステータス'],
                ['feature_assignee', '担当者'],
                ['feature_date',     '日付'],
                ['feature_memo',     'メモ'],
                ['feature_priority', '優先度'],
              ] as [keyof AppSettings, string][]
            ).map(([key, label]) => (
              <label key={key} className="toggle-row">
                <input
                  type="checkbox"
                  checked={!!draft[key]}
                  onChange={() => toggle(key)}
                />
                {label}
              </label>
            ))}
          </section>
        )}

        {/* Statuses tab */}
        {tab === 'statuses' && (
          <section>
            <h3>ステータス管理</h3>
            <div className="status-list">
              {statuses.map((s) => (
                <StatusRow
                  key={s.id}
                  status={s}
                  onEdit={(name) => editStatus(s, name)}
                  onDelete={() => deleteStatus(s.id)}
                />
              ))}
            </div>
            <div className="status-add-row">
              <input
                value={newStatusName}
                onChange={(e) => setNewStatusName(e.target.value)}
                placeholder="新しいステータス名"
                onKeyDown={(e) => e.key === 'Enter' && addStatus()}
              />
              <input
                type="color"
                value={newStatusColor}
                onChange={(e) => setNewStatusColor(e.target.value)}
              />
              <button className="btn-primary" onClick={addStatus}>追加</button>
            </div>
          </section>
        )}

        {/* Assignees tab */}
        {tab === 'assignees' && (
          <section>
            <h3>担当者グループ</h3>

            {/* Group list */}
            <div className="assignee-groups">
              {assigneeGroups.map((g) => (
                <button
                  key={g.id}
                  className={`group-tab${selectedGroupId === g.id ? ' active' : ''}`}
                  onClick={() => setSelectedGroupId(g.id)}
                >
                  {g.name}
                  <span
                    className="group-del"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`グループ「${g.name}」を削除しますか？`)) {
                        deleteAssigneeGroup(g.id);
                        if (selectedGroupId === g.id) {
                          setSelectedGroupId(assigneeGroups[0]?.id ?? '');
                        }
                      }
                    }}
                  >×</span>
                </button>
              ))}
            </div>
            <div className="status-add-row" style={{ marginBottom: 12 }}>
              <input
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                placeholder="グループ名"
                onKeyDown={(e) => e.key === 'Enter' && addGroup()}
              />
              <button className="btn-primary" onClick={addGroup}>グループ追加</button>
            </div>

            {/* Active group setting */}
            {assigneeGroups.length > 0 && (
              <>
                <h3>使用グループ</h3>
                <select
                  className="sort-select"
                  value={draft.active_group_id ?? ''}
                  onChange={(e) => setDraft((d) => ({ ...d, active_group_id: e.target.value || null }))}
                  style={{ width: '100%', marginBottom: 12 }}
                >
                  <option value="">（自動）</option>
                  {assigneeGroups.map((g) => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </select>
              </>
            )}

            {/* Person list for selected group */}
            {selectedGroupId && (
              <>
                <h3>メンバー</h3>
                <div className="status-list">
                  {groupPersons.map((p) => (
                    <div key={p.id} className="status-row">
                      <span className="status-dot" style={{ background: p.color }} />
                      <span style={{ flex: 1 }}>{p.name}</span>
                      <button
                        className="btn-icon"
                        onClick={() => deleteAssigneePerson(p.id)}
                      >×</button>
                    </div>
                  ))}
                </div>
                <div className="status-add-row">
                  <input
                    value={newPersonName}
                    onChange={(e) => setNewPersonName(e.target.value)}
                    placeholder="メンバー名"
                    onKeyDown={(e) => e.key === 'Enter' && addPerson()}
                  />
                  <input
                    type="color"
                    value={newPersonColor}
                    onChange={(e) => setNewPersonColor(e.target.value)}
                  />
                  <button className="btn-primary" onClick={addPerson}>追加</button>
                </div>
              </>
            )}
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

// ── StatusRow (editable) ──────────────────────────────────────────────────────
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
    onEdit(name);
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
