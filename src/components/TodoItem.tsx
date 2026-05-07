import { useRef, KeyboardEvent, useState, MouseEvent } from 'react';
import type { TodoItem as Item } from '../types';
import { useNoteStore } from '../store/noteStore';
import { useAppStore } from '../store/appStore';
import { ContextMenu, ContextMenuItem } from './ContextMenu';
import { renderTextWithLinks } from './todo/textRender';
import { StatusBadge, PriorityBadge, AssigneeBadge, DateBadge } from './todo/badges';
import { InlineStatusPicker, InlineAssigneePicker, InlineDatePicker } from './todo/inlinePickers';

interface Props {
  item: Item;
  visibleItems: Item[];
  allItems: Item[];
  warnDays: number;
  priorityMode?: 'hml' | 'abc';
  activeGroupId?: string;
  searchTerm?: string;       // when set, render <mark> around matches
  isCurrentMatch?: boolean;  // highlight the row as the active match
}

export function TodoItemRow({ item, visibleItems, allItems, warnDays, priorityMode, activeGroupId, searchTerm, isCurrentMatch }: Props) {
  const {
    updateItem, deleteItem, toggleCheck, toggleBold, toggleLock, toggleCollapse,
    indent, dedent, addItem, selectedIds, toggleSelected, moveItem,
    duplicateItem, setSelected, dragState, startDrag, updateDragOver, endDrag,
    moveSelectedItems, deleteSelected, duplicateSelected, lockSelected,
    indentSelected, dedentSelected,
  } = useNoteStore();
  const { statuses, settings, assigneePersons, assigneeGroups } = useAppStore();
  const inputRef = useRef<HTMLInputElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [showMemoEdit, setShowMemoEdit] = useState(false);
  const [memoText, setMemoText] = useState(item.memo ?? '');
  const [commentAbove, setCommentAbove] = useState(false);
  const [ctx, setCtx] = useState<{ x: number; y: number } | null>(null);
  const [hoverMemo, setHoverMemo] = useState<{ above: boolean } | null>(null);

  const isDragging = dragState?.fromId === item.id;
  const isDragOver = dragState?.overItemId === item.id;
  const dragOverPos = isDragOver ? dragState?.overPos : null;

  const hasChildren = allItems.some((i) => i.parent_id === item.id);
  const isSelected = selectedIds.has(item.id);

  // Deadline warning
  const isWarn = !!item.limit_date && (() => {
    const deadline = new Date(item.limit_date!);
    const now = new Date();
    const diffDays = (deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    return diffDays >= 0 && diffDays <= warnDays;
  })();
  const isOverdue = !!item.limit_date && new Date(item.limit_date) < new Date();

  // Context menu — bulk-aware when right-clicked item is part of a multi-selection
  const isInSel = selectedIds.has(item.id) && selectedIds.size > 1;
  const selSuffix = isInSel ? ` (${selectedIds.size}件)` : '';

  const ctxItems: ContextMenuItem[] = [
    {
      label: '上に項目を追加',
      icon: '↑',
      shortcut: 'Ctrl+Shift+Enter',
      action: () => {
        const newId = addItem(item.id, undefined, 'before');
        setTimeout(() => {
          document.querySelector<HTMLInputElement>(`[data-item-id="${newId}"] [data-text-input]`)?.focus();
        }, 30);
      },
    },
    {
      label: '下に項目を追加',
      icon: '↓',
      shortcut: 'Shift+Enter',
      action: () => {
        const newId = addItem(item.id);
        setTimeout(() => {
          document.querySelector<HTMLInputElement>(`[data-item-id="${newId}"] [data-text-input]`)?.focus();
        }, 30);
      },
    },
    { label: '', separator: true, action: () => {} },
    {
      label: `${item.bold ? '太字を解除' : '太字'}${selSuffix}`,
      icon: 'B',
      shortcut: 'Ctrl+B',
      action: () => toggleBold(item.id), // toggleBold already handles selectedIds internally
    },
    {
      label: 'コメント',
      icon: '💬',
      shortcut: 'Ctrl+M',
      action: () => { setMemoText(item.memo ?? ''); setShowMemoEdit(true); },
    },
    { label: '', separator: true, action: () => {} },
    { label: '見出しに変更', icon: 'H', shortcut: 'Ctrl+H', action: () => updateItem(item.id, { item_type: 'heading' }) },
    { label: '通常に変更', icon: '•', shortcut: 'Ctrl+Shift+H', action: () => updateItem(item.id, { item_type: 'normal' }) },
    { label: '', separator: true, action: () => {} },
    {
      label: `インデント${selSuffix}`,
      icon: '→',
      shortcut: 'Tab',
      action: () => isInSel ? indentSelected() : indent(item.id),
      disabled: !isInSel && (item.indent >= 6 || item.locked),
    },
    {
      label: `アウトデント${selSuffix}`,
      icon: '←',
      shortcut: 'Shift+Tab',
      action: () => isInSel ? dedentSelected() : dedent(item.id),
      disabled: !isInSel && (item.indent <= 0 || item.locked),
    },
    { label: '', separator: true, action: () => {} },
    {
      label: `${item.locked ? 'ロック解除' : 'ロック'}${selSuffix}`,
      icon: item.locked ? '🔓' : '🔒',
      shortcut: 'Ctrl+L',
      action: () => isInSel ? lockSelected(!item.locked) : toggleLock(item.id),
    },
    {
      label: `複製${selSuffix}`,
      icon: '📋',
      shortcut: 'Ctrl+D',
      action: () => isInSel ? duplicateSelected() : duplicateItem(item.id),
    },
    {
      label: item.archived ? `アーカイブから戻す${selSuffix}` : `アーカイブ${selSuffix}`,
      icon: item.archived ? '↩' : '🗄',
      shortcut: 'Ctrl+E',
      action: () => {
        const next = !item.archived;
        if (isInSel) {
          [...selectedIds].forEach((id) => updateItem(id, { archived: next }));
        } else {
          updateItem(item.id, { archived: next });
        }
      },
    },
    {
      label: `削除${selSuffix}`,
      icon: '🗑',
      shortcut: 'Del',
      action: () => isInSel ? deleteSelected() : deleteItem(item.id),
      danger: true,
    },
  ];

  // ── Keyboard ────────────────────────────────────────────────────────────────
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (item.locked && e.key !== 'Escape' && e.key !== 'Tab') {
      if (!e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        return;
      }
    }

    if (e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      exitEdit();
      const idx = visibleItems.findIndex((i) => i.id === item.id);
      const target = e.key === 'ArrowUp' ? visibleItems[idx - 1] : visibleItems[idx + 1];
      if (target) {
        setSelected(new Set([...selectedIds, target.id]));
      }
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const idx = visibleItems.findIndex((i) => i.id === item.id);
      const prev = visibleItems[idx - 1];
      if (prev) {
        setTimeout(() => {
          document.querySelector<HTMLInputElement>(`[data-item-id="${prev.id}"] [data-text-input]`)?.focus();
        }, 0);
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const idx = visibleItems.findIndex((i) => i.id === item.id);
      const next = visibleItems[idx + 1];
      if (next) {
        setTimeout(() => {
          document.querySelector<HTMLInputElement>(`[data-item-id="${next.id}"] [data-text-input]`)?.focus();
        }, 0);
      }
      return;
    }

    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      const newId = addItem(item.id, item.indent);
      setTimeout(() => {
        document.querySelector<HTMLInputElement>(`[data-item-id="${newId}"] [data-text-input]`)?.focus();
      }, 30);
      return;
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      inputRef.current?.blur();
      return;
    }

    if (e.key === 'Tab') {
      e.preventDefault();
      e.shiftKey ? dedent(item.id) : indent(item.id);
    }

    if (e.key === 'Backspace' && item.text === '' && !item.locked) {
      e.preventDefault();
      const idx = visibleItems.findIndex((i) => i.id === item.id);
      const prev = visibleItems[idx - 1];
      deleteItem(item.id);
      setTimeout(() => {
        if (prev) {
          document.querySelector<HTMLInputElement>(`[data-item-id="${prev.id}"] [data-text-input]`)?.focus();
        }
      }, 30);
    }

    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault(); useNoteStore.getState().undo();
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) {
      e.preventDefault(); useNoteStore.getState().redo();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
      e.preventDefault(); toggleBold(item.id);
    }
  };

  // ── Row keyboard handler (when not editing) ──────────────────────────────────
  const onRowKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (isEditing) return; // let input handle it

    // Shift+Arrow = multi-select
    if (e.shiftKey && !e.ctrlKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      const idx = visibleItems.findIndex((i) => i.id === item.id);
      const target = e.key === 'ArrowUp' ? visibleItems[idx - 1] : visibleItems[idx + 1];
      if (target) {
        const newSel = new Set([...selectedIds, target.id]);
        setSelected(newSel);
        setTimeout(() => {
          document.querySelector<HTMLDivElement>(`[data-item-id="${target.id}"].todo-item, [data-item-id="${target.id}"].todo-heading`)?.focus();
        }, 0);
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

    // Enter = enter edit
    if (e.key === 'Enter') {
      e.preventDefault();
      enterEdit();
      return;
    }

    // ArrowUp / ArrowDown = move selection
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const idx = visibleItems.findIndex((i) => i.id === item.id);
      const prev = visibleItems[idx - 1];
      if (prev) {
        useNoteStore.getState().setSelected(new Set([prev.id]));
        setTimeout(() => {
          document.querySelector<HTMLDivElement>(`[data-item-id="${prev.id}"].todo-item`)?.focus();
        }, 0);
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const idx = visibleItems.findIndex((i) => i.id === item.id);
      const next = visibleItems[idx + 1];
      if (next) {
        useNoteStore.getState().setSelected(new Set([next.id]));
        setTimeout(() => {
          document.querySelector<HTMLDivElement>(`[data-item-id="${next.id}"].todo-item`)?.focus();
        }, 0);
      }
      return;
    }

    // Tab / Shift+Tab = indent / dedent
    if (e.key === 'Tab') {
      e.preventDefault();
      if (e.shiftKey) {
        isInSel ? dedentSelected() : dedent(item.id);
      } else {
        isInSel ? indentSelected() : indent(item.id);
      }
      return;
    }

    // Del = delete
    if (e.key === 'Delete') {
      e.preventDefault();
      isInSel ? deleteSelected() : deleteItem(item.id);
      return;
    }

    // Ctrl+B = bold
    if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
      e.preventDefault();
      toggleBold(item.id); // toggleBold already applies to selection
      return;
    }

    // Ctrl+D = duplicate
    if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
      e.preventDefault();
      isInSel ? duplicateSelected() : duplicateItem(item.id);
      return;
    }

    // Ctrl+L = lock / unlock
    if ((e.ctrlKey || e.metaKey) && e.key === 'l') {
      e.preventDefault();
      isInSel ? lockSelected(!item.locked) : toggleLock(item.id);
      return;
    }

    // Ctrl+M = open comment
    if ((e.ctrlKey || e.metaKey) && e.key === 'm') {
      e.preventDefault();
      setMemoText(item.memo ?? '');
      setShowMemoEdit(true);
      return;
    }

    // Ctrl+H = make heading; Ctrl+Shift+H = back to normal
    if ((e.ctrlKey || e.metaKey) && (e.key === 'h' || e.key === 'H')) {
      e.preventDefault();
      updateItem(item.id, { item_type: e.shiftKey ? 'normal' : 'heading' });
      return;
    }

    // Ctrl+E = archive / unarchive
    if ((e.ctrlKey || e.metaKey) && e.key === 'e') {
      e.preventDefault();
      const next = !item.archived;
      if (isInSel) [...selectedIds].forEach((id) => updateItem(id, { archived: next }));
      else updateItem(item.id, { archived: next });
      return;
    }

    // Ctrl+Shift+Enter = add new item ABOVE this row (mirrors Shift+Enter for below)
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'Enter') {
      e.preventDefault();
      const newId = addItem(item.id, undefined, 'before');
      setTimeout(() => {
        document.querySelector<HTMLInputElement>(`[data-item-id="${newId}"] [data-text-input]`)?.focus();
      }, 30);
      return;
    }
  };

  // ── Click / Selection ────────────────────────────────────────────────────────
  const onRowClick = (e: MouseEvent) => {
    if (isEditing) return;
    // stopPropagation is critical: without it the click bubbles to note-items
    // which calls clearSelection() and immediately undoes the selection we just set.
    e.stopPropagation();
    if (e.shiftKey) {
      const visIds = visibleItems.map((i) => i.id);
      const selectedArr = [...selectedIds];
      if (selectedArr.length === 0) { toggleSelected(item.id); return; }
      const lastSel = selectedArr[selectedArr.length - 1];
      const from = visIds.indexOf(lastSel);
      const to = visIds.indexOf(item.id);
      if (from === -1 || to === -1) { toggleSelected(item.id); return; }
      const [lo, hi] = from < to ? [from, to] : [to, from];
      setSelected(new Set([...selectedIds, ...visIds.slice(lo, hi + 1)]));
    } else if (e.ctrlKey || e.metaKey) {
      toggleSelected(item.id);
    } else {
      setSelected(new Set([item.id]));
      rowRef.current?.focus();
    }
  };

  const onContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    setCtx({ x: e.clientX, y: e.clientY });
  };

  // ── Pointer-based Drag & Drop ─────────────────────────────────────────────────
  const onGripPointerDown = (e: React.PointerEvent<HTMLSpanElement>) => {
    if (item.locked) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    e.stopPropagation();
    startDrag(item.id);
  };

  const onGripPointerMove = (e: React.PointerEvent<HTMLSpanElement>) => {
    if (!dragState || dragState.fromId !== item.id) return;
    const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    const itemEl = el?.closest('[data-item-id]') as HTMLElement | null;
    if (itemEl?.dataset.itemId && itemEl.dataset.itemId !== item.id) {
      const rect = itemEl.getBoundingClientRect();
      updateDragOver(itemEl.dataset.itemId, e.clientY < rect.top + rect.height / 2 ? 'before' : 'after');
    } else if (!itemEl?.dataset.itemId) {
      updateDragOver(null, 'after');
    }
  };

  const onGripPointerUp = () => {
    if (dragState?.fromId === item.id && dragState.overItemId) {
      // If the dragged item is part of a multi-selection, move all selected items as a group
      if (selectedIds.has(item.id) && selectedIds.size > 1) {
        moveSelectedItems(dragState.overItemId, dragState.overPos);
      } else {
        moveItem(dragState.fromId, dragState.overItemId, dragState.overPos);
      }
    }
    endDrag();
  };

  // ── Bulk-aware update — applies the patch to all selected items if this row
  // is part of a multi-selection, otherwise just to this row.
  const updateMaybeBulk = (patch: Partial<Item>) => {
    if (isInSel) {
      [...selectedIds].forEach((id) => updateItem(id, patch));
    } else {
      updateItem(item.id, patch);
    }
  };

  // ── Memo / Comment ──────────────────────────────────────────────────────────
  const saveMemo = () => {
    updateItem(item.id, { memo: memoText.trim() || null });
    setShowMemoEdit(false);
  };

  const openComment = (e: MouseEvent) => {
    e.stopPropagation();
    const el = (e.currentTarget as HTMLElement).closest('.todo-item, .todo-heading');
    if (el) {
      const rect = el.getBoundingClientRect();
      setCommentAbove(rect.top > window.innerHeight * 0.5);
    }
    setMemoText(item.memo ?? '');
    setShowMemoEdit(true);
  };

  // ── Edit mode ────────────────────────────────────────────────────────────────
  const enterEdit = () => {
    if (!item.locked) {
      setIsEditing(true);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  };
  const exitEdit = () => setIsEditing(false);

  // ── Assignee ────────────────────────────────────────────────────────────────
  const assigneePerson = item.assignee_person_id
    ? assigneePersons.find((p) => p.id === item.assignee_person_id)
    : null;

  // Active group persons — use prop activeGroupId if provided, fall back to settings
  const resolvedGroupId = activeGroupId ?? settings.active_group_id ?? assigneeGroups[0]?.id;
  const groupPersons = resolvedGroupId
    ? assigneePersons.filter((p) => p.group_id === resolvedGroupId)
    : [];

  // ── Separator ────────────────────────────────────────────────────────────────
  if (item.item_type === 'separator') {
    return (
      <div
        className={`todo-separator${dragOverPos ? ` drag-${dragOverPos}` : ''}`}
        style={{ marginLeft: item.indent * 20 }}
        data-item-id={item.id}
        onContextMenu={onContextMenu}
      >
        {!item.locked && (
          <span
            className="item-drag-grip"
            style={{ touchAction: 'none', cursor: isDragging ? 'grabbing' : 'grab' }}
            onPointerDown={onGripPointerDown}
            onPointerMove={onGripPointerMove}
            onPointerUp={onGripPointerUp}
            onPointerCancel={endDrag}
            title="ドラッグで並び替え"
          >⠿</span>
        )}
        <hr />
        {ctx && <ContextMenu x={ctx.x} y={ctx.y} items={ctxItems} onClose={() => setCtx(null)} />}
      </div>
    );
  }

  // ── Heading ──────────────────────────────────────────────────────────────────
  if (item.item_type === 'heading') {
    return (
      <div
        className={`todo-heading${isSelected ? ' selected' : ''}${dragOverPos ? ` drag-${dragOverPos}` : ''}`}
        style={{ marginLeft: item.indent * 20 }}
        data-item-id={item.id}
        tabIndex={isSelected && !isEditing ? 0 : -1}
        onContextMenu={onContextMenu}
        onDoubleClick={(e) => { e.stopPropagation(); enterEdit(); }}
        onKeyDown={(e) => {
          if (!isEditing && e.key === 'Enter') { e.preventDefault(); enterEdit(); return; }
          // Forward all other keys (Ctrl+H, Ctrl+B, Ctrl+E, etc.) to the row handler.
          onRowKeyDown(e);
        }}
        onClick={(e) => {
          e.stopPropagation();
          setSelected(new Set([item.id]));
        }}
      >
        {!item.locked && (
          <span
            className="item-drag-grip"
            style={{ touchAction: 'none', cursor: isDragging ? 'grabbing' : 'grab' }}
            onPointerDown={onGripPointerDown}
            onPointerMove={onGripPointerMove}
            onPointerUp={onGripPointerUp}
            onPointerCancel={endDrag}
            title="ドラッグで並び替え"
          >⠿</span>
        )}
        {item.locked && <span className="item-lock-icon">🔒</span>}
        <input
          ref={inputRef}
          data-text-input=""
          className="todo-heading-input"
          value={item.text}
          readOnly={!isEditing || item.locked}
          onChange={(e) => isEditing && !item.locked && updateItem(item.id, { text: e.target.value })}
          onKeyDown={onKeyDown}
          onBlur={exitEdit}
          onDoubleClick={(e) => { e.stopPropagation(); enterEdit(); }}
          onMouseDown={(e) => e.stopPropagation()}
          placeholder="見出し"
        />
        {ctx && <ContextMenu x={ctx.x} y={ctx.y} items={ctxItems} onClose={() => setCtx(null)} />}
      </div>
    );
  }

  // ── Normal item ──────────────────────────────────────────────────────────────
  const statusObj = statuses.find((s) => s.id === item.status);

  return (
    <div
      ref={rowRef}
      className={`todo-item${isSelected ? ' selected' : ''}${dragOverPos ? ` drag-${dragOverPos}` : ''}${isDragging ? ' dragging' : ''}${item.locked ? ' locked-item' : ''}${isOverdue ? ' overdue-item' : isWarn ? ' warn-item' : ''}${isCurrentMatch ? ' current-match' : ''}`}
      style={{ paddingLeft: item.indent * 20 + 4 }}
      data-item-id={item.id}
      tabIndex={isSelected && !isEditing ? 0 : -1}
      onClick={onRowClick}
      onDoubleClick={(e) => { e.stopPropagation(); enterEdit(); }}
      onKeyDown={onRowKeyDown}
      onContextMenu={onContextMenu}
      onMouseEnter={(e) => {
        if (item.memo) {
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
          setHoverMemo({ above: rect.top > window.innerHeight * 0.5 });
        }
      }}
      onMouseLeave={() => setHoverMemo(null)}
    >
      {/* Drag grip */}
      {!item.locked && (
        <span
          className="item-drag-grip"
          style={{ touchAction: 'none', cursor: isDragging ? 'grabbing' : 'grab' }}
          onPointerDown={onGripPointerDown}
          onPointerMove={onGripPointerMove}
          onPointerUp={onGripPointerUp}
          onPointerCancel={endDrag}
          title="ドラッグで並び替え"
        >⠿</span>
      )}

      {/* Lock indicator */}
      {item.locked && <span className="item-lock-icon">🔒</span>}

      {/* Collapse toggle */}
      <button
        className={`collapse-btn${hasChildren ? '' : ' invisible'}`}
        onClick={(e) => { e.stopPropagation(); toggleCollapse(item.id); }}
        tabIndex={-1}
      >
        {item.collapsed ? '▶' : '▼'}
      </button>

      {/* Checkbox */}
      <input
        type="checkbox"
        checked={item.checked}
        onChange={(e) => { e.stopPropagation(); toggleCheck(item.id); }}
        onClick={(e) => e.stopPropagation()}
        className="todo-check"
        disabled={item.locked}
      />

      {/* Text — input while editing, div with clickable URLs while viewing */}
      {isEditing ? (
        <input
          ref={inputRef}
          data-text-input=""
          className={`todo-text${item.checked ? ' done' : ''}${item.bold ? ' bold' : ''}`}
          value={item.text}
          readOnly={item.locked}
          onChange={(e) => !item.locked && updateItem(item.id, { text: e.target.value })}
          onKeyDown={onKeyDown}
          onBlur={exitEdit}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          placeholder="タスクを入力…"
        />
      ) : (
        <div
          data-text-input=""
          className={`todo-text todo-text-view${item.checked ? ' done' : ''}${item.bold ? ' bold' : ''}`}
          onClick={(e) => { e.stopPropagation(); onRowClick(e); }}
          onDoubleClick={(e) => { e.stopPropagation(); enterEdit(); }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {item.text ? renderTextWithLinks(item.text, searchTerm) : <span className="todo-text-placeholder"></span>}
        </div>
      )}

      {/* Badges — fixed-width columns: 担当者 | ステータス | 期日 */}
      <div className="todo-badges">
        {/* ── 担当者 column ── */}
        {settings.feature_assignee && (
          <div className="badge-col badge-col-assignee">
            {assigneePerson
              ? <AssigneeBadge person={assigneePerson} persons={groupPersons} onSelect={(id) => updateMaybeBulk({ assignee_person_id: id || null })} />
              : groupPersons.length > 0 && <InlineAssigneePicker persons={groupPersons} onSelect={(id) => updateMaybeBulk({ assignee_person_id: id || null })} />
            }
          </div>
        )}

        {/* ── ステータス column ── */}
        {settings.feature_status && (
          <div className="badge-col badge-col-status">
            {statusObj
              ? <StatusBadge status={statusObj} allStatuses={statuses} onSelect={(id) => updateMaybeBulk({ status: id || null })} />
              : statuses.length > 0 && <InlineStatusPicker statuses={statuses} onSelect={(id) => updateMaybeBulk({ status: id || null })} />
            }
          </div>
        )}

        {/* ── 期日 column ── */}
        {settings.feature_date && (
          <div className="badge-col badge-col-date">
            {item.limit_date
              ? <DateBadge date={item.limit_date} isWarn={isWarn} isOverdue={isOverdue} onSelect={(d) => updateMaybeBulk({ limit_date: d || null })} />
              : <InlineDatePicker onSelect={(d) => updateMaybeBulk({ limit_date: d || null })} />
            }
          </div>
        )}

        {/* ── Priority (compact, after the main columns) ── */}
        {settings.feature_priority && item.priority && (
          <PriorityBadge
            priority={item.priority}
            onSelect={(p) => updateMaybeBulk({ priority: p })}
            mode={priorityMode ?? 'hml'}
          />
        )}

        {/* ── Memo indicator ── */}
        {settings.feature_memo && item.memo && (
          <span className="memo-indicator" title={item.memo} onClick={openComment}>💬</span>
        )}
      </div>

      {/* Context menu */}
      {ctx && <ContextMenu x={ctx.x} y={ctx.y} items={ctxItems} onClose={() => setCtx(null)} />}

      {/* Memo hover tooltip - Google Sheets style */}
      {item.memo && hoverMemo && !showMemoEdit && (
        <div className={`memo-tooltip${hoverMemo.above ? ' memo-tooltip-above' : ''}`}>
          <div className="memo-tooltip-text">{item.memo}</div>
        </div>
      )}

      {/* Comment edit popup */}
      {showMemoEdit && (
        <div className={`comment-popup${commentAbove ? ' comment-popup-above' : ''}`} onClick={(e) => e.stopPropagation()}>
          <div className="memo-popup-title">コメント</div>
          <textarea
            className="memo-textarea"
            autoFocus
            value={memoText}
            onChange={(e) => setMemoText(e.target.value)}
            placeholder="コメントを入力…"
            rows={4}
          />
          <div className="memo-popup-actions">
            <button className="btn-primary" onClick={saveMemo}>保存</button>
            <button className="btn-secondary" onClick={() => setShowMemoEdit(false)}>キャンセル</button>
          </div>
        </div>
      )}
    </div>
  );
}

