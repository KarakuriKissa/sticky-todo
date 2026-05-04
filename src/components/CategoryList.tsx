import { useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { Category } from '../types';
import { useAppStore } from '../store/appStore';

export function CategoryList() {
  const {
    categories, selectedCategoryId, setSelectedCategory,
    saveCategory, deleteCategory, reorderCategories,
    draggingNoteId, noteDropOverCatId,
  } = useAppStore();
  const [editing, setEditing] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState(false);
  const [addName, setAddName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Pointer-based drag state
  const [catDrag, setCatDrag] = useState<{
    fromId: string;
    overItemId: string | null;
    overPos: 'before' | 'after';
  } | null>(null);

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

  // ── Pointer-based Drag & Drop ────────────────────────────────────────────────
  const onGripPointerDown = (e: React.PointerEvent<HTMLSpanElement>, id: string) => {
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    e.stopPropagation();
    setCatDrag({ fromId: id, overItemId: null, overPos: 'after' });
  };

  const onGripPointerMove = (e: React.PointerEvent<HTMLSpanElement>) => {
    if (!catDrag) return;
    const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    const liEl = el?.closest('[data-cat-id]') as HTMLElement | null;
    if (liEl?.dataset.catId && liEl.dataset.catId !== catDrag.fromId) {
      const rect = liEl.getBoundingClientRect();
      const pos = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
      setCatDrag(d => d ? { ...d, overItemId: liEl.dataset.catId!, overPos: pos } : d);
    }
  };

  const onGripPointerUp = () => {
    if (catDrag?.overItemId) {
      const ids = categories.map(c => c.id);
      const fromIdx = ids.indexOf(catDrag.fromId);
      const newIds = [...ids];
      newIds.splice(fromIdx, 1);
      const toIdx = newIds.indexOf(catDrag.overItemId);
      const insertAt = catDrag.overPos === 'before' ? toIdx : toIdx + 1;
      newIds.splice(insertAt, 0, catDrag.fromId);
      reorderCategories(newIds);
    }
    setCatDrag(null);
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
            data-cat-id={cat.id}
            className={`${selectedCategoryId === cat.id ? 'active' : ''}${catDrag?.overItemId === cat.id ? ` drag-${catDrag.overPos}` : ''}${noteDropOverCatId === cat.id ? ' note-drop-target' : ''}${draggingNoteId ? ' drop-zone-hint' : ''}`}
            onClick={() => setSelectedCategory(cat.id)}
            onDoubleClick={() => startEdit(cat)}
          >
            <span
              className="cat-grip"
              style={{ touchAction: 'none', cursor: catDrag?.fromId === cat.id ? 'grabbing' : 'grab' }}
              onPointerDown={(e) => onGripPointerDown(e, cat.id)}
              onPointerMove={onGripPointerMove}
              onPointerUp={onGripPointerUp}
              onPointerCancel={() => setCatDrag(null)}
              title="ドラッグで並び替え"
            >⠿</span>
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
