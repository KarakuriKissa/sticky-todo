import { useRef, KeyboardEvent, useState, MouseEvent } from 'react';
import type { TodoItem as Item, Status } from '../types';
import { useNoteStore } from '../store/noteStore';
import { useAppStore } from '../store/appStore';
import { ContextMenu, ContextMenuItem } from './ContextMenu';

interface Props {
  item: Item;
  visibleItems: Item[];
  allItems: Item[];
  warnDays: number;
  priorityMode?: 'hml' | 'abc';
}

export function TodoItemRow({ item, visibleItems, allItems, warnDays, priorityMode }: Props) {
  const {
    updateItem, deleteItem, toggleCheck, toggleBold, toggleLock, toggleCollapse,
    indent, dedent, addItem, selectedIds, toggleSelected, moveItem,
    duplicateItem, setSelected, dragState, startDrag, updateDragOver, endDrag,
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

  // Context menu
  const ctxItems: ContextMenuItem[] = [
    {
      label: '上に項目を追加',
      icon: '↑',
      action: () => {
        const newId = addItem(item.id, item.indent, 'before');
        setTimeout(() => {
          document.querySelector<HTMLInputElement>(`[data-item-id="${newId}"] [data-text-input]`)?.focus();
        }, 30);
      },
    },
    {
      label: '下に項目を追加',
      icon: '↓',
      action: () => {
        const newId = addItem(item.id, item.indent);
        setTimeout(() => {
          document.querySelector<HTMLInputElement>(`[data-item-id="${newId}"] [data-text-input]`)?.focus();
        }, 30);
      },
    },
    { label: '', separator: true, action: () => {} },
    { label: item.bold ? '太字を解除' : '太字', icon: 'B', action: () => toggleBold(item.id) },
    { label: 'コメント', icon: '💬', action: () => { setMemoText(item.memo ?? ''); setShowMemoEdit(true); } },
    { label: '', separator: true, action: () => {} },
    { label: '見出しに変更', icon: 'H', action: () => updateItem(item.id, { item_type: 'heading' }) },
    { label: '通常に変更', icon: '•', action: () => updateItem(item.id, { item_type: 'normal' }) },
    { label: '', separator: true, action: () => {} },
    { label: 'インデント', icon: '→', action: () => indent(item.id), disabled: item.indent >= 6 || item.locked },
    { label: 'アウトデント', icon: '←', action: () => dedent(item.id), disabled: item.indent <= 0 || item.locked },
    { label: '', separator: true, action: () => {} },
    {
      label: item.locked ? 'ロック解除' : 'ロック',
      icon: item.locked ? '🔓' : '🔒',
      action: () => toggleLock(item.id),
    },
    { label: '複製', icon: '📋', action: () => duplicateItem(item.id) },
    { label: '削除', icon: '🗑', action: () => deleteItem(item.id), danger: true },
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

    // Ctrl+Shift+Arrow = move selected items
    if (e.shiftKey && e.ctrlKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      if (e.key === 'ArrowUp') useNoteStore.getState().moveSelectedUp();
      else useNoteStore.getState().moveSelectedDown();
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      enterEdit();
      return;
    }
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
  };

  // ── Click / Selection ────────────────────────────────────────────────────────
  const onRowClick = (e: MouseEvent) => {
    if (isEditing) return; // don't interfere while editing
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
      moveItem(dragState.fromId, dragState.overItemId, dragState.overPos);
    }
    endDrag();
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

  // Active group persons for inline pickers
  const activeGroup = settings.active_group_id
    ? assigneeGroups.find((g) => g.id === settings.active_group_id)
    : assigneeGroups[0];
  const groupPersons = activeGroup ? assigneePersons.filter((p) => p.group_id === activeGroup.id) : [];

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
          if (!isEditing && e.key === 'Enter') { e.preventDefault(); enterEdit(); }
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
        <div className="todo-item-hover-actions">
          <button className="btn-icon" tabIndex={-1} onClick={() => toggleLock(item.id)} title={item.locked ? 'ロック解除' : 'ロック'}>
            {item.locked ? '🔓' : '🔒'}
          </button>
          <button className="btn-icon danger" tabIndex={-1} onClick={() => deleteItem(item.id)} title="削除">×</button>
        </div>
        {ctx && <ContextMenu x={ctx.x} y={ctx.y} items={ctxItems} onClose={() => setCtx(null)} />}
      </div>
    );
  }

  // ── Normal item ──────────────────────────────────────────────────────────────
  const statusObj = statuses.find((s) => s.id === item.status);

  return (
    <div
      ref={rowRef}
      className={`todo-item${isSelected ? ' selected' : ''}${dragOverPos ? ` drag-${dragOverPos}` : ''}${isDragging ? ' dragging' : ''}${item.locked ? ' locked-item' : ''}${isOverdue ? ' overdue-item' : isWarn ? ' warn-item' : ''}`}
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

      {/* Text */}
      <input
        ref={inputRef}
        data-text-input=""
        className={`todo-text${item.checked ? ' done' : ''}${item.bold ? ' bold' : ''}`}
        value={item.text}
        readOnly={!isEditing || item.locked}
        onChange={(e) => isEditing && !item.locked && updateItem(item.id, { text: e.target.value })}
        onKeyDown={onKeyDown}
        onBlur={exitEdit}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => { e.stopPropagation(); enterEdit(); }}
        onMouseDown={(e) => e.stopPropagation()}
        placeholder={isEditing ? 'タスクを入力…' : ''}
      />

      {/* Badges */}
      <div className="todo-badges">
        {settings.feature_priority && item.priority && (
          <PriorityBadge
            priority={item.priority}
            onSelect={(p) => updateItem(item.id, { priority: p })}
            mode={priorityMode ?? 'hml'}
          />
        )}

        {settings.feature_status && statusObj && (
          <StatusBadge status={statusObj} allStatuses={statuses} onSelect={(id) => updateItem(item.id, { status: id || null })} />
        )}

        {settings.feature_assignee && assigneePerson && (
          <AssigneeBadge
            person={assigneePerson}
            persons={groupPersons}
            onSelect={(id) => updateItem(item.id, { assignee_person_id: id || null })}
          />
        )}

        {settings.feature_date && item.limit_date && (
          <DateBadge
            date={item.limit_date}
            isWarn={isWarn}
            isOverdue={isOverdue}
            onSelect={(d) => updateItem(item.id, { limit_date: d || null })}
          />
        )}

        {/* Inline add buttons when values are empty */}
        {settings.feature_status && !statusObj && (
          <InlineStatusPicker statuses={statuses} onSelect={(id) => updateItem(item.id, { status: id || null })} />
        )}
        {settings.feature_assignee && !assigneePerson && groupPersons.length > 0 && (
          <InlineAssigneePicker persons={groupPersons} onSelect={(id) => updateItem(item.id, { assignee_person_id: id || null })} />
        )}
        {settings.feature_date && !item.limit_date && (
          <InlineDatePicker onSelect={(d) => updateItem(item.id, { limit_date: d || null })} />
        )}

        {settings.feature_memo && item.memo && (
          <span
            className="memo-indicator"
            title={item.memo}
            onClick={openComment}
          >
            💬
          </span>
        )}
      </div>

      {/* Hover actions */}
      <div className="todo-item-hover-actions">
        <button
          className={`btn-icon${item.bold ? ' active' : ''}`}
          tabIndex={-1}
          title="太字 (Ctrl+B)"
          onClick={(e) => { e.stopPropagation(); toggleBold(item.id); }}
          style={{ fontWeight: 800, fontSize: 12 }}
        >B</button>
        <button
          className={`btn-icon${item.locked ? ' active' : ''}`}
          tabIndex={-1}
          title={item.locked ? 'ロック解除' : 'ロック'}
          onClick={(e) => { e.stopPropagation(); toggleLock(item.id); }}
        >{item.locked ? '🔓' : '🔒'}</button>
        <button
          className="btn-icon"
          tabIndex={-1}
          title="複製"
          onClick={(e) => { e.stopPropagation(); duplicateItem(item.id); }}
        >📋</button>
        <button
          className="btn-icon danger"
          tabIndex={-1}
          title="削除"
          onClick={(e) => { e.stopPropagation(); if (!item.locked) deleteItem(item.id); }}
        >×</button>
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

// ── StatusBadge ───────────────────────────────────────────────────────────────
function StatusBadge({
  status,
  allStatuses,
  onSelect,
}: {
  status: Status;
  allStatuses: Status[];
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [above, setAbove] = useState(false);
  const btnRef = useRef<HTMLSpanElement>(null);

  const openPicker = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setAbove(rect.top > window.innerHeight * 0.5);
    }
    setOpen((o) => !o);
  };

  return (
    <div className="status-badge-wrap" onMouseLeave={() => setOpen(false)}>
      <span
        ref={btnRef}
        className="status-badge"
        style={{ background: status.color }}
        onClick={openPicker}
      >
        {status.name}
      </span>
      {open && (
        <div className="status-dropdown" style={above ? { bottom: '100%', top: 'auto' } : {}}>
          <div className="status-option" onClick={(e) => { e.stopPropagation(); onSelect(''); setOpen(false); }}>（なし）</div>
          {allStatuses.map((s) => (
            <div
              key={s.id}
              className="status-option"
              style={{ borderLeft: `3px solid ${s.color}` }}
              onClick={(e) => { e.stopPropagation(); onSelect(s.id); setOpen(false); }}
            >
              {s.name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── PriorityBadge ─────────────────────────────────────────────────────────────
const PRIORITIES_HML = [
  { value: 'high', label: '高', color: '#ef4444' },
  { value: 'medium', label: '中', color: '#f97316' },
  { value: 'low', label: '低', color: '#22c55e' },
];
const PRIORITIES_ABC = [
  { value: 'high', label: 'A', color: '#ef4444' },
  { value: 'medium', label: 'B', color: '#f97316' },
  { value: 'low', label: 'C', color: '#22c55e' },
];

function PriorityBadge({ priority, onSelect, mode = 'hml' }: { priority: string; onSelect: (p: string | null) => void; mode?: 'hml' | 'abc' }) {
  const [open, setOpen] = useState(false);
  const PRIORITIES = mode === 'abc' ? PRIORITIES_ABC : PRIORITIES_HML;
  const p = PRIORITIES.find((x) => x.value === priority);
  if (!p) return null;
  return (
    <div className="status-badge-wrap">
      <span
        className="priority-badge"
        style={{ background: p.color }}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
      >
        {p.label}
      </span>
      {open && (
        <div className="status-dropdown">
          <div className="status-option" onClick={(e) => { e.stopPropagation(); onSelect(null); setOpen(false); }}>（なし）</div>
          {PRIORITIES.map((px) => (
            <div
              key={px.value}
              className="status-option"
              style={{ borderLeft: `3px solid ${px.color}` }}
              onClick={(e) => { e.stopPropagation(); onSelect(px.value); setOpen(false); }}
            >
              {px.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── AssigneeBadge ─────────────────────────────────────────────────────────────
function AssigneeBadge({
  person,
  persons,
  onSelect,
}: {
  person: { id: string; name: string; color: string };
  persons: { id: string; name: string; color: string }[];
  onSelect: (id: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [above, setAbove] = useState(false);
  const btnRef = useRef<HTMLSpanElement>(null);

  const openPicker = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setAbove(rect.top > window.innerHeight * 0.5);
    }
    setOpen((o) => !o);
  };

  return (
    <div className="status-badge-wrap" onMouseLeave={() => setOpen(false)}>
      <span
        ref={btnRef}
        className="assignee-badge"
        style={{ borderColor: person.color, cursor: 'pointer' }}
        onClick={openPicker}
      >
        {person.name}
      </span>
      {open && (
        <div className="status-dropdown" style={above ? { bottom: '100%', top: 'auto' } : {}}>
          <div className="status-option" onClick={(e) => { e.stopPropagation(); onSelect(null); setOpen(false); }}>（なし）</div>
          {persons.map((p) => (
            <div
              key={p.id}
              className="status-option"
              style={{ borderLeft: `3px solid ${p.color}` }}
              onClick={(e) => { e.stopPropagation(); onSelect(p.id); setOpen(false); }}
            >
              {p.name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── DateBadge ─────────────────────────────────────────────────────────────────
function DateBadge({
  date,
  isWarn,
  isOverdue,
  onSelect,
}: {
  date: string;
  isWarn: boolean;
  isOverdue: boolean;
  onSelect: (d: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(date);
  if (editing) {
    return (
      <input
        type="date"
        className="inline-date-input"
        autoFocus
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        onBlur={() => { onSelect(val || null); setEditing(false); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { onSelect(val || null); setEditing(false); }
          if (e.key === 'Escape') setEditing(false);
          if (e.key === 'Delete' || e.key === 'Backspace') { onSelect(null); setEditing(false); }
          e.stopPropagation();
        }}
      />
    );
  }
  return (
    <span
      className={`date-badge${isOverdue ? ' overdue' : isWarn ? ' warn' : ''}`}
      title="期限（クリックで変更）"
      onClick={(e) => { e.stopPropagation(); setEditing(true); }}
      style={{ cursor: 'pointer' }}
    >
      {date}
    </span>
  );
}

// ── InlineStatusPicker ────────────────────────────────────────────────────────
function InlineStatusPicker({
  statuses,
  onSelect,
}: {
  statuses: Status[];
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [above, setAbove] = useState(false);
  const btnRef = useRef<HTMLSpanElement>(null);

  const openPicker = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setAbove(rect.top > window.innerHeight * 0.5);
    }
    setOpen((o) => !o);
  };

  if (statuses.length === 0) return null;
  return (
    <div className="status-badge-wrap inline-add" onMouseLeave={() => setOpen(false)}>
      <span
        ref={btnRef}
        className="inline-add-btn"
        onClick={openPicker}
        title="ステータスを設定"
      >
        ST＋
      </span>
      {open && (
        <div className="status-dropdown" style={above ? { bottom: '100%', top: 'auto' } : {}}>
          {statuses.map((s) => (
            <div
              key={s.id}
              className="status-option"
              style={{ borderLeft: `3px solid ${s.color}` }}
              onClick={(e) => { e.stopPropagation(); onSelect(s.id); setOpen(false); }}
            >
              {s.name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── InlineAssigneePicker ──────────────────────────────────────────────────────
function InlineAssigneePicker({
  persons,
  onSelect,
}: {
  persons: { id: string; name: string; color: string }[];
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [above, setAbove] = useState(false);
  const btnRef = useRef<HTMLSpanElement>(null);

  const openPicker = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setAbove(rect.top > window.innerHeight * 0.5);
    }
    setOpen((o) => !o);
  };

  if (persons.length === 0) return null;
  return (
    <div className="status-badge-wrap inline-add" onMouseLeave={() => setOpen(false)}>
      <span
        ref={btnRef}
        className="inline-add-btn"
        onClick={openPicker}
        title="担当者を設定"
      >
        👤＋
      </span>
      {open && (
        <div className="status-dropdown" style={above ? { bottom: '100%', top: 'auto' } : {}}>
          {persons.map((p) => (
            <div
              key={p.id}
              className="status-option"
              style={{ borderLeft: `3px solid ${p.color}` }}
              onClick={(e) => { e.stopPropagation(); onSelect(p.id); setOpen(false); }}
            >
              {p.name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── InlineDatePicker ──────────────────────────────────────────────────────────
function InlineDatePicker({ onSelect }: { onSelect: (d: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState('');
  if (!open) {
    return (
      <span
        className="inline-add-btn"
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        title="期日を設定"
      >
        📅＋
      </span>
    );
  }
  return (
    <input
      type="date"
      className="inline-date-input"
      autoFocus
      value={val}
      onChange={(e) => setVal(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onBlur={() => { if (val) onSelect(val); setOpen(false); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { if (val) onSelect(val); setOpen(false); }
        if (e.key === 'Escape') setOpen(false);
        e.stopPropagation();
      }}
    />
  );
}
