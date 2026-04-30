import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { TodoItemRow } from '../components/TodoItem';
import { useNoteStore } from '../store/noteStore';
import { useAppStore } from '../store/appStore';
import type { ItemType, Note, TodoItem } from '../types';

interface Props {
  noteId: string;
}

const NOTE_COLORS = [
  '#fef08a', '#bbf7d0', '#bfdbfe', '#fecaca',
  '#e9d5ff', '#fed7aa', '#f9fafb', '#fce7f3',
];

export function NoteWindow({ noteId }: Props) {
  const {
    load, items, note, setNote, addItem, flush, undo, redo,
    selectAll, clearSelection, selectedIds, searchQuery, setSearchQuery,
    saveStatus, lastSavedAt,
  } = useNoteStore();
  const { notes, updateNote, assigneeGroups, settings, trackWindowClose, categories } = useAppStore();
  const [alwaysOnTop, setAlwaysOnTop] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showPriorityPicker, setShowPriorityPicker] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [priorityMode, setPriorityMode] = useState<'hml' | 'abc'>('hml');
  const [titleDraft, setTitleDraft] = useState('');
  const [activeGroupId, setActiveGroupId] = useState<string>('');
  const [closingOverlay, setClosingOverlay] = useState<null | 'saving' | 'failed'>(null);
  const [quickAddText, setQuickAddText] = useState('');
  const [showCheatSheet, setShowCheatSheet] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const appWin = getCurrentWindow();
  const closingRef = useRef(false);
  // noteRef lets the onCloseRequested closure (registered once) always read the
  // latest note without needing to re-register whenever note changes.
  const noteRef = useRef<Note | null>(null);

  // Load note + items
  useEffect(() => {
    const found = notes.find((n) => n.id === noteId);
    if (found) {
      setNote(found);
      setAlwaysOnTop(found.always_on_top);
    } else {
      invoke<Note[]>('get_all_notes').then((all) => {
        const n = all.find((x) => x.id === noteId);
        if (n) { setNote(n); setAlwaysOnTop(n.always_on_top); }
      });
    }
    load(noteId);
  }, [noteId]);

  // Initialize activeGroupId once groups are available
  useEffect(() => {
    if (!activeGroupId && assigneeGroups.length > 0) {
      setActiveGroupId(settings.active_group_id ?? assigneeGroups[0].id);
    }
  }, [assigneeGroups]);

  // Keep noteRef in sync so the close handler always has the latest note.
  useEffect(() => { noteRef.current = note; }, [note]);

  // Periodic autosave — final defense if everything else fails.
  // Calls flush() every 5s. flush() is a no-op when items are empty / nothing changed.
  useEffect(() => {
    const id = setInterval(() => { flush().catch(() => {}); }, 5000);
    return () => clearInterval(id);
  }, [flush]);

  // Sync title/color from appStore when another window changes them
  useEffect(() => {
    const found = notes.find((n) => n.id === noteId);
    if (found && note && !editingTitle) {
      if (found.title !== note.title || found.color !== note.color) {
        setNote({ ...note, title: found.title, color: found.color });
      }
    }
  }, [notes]);

  // Register the close handler ONCE (empty deps) so there is never a gap where no
  // handler is listening.  noteRef gives it access to the current note at any time.
  useEffect(() => {
    const unlisten = appWin.onCloseRequested(async (event) => {
      if (closingRef.current) return;
      event.preventDefault();          // never let the window close on its own
      closingRef.current = true;
      setClosingOverlay('saving');     // show the "保存中…" overlay

      // ── 1. Flush items to SQLite, with up to 3 retries ────────────────────
      let saved = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await flush();
          saved = true;
          break;
        } catch (e) {
          console.error(`flush attempt ${attempt + 1} failed:`, e);
          await new Promise((r) => setTimeout(r, 250));
        }
      }
      if (!saved) {
        // All retries failed — let the user decide whether to force-close.
        setClosingOverlay('failed');
        const ok = window.confirm(
          '保存に失敗しました。\nこのまま閉じると最後の変更が失われる可能性があります。\nそれでも閉じますか？',
        );
        if (!ok) {
          // User chose to stay → reset state so the window remains usable.
          closingRef.current = false;
          setClosingOverlay(null);
          return;
        }
      }

      // ── 2. Persist window geometry (best-effort, never blocks close) ──────
      const currentNote = noteRef.current;
      if (currentNote) {
        try {
          const pos = await appWin.outerPosition();
          const size = await appWin.outerSize();
          const scale = await appWin.scaleFactor();
          const updated = {
            ...currentNote,
            window_x: pos.x / scale,
            window_y: pos.y / scale,
            window_width: size.width / scale,
            window_height: size.height / scale,
          };
          updateNote(updated);
          await invoke('save_note', { note: updated });
        } catch (posErr) {
          console.warn('Could not save window geometry:', posErr);
        }
      }

      try { await trackWindowClose(noteId); } catch { /* ignore */ }
      appWin.destroy();
    });
    return () => { unlisten.then((f) => f()); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Listen for note-updated events from other windows
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    import('@tauri-apps/api/event').then(({ listen }) => {
      listen<{ id: string; title: string; color: string }>('note-updated', (event) => {
        if (event.payload.id !== noteId) return;
        const current = useNoteStore.getState().note;
        if (current && !editingTitle) {
          useNoteStore.setState({ note: { ...current, title: event.payload.title, color: event.payload.color } });
        }
      }).then((fn) => { unlisten = fn; }).catch(() => {});
    });
    return () => { unlisten?.(); };
  }, [noteId, editingTitle]);

  // Listen for request-close event (emitted by NoteList "リストを閉じる")
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    import('@tauri-apps/api/event').then(({ listen }) => {
      listen('request-close', () => {
        if (!closingRef.current) close();
      }).then(fn => { unlisten = fn; }).catch(() => {});
    });
    return () => { unlisten?.(); };
  }, [note]); // re-subscribe when note changes so close() has fresh note

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't intercept when typing inside a text field, except for shortcuts that
      // are explicitly modifier-based (Ctrl/Meta).
      const target = e.target as HTMLElement | null;
      const isInputFocused = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');

      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) { e.preventDefault(); redo(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') { e.preventDefault(); selectAll(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') { e.preventDefault(); document.querySelector<HTMLInputElement>('.note-search-input')?.focus(); return; }
      if (e.key === 'Escape') {
        clearSelection();
        setSearchQuery('');
        setShowColorPicker(false);
        setShowPriorityPicker(false);
        setShowCheatSheet(false);
        return;
      }
      // ? key — show cheat sheet (only when not typing into a field)
      if (!isInputFocused && (e.key === '?' || (e.shiftKey && e.key === '/'))) {
        e.preventDefault();
        setShowCheatSheet((v) => !v);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Quick-add: pressing Enter in the top bar adds a task and clears the input.
  const submitQuickAdd = () => {
    const t = quickAddText.trim();
    if (!t) return;
    const id = addItem();
    if (id) {
      useNoteStore.getState().updateItem(id, { text: t });
      setQuickAddText('');
    }
  };

  const close = () => {
    // Simply request a close — onCloseRequested handles saving + destroy().
    // Using appWin.close() (not destroy()) so the onCloseRequested handler
    // fires and performs the full save-then-destroy sequence.
    appWin.close();
  };

  const togglePin = async () => {
    const next = !alwaysOnTop;
    setAlwaysOnTop(next);
    await invoke('set_always_on_top', { noteId, onTop: next });
    if (note) {
      const updated = { ...note, always_on_top: next };
      updateNote(updated);
      setNote(updated);
    }
  };

  const setColor = (color: string) => {
    if (!note) return;
    const updated = { ...note, color };
    updateNote(updated);
    setNote(updated);
    setShowColorPicker(false);
  };

  // Title edit
  const startTitleEdit = () => {
    setTitleDraft(note?.title ?? '');
    setEditingTitle(true);
    setTimeout(() => titleInputRef.current?.select(), 20);
  };

  const commitTitle = () => {
    if (!note) return;
    setEditingTitle(false);
    const title = titleDraft.trim() || note.title;
    const updated = { ...note, title };
    updateNote(updated);
    setNote(updated);
  };

  // Apply to selected items
  const applyToSelected = (patch: Partial<TodoItem>) => {
    const store = useNoteStore.getState();
    if (store.selectedIds.size > 0) {
      store.selectedIds.forEach((id) => store.updateItem(id, patch));
    }
  };

  // Per-note deadline warn days
  const globalWarnDays = settings.deadline_warn_days ?? 3;
  const warnDays = note?.warn_days ?? globalWarnDays;

  const setNoteWarnDays = (days: number) => {
    if (!note) return;
    const updated = { ...note, warn_days: days };
    updateNote(updated);
    setNote(updated);
  };

  // Build visible item list
  const collapsedIds = new Set(items.filter((i) => i.collapsed).map((i) => i.id));
  const isHidden = (item: TodoItem): boolean => {
    if (!item.parent_id) return false;
    if (collapsedIds.has(item.parent_id)) return true;
    const parent = items.find((i) => i.id === item.parent_id);
    return parent ? isHidden(parent) : false;
  };

  const sq = searchQuery.toLowerCase().trim();
  const visibleItems = items.filter((i) => {
    if (showArchived ? !i.archived : i.archived) return false;
    if (isHidden(i)) return false;
    if (sq && !i.text.toLowerCase().includes(sq)) return false;
    return true;
  });
  const archivedCount = items.filter((i) => i.archived).length;
  const checkedNonArchived = items.filter((i) => i.checked && !i.archived);

  const archiveCheckedAll = () => {
    if (checkedNonArchived.length === 0) return;
    const ids = new Set(checkedNonArchived.map((i) => i.id));
    ids.forEach((id) => useNoteStore.getState().updateItem(id, { archived: true }));
  };

  const noteColor = note?.color ?? '#fef08a';
  const titleText = note?.title ?? '';

  const addTyped = (type: ItemType) => {
    const id = addItem(undefined, 0);
    useNoteStore.getState().updateItem(id, { item_type: type });
  };

  const selCount = selectedIds.size;

  const PRIORITY_OPTIONS = [
    { value: null, label: '（なし）' },
    { value: 'high', label: '高' },
    { value: 'medium', label: '中' },
    { value: 'low', label: '低' },
  ] as const;

  return (
    <div
      className="note-window"
      style={{ background: noteColor }}
      onClick={() => {
        setShowColorPicker(false);
        setShowPriorityPicker(false);
      }}
    >
      {/* Category color stripe on the left edge */}
      {(() => {
        const cat = categories.find((c) => c.id === note?.category_id);
        return cat ? <div className="note-category-stripe" style={{ background: cat.color }} /> : null;
      })()}

      {/* ── Closing overlay — blocks close until save finishes ── */}
      {closingOverlay && (
        <div className="closing-overlay">
          <div className="closing-overlay-box">
            {closingOverlay === 'saving'
              ? <><div className="spinner" />保存中…<br />しばらくお待ちください</>
              : <>⚠ 保存に失敗しました</>}
          </div>
        </div>
      )}

      {/* ── Title bar ── */}
      <div className="note-titlebar" data-tauri-drag-region="">
        {editingTitle ? (
          <input
            ref={titleInputRef}
            className="note-title-input editing"
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); commitTitle(); }
              if (e.key === 'Escape') setEditingTitle(false);
            }}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span
            className="note-title-text"
            data-tauri-drag-region=""
            onDoubleClick={startTitleEdit}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              startTitleEdit();
            }}
            title="ダブルクリックまたは右クリックで編集"
          >
            {titleText || 'タイトルなし'}
          </span>
        )}

        <div className="note-titlebar-actions">
          {/* Save indicator */}
          <span
            className={`save-indicator save-${saveStatus}`}
            title={lastSavedAt ? `最終保存: ${new Date(lastSavedAt).toLocaleTimeString()}` : '未保存'}
          >
            {saveStatus === 'saving' ? '💾…' : saveStatus === 'saved' ? '✓' : saveStatus === 'error' ? '⚠' : ''}
          </span>

          {/* Pin button — visually distinct when ON */}
          <button
            className={`pin-btn${alwaysOnTop ? ' pinned' : ''}`}
            onClick={togglePin}
            title={alwaysOnTop ? '最前面固定: ON（クリックで解除）' : '最前面固定: OFF'}
          >
            {alwaysOnTop ? '📍' : '📌'}
          </button>

          {/* Color swatch button */}
          <div style={{ position: 'relative' }}>
            <button
              className="color-swatch-btn"
              style={{ background: noteColor }}
              onClick={(e) => { e.stopPropagation(); setShowColorPicker((o) => !o); }}
              title="色を変更"
            />
            {showColorPicker && (
              <div className="color-picker" onClick={(e) => e.stopPropagation()}>
                {NOTE_COLORS.map((c) => (
                  <div
                    key={c}
                    className={`color-swatch${noteColor === c ? ' selected' : ''}`}
                    style={{ background: c }}
                    onClick={() => setColor(c)}
                  />
                ))}
              </div>
            )}
          </div>

          <button className="close-btn" onClick={close} title="閉じる">✕</button>
        </div>
      </div>

      {/* ── Toolbar ── */}
      <div className="note-type-bar">
        <button className="type-btn" onClick={() => addItem()} title="項目追加">＋</button>
        <button className="type-btn" onClick={() => addTyped('heading')} title="見出し">H</button>
        <button className="type-btn" onClick={() => addTyped('separator')} title="区切り線">—</button>
        <button
          className="type-btn"
          onClick={() => { if (selCount > 0) [...selectedIds].forEach((id) => useNoteStore.getState().indent(id)); }}
          title="インデント (Tab)"
        >→</button>
        <button
          className="type-btn"
          onClick={() => { if (selCount > 0) [...selectedIds].forEach((id) => useNoteStore.getState().dedent(id)); }}
          title="アウトデント (Shift+Tab)"
        >←</button>

        {/* Group selector — choose which assignee group is shown in task badges */}
        {settings.feature_assignee && assigneeGroups.length > 0 && (
          <select
            className="group-selector"
            value={activeGroupId}
            onChange={(e) => setActiveGroupId(e.target.value)}
            title="担当者グループ"
            onClick={(e) => e.stopPropagation()}
          >
            {assigneeGroups.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
        )}

        {/* Priority for selection */}
        {settings.feature_priority && selCount > 0 && (
          <div style={{ position: 'relative' }}>
            <button className="type-btn active-feature" onClick={(e) => { e.stopPropagation(); setShowPriorityPicker((o) => !o); }}>★</button>
            {showPriorityPicker && (
              <div className="status-dropdown" style={{ top: '100%', left: 0, bottom: 'auto' }} onClick={(e) => e.stopPropagation()}>
                {PRIORITY_OPTIONS.map((p) => (
                  <div key={String(p.value)} className="status-option"
                    onClick={() => { applyToSelected({ priority: p.value ?? null }); setShowPriorityPicker(false); }}>
                    {p.label}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="type-bar-spacer" />

        {/* Priority mode toggle */}
        {settings.feature_priority && (
          <button
            className="type-btn"
            onClick={() => setPriorityMode(m => m === 'hml' ? 'abc' : 'hml')}
            title={priorityMode === 'hml' ? 'ABC表記に切替' : '高中低表記に切替'}
            style={{ fontSize: 10 }}
          >
            {priorityMode === 'hml' ? '高中低' : 'ABC'}
          </button>
        )}

        {selCount > 0 && <span className="sel-count">{selCount}件</span>}

        {/* Check/uncheck selected */}
        <button
          className="type-btn"
          onClick={() => useNoteStore.getState().checkSelected(true)}
          title="選択をチェック"
        >☑</button>
        <button
          className="type-btn"
          onClick={() => useNoteStore.getState().checkSelected(false)}
          title="選択のチェックを外す"
        >☐</button>

        {/* Bulk archive checked */}
        <button
          className="type-btn"
          onClick={archiveCheckedAll}
          disabled={checkedNonArchived.length === 0}
          title={`チェック済を一括アーカイブ (${checkedNonArchived.length}件)`}
        >📥</button>

        {/* Toggle archived view */}
        <button
          className={`type-btn${showArchived ? ' active-feature' : ''}`}
          onClick={() => setShowArchived((v) => !v)}
          title={showArchived ? `通常表示に戻る` : `アーカイブを表示 (${archivedCount}件)`}
        >🗄️{archivedCount > 0 && <sup style={{ fontSize: 8 }}>{archivedCount}</sup>}</button>
      </div>

      {/* ── Search bar ── */}
      <div className="note-search-bar">
        <input
          className="note-search-input"
          placeholder="🔍 検索…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onClick={(e) => e.stopPropagation()}
        />
        {searchQuery && (
          <button className="note-search-clear" onClick={() => setSearchQuery('')}>✕</button>
        )}
        {/* Per-note deadline warn days */}
        {settings.feature_date && (
          <span className="warn-days-setting" title="期日警告の日数（このリストの設定）">
            ⚠
            <input
              type="number"
              className="warn-days-input"
              value={warnDays}
              min={0}
              max={30}
              onChange={(e) => setNoteWarnDays(Number(e.target.value))}
              onClick={(e) => e.stopPropagation()}
              title="期日の何日前から警告するか"
            />
            日前
          </span>
        )}
      </div>

      {/* ── Quick-add bar — Enter で1秒で追加 ── */}
      {!showArchived && (
        <div className="quick-add-bar">
          <input
            className="quick-add-input"
            placeholder="✏️ 新しいタスクを入力して Enter で追加…"
            value={quickAddText}
            onChange={(e) => setQuickAddText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); submitQuickAdd(); }
              if (e.key === 'Escape') setQuickAddText('');
            }}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {/* ── Item list ── */}
      <div className="note-items" onClick={() => clearSelection()}>
        {visibleItems.length === 0 && (
          <div className="note-items-empty" onClick={(e) => { e.stopPropagation(); addItem(); }}>
            {searchQuery ? '該当するタスクがありません' : 'クリックして追加…'}
          </div>
        )}
        {visibleItems.map((item) => (
          <TodoItemRow
            key={item.id}
            item={item}
            visibleItems={visibleItems}
            allItems={items}
            warnDays={warnDays}
            priorityMode={priorityMode}
            activeGroupId={activeGroupId}
          />
        ))}
      </div>

      {/* ── Cheat sheet (? key) ── */}
      {showCheatSheet && (
        <div className="cheat-sheet-backdrop" onClick={() => setShowCheatSheet(false)}>
          <div className="cheat-sheet" onClick={(e) => e.stopPropagation()}>
            <h4>キーボードショートカット</h4>
            {[
              ['元に戻す', 'Ctrl+Z'],
              ['やり直し', 'Ctrl+Y'],
              ['全選択', 'Ctrl+A'],
              ['検索', 'Ctrl+F'],
              ['インデント', 'Tab'],
              ['アウトデント', 'Shift+Tab'],
              ['太字', 'Ctrl+B'],
              ['複製', 'Ctrl+D'],
              ['ロック', 'Ctrl+L'],
              ['コメント', 'Ctrl+M'],
              ['複数選択', 'Shift+↑/↓'],
              ['行を移動', 'Ctrl+Shift+↑/↓'],
              ['削除', 'Delete'],
              ['キャンセル / 閉じる', 'Esc'],
              ['この一覧を表示', '?'],
            ].map(([label, key]) => (
              <div key={key} className="cheat-sheet-row">
                <span>{label}</span>
                <span className="cheat-sheet-key">{key}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
