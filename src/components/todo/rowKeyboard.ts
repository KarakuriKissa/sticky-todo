// Row-level keyboard handler — extracted from TodoItem.tsx so the row stays
// presentational. Returns the actual onRowKeyDown function ready to be passed
// to the row's onKeyDown prop.
import type React from 'react';
import type { TodoItem as Item } from '../../types';
import { useNoteStore } from '../../store/noteStore';

export interface RowKeyboardDeps {
  item: Item;
  isEditing: boolean;
  isInSel: boolean;
  selectedIds: Set<string>;
  visibleItems: Item[];
  enterEdit: () => void;
  setSelected: (ids: Set<string>) => void;
  addItem: (afterId?: string, indent?: number, position?: 'before' | 'after') => string;
  updateItem: (id: string, patch: Partial<Item>) => void;
  toggleBold: (id: string) => void;
  toggleLock: (id: string) => void;
  indent: (id: string) => void;
  dedent: (id: string) => void;
  duplicateItem: (id: string) => void;
  deleteItem: (id: string) => void;
  indentSelected: () => void;
  dedentSelected: () => void;
  lockSelected: (locked: boolean) => void;
  duplicateSelected: () => void;
  deleteSelected: () => void;
  setMemoText: (s: string) => void;
  setShowMemoEdit: (b: boolean) => void;
}

const focusItem = (id: string) =>
  setTimeout(() => {
    document.querySelector<HTMLDivElement>(`[data-item-id="${id}"].todo-item, [data-item-id="${id}"].todo-heading`)?.focus();
  }, 0);

export function makeRowKeyDown(d: RowKeyboardDeps) {
  return (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (d.isEditing) return; // let input handle it

    // Shift+Arrow = multi-select
    if (e.shiftKey && !e.ctrlKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      const idx = d.visibleItems.findIndex((i) => i.id === d.item.id);
      const target = e.key === 'ArrowUp' ? d.visibleItems[idx - 1] : d.visibleItems[idx + 1];
      if (target) {
        d.setSelected(new Set([...d.selectedIds, target.id]));
        focusItem(target.id);
      }
      return;
    }

    // Ctrl+Shift+Arrow = move selected items up/down
    if (e.shiftKey && e.ctrlKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      if (e.key === 'ArrowUp') useNoteStore.getState().moveSelectedUp();
      else useNoteStore.getState().moveSelectedDown();
      return;
    }

    if (e.key === 'Enter') { e.preventDefault(); d.enterEdit(); return; }

    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const idx = d.visibleItems.findIndex((i) => i.id === d.item.id);
      const next = e.key === 'ArrowUp' ? d.visibleItems[idx - 1] : d.visibleItems[idx + 1];
      if (next) { useNoteStore.getState().setSelected(new Set([next.id])); focusItem(next.id); }
      return;
    }

    if (e.key === 'Tab') {
      e.preventDefault();
      if (e.shiftKey) d.isInSel ? d.dedentSelected() : d.dedent(d.item.id);
      else d.isInSel ? d.indentSelected() : d.indent(d.item.id);
      return;
    }

    if (e.key === 'Delete') {
      e.preventDefault();
      d.isInSel ? d.deleteSelected() : d.deleteItem(d.item.id);
      return;
    }

    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key === 'b') { e.preventDefault(); d.toggleBold(d.item.id); return; }
    if (ctrl && e.key === 'd') { e.preventDefault(); d.isInSel ? d.duplicateSelected() : d.duplicateItem(d.item.id); return; }
    if (ctrl && e.key === 'l') { e.preventDefault(); d.isInSel ? d.lockSelected(!d.item.locked) : d.toggleLock(d.item.id); return; }
    if (ctrl && e.key === 'm') { e.preventDefault(); d.setMemoText(d.item.memo ?? ''); d.setShowMemoEdit(true); return; }
    if (ctrl && (e.key === 'h' || e.key === 'H')) {
      e.preventDefault();
      const next = e.shiftKey ? 'normal' : 'heading';
      const ids = d.isInSel ? [...d.selectedIds] : [d.item.id];
      ids.forEach((id) => d.updateItem(id, { item_type: next }));
      return;
    }
    if (ctrl && e.key === 'e') {
      e.preventDefault();
      const next = !d.item.archived;
      if (d.isInSel) [...d.selectedIds].forEach((id) => d.updateItem(id, { archived: next }));
      else d.updateItem(d.item.id, { archived: next });
      return;
    }
    if (ctrl && e.shiftKey && e.key === 'Enter') {
      e.preventDefault();
      const newId = d.addItem(d.item.id, undefined, 'before');
      setTimeout(() => {
        document.querySelector<HTMLInputElement>(`[data-item-id="${newId}"] [data-text-input]`)?.focus();
      }, 30);
      return;
    }
  };
}
