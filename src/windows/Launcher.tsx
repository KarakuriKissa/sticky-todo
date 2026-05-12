import { useEffect, useRef, useState, KeyboardEvent } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { CategoryList } from '../components/CategoryList';
import { NoteList } from '../components/NoteList';
import { useAppStore } from '../store/appStore';
import type { SortMode } from '../types';
import { log } from '../utils/log';
import { SettingsModal } from './launcher/SettingsModal';

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
  } = useAppStore();
  const [showSettings, setShowSettings] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(180);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    load().then(() => {
      const { settings } = useAppStore.getState();
      if (settings.reopen_windows_on_start !== false) reopenSavedWindows();
    });
  }, []);

  // Background update check on launcher open. Compares the latest GitHub
  // Actions build run number against the one we last seen and shows a banner
  // if a newer build is available.
  const [updateBanner, setUpdateBanner] = useState<{ runNumber: number; url: string } | null>(null);
  useEffect(() => {
    const seenKey = 'sticky-todo:last-seen-build';
    const lastSeen = Number(localStorage.getItem(seenKey) ?? '0');
    fetch('https://api.github.com/repos/KarakuriKissa/sticky-todo/actions/workflows/build.yml/runs?per_page=1&status=success')
      .then((r) => r.json())
      .then((j) => {
        const run = j.workflow_runs?.[0];
        if (run && run.run_number > lastSeen + 0) {
          // Show banner only if a strictly NEW run appeared after first launch.
          if (lastSeen === 0) {
            // First time we see a build → just remember, don't bug the user.
            localStorage.setItem(seenKey, String(run.run_number));
          } else if (run.run_number > lastSeen) {
            setUpdateBanner({ runNumber: run.run_number, url: run.html_url });
          }
        }
      })
      .catch(() => {});
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
      } catch (e) { log.error('[search] DB query failed:', e); }
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
    // カテゴリーが選択されていない場合は「カテゴリー無し」として作成する
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
      {/* Update banner — appears when a newer GitHub build is available. */}
      {updateBanner && (
        <div className="update-banner" role="alert">
          🆙 新しいビルド <b>#{updateBanner.runNumber}</b> が利用可能です
          <button
            className="btn-secondary"
            style={{ marginLeft: 10, fontSize: 11, padding: '3px 10px' }}
            onClick={async () => {
              (await import('@tauri-apps/plugin-shell')).open(updateBanner.url);
              localStorage.setItem('sticky-todo:last-seen-build', String(updateBanner.runNumber));
              setUpdateBanner(null);
            }}
          >ダウンロードページを開く</button>
          <button
            className="btn-secondary"
            style={{ marginLeft: 6, fontSize: 11, padding: '3px 8px' }}
            onClick={() => {
              localStorage.setItem('sticky-todo:last-seen-build', String(updateBanner.runNumber));
              setUpdateBanner(null);
            }}
          >閉じる</button>
        </div>
      )}

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
            title="新規リスト作成"
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
                        } catch (e) { log.error('[search] emit failed:', e); }
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

// ── Help / About / Privacy ────────────────────────────────────────────────────
