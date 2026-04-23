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

const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();

export const useNoteStore = create<NoteStore>((set, get) => {
  const pushHistory = (items: TodoItem[]) => {
    const { history, historyIdx } = get();
    const newHistory = history.slice(0, historyIdx + 1);
    newHistory.push({ items: items.map((i) => ({ ...i })) });
    if (newHistory.length > 50) newHistory.shift();
    set({ history: newHistory, historyIdx: newHistory.length - 1 });
  };

  const mutate = (updater: (items: TodoItem[]) => TodoItem[]) => {
    const next = updater(get().items);
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
        setTimeout(async () => {
          saveTimers.delete(item.id);
          try {
            // Capture the LATEST version from the store, not the stale closure value
            const latest = get().items.find((i) => i.id === item.id);
            if (latest && latest.dirty) {
              await invoke('save_item', { item: latest });
              set((s) => ({
                items: s.items.map((i) => (i.id === item.id ? { ...i, dirty: false } : i)),
              }));
            }
          } catch (e) {
            console.error('save_item failed:', e);
          }
        }, 400),
      );
    });
  };

  return {
    note: null,
    items: [],
    selectedIds: new Set(),
    searchQuery: '',
    history: [],
    historyIdx: -1,
    dragState: null,
    startDrag: (fromId) => set({ dragState: { fromId, overItemId: null, overPos: 'after' } }),
    updateDragOver: (overId, pos) => set((s) => s.dragState ? { dragState: { ...s.dragState, overItemId: overId, overPos: pos } } : {}),
    endDrag: () => set({ dragState: null }),

    load: async (noteId: string) => {
      const items = await invoke<TodoItem[]>('get_note_items', { noteId });
      const sorted = [...items].sort((a, b) => a.sort_order - b.sort_order);
      set({ items: sorted, history: [{ items: sorted }], historyIdx: 0, searchQuery: '' });
    },

    setNote: (note: Note) => set({ note }),
    setSearchQuery: (q: string) => set({ searchQuery: q }),

    addItem: (afterId?: string, indent = 0, position: 'before' | 'after' = 'after') => {
      // Guard: if the note hasn't loaded yet, note_id would be '' which violates the
      // FK constraint and causes save_item / save_items to fail silently.
      const noteId = get().note?.id;
      if (!noteId) return '';
      const newItem = makeItem(noteId, { indent });
      let items = get().items;

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
      mutate((items) =>
        items.map((i) =>
          i.id === id ? { ...i, ...patch, updated_at: now(), dirty: true } : i,
        ),
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
        idsToRemove.forEach((rmId) => invoke('delete_item', { id: rmId }).catch(console.error));
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
      set((s) => ({
        items: s.items.map((i) =>
          i.id === id ? { ...i, collapsed: !i.collapsed } : i,
        ),
      }));
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

    moveSelectedItems: (toId: string, position: 'before' | 'after') => {
      const { selectedIds } = get();
      if (selectedIds.size <= 1) return;
      mutate((items) => {
        // Cannot insert into a target that is itself selected
        if (selectedIds.has(toId)) return items;
        // Bail if any selected item is locked
        if (items.filter((i) => selectedIds.has(i.id)).some((i) => i.locked)) return items;
        // Selected items in their current order
        const selected = items.filter((i) => selectedIds.has(i.id));
        // Remaining (non-selected) items
        const rest = items.filter((i) => !selectedIds.has(i.id));
        const toIdx = rest.findIndex((i) => i.id === toId);
        if (toIdx === -1) return items;
        const insertAt = position === 'before' ? toIdx : toIdx + 1;
        return [
          ...rest.slice(0, insertAt),
          ...selected.map((i) => ({ ...i, dirty: true })),
          ...rest.slice(insertAt),
        ];
      });
    },

    deleteSelected: () => {
      const { selectedIds } = get();
      if (selectedIds.size === 0) return;
      mutate((items) => {
        const idsToRemove = new Set<string>(selectedIds);
        const collectChildren = (parentId: string) => {
          items.forEach((i) => {
            if (i.parent_id === parentId && !idsToRemove.has(i.id)) {
              idsToRemove.add(i.id);
              collectChildren(i.id);
            }
          });
        };
        selectedIds.forEach((id) => collectChildren(id));
        idsToRemove.forEach((id) => invoke('delete_item', { id }).catch(console.error));
        return items.filter((i) => !idsToRemove.has(i.id));
      });
      set({ selectedIds: new Set() });
    },

    duplicateSelected: () => {
      const { selectedIds } = get();
      if (selectedIds.size === 0) return;
      mutate((items) => {
        // Process in descending index order so earlier inserts don't shift later indices
        const indices = [...selectedIds]
          .map((id) => items.findIndex((i) => i.id === id))
          .filter((idx) => idx !== -1)
          .sort((a, b) => b - a);
        const result = [...items];
        for (const idx of indices) {
          const orig = result[idx];
          const copy = { ...orig, id: crypto.randomUUID(), locked: false, dirty: true, updated_at: now() };
          result.splice(idx + 1, 0, copy);
        }
        return result;
      });
    },

    lockSelected: (locked: boolean) => {
      const { selectedIds } = get();
      if (selectedIds.size === 0) return;
      mutate((items) =>
        items.map((i) =>
          selectedIds.has(i.id) ? { ...i, locked, updated_at: now(), dirty: true } : i,
        ),
      );
    },

    indentSelected: () => {
      const { selectedIds } = get();
      if (selectedIds.size === 0) return;
      mutate((items) =>
        items.map((i) =>
          selectedIds.has(i.id) && !i.locked && i.indent < 6
            ? { ...i, indent: i.indent + 1, updated_at: now(), dirty: true }
            : i,
        ),
      );
    },

    dedentSelected: () => {
      const { selectedIds } = get();
      if (selectedIds.size === 0) return;
      mutate((items) =>
        items.map((i) =>
          selectedIds.has(i.id) && !i.locked && i.indent > 0
            ? { ...i, indent: i.indent - 1, updated_at: now(), dirty: true }
            : i,
        ),
      );
    },

    checkSelected: (checked: boolean) => {
      const { selectedIds } = get();
      if (selectedIds.size === 0) return;
      mutate((items) =>
        items.map((i) =>
          selectedIds.has(i.id) ? { ...i, checked, updated_at: now(), dirty: true } : i,
        ),
      );
    },

    checkAll: (checked: boolean) => {
      mutate((items) =>
        items.map((i) => ({ ...i, checked, updated_at: now(), dirty: true })),
      );
    },

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

    moveSelectedUp: () => {
      const { selectedIds } = get();
      if (selectedIds.size === 0) return;
      mutate((items) => {
        const sorted = [...selectedIds].sort((a, b) => items.findIndex(i => i.id === a) - items.findIndex(i => i.id === b));
        const firstIdx = items.findIndex(i => i.id === sorted[0]);
        if (firstIdx === 0) return items;
        const newItems = [...items];
        for (const id of sorted) {
          const idx = newItems.findIndex(i => i.id === id);
          if (idx > 0 && !selectedIds.has(newItems[idx - 1].id)) {
            [newItems[idx - 1], newItems[idx]] = [newItems[idx], newItems[idx - 1]];
          }
        }
        return newItems.map(i => ({ ...i, dirty: true }));
      });
    },

    moveSelectedDown: () => {
      const { selectedIds } = get();
      if (selectedIds.size === 0) return;
      mutate((items) => {
        const sorted = [...selectedIds].sort((a, b) => items.findIndex(i => i.id === b) - items.findIndex(i => i.id === a));
        const lastIdx = items.findIndex(i => i.id === sorted[0]);
        if (lastIdx === items.length - 1) return items;
        const newItems = [...items];
        for (const id of sorted) {
          const idx = newItems.findIndex(i => i.id === id);
          if (idx < newItems.length - 1 && !selectedIds.has(newItems[idx + 1].id)) {
            [newItems[idx], newItems[idx + 1]] = [newItems[idx + 1], newItems[idx]];
          }
        }
        return newItems.map(i => ({ ...i, dirty: true }));
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
      // Cancel all pending debounce timers — they may have stale snapshots and would
      // race with the save we're about to do.
      saveTimers.forEach((timer) => clearTimeout(timer));
      saveTimers.clear();

      const noteId = get().note?.id;
      if (!noteId) return; // No note loaded, nothing to save.

      // Save ALL items for this note (not just dirty ones) so that anything not yet
      // persisted by the debounce is captured.  On close this is acceptable overhead.
      const items = get().items;
      if (items.length > 0) {
        await invoke('save_items', { items });
        set((s) => ({
          items: s.items.map((i) => ({ ...i, dirty: false })),
        }));
      }
    },
  };
});
