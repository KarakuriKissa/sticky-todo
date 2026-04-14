/**
 * Per-note store used inside each note window.
 * Handles todo items with undo/redo history.
 */
import { invoke } from '@tauri-apps/api/core';
import { create } from 'zustand';
import type { ItemType, Note, TodoItem } from '../types';

interface Snapshot {
  items: TodoItem[];
}

interface NoteStore {
  note: Note | null;
  items: TodoItem[];
  selectedIds: Set<string>;
  history: Snapshot[];
  historyIdx: number;

  load: (noteId: string) => Promise<void>;
  setNote: (note: Note) => void;

  // Item mutations
  addItem: (afterId?: string, indent?: number) => string;
  updateItem: (id: string, patch: Partial<TodoItem>) => void;
  deleteItem: (id: string) => void;
  toggleCheck: (id: string) => void;
  toggleCollapse: (id: string) => void;
  indent: (id: string) => void;
  dedent: (id: string) => void;
  moveItem: (fromId: string, toId: string, position: 'before' | 'after') => void;
  checkAll: (checked: boolean) => void;

  // Selection
  setSelected: (ids: Set<string>) => void;
  toggleSelected: (id: string) => void;

  // History
  undo: () => void;
  redo: () => void;

  // Flush dirty items to backend
  flush: () => Promise<void>;
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
    status: null,
    assignees: '[]',
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

const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
let storeInstance: NoteStore | null = null;

export const useNoteStore = create<NoteStore>((set, get) => {
  const pushHistory = (items: TodoItem[]) => {
    const { history, historyIdx } = get();
    const newHistory = history.slice(0, historyIdx + 1);
    newHistory.push({ items: items.map((i) => ({ ...i })) });
    // Keep last 50 snapshots
    if (newHistory.length > 50) newHistory.shift();
    set({ history: newHistory, historyIdx: newHistory.length - 1 });
  };

  const mutate = (updater: (items: TodoItem[]) => TodoItem[]) => {
    const next = updater(get().items);
    // Assign sort_order by current array position
    const ordered = next.map((item, i) => ({ ...item, sort_order: i }));
    pushHistory(ordered);
    set({ items: ordered });
    scheduleSave(ordered);
  };

  const scheduleSave = (items: TodoItem[]) => {
    const dirty = items.filter((i) => i.dirty);
    dirty.forEach((item) => {
      const prev = saveTimers.get(item.id);
      if (prev) clearTimeout(prev);
      saveTimers.set(
        item.id,
        setTimeout(() => {
          invoke('save_item', { item }).catch(console.error);
          set((s) => ({
            items: s.items.map((i) => (i.id === item.id ? { ...i, dirty: false } : i)),
          }));
          saveTimers.delete(item.id);
        }, 600),
      );
    });
  };

  const store: NoteStore = {
    note: null,
    items: [],
    selectedIds: new Set(),
    history: [],
    historyIdx: -1,

    load: async (noteId: string) => {
      const items = await invoke<TodoItem[]>('get_note_items', { noteId });
      const sorted = [...items].sort((a, b) => a.sort_order - b.sort_order);
      set({ items: sorted, history: [{ items: sorted }], historyIdx: 0 });
    },

    setNote: (note: Note) => set({ note }),

    addItem: (afterId?: string, indent = 0) => {
      const noteId = get().note?.id ?? '';
      const newItem = makeItem(noteId, { indent });
      let items = get().items;

      if (afterId) {
        const idx = items.findIndex((i) => i.id === afterId);
        items = [...items.slice(0, idx + 1), newItem, ...items.slice(idx + 1)];
      } else {
        items = [...items, newItem];
      }
      mutate(() => items);
      return newItem.id;
    },

    updateItem: (id: string, patch: Partial<TodoItem>) => {
      mutate((items) =>
        items.map((i) =>
          i.id === id ? { ...i, ...patch, updated_at: now(), dirty: true } : i,
        ),
      );
    },

    deleteItem: (id: string) => {
      // Also delete all children
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
        // Fire backend deletes
        idsToRemove.forEach((rmId) => invoke('delete_item', { id: rmId }).catch(console.error));
        return items.filter((i) => !idsToRemove.has(i.id));
      });
    },

    toggleCheck: (id: string) => {
      mutate((items) =>
        items.map((i) =>
          i.id === id ? { ...i, checked: !i.checked, updated_at: now(), dirty: true } : i,
        ),
      );
    },

    toggleCollapse: (id: string) => {
      set((s) => ({
        items: s.items.map((i) =>
          i.id === id ? { ...i, collapsed: !i.collapsed } : i,
        ),
      }));
    },

    indent: (id: string) => {
      mutate((items) =>
        items.map((i) =>
          i.id === id && i.indent < 6
            ? { ...i, indent: i.indent + 1, updated_at: now(), dirty: true }
            : i,
        ),
      );
    },

    dedent: (id: string) => {
      mutate((items) =>
        items.map((i) =>
          i.id === id && i.indent > 0
            ? { ...i, indent: i.indent - 1, updated_at: now(), dirty: true }
            : i,
        ),
      );
    },

    moveItem: (fromId: string, toId: string, position: 'before' | 'after') => {
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

    checkAll: (checked: boolean) => {
      mutate((items) =>
        items.map((i) => ({ ...i, checked, updated_at: now(), dirty: true })),
      );
    },

    setSelected: (ids: Set<string>) => set({ selectedIds: ids }),

    toggleSelected: (id: string) => {
      set((s) => {
        const next = new Set(s.selectedIds);
        next.has(id) ? next.delete(id) : next.add(id);
        return { selectedIds: next };
      });
    },

    undo: () => {
      const { history, historyIdx } = get();
      if (historyIdx <= 0) return;
      const idx = historyIdx - 1;
      set({ items: history[idx].items, historyIdx: idx });
    },

    redo: () => {
      const { history, historyIdx } = get();
      if (historyIdx >= history.length - 1) return;
      const idx = historyIdx + 1;
      set({ items: history[idx].items, historyIdx: idx });
    },

    flush: async () => {
      const dirty = get().items.filter((i) => i.dirty);
      if (dirty.length > 0) {
        await invoke('save_items', { items: dirty });
        set((s) => ({
          items: s.items.map((i) => ({ ...i, dirty: false })),
        }));
      }
    },
  };

  storeInstance = store;
  return store;
});
