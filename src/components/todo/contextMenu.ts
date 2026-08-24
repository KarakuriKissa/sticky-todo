// Builds the right-click context-menu for a single todo item.
// Pure data — kept out of TodoItem.tsx so the row component stays focused on
// rendering and keyboard handlers.
import type { TodoItem as Item } from '../../types';
import type { ContextMenuItem } from '../ContextMenu';
import { t } from '../../i18n';

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
  copyToClipboard: () => number;
  pasteFromClipboard: () => number;
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
      label: t('ctx.addAbove'), icon: '↑', shortcut: 'Ctrl+Shift+Enter',
      action: () => focusNew(d.addItem(item.id, undefined, 'before')),
    },
    {
      label: t('ctx.addBelow'), icon: '↓', shortcut: 'Shift+Enter',
      action: () => focusNew(d.addItem(item.id)),
    },
    { label: '', separator: true, action: () => {} },
    {
      label: `${item.bold ? t('ctx.boldOff') : t('ctx.bold')}${selSuffix}`,
      icon: 'B', shortcut: 'Ctrl+B',
      action: () => d.toggleBold(item.id),
    },
    {
      label: `${item.strikethrough ? t('ctx.strikeOff') : t('ctx.strike')}${selSuffix}`,
      icon: 'S', shortcut: 'Ctrl+Alt+S',
      action: () => d.toggleStrike(item.id),
    },
    {
      label: t('ctx.comment'), icon: '💬', shortcut: 'Ctrl+M',
      action: d.openMemoEditor,
    },
    { label: '', separator: true, action: () => {} },
    {
      label: `${t('ctx.toHeading')}${selSuffix}`, icon: 'H', shortcut: 'Ctrl+H',
      action: () => {
        const ids = isInSel ? [...selectedIds] : [item.id];
        ids.forEach((id) => d.updateItem(id, { item_type: 'heading' }));
      },
    },
    {
      label: `${t('ctx.toNormal')}${selSuffix}`, icon: '•', shortcut: 'Ctrl+Shift+H',
      action: () => {
        const ids = isInSel ? [...selectedIds] : [item.id];
        ids.forEach((id) => d.updateItem(id, { item_type: 'normal' }));
      },
    },
    {
      // ADD a separator below (not convert) — converting a task to a separator
      // destroys its text and is an easy mis-click, so this inserts instead.
      label: t('ctx.addSeparatorBelow'), icon: '—',
      action: () => {
        const newId = d.addItem(item.id, item.indent, 'after');
        if (newId) d.updateItem(newId, { item_type: 'separator' });
      },
    },
    { label: '', separator: true, action: () => {} },
    {
      label: `${t('ctx.indent')}${selSuffix}`, icon: '→', shortcut: 'Tab',
      action: () => isInSel ? d.indentSelected() : d.indent(item.id),
      disabled: !isInSel && (item.indent >= 6 || item.locked),
    },
    {
      label: `${t('ctx.outdent')}${selSuffix}`, icon: '←', shortcut: 'Shift+Tab',
      action: () => isInSel ? d.dedentSelected() : d.dedent(item.id),
      disabled: !isInSel && (item.indent <= 0 || item.locked),
    },
    { label: '', separator: true, action: () => {} },
    {
      label: `${item.locked ? t('ctx.unlock') : t('ctx.lock')}${selSuffix}`,
      icon: item.locked ? '🔓' : '🔒', shortcut: 'Ctrl+L',
      action: () => isInSel ? d.lockSelected(!item.locked) : d.toggleLock(item.id),
    },
    {
      label: `${t('ctx.copy')}${selSuffix}`, icon: '⧉', shortcut: 'Ctrl+C',
      action: () => d.copyToClipboard(),
    },
    {
      label: t('ctx.pasteBelow'), icon: '📋', shortcut: 'Ctrl+V',
      action: () => d.pasteFromClipboard(),
    },
    {
      label: `${t('ctx.duplicate')}${selSuffix}`, icon: '🔁', shortcut: 'Ctrl+D',
      action: () => isInSel ? d.duplicateSelected() : d.duplicateItem(item.id),
    },
    {
      label: item.archived ? `${t('ctx.unarchive')}${selSuffix}` : `${t('ctx.archive')}${selSuffix}`,
      icon: item.archived ? '↩' : '🗄', shortcut: 'Ctrl+E',
      action: () => {
        const next = !item.archived;
        if (isInSel) [...selectedIds].forEach((id) => d.updateItem(id, { archived: next }));
        else d.updateItem(item.id, { archived: next });
      },
    },
    {
      label: `${t('ctx.delete')}${selSuffix}`, icon: '🗑', shortcut: 'Del',
      action: () => isInSel ? d.deleteSelected() : d.deleteItem(item.id),
      danger: true,
    },
  ];
}
