import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { TodoItemRow } from '../components/TodoItem';
import { useNoteStore } from '../store/noteStore';
import { useAppStore } from '../store/appStore';
import type { ItemType, Note, TodoItem } from '../types';
import { ClosingOverlay, SearchOverlay, CheatSheet } from './note/overlays';
import { useReminders } from './note/useReminders';
import { useCloseHandler } from './note/useCloseHandler';
import { NoteToolbar } from './note/Toolbar';

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
  // Search overlay (Ctrl+F). Browser-style find: highlights matches in the
  // visible task list and supports up/down navigation between hits.
  const [showSearch, setShowSearch] = useState(false);
  const [searchMatchIdx, setSearchMatchIdx] = useState(0);
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

  // Clear "NEW" badges on imported items a few seconds after the window opens.
  useEffect(() => {
    const t = setTimeout(() => {
      useNoteStore.getState().clearNewItemIds();
    }, 6000);
    return () => clearTimeout(t);
  }, []);

  // Desktop reminders for overdue / soon-due tasks (extracted hook).
  useReminders({ items, note, settings });

  // Sync title/color from appStore when another window changes them
  useEffect(() => {
    const found = notes.find((n) => n.id === noteId);
    if (found && note && !editingTitle) {
      if (found.title !== note.title || found.color !== note.color) {
        setNote({ ...note, title: found.title, color: found.color });
      }
    }
  }, [notes]);

  // Close handler — flushes items + persists geometry, registered once.
  useCloseHandler({
    appWin, noteRef, closingRef, noteId,
    flush, updateNote, trackWindowClose, setClosingOverlay,
  });

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

  // Listen for statuses/assignees changes from other windows so the dropdowns
  // here update immediately when the user edits them in the launcher settings.
  useEffect(() => {
    let unlistenStatus: (() => void) | undefined;
    let unlistenAssignee: (() => void) | undefined;
    import('@tauri-apps/api/event').then(({ listen }) => {
      listen('statuses-updated', async () => {
        try {
          const next = await invoke<any[]>('get_statuses');
          useAppStore.setState({ statuses: next });
        } catch { /* ignore */ }
      }).then(fn => { unlistenStatus = fn; }).catch(() => {});
      listen('assignees-updated', async () => {
        try {
          const [groups, persons] = await Promise.all([
            invoke<any[]>('get_assignee_groups'),
            invoke<any[]>('get_assignee_persons'),
          ]);
          useAppStore.setState({ assigneeGroups: groups, assigneePersons: persons });
        } catch { /* ignore */ }
      }).then(fn => { unlistenAssignee = fn; }).catch(() => {});
    });
    return () => { unlistenStatus?.(); unlistenAssignee?.(); };
  }, []);

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
      if ((e.ctrlKey || e.metaKey) && e.key === 'a' && !isInputFocused) { e.preventDefault(); selectAll(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        e.stopImmediatePropagation();           // suppress WebView2's native find
        setShowSearch(true);
        setTimeout(() => document.querySelector<HTMLInputElement>('.search-overlay-input')?.focus(), 30);
        return;
      }
      if (e.key === 'Escape') {
        if (showSearch) { setShowSearch(false); setSearchQuery(''); return; }
        clearSelection();
        setSearchQuery('');
        setShowColorPicker(false);
        setShowPriorityPicker(false);
        setShowCheatSheet(false);
        return;
      }
      // ? key — show cheat sheet (only when not typing into a field, and
      // not during IME composition so JP/CN input isn't disrupted)
      if (!isInputFocused && !e.isComposing && (e.key === '?' || (e.shiftKey && e.key === '/'))) {
        e.preventDefault();
        setShowCheatSheet((v) => !v);
      }
      // Task-level copy / paste — only when not editing text (so it doesn't
      // hijack the user's normal text Ctrl+C/V in inputs).
      if ((e.ctrlKey || e.metaKey) && !isInputFocused) {
        if (e.key === 'c' || e.key === 'C') {
          const n = useNoteStore.getState().copySelectedToClipboard();
          if (n > 0) e.preventDefault();
        } else if (e.key === 'v' || e.key === 'V') {
          const n = useNoteStore.getState().pasteFromClipboard();
          if (n > 0) e.preventDefault();
        }
      }

      // Arrow-key selection navigation: when something is selected and the user
      // isn't editing text, ↑/↓ shifts the selection by one item. Works even
      // without the row being focused (row-level handler already covers focused
      // rows; this catches the "clicked, then pressed arrow" path).
      if (!isInputFocused && !e.shiftKey && !e.ctrlKey && !e.metaKey &&
          (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        const st = useNoteStore.getState();
        if (st.selectedIds.size === 0) return;
        const ids = [...st.selectedIds];
        const items = st.items.filter((i) => !i.archived);
        // Anchor = last selected in display order for ↓, first for ↑.
        let anchorIdx: number;
        if (e.key === 'ArrowDown') {
          anchorIdx = items.length - 1;
          for (let i = items.length - 1; i >= 0; i--) {
            if (ids.includes(items[i].id)) { anchorIdx = i; break; }
          }
          const next = items[anchorIdx + 1];
          if (next) {
            e.preventDefault();
            st.setSelected(new Set([next.id]));
            setTimeout(() => {
              document.querySelector<HTMLElement>(`[data-item-id="${next.id}"]`)?.focus();
            }, 0);
          }
        } else {
          anchorIdx = 0;
          for (let i = 0; i < items.length; i++) {
            if (ids.includes(items[i].id)) { anchorIdx = i; break; }
          }
          const prev = items[anchorIdx - 1];
          if (prev) {
            e.preventDefault();
            st.setSelected(new Set([prev.id]));
            setTimeout(() => {
              document.querySelector<HTMLElement>(`[data-item-id="${prev.id}"]`)?.focus();
            }, 0);
          }
        }
      }
    };
    // capture: true so we beat WebView2's built-in Ctrl+F handler.
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [showSearch]);

  const gotoMatch = (delta: number) => {
    if (matchedIds.length === 0) return;
    setSearchMatchIdx((i) => (i + delta + matchedIds.length) % matchedIds.length);
  };

  // Listen for "jump-to-task" events emitted by the launcher's global search.
  // Highlights the requested task in this note window.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    import('@tauri-apps/api/event').then(({ listen }) => {
      listen<{ taskId: string; query: string }>('jump-to-task', (event) => {
        if (!event.payload) return;
        setSearchQuery(event.payload.query);
        setShowSearch(true);
        setTimeout(() => {
          const ids = useNoteStore.getState().items
            .filter((i) => i.text.toLowerCase().includes(event.payload.query.toLowerCase()))
            .map((i) => i.id);
          const idx = ids.indexOf(event.payload.taskId);
          if (idx >= 0) setSearchMatchIdx(idx);
        }, 200);
      }).then((fn) => { unlisten = fn; }).catch(() => {});
    });
    return () => { unlisten?.(); };
  }, []);

  // Quick-add: extra indent levels added via Tab (and removed via Shift+Tab) before submit.
  const [quickAddIndent, setQuickAddIndent] = useState(0);
  // Create one task per non-empty line. Shared by Enter-submit and multi-line paste.
  // If something is selected, insert below the last selected item (in display order).
  // Otherwise append to the end of the list.
  const submitQuickAddLines = (raw: string) => {
    const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length === 0) return;
    // Find anchor item to insert after.
    let anchorId: string | undefined;
    if (selectedIds.size > 0) {
      // Last selected item in current display order.
      for (let i = items.length - 1; i >= 0; i--) {
        if (selectedIds.has(items[i].id)) { anchorId = items[i].id; break; }
      }
    }
    const anchor = anchorId ? items.find((i) => i.id === anchorId) : items[items.length - 1];
    const baseIndent = anchor ? anchor.indent : 0;
    const indent = Math.max(0, Math.min(6, baseIndent + quickAddIndent));
    // Insert sequentially after the previously-inserted item so paste-order is preserved.
    let prevId = anchorId;
    for (const line of lines) {
      const id = addItem(prevId, indent);
      if (id) {
        useNoteStore.getState().updateItem(id, { text: line });
        prevId = id;
      }
    }
    setQuickAddText('');
    setQuickAddIndent(0);
  };

  const submitQuickAdd = () => {
    if (!quickAddText.trim()) return;
    submitQuickAddLines(quickAddText);
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
  // While the find overlay is open we KEEP all rows visible and just highlight
  // the matches — that's the browser-Ctrl+F behaviour the user expects.
  const findMode = showSearch && sq.length > 0;
  const visibleItems = items.filter((i) => {
    if (showArchived ? !i.archived : i.archived) return false;
    if (isHidden(i)) return false;
    if (!findMode && sq && !i.text.toLowerCase().includes(sq)) return false;
    return true;
  });
  // Matched item IDs (for highlighting + nav). Only used when findMode.
  const matchedIds = findMode
    ? visibleItems.filter((i) => i.text.toLowerCase().includes(sq)).map((i) => i.id)
    : [];
  const currentMatchId = matchedIds[searchMatchIdx] ?? null;

  // Reset match index on query change; auto-scroll the current match into view.
  useEffect(() => { setSearchMatchIdx(0); }, [searchQuery]);
  useEffect(() => {
    if (!currentMatchId) return;
    const el = document.querySelector(`[data-item-id="${currentMatchId}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [currentMatchId]);
  const archivedCount = items.filter((i) => i.archived).length;
  const checkedNonArchived = items.filter((i) => i.checked && !i.archived);

  const archiveCheckedAll = () => {
    if (checkedNonArchived.length === 0) return;
    const ids = new Set(checkedNonArchived.map((i) => i.id));
    ids.forEach((id) => useNoteStore.getState().updateItem(id, { archived: true }));
  };

  const noteColor = note?.color ?? '#fef08a';
  const titleText = note?.title ?? '';

  // Return the id of the last-selected item (in display order), or undefined.
  // Used so toolbar add-buttons insert below the user's current selection
  // instead of always appending to the end of the list.
  const anchorAfterSelection = (): string | undefined => {
    if (selectedIds.size === 0) return undefined;
    for (let i = items.length - 1; i >= 0; i--) {
      if (selectedIds.has(items[i].id)) return items[i].id;
    }
    return undefined;
  };

  // Toolbar "+" button — insert below the selection (or at end if none).
  const addItemFromToolbar = (): string => {
    const after = anchorAfterSelection();
    const id = addItem(after, undefined);
    if (id) useNoteStore.setState({ pendingFocusId: id });
    return id;
  };

  const addTyped = (type: ItemType) => {
    const after = anchorAfterSelection();
    const id = addItem(after, after ? undefined : 0);
    if (!id) return;
    useNoteStore.getState().updateItem(id, { item_type: type });
    // Separators have no text, no need to enter edit mode.
    if (type !== 'separator') useNoteStore.setState({ pendingFocusId: id });
  };

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
      <ClosingOverlay state={closingOverlay} />

      {/* ── Title bar ── */}
      {/* Titlebar layout (left → right):
            ┌──────────────────────────────────────────────────────────────┐
            │ [Title text]  [drag-spacer (window move)]  [save/pin/color/✕]│
            └──────────────────────────────────────────────────────────────┘
          - Title is content-width and accepts right-click to edit.
          - Drag spacer expands to fill remaining space → window-move cursor.
          - Actions are right-aligned. When the title is long enough to
            collide with the actions, it visually flows under them. */}
      <div className="note-titlebar">
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
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              startTitleEdit();
            }}
            title="右クリックで編集"
          >
            {titleText || 'タイトルなし'}
          </span>
        )}

        {/* Window-drag region — fills remaining horizontal space. */}
        <div className="note-titlebar-drag" data-tauri-drag-region="" />

        <div className="note-titlebar-actions">
          {/* Save indicator */}
          <span
            className={`save-indicator save-${saveStatus}`}
            title={lastSavedAt ? `最終保存: ${new Date(lastSavedAt).toLocaleTimeString()}` : '未保存'}
          >
            {saveStatus === 'saving' ? '💾…' : saveStatus === 'saved' ? '✓' : saveStatus === 'error' ? '⚠' : ''}
          </span>

          {/* Launcher button */}
          <button
            className="pin-btn"
            onClick={() => { invoke('show_launcher').catch(() => {}); }}
            title="ランチャーを開く"
            style={{ fontSize: 13 }}
          >
            🗂
          </button>

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

      {/* ── Toolbar (extracted) ── */}
      <NoteToolbar
        settings={settings}
        assigneeGroups={assigneeGroups}
        activeGroupId={activeGroupId}
        setActiveGroupId={setActiveGroupId}
        selectedIds={selectedIds}
        showPriorityPicker={showPriorityPicker}
        setShowPriorityPicker={setShowPriorityPicker}
        applyToSelected={applyToSelected}
        priorityMode={priorityMode}
        setPriorityMode={setPriorityMode}
        archiveCheckedAll={archiveCheckedAll}
        checkedNonArchived={checkedNonArchived}
        showArchived={showArchived}
        setShowArchived={setShowArchived}
        archivedCount={archivedCount}
        addItem={addItemFromToolbar}
        addTyped={addTyped}
      />

      {/* Hidden search bar — kept in DOM to preserve any existing CSS / focus
          targeting code; just visually hidden. The overlay below is the new UI. */}
      <div className="note-search-bar" style={{ display: 'none' }}>
        <input
          className="note-search-input"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {/* ── Quick-add bar (now in the search bar slot) ─────────────────────── */}
      {!showArchived && (
        <div className="quick-add-bar quick-add-bar-top">
          <input
            className="quick-add-input"
            placeholder={`✏️ 新しいタスクを入力して Enter で追加…${quickAddIndent > 0 ? `  (インデント+${quickAddIndent})` : ''}`}
            value={quickAddText}
            onChange={(e) => setQuickAddText(e.target.value)}
            onPaste={(e) => {
              // A single-line <input> collapses pasted newlines into spaces.
              // Intercept the raw clipboard text — if it has line breaks,
              // create one task per line immediately.
              const raw = e.clipboardData.getData('text');
              if (/\r?\n/.test(raw.trim())) {
                e.preventDefault();
                submitQuickAddLines(raw);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); submitQuickAdd(); }
              if (e.key === 'Escape') { setQuickAddText(''); setQuickAddIndent(0); }
              if (e.key === 'Tab') {
                e.preventDefault();
                if (e.shiftKey) setQuickAddIndent((n) => Math.max(0, n - 1));
                else setQuickAddIndent((n) => Math.min(6, n + 1));
              }
            }}
            onClick={(e) => e.stopPropagation()}
          />
          {/* Per-note deadline warn days kept here so it is still reachable. */}
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
      )}

      {/* ── Search overlay (Ctrl+F) — browser-style find ─────────────────── */}
      {showSearch && (
        <SearchOverlay
          query={searchQuery}
          onQueryChange={setSearchQuery}
          onClose={() => { setShowSearch(false); setSearchQuery(''); }}
          onNav={gotoMatch}
          matchCount={matchedIds.length}
          matchIdx={searchMatchIdx}
          findMode={findMode}
        />
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
            searchTerm={findMode ? sq : ''}
            isCurrentMatch={item.id === currentMatchId}
          />
        ))}
      </div>

      {/* ── Cheat sheet (? key) ── */}
      {showCheatSheet && <CheatSheet onClose={() => setShowCheatSheet(false)} />}
    </div>
  );
}
