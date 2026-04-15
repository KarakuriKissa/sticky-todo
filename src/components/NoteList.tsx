import { useState, DragEvent } from 'react';
import { useAppStore } from '../store/appStore';
import type { Note } from '../types';

interface Props {
  onNew: () => void;
}

export function NoteList({ onNew }: Props) {
  const { filteredNotes, openNote, deleteNote, duplicateNote, updateNote, categories, reorderNotes } =
    useAppStore();
  const notes = filteredNotes();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [dragPos, setDragPos] = useState<'before' | 'after'>('after');
  const [dragSrcId, setDragSrcId] = useState<string | null>(null);

  const catName = (id: string | null) => {
    if (!id) return '';
    return categories.find((c) => c.id === id)?.name ?? '';
  };

  const startEdit = (note: Note, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(note.id);
    setEditTitle(note.title);
  };

  const commitEdit = (note: Note) => {
    if (editTitle.trim() !== note.title) {
      updateNote({ ...note, title: editTitle.trim() || note.title });
    }
    setEditingId(null);
  };

  // ── Drag & Drop ─────────────────────────────────────────────────────────────
  const onDragStart = (e: DragEvent, note: Note) => {
    if (note.locked) { e.preventDefault(); return; }
    e.dataTransfer.setData('text/plain', note.id);
    e.dataTransfer.effectAllowed = 'move';
    setDragSrcId(note.id);
  };

  const onDragOver = (e: DragEvent, note: Note) => {
    e.preventDefault();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const mid = rect.top + rect.height / 2;
    setDragOverId(note.id);
    setDragPos(e.clientY < mid ? 'before' : 'after');
  };

  const onDrop = (e: DragEvent, toNote: Note) => {
    e.preventDefault();
    const fromId = e.dataTransfer.getData('text/plain');
    setDragOverId(null);
    setDragSrcId(null);
    if (!fromId || fromId === toNote.id) return;
    const ids = notes.map((n) => n.id);
    const fromIdx = ids.indexOf(fromId);
    const toIdx = ids.indexOf(toNote.id);
    if (fromIdx === -1 || toIdx === -1) return;
    const newIds = [...ids];
    newIds.splice(fromIdx, 1);
    const insertAt = dragPos === 'before' ? newIds.indexOf(toNote.id) : newIds.indexOf(toNote.id) + 1;
    newIds.splice(insertAt, 0, fromId);
    reorderNotes(newIds);
  };

  return (
    <div className="note-list">
      {notes.length === 0 && (
        <div className="note-list-empty">
          <p>リストがありません</p>
          <button className="btn-primary" onClick={onNew}>＋ 新規作成</button>
        </div>
      )}
      {notes.map((note) => (
        <div
          key={note.id}
          className={`note-card${dragOverId === note.id ? ` drag-${dragPos}` : ''}${dragSrcId === note.id ? ' dragging' : ''}`}
          style={{ borderLeft: `4px solid ${note.color}` }}
          draggable={!note.locked}
          onDragStart={(e) => onDragStart(e, note)}
          onDragOver={(e) => onDragOver(e, note)}
          onDragLeave={() => setDragOverId(null)}
          onDrop={(e) => onDrop(e, note)}
          onDragEnd={() => { setDragOverId(null); setDragSrcId(null); }}
          onDoubleClick={() => openNote(note)}
        >
          {/* Drag handle */}
          {!note.locked && (
            <span className="note-card-grip" title="ドラッグで並び替え">⠿</span>
          )}
          {note.locked && (
            <span className="note-card-grip locked" title="ロック中">🔒</span>
          )}

          {/* Title */}
          <div className="note-card-body">
            {editingId === note.id ? (
              <input
                className="note-card-title-input"
                autoFocus
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                onBlur={() => commitEdit(note)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitEdit(note);
                  if (e.key === 'Escape') setEditingId(null);
                }}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <div
                className="note-card-title"
                onDoubleClick={(e) => startEdit(note, e)}
                title="ダブルクリックで編集"
              >
                {note.title || '（無題）'}
              </div>
            )}
            <div className="note-card-meta">
              {catName(note.category_id) && (
                <span className="note-card-cat">{catName(note.category_id)}</span>
              )}
              <span className="note-card-date">
                {new Date(note.updated_at).toLocaleDateString('ja-JP')}
              </span>
            </div>
          </div>

          {/* Hover actions */}
          <div className="note-card-actions">
            <button
              className={`btn-icon note-action-btn${note.locked ? ' active' : ''}`}
              title={note.locked ? 'ロック解除' : 'ロック'}
              onClick={(e) => { e.stopPropagation(); updateNote({ ...note, locked: !note.locked }); }}
            >
              {note.locked ? '🔒' : '🔓'}
            </button>
            <button
              className="btn-icon note-action-btn"
              title="複製"
              onClick={(e) => { e.stopPropagation(); duplicateNote(note.id).catch(console.error); }}
            >
              📋
            </button>
            <button
              className="btn-icon note-action-btn danger"
              title="削除"
              onClick={(e) => {
                e.stopPropagation();
                if (confirm(`「${note.title || '（無題）'}」を削除しますか？`)) {
                  deleteNote(note.id);
                }
              }}
            >
              🗑
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
