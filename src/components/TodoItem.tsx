import { useRef, KeyboardEvent, DragEvent, useState, MouseEvent } from 'react';
import type { TodoItem as Item, Status } from '../types';
import { useNoteStore } from '../store/noteStore';
import { useAppStore } from '../store/appStore';
import { ContextMenu, ContextMenuItem } from './ContextMenu';

interface Props {
  item: Item;
  visibleItems: Item[]; // flat ordered list (excludes collapsed children)
  allItems: Item[];
}

export function TodoItemRow({ item, visibleItems, allItems }: Props) {
  const {
    updateItem, deleteItem, toggleCheck, toggleBold, toggleCollapse,
    indent, dedent, addItem, selectedIds, toggleSelected, moveItem,
    duplicateItem, setSelected,
  } = useNoteStore();
  const { statuses, settings } = useAppStore();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState<'before' | 'after' | null>(null);
  const [showMemo, setShowMemo] = useState(false);
  const [memoText, setMemoText] = useState(item.memo ?? '');
  const [ctx, setCtx] = useState<{ x: number; y: number } | null>(null);

  const hasChildren = allItems.some((i) => i.parent_id === item.id);
  const isSelected = selectedIds.has(item.id);

  // ── Context menu items ───────────────────────────────────────────────────────
  const ctxItems: ContextMenuItem[] = [
    {
      label: '下に項目を追加',
      icon: '＋',
      action: () => {
        const newId = addItem(item.id, item.indent);
        setTimeout(() => {
          document.querySelector<HTMLInputElement>(`[data-item-id="${newId}"] input`)?.focus();
        }, 30);
      },
    },
    { label: '', separator: true, action: () => {} },
    {
      label: item.bold ? '太字を解除' : '太字',
      icon: 'B',
      action: () => toggleBold(item.id),
    },
    {
      label: 'メモ',
      icon: '📝',
      action: () => setShowMemo(true),
    },
    { label: '', separator: true, action: () => {} },
    {
      label: '見出しに変更',
      icon: 'H',
      action: () => updateItem(item.id, { item_type: 'heading' }),
    },
    {
      label: '通常に変更',
      icon: '•',
      action: () => updateItem(item.id, { item_type: 'normal' }),
    },
    { label: '', separator: true, action: () => {} },
    {
      label: 'インデント',
      icon: '→',
      action: () => indent(item.id),
      disabled: item.indent >= 6,
    },
    {
      label: 'アウトデント',
      icon: '←',
      action: () => dedent(item.id),
      disabled: item.indent <= 0,
    },
    { label: '', separator: true, action: () => {} },
    {
      label: '複製',
      icon: '📋',
      action: () => duplicateItem(item.id),
    },
    {
      label: '削除',
      icon: '🗑',
      action: () => deleteItem(item.id),
      danger: true,
    },
  ];

  // ── Keyboard ────────────────────────────────────────────────────────────────
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // Shift+Enter = new item below
    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      const newId = addItem(item.id, item.indent);
      setTimeout(() => {
        document.querySelector<HTMLInputElement>(`[data-item-id="${newId}"] input`)?.focus();
      }, 30);
      return;
    }

    // Enter = confirm / blur
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      inputRef.current?.blur();
      return;
    }

    if (e.key === 'Tab') {
      e.preventDefault();
      e.shiftKey ? dedent(item.id) : indent(item.id);
    }

    if (e.key === 'Backspace' && item.text === '') {
      e.preventDefault();
      const idx = visibleItems.findIndex((i) => i.id === item.id);
      const prev = visibleItems[idx - 1];
      deleteItem(item.id);
      setTimeout(() => {
        if (prev) {
          document.querySelector<HTMLInputElement>(`[data-item-id="${prev.id}"] input`)?.focus();
        }
      }, 30);
    }

    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      useNoteStore.getState().undo();
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) {
      e.preventDefault();
      useNoteStore.getState().redo();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
      e.preventDefault();
      toggleBold(item.id);
    }
  };

  // ── Click / Selection ────────────────────────────────────────────────────────
  const onRowClick = (e: MouseEvent) => {
    if (e.shiftKey) {
      // Shift+click: range select
      const visIds = visibleItems.map((i) => i.id);
      const selectedArr = [...selectedIds];
      if (selectedArr.length === 0) {
        toggleSelected(item.id);
        return;
      }
      const lastSel = selectedArr[selectedArr.length - 1];
      const from = visIds.indexOf(lastSel);
      const to = visIds.indexOf(item.id);
      if (from === -1 || to === -1) { toggleSelected(item.id); return; }
      const [lo, hi] = from < to ? [from, to] : [to, from];
      const range = visIds.slice(lo, hi + 1);
      setSelected(new Set([...selectedIds, ...range]));
    } else if (e.ctrlKey || e.metaKey) {
      toggleSelected(item.id);
    }
  };

  // ── Right click ──────────────────────────────────────────────────────────────
  const onContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    setCtx({ x: e.clientX, y: e.clientY });
  };

  // ── Drag & Drop ─────────────────────────────────────────────────────────────
  const onDragStart = (e: DragEvent) => {
    e.dataTransfer.setData('text/plain', item.id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const onDragOver = (e: DragEvent) => {
    e.preventDefault();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    setDragOver(e.clientY < midY ? 'before' : 'after');
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    const fromId = e.dataTransfer.getData('text/plain');
    if (fromId !== item.id && dragOver) {
      moveItem(fromId, item.id, dragOver);
    }
    setDragOver(null);
  };

  // ── Memo ────────────────────────────────────────────────────────────────────
  const saveMemo = () => {
    updateItem(item.id, { memo: memoText.trim() || null });
    setShowMemo(false);
  };

  // ── Separator ────────────────────────────────────────────────────────────────
  if (item.item_type === 'separator') {
    return (
      <div
        className={`todo-separator${dragOver ? ` drag-${dragOver}` : ''}`}
        style={{ marginLeft: item.indent * 20 }}
        data-item-id={item.id}
        draggable
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragLeave={() => setDragOver(null)}
        onDrop={onDrop}
        onContextMenu={onContextMenu}
      >
        <hr />
        {ctx && <ContextMenu x={ctx.x} y={ctx.y} items={ctxItems} onClose={() => setCtx(null)} />}
      </div>
    );
  }

  // ── Heading ──────────────────────────────────────────────────────────────────
  if (item.item_type === 'heading') {
    return (
      <div
        className={`todo-heading${dragOver ? ` drag-${dragOver}` : ''}`}
        style={{ marginLeft: item.indent * 20 }}
        data-item-id={item.id}
        draggable
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragLeave={() => setDragOver(null)}
        onDrop={onDrop}
        onContextMenu={onContextMenu}
      >
        <input
          ref={inputRef}
          className="todo-heading-input"
          value={item.text}
          onChange={(e) => updateItem(item.id, { text: e.target.value })}
          onKeyDown={onKeyDown}
          placeholder="見出し"
        />
        <div className="todo-item-hover-actions">
          <button className="btn-icon" tabIndex={-1} title="削除" onClick={() => deleteItem(item.id)}>×</button>
        </div>
        {ctx && <ContextMenu x={ctx.x} y={ctx.y} items={ctxItems} onClose={() => setCtx(null)} />}
      </div>
    );
  }

  // ── Normal item ──────────────────────────────────────────────────────────────
  const statusObj = statuses.find((s) => s.id === item.status);

  return (
    <div
      className={`todo-item${isSelected ? ' selected' : ''}${dragOver ? ` drag-${dragOver}` : ''}`}
      style={{ paddingLeft: item.indent * 20 + 4 }}
      data-item-id={item.id}
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={() => setDragOver(null)}
      onDrop={onDrop}
      onClick={onRowClick}
      onContextMenu={onContextMenu}
    >
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
      />

      {/* Text */}
      <input
        ref={inputRef}
        className={`todo-text${item.checked ? ' done' : ''}${item.bold ? ' bold' : ''}`}
        value={item.text}
        onChange={(e) => updateItem(item.id, { text: e.target.value })}
        onKeyDown={onKeyDown}
        onClick={(e) => e.stopPropagation()}
        placeholder="タスクを入力…"
      />

      <div className="todo-badges">
        {/* Priority badge */}
        {settings.feature_priority && item.priority && (
          <PriorityBadge
            priority={item.priority}
            onSelect={(p) => updateItem(item.id, { priority: p })}
          />
        )}

        {/* Status badge */}
        {settings.feature_status && statusObj && (
          <StatusBadge
            status={statusObj}
            allStatuses={statuses}
            onSelect={(id) => updateItem(item.id, { status: id })}
          />
        )}

        {/* Date badge */}
        {settings.feature_date && item.limit_date && (
          <span
            className={`date-badge${isOverdue(item.limit_date) ? ' overdue' : ''}`}
            title="期限"
          >
            {item.limit_date}
          </span>
        )}

        {/* Memo indicator */}
        {settings.feature_memo && item.memo && (
          <button
            className="memo-badge"
            title={item.memo}
            onClick={(e) => { e.stopPropagation(); setMemoText(item.memo ?? ''); setShowMemo(true); }}
          >
            📝
          </button>
        )}
      </div>

      {/* Hover actions */}
      <div className="todo-item-hover-actions">
        {settings.feature_memo && (
          <button
            className="btn-icon"
            tabIndex={-1}
            title="メモ"
            onClick={(e) => { e.stopPropagation(); setMemoText(item.memo ?? ''); setShowMemo(true); }}
          >
            📝
          </button>
        )}
        <button
          className={`btn-icon${item.bold ? ' active' : ''}`}
          tabIndex={-1}
          title="太字"
          onClick={(e) => { e.stopPropagation(); toggleBold(item.id); }}
          style={{ fontWeight: 'bold' }}
        >
          B
        </button>
        <button
          className="btn-icon"
          tabIndex={-1}
          title="複製"
          onClick={(e) => { e.stopPropagation(); duplicateItem(item.id); }}
        >
          📋
        </button>
        <button
          className="btn-icon danger"
          tabIndex={-1}
          title="削除"
          onClick={(e) => { e.stopPropagation(); deleteItem(item.id); }}
        >
          ×
        </button>
      </div>

      {/* Context menu */}
      {ctx && <ContextMenu x={ctx.x} y={ctx.y} items={ctxItems} onClose={() => setCtx(null)} />}

      {/* Memo popup */}
      {showMemo && (
        <div className="memo-popup" onClick={(e) => e.stopPropagation()}>
          <div className="memo-popup-title">メモ</div>
          <textarea
            className="memo-textarea"
            autoFocus
            value={memoText}
            onChange={(e) => setMemoText(e.target.value)}
            placeholder="メモを入力…"
            rows={4}
          />
          <div className="memo-popup-actions">
            <button className="btn-primary" onClick={saveMemo}>保存</button>
            <button className="btn-secondary" onClick={() => setShowMemo(false)}>キャンセル</button>
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

  return (
    <div className="status-badge-wrap">
      <span
        className="status-badge"
        style={{ background: status.color }}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
      >
        {status.name}
      </span>
      {open && (
        <div className="status-dropdown">
          <div
            className="status-option"
            style={{ borderLeft: '3px solid #ccc' }}
            onClick={(e) => { e.stopPropagation(); onSelect(''); setOpen(false); }}
          >
            （なし）
          </div>
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
const PRIORITIES = [
  { value: 'high',   label: '高', color: '#ef4444' },
  { value: 'medium', label: '中', color: '#f97316' },
  { value: 'low',    label: '低', color: '#22c55e' },
];

function PriorityBadge({
  priority,
  onSelect,
}: {
  priority: string;
  onSelect: (p: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
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
          <div
            className="status-option"
            onClick={(e) => { e.stopPropagation(); onSelect(null); setOpen(false); }}
          >
            （なし）
          </div>
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

function isOverdue(dateStr: string): boolean {
  return new Date(dateStr) < new Date();
}
