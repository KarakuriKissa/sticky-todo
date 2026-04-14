import { useEffect, useRef, useState, KeyboardEvent } from 'react';
import { CategoryList } from '../components/CategoryList';
import { NoteList } from '../components/NoteList';
import { useAppStore } from '../store/appStore';
import { startAutoSync, stopAutoSync } from '../utils/sync';
import type { AppSettings, SortMode } from '../types';

const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: 'manual',     label: '手動' },
  { value: 'name',       label: '名前' },
  { value: 'deadline',   label: '期限' },
  { value: 'start_date', label: '開始日' },
  { value: 'status',     label: 'ステータス' },
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
    // Global Ctrl+F
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
    if (settings.sync_enabled && settings.sync_token) {
      startAutoSync({ endpoint: '/api/sync', token: settings.sync_token });
    } else {
      stopAutoSync();
    }
    return () => stopAutoSync();
  }, [settings.sync_enabled, settings.sync_token]);

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

  const toggleSync = async () => {
    await saveSettings({ ...settings, sync_enabled: !settings.sync_enabled });
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

          <button className="btn-primary" onClick={handleNew} title="新規作成 (Enter)">
            ＋ 新規
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

          <button
            className={`btn-sync${settings.sync_enabled ? ' active' : ''}`}
            onClick={toggleSync}
            title="同期"
          >
            ⟳ 同期{settings.sync_enabled ? ' ON' : ' OFF'}
          </button>

          <button className="btn-icon" onClick={() => setShowSettings(true)} title="設定">
            ⚙
          </button>
        </header>

        {/* ── Note list ── */}
        <NoteList onNew={handleNew} />
      </main>

      {showSettings && (
        <SettingsModal settings={settings} onSave={saveSettings} onClose={() => setShowSettings(false)} />
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
  const { statuses, saveStatus, deleteStatus } = useAppStore();
  const [newStatusName, setNewStatusName] = useState('');
  const [newStatusColor, setNewStatusColor] = useState('#6366f1');

  const toggle = (key: keyof AppSettings) =>
    setDraft((d) => ({ ...d, [key]: !d[key as keyof AppSettings] }));

  const save = async () => {
    await onSave(draft);
    onClose();
  };

  const addStatus = async () => {
    if (!newStatusName.trim()) return;
    const id = await (await import('@tauri-apps/api/core')).invoke<string>('generate_id');
    await saveStatus({ id, name: newStatusName.trim(), color: newStatusColor, sort_order: statuses.length });
    setNewStatusName('');
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>設定</h2>

        <section>
          <h3>機能ON/OFF</h3>
          {(['feature_status', 'feature_assignee', 'feature_date', 'feature_sync'] as const).map((key) => (
            <label key={key} className="toggle-row">
              <input type="checkbox" checked={!!draft[key]} onChange={() => toggle(key)} />
              {{ feature_status: 'ステータス', feature_assignee: '担当者', feature_date: '日付', feature_sync: '同期' }[key]}
            </label>
          ))}
        </section>

        <section>
          <h3>ステータス管理</h3>
          <div className="status-list">
            {statuses.map((s) => (
              <div key={s.id} className="status-row">
                <span className="status-dot" style={{ background: s.color }} />
                <span>{s.name}</span>
                <button className="btn-icon" onClick={() => deleteStatus(s.id)}>×</button>
              </div>
            ))}
          </div>
          <div className="status-add-row">
            <input
              value={newStatusName}
              onChange={(e) => setNewStatusName(e.target.value)}
              placeholder="新しいステータス"
              onKeyDown={(e) => e.key === 'Enter' && addStatus()}
            />
            <input type="color" value={newStatusColor} onChange={(e) => setNewStatusColor(e.target.value)} />
            <button className="btn-primary" onClick={addStatus}>追加</button>
          </div>
        </section>

        <div className="modal-actions">
          <button className="btn-primary" onClick={save}>保存</button>
          <button className="btn-secondary" onClick={onClose}>キャンセル</button>
        </div>
      </div>
    </div>
  );
}
