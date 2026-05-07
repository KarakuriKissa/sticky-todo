// Bulk actions on the current selection — extracted from noteStore so the
// main store stays focused on single-item mutations + state shape.
import { invoke } from '@tauri-apps/api/core';
import type { TodoItem } from '../types';

const now = () => new Date().toISOString();

interface Deps {
  get: () => { selectedIds: Set<string>; items: TodoItem[] };
  set: (s: { selectedIds: Set<string> }) => void;
  mutate: (updater: (items: TodoItem[]) => TodoItem[]) => void;
}

export function buildBulkActions({ get, set, mutate }: Deps) {
  const moveSelectedItems = (toId: string, position: 'before' | 'after') => {
    const { selectedIds } = get();
    if (selectedIds.size <= 1) return;
    mutate((items) => {
      if (selectedIds.has(toId)) return items;
      if (items.filter((i) => selectedIds.has(i.id)).some((i) => i.locked)) return items;
      const selected = items.filter((i) => selectedIds.has(i.id));
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
  };

  const deleteSelected = () => {
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
      idsToRemove.forEach((id) => invoke('delete_item', { id }).catch(() => {}));
      return items.filter((i) => !idsToRemove.has(i.id));
    });
    set({ selectedIds: new Set() });
  };

  const duplicateSelected = () => {
    const { selectedIds } = get();
    if (selectedIds.size === 0) return;
    mutate((items) => {
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
  };

  const lockSelected = (locked: boolean) => {
    const { selectedIds } = get();
    if (selectedIds.size === 0) return;
    mutate((items) =>
      items.map((i) => selectedIds.has(i.id) ? { ...i, locked, updated_at: now(), dirty: true } : i),
    );
  };

  const indentSelected = () => {
    const { selectedIds } = get();
    if (selectedIds.size === 0) return;
    mutate((items) =>
      items.map((i) => (selectedIds.has(i.id) && !i.locked && i.indent < 6)
        ? { ...i, indent: i.indent + 1, updated_at: now(), dirty: true } : i),
    );
  };

  const dedentSelected = () => {
    const { selectedIds } = get();
    if (selectedIds.size === 0) return;
    mutate((items) =>
      items.map((i) => (selectedIds.has(i.id) && !i.locked && i.indent > 0)
        ? { ...i, indent: i.indent - 1, updated_at: now(), dirty: true } : i),
    );
  };

  const checkSelected = (checked: boolean) => {
    const { selectedIds } = get();
    if (selectedIds.size === 0) return;
    mutate((items) =>
      items.map((i) => selectedIds.has(i.id) ? { ...i, checked, updated_at: now(), dirty: true } : i),
    );
  };

  const checkAll = (checked: boolean) => {
    mutate((items) => items.map((i) => ({ ...i, checked, updated_at: now(), dirty: true })));
  };

  const moveSelectedUp = () => {
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
  };

  const moveSelectedDown = () => {
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
  };

  return {
    moveSelectedItems, deleteSelected, duplicateSelected, lockSelected,
    indentSelected, dedentSelected, checkSelected, checkAll,
    moveSelectedUp, moveSelectedDown,
  };
}
