import { useRef, useState, DragEvent } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { Category } from '../types';
import { useAppStore } from '../store/appStore';

export function CategoryList() {
  const {
    categories, selectedCategoryId, setSelectedCategory,
    saveCategory, deleteCategory, reorderCategories,
  } = useAppStore();
  const [editing, setEditing] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState(false);
  const [addName, setAddName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Drag state
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [dragPos, setDragPos] = useState<'before' | 'after'>('after');

  const startAdd = () => {
    setAdding(true);
    setAddName('');
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const confirmAdd = async () => {
    if (!addName.trim()) { setAdding(false); return; }
    const id = await invoke<string>('generate_id');
    await saveCategory({
      id,
      name: addName.trim(),
      color: '#6366f1',
      sort_order: categories.length,
    });
    setAdding(false);
  };

  const startEdit = (cat: Category) => {
    setEditing(cat.id);
    setNewName(cat.name);
  };

  const confirmEdit = async (cat: Category) => {
    if (newName.trim()) {
      await saveCategory({ ...cat, name: newName.trim() });
    }
    setEditing(null);
  };

  // ── Drag & Drop ─────────────────────────────────────────────────────────────
  const onDragStart = (e: DragEvent, id: string) => {
    e.dataTransfer.setData('text/plain', id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const onDragOver = (e: DragEvent, id: string) => {
    e.preventDefault();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const mid = rect.top + rect.height / 2;
    setDragOverId(id);
    setDragPos(e.clientY < mid ? 'before' : 'after');
  };

  const onDrop = (e: DragEvent, toId: string) => {
    e.preventDefault();
    const fromId = e.dataTransfer.getData('text/plain');
    setDragOverId(null);
    if (!fromId || fromId === toId) return;
    const ids = categories.map((c) => c.id);
    const fromIdx = ids.indexOf(fromId);
    const toIdx = ids.indexOf(toId);
    if (fromIdx === -1 || toIdx === -1) return;
    const newIds = [...ids];
    newIds.splice(fromIdx, 1);
    const insertAt = dragPos === 'before'
      ? newIds.indexOf(toId)
      : newIds.indexOf(toId) + 1;
    newIds.splice(insertAt, 0, fromId);
    reorderCategories(newIds);
  };

  return (
    <aside className="category-list">
      <div className="category-header">
        <span>カテゴリ</span>
        <button className="btn-icon" onClick={startAdd} title="追加">＋</button>
      </div>

      <ul>
        <li
          className={selectedCategoryId === null ? 'active' : ''}
          onClick={() => setSelectedCategory(null)}
        >
          <span className="cat-dot" style={{ background: '#6366f1' }} />
          <span className="cat-name">すべて</span>
        </li>

        {categories.map((cat) => (
          <li
            key={cat.id}
            className={`${selectedCategoryId === cat.id ? 'active' : ''}${dragOverId === cat.id ? ` drag-${dragPos}` : ''}`}
            onClick={() => setSelectedCategory(cat.id)}
            onDoubleClick={() => startEdit(cat)}
            draggable
            onDragStart={(e) => onDragStart(e, cat.id)}
            onDragOver={(e) => onDragOver(e, cat.id)}
            onDragLeave={() => setDragOverId(null)}
            onDrop={(e) => onDrop(e, cat.id)}
            onDragEnd={() => setDragOverId(null)}
          >
            <span className="cat-grip" title="ドラッグで並び替え">⠿</span>
            <span className="cat-dot" style={{ background: cat.color }} />
            {editing === cat.id ? (
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onBlur={() => confirmEdit(cat)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') confirmEdit(cat);
                  if (e.key === 'Escape') setEditing(null);
                }}
                onClick={(e) => e.stopPropagation()}
                className="cat-input"
              />
            ) : (
              <span className="cat-name">{cat.name}</span>
            )}
            <button
              className="btn-icon cat-del"
              onClick={(e) => { e.stopPropagation(); deleteCategory(cat.id); }}
              title="削除"
            >
              ×
            </button>
          </li>
        ))}
      </ul>

      {adding && (
        <div className="cat-add-row">
          <input
            ref={inputRef}
            value={addName}
            onChange={(e) => setAddName(e.target.value)}
            onBlur={confirmAdd}
            onKeyDown={(e) => {
              if (e.key === 'Enter') confirmAdd();
              if (e.key === 'Escape') setAdding(false);
            }}
            placeholder="カテゴリ名"
            className="cat-input"
          />
        </div>
      )}
    </aside>
  );
}
