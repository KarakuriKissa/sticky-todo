// Builds the right-click context-menu for a single todo item.
// Pure data — kept out of TodoItem.tsx so the row component stays focused on
// rendering and keyboard handlers.
import type { TodoItem as Item } from '../../types';
import type { ContextMenuItem } from '../ContextMenu';

export interface CtxBuilderDeps {
  item: Item;
  isInSel: boolean;
  selSuffix: string;
  selectedIds: Set<string>;
  // Store action handles
  addItem: (afterId?: string, indent?: number, position?: 'before' | 'after') => string;
  updateItem: (id: string, patch: Partial<Item>) => void;
  toggleBold: (id: string) => void;
  toggleStrike: (id: string) => void;
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
  // Comment popup trigger
  openMemoEditor: () => void;
}

export function buildContextMenu(d: CtxBuilderDeps): ContextMenuItem[] {
  const { item, isInSel, selSuffix, selectedIds } = d;

  const focusNew = (newId: string) => setTimeout(() => {
    document.querySelector<HTMLInputElement>(`[data-item-id="${newId}"] [data-text-input]`)?.focus();
  }, 30);

  return [
    {
      label: '上に項目を追加', icon: '↑', shortcut: 'Ctrl+Shift+Enter',
      action: () => focusNew(d.addItem(item.id, undefined, 'before')),
    },
    {
      label: '下に項目を追加', icon: '↓', shortcut: 'Shift+Enter',
      action: () => focusNew(d.addItem(item.id)),
    },
    { label: '', separator: true, action: () => {} },
    {
      label: `${item.bold ? '太字を解除' : '太字'}${selSuffix}`,
      icon: 'B', shortcut: 'Ctrl+B',
      action: () => d.toggleBold(item.id),
    },
    {
      label: `${item.strikethrough ? '打ち消し線を解除' : '打ち消し線'}${selSuffix}`,
      icon: 'S', shortcut: 'Ctrl+Shift+S',
      action: () => d.toggleStrike(item.id),
    },
    {
      label: 'コメント', icon: '💬', shortcut: 'Ctrl+M',
      action: d.openMemoEditor,
    },
    { label: '', separator: true, action: () => {} },
    { label: '見出しに変更', icon: 'H', shortcut: 'Ctrl+H', action: () => d.updateItem(item.id, { item_type: 'heading' }) },
    { label: '通常に変更', icon: '•', shortcut: 'Ctrl+Shift+H', action: () => d.updateItem(item.id, { item_type: 'normal' }) },
    { label: '', separator: true, action: () => {} },
    {
      label: `インデント${selSuffix}`, icon: '→', shortcut: 'Tab',
      action: () => isInSel ? d.indentSelected() : d.indent(item.id),
      disabled: !isInSel && (item.indent >= 6 || item.locked),
    },
    {
      label: `アウトデント${selSuffix}`, icon: '←', shortcut: 'Shift+Tab',
      action: () => isInSel ? d.dedentSelected() : d.dedent(item.id),
      disabled: !isInSel && (item.indent <= 0 || item.locked),
    },
    { label: '', separator: true, action: () => {} },
    {
      label: `${item.locked ? 'ロック解除' : 'ロック'}${selSuffix}`,
      icon: item.locked ? '🔓' : '🔒', shortcut: 'Ctrl+L',
      action: () => isInSel ? d.lockSelected(!item.locked) : d.toggleLock(item.id),
    },
    {
      label: `複製${selSuffix}`, icon: '📋', shortcut: 'Ctrl+D',
      action: () => isInSel ? d.duplicateSelected() : d.duplicateItem(item.id),
    },
    {
      label: item.archived ? `アーカイブから戻す${selSuffix}` : `アーカイブ${selSuffix}`,
      icon: item.archived ? '↩' : '🗄', shortcut: 'Ctrl+E',
      action: () => {
        const next = !item.archived;
        if (isInSel) [...selectedIds].forEach((id) => d.updateItem(id, { archived: next }));
        else d.updateItem(item.id, { archived: next });
      },
    },
    {
      label: `削除${selSuffix}`, icon: '🗑', shortcut: 'Del',
      action: () => isInSel ? d.deleteSelected() : d.deleteItem(item.id),
      danger: true,
    },
  ];
}
