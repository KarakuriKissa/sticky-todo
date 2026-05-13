import { invoke } from '@tauri-apps/api/core';
import { create } from 'zustand';
import type { ItemType, Note, TodoItem } from '../types';
import { log } from '../utils/log';
import { createSaveQueue, readLocalStorage } from './saveQueue';
import { buildBulkActions } from './bulkActions';

interface Snapshot {
  items: TodoItem[];
}

interface NoteStore {
  note: Note | null;
  items: TodoItem[];
  selectedIds: Set<string>;
  searchQuery: string;
  history: Snapshot[];
  historyIdx: number;

  // Drag state for pointer-based DnD
  dragState: { fromId: string; overItemId: string | null; overPos: 'before' | 'after' } | null;
  startDrag: (fromId: string) => void;
  updateDragOver: (overId: string | null, pos: 'before' | 'after') => void;
  endDrag: () => void;

  load: (noteId: string) => Promise<void>;
  setNote: (note: Note) => void;
  setSearchQuery: (q: string) => void;

  // Item mutations
  addItem: (afterId?: string, indent?: number, position?: 'before' | 'after') => string;
  updateItem: (id: string, patch: Partial<TodoItem>) => void;
  deleteItem: (id: string) => void;
  toggleCheck: (id: string) => void;
  toggleBold: (id: string) => void;
  toggleLock: (id: string) => void;
  toggleCollapse: (id: string) => void;
  indent: (id: string) => void;
  dedent: (id: string) => void;
  moveItem: (fromId: string, toId: string, position: 'before' | 'after') => void;
  checkSelected: (checked: boolean) => void;
  checkAll: (checked: boolean) => void;
  duplicateItem: (id: string) => void;

  // Selection
  setSelected: (ids: Set<string>) => void;
  toggleSelected: (id: string) => void;
  selectAll: () => void;
  clearSelection: () => void;

  // Move selected items as a group via drag
  moveSelectedItems: (toId: string, position: 'before' | 'after') => void;

  // Bulk operations on selected items
  deleteSelected: () => void;
  duplicateSelected: () => void;
  lockSelected: (locked: boolean) => void;
  indentSelected: () => void;
  dedentSelected: () => void;

  // Move selected items up/down
  moveSelectedUp: () => void;
  moveSelectedDown: () => void;

  // History
  undo: () => void;
  redo: () => void;

  // Flush dirty items to backend
  flush: () => Promise<void>;

  // Live save indicator. 'idle' | 'saving' | 'saved' | 'error'
  saveStatus: 'idle' | 'saving' | 'saved' | 'error';
  lastSavedAt: number | null;

  // ID of item to enter edit mode on mount (toolbar add, quick-add, etc.).
  // TodoItem reads this and self-clears when it enters edit mode.
  pendingFocusId: string | null;
  clearPendingFocus: () => void;
}

function now() {
  return new Date().toISOString();
}

function makeItem(noteId: string, partial: Partial<TodoItem> = {}): TodoItem {
  return {
    id: crypto.randomUUID(),
    note_id: noteId,
    parent_id: null,
    text: '',
    checked: false,
    indent: 0,
    collapsed: false,
    locked: false,
    status: null,
    assignees: '[]',
    assignee_person_id: null,
    memo: null,
    bold: false,
    priority: null,
    start_date: null,
    end_date: null,
    limit_date: null,
    item_type: 'normal' as ItemType,
    sort_order: 0,
    archived: false,
    updated_at: now(),
    dirty: true,
    ...partial,
  };
}

// Save layer is owned by ./saveQueue — it handles localStorage backup, the
// sequential SQLite chain, retry, and flush(). This module just wires it up.
export const useNoteStore = create<NoteStore>((set, get) => {
  const pushHistory = (items: TodoItem[]) => {
    const { history, historyIdx } = get();
    const newHistory = history.slice(0, historyIdx + 1);
    newHistory.push({ items: items.map((i) => ({ ...i })) });
    if (newHistory.length > 50) newHistory.shift();
    set({ history: newHistory, historyIdx: newHistory.length - 1 });
  };

  const queue = createSaveQueue({
    getItems: () => get().items,
    setStatus: (status, at) => set(at !== undefined ? { saveStatus: status, lastSavedAt: at } : { saveStatus: status }),
  });
  const { saveAll, saveAllDebounced } = queue;

  const mutate = (
    updater: (items: TodoItem[]) => TodoItem[],
    mode: 'immediate' | 'debounced' = 'immediate',
  ) => {
    const next = updater(get().items);
    const ordered = next.map((item, i) => ({ ...item, sort_order: i }));
    pushHistory(ordered);
    set({ items: ordered });
    if (mode === 'debounced') saveAllDebounced();
    else saveAll();
  };

  // Bulk actions on the current selection — extracted to ./bulkActions.
  const bulk = buildBulkActions({
    get: () => ({ selectedIds: get().selectedIds, items: get().items }),
    set: (s) => set(s),
    mutate: (u) => mutate(u),
  });

  return {
    note: null,
    items: [],
    selectedIds: new Set(),
    searchQuery: '',
    history: [],
    historyIdx: -1,
    dragState: null,
    saveStatus: 'idle',
    lastSavedAt: null,
    pendingFocusId: null,
    clearPendingFocus: () => set({ pendingFocusId: null }),
    startDrag: (fromId) => set({ dragState: { fromId, overItemId: null, overPos: 'after' } }),
    updateDragOver: (overId, pos) => set((s) => s.dragState ? { dragState: { ...s.dragState, overItemId: overId, overPos: pos } } : {}),
    endDrag: () => set({ dragState: null }),

    load: async (noteId: string) => {
      let items: TodoItem[] = [];
      try {
        items = await invoke<TodoItem[]>('get_note_items', { noteId });
        log.debug('[load] DB returned', items.length, 'items for note', noteId);
      } catch (e) {
        log.error('[load] DB read failed:', e);
      }

      // Fallback to localStorage if DB came back empty.
      if (items.length === 0) {
        const cached = readLocalStorage(noteId);
        if (cached && cached.length > 0) {
          log.debug('[load] DB empty — restoring', cached.length, 'items from localStorage');
          items = cached;
          try { await invoke('save_items', { items }); } catch (e) {
            log.error('[load] re-save to DB failed:', e);
          }
        }
      }

      const sorted = [...items].sort((a, b) => a.sort_order - b.sort_order);
      // Only OVERWRITE if the user hasn't already started editing in this window
      // (prevents the race where load() resolves AFTER the user has typed).
      const cur = get().items;
      if (cur.length > 0) {
        // Merge: keep user's edits, add DB items the user doesn't yet have.
        const userIds = new Set(cur.map((i) => i.id));
        const merged = [...cur, ...sorted.filter((i) => !userIds.has(i.id))];
        log.debug('[load] user already has', cur.length, 'items, merging →', merged.length);
        set({ items: merged, history: [{ items: merged }], historyIdx: 0 });
      } else {
        set({ items: sorted, history: [{ items: sorted }], historyIdx: 0, searchQuery: '' });
      }
    },

    setNote: (note: Note) => set({ note }),
    setSearchQuery: (q: string) => set({ searchQuery: q }),

    addItem: (afterId?: string, indent?: number, position: 'before' | 'after' = 'after') => {
      // Guard: if the note hasn't loaded yet, note_id would be '' which violates the
      // FK constraint and causes save_item / save_items to fail silently.
      const noteId = get().note?.id;
      if (!noteId) return '';
      const allItems = get().items;

      // Inheritance:
      // - if `indent` is explicitly given, use it (caller is overriding)
      // - else inherit indent from the reference task: afterId if given, otherwise the
      //   last visible task in the list. New tasks should look like a sibling of the
      //   task they were added near.
      let inheritedIndent = 0;
      if (typeof indent === 'number') {
        inheritedIndent = indent;
      } else if (afterId) {
        const ref = allItems.find((i) => i.id === afterId);
        if (ref) inheritedIndent = ref.indent;
      } else if (allItems.length > 0) {
        inheritedIndent = allItems[allItems.length - 1].indent;
      }

      // Default deadline = 10 days from now (date only, ISO YYYY-MM-DD).
      const tenDays = new Date();
      tenDays.setDate(tenDays.getDate() + 10);
      const limit_date = tenDays.toISOString().slice(0, 10);

      const newItem = makeItem(noteId, { indent: inheritedIndent, limit_date });
      let items = allItems;

      if (afterId) {
        const idx = items.findIndex((i) => i.id === afterId);
        if (position === 'before') {
          items = [...items.slice(0, idx), newItem, ...items.slice(idx)];
        } else {
          items = [...items.slice(0, idx + 1), newItem, ...items.slice(idx + 1)];
        }
      } else {
        items = [...items, newItem];
      }
      mutate(() => items);
      return newItem.id;
    },

    updateItem: (id: string, patch: Partial<TodoItem>) => {
      // Text and memo edits are debounced (avoid saving every keystroke).
      // Every other field change (status, assignee, date, priority, type…) saves immediately.
      const mode = ('text' in patch || 'memo' in patch) ? 'debounced' : 'immediate';
      mutate(
        (items) => items.map((i) =>
          i.id === id ? { ...i, ...patch, updated_at: now(), dirty: true } : i,
        ),
        mode,
      );
    },

    deleteItem: (id: string) => {
      mutate((items) => {
        const idsToRemove = new Set<string>();
        const collectChildren = (parentId: string) => {
          items.forEach((i) => {
            if (i.parent_id === parentId) {
              idsToRemove.add(i.id);
              collectChildren(i.id);
            }
          });
        };
        idsToRemove.add(id);
        collectChildren(id);
        idsToRemove.forEach((rmId) => invoke('delete_item', { id: rmId }).catch((e) => log.error('[deleteItem]', e)));
        return items.filter((i) => !idsToRemove.has(i.id));
      });
    },

    toggleCheck: (id: string) => {
      const { selectedIds } = get();
      if (selectedIds.has(id) && selectedIds.size > 1) {
        const item = get().items.find((i) => i.id === id);
        const newChecked = item ? !item.checked : true;
        mutate((items) =>
          items.map((i) =>
            selectedIds.has(i.id) ? { ...i, checked: newChecked, updated_at: now(), dirty: true } : i,
          ),
        );
      } else {
        mutate((items) =>
          items.map((i) =>
            i.id === id ? { ...i, checked: !i.checked, updated_at: now(), dirty: true } : i,
          ),
        );
      }
    },

    toggleBold: (id: string) => {
      const { selectedIds } = get();
      const ids = selectedIds.has(id) ? selectedIds : new Set([id]);
      mutate((items) =>
        items.map((i) =>
          ids.has(i.id) ? { ...i, bold: !i.bold, updated_at: now(), dirty: true } : i,
        ),
      );
    },

    toggleLock: (id: string) => {
      mutate((items) =>
        items.map((i) =>
          i.id === id ? { ...i, locked: !i.locked, updated_at: now(), dirty: true } : i,
        ),
      );
    },

    toggleCollapse: (id: string) => {
      mutate((items) =>
        items.map((i) =>
          i.id === id ? { ...i, collapsed: !i.collapsed, updated_at: now(), dirty: true } : i,
        ),
      );
    },

    indent: (id: string) => {
      const item = get().items.find((i) => i.id === id);
      if (item?.locked) return;
      mutate((items) =>
        items.map((i) =>
          i.id === id && i.indent < 6
            ? { ...i, indent: i.indent + 1, updated_at: now(), dirty: true }
            : i,
        ),
      );
    },

    dedent: (id: string) => {
      const item = get().items.find((i) => i.id === id);
      if (item?.locked) return;
      mutate((items) =>
        items.map((i) =>
          i.id === id && i.indent > 0
            ? { ...i, indent: i.indent - 1, updated_at: now(), dirty: true }
            : i,
        ),
      );
    },

    moveItem: (fromId: string, toId: string, position: 'before' | 'after') => {
      const fromItem = get().items.find((i) => i.id === fromId);
      if (fromItem?.locked) return;
      mutate((items) => {
        const from = items.find((i) => i.id === fromId);
        if (!from) return items;
        const rest = items.filter((i) => i.id !== fromId);
        const toIdx = rest.findIndex((i) => i.id === toId);
        if (toIdx === -1) return items;
        const insertAt = position === 'before' ? toIdx : toIdx + 1;
        return [
          ...rest.slice(0, insertAt),
          { ...from, dirty: true },
          ...rest.slice(insertAt),
        ];
      });
    },

    moveSelectedItems: bulk.moveSelectedItems,
    deleteSelected:    bulk.deleteSelected,
    duplicateSelected: bulk.duplicateSelected,
    lockSelected:      bulk.lockSelected,
    indentSelected:    bulk.indentSelected,
    dedentSelected:    bulk.dedentSelected,
    checkSelected:     bulk.checkSelected,
    checkAll:          bulk.checkAll,

    duplicateItem: (id: string) => {
      mutate((items) => {
        const idx = items.findIndex((i) => i.id === id);
        if (idx === -1) return items;
        const orig = items[idx];
        const copy = {
          ...orig,
          id: crypto.randomUUID(),
          locked: false,
          dirty: true,
          updated_at: now(),
        };
        return [...items.slice(0, idx + 1), copy, ...items.slice(idx + 1)];
      });
    },

    setSelected: (ids: Set<string>) => set({ selectedIds: ids }),

    toggleSelected: (id: string) => {
      set((s) => {
        const next = new Set(s.selectedIds);
        next.has(id) ? next.delete(id) : next.add(id);
        return { selectedIds: next };
      });
    },

    selectAll: () => {
      set((s) => ({ selectedIds: new Set(s.items.map((i) => i.id)) }));
    },

    clearSelection: () => set({ selectedIds: new Set() }),

    moveSelectedUp:   bulk.moveSelectedUp,
    moveSelectedDown: bulk.moveSelectedDown,

    undo: () => {
      const { history, historyIdx } = get();
      if (historyIdx <= 0) return;
      const idx = historyIdx - 1;
      // Mark all items dirty so the restored state is persisted immediately.
      const items = history[idx].items.map((i) => ({ ...i, dirty: true }));
      set({ items, historyIdx: idx });
      saveAll();
    },

    redo: () => {
      const { history, historyIdx } = get();
      if (historyIdx >= history.length - 1) return;
      const idx = historyIdx + 1;
      const items = history[idx].items.map((i) => ({ ...i, dirty: true }));
      set({ items, historyIdx: idx });
      saveAll();
    },

    flush: async () => {
      await queue.flush();
      set({ saveStatus: 'saved', lastSavedAt: Date.now() });
    },
  };
});
