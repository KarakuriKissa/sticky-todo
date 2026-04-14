import { useRef, KeyboardEvent, DragEvent, useState } from 'react';
import type { TodoItem as Item, Status } from '../types';
import { useNoteStore } from '../store/noteStore';
import { useAppStore } from '../store/appStore';

interface Props {
  item: Item;
  visibleItems: Item[]; // flat ordered list (excludes collapsed children)
  allItems: Item[];
}

export function TodoItemRow({ item, visibleItems, allItems }: Props) {
  const {
    updateItem, deleteItem, toggleCheck, toggleCollapse,
    indent, dedent, addItem, selectedIds, toggleSelected, moveItem,
  } = useNoteStore();
  const { statuses, settings } = useAppStore();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState<'before' | 'after' | null>(null);

  const hasChildren = allItems.some((i) => i.parent_id === item.id);
  const isSelected = selectedIds.has(item.id);

  // ── Keyboard ────────────────────────────────────────────────────────────────
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const newId = addItem(item.id, item.indent);
      // Focus new item next tick
      setTimeout(() => {
        document.querySelector<HTMLInputElement>(`[data-item-id="${newId}"] input`)?.focus();
      }, 30);
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

    if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
      e.preventDefault();
      useNoteStore.getState().undo();
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) {
      e.preventDefault();
      useNoteStore.getState().redo();
    }
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

  // ── Separator / Heading ──────────────────────────────────────────────────────
  if (item.item_type === 'separator') {
    return (
      <div
        className="todo-separator"
        style={{ marginLeft: item.indent * 20 }}
        data-item-id={item.id}
      >
        <hr />
      </div>
    );
  }

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
      >
        <input
          ref={inputRef}
          className="todo-heading-input"
          value={item.text}
          onChange={(e) => updateItem(item.id, { text: e.target.value })}
          onKeyDown={onKeyDown}
          placeholder="見出し"
        />
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
      onClick={(e) => e.ctrlKey && toggleSelected(item.id)}
    >
      {/* Collapse toggle */}
      <button
        className={`collapse-btn${hasChildren ? '' : ' invisible'}`}
        onClick={() => toggleCollapse(item.id)}
        tabIndex={-1}
      >
        {item.collapsed ? '▶' : '▼'}
      </button>

      {/* Checkbox */}
      <input
        type="checkbox"
        checked={item.checked}
        onChange={() => toggleCheck(item.id)}
        className="todo-check"
      />

      {/* Text */}
      <input
        ref={inputRef}
        className={`todo-text${item.checked ? ' done' : ''}`}
        value={item.text}
        onChange={(e) => updateItem(item.id, { text: e.target.value })}
        onKeyDown={onKeyDown}
        placeholder="タスクを入力…"
      />

      <div className="todo-badges">
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

        {/* Assignee badge */}
        {settings.feature_assignee && (() => {
          const arr: string[] = JSON.parse(item.assignees || '[]');
          return arr.length > 0 ? (
            <span className="assignee-badge">{arr.join(', ')}</span>
          ) : null;
        })()}
      </div>

      {/* Delete */}
      <button
        className="todo-del btn-icon"
        onClick={() => deleteItem(item.id)}
        tabIndex={-1}
        title="削除"
      >
        ×
      </button>
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

function isOverdue(dateStr: string): boolean {
  return new Date(dateStr) < new Date();
}
