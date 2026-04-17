import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
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
  const [deleteTarget, setDeleteTarget] = useState<Note | null>(null);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [noteCtx, setNoteCtx] = useState<{ note: Note; x: number; y: number } | null>(null);

  // Pointer-based drag state
  const [noteDrag, setNoteDrag] = useState<{
    fromId: string;
    overItemId: string | null;
    overPos: 'before' | 'after';
  } | null>(null);

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

  // ── Pointer-based Drag & Drop ────────────────────────────────────────────────
  const onGripPointerDown = (e: React.PointerEvent<HTMLSpanElement>, note: Note) => {
    if (note.locked) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    e.stopPropagation();
    setNoteDrag({ fromId: note.id, overItemId: null, overPos: 'after' });
  };

  const onGripPointerMove = (e: React.PointerEvent<HTMLSpanElement>) => {
    if (!noteDrag) return;
    const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    const cardEl = el?.closest('[data-note-id]') as HTMLElement | null;
    if (cardEl?.dataset.noteId && cardEl.dataset.noteId !== noteDrag.fromId) {
      const rect = cardEl.getBoundingClientRect();
      const pos = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
      setNoteDrag(d => d ? { ...d, overItemId: cardEl.dataset.noteId!, overPos: pos } : d);
    }
  };

  const onGripPointerUp = () => {
    if (noteDrag?.overItemId) {
      const ids = notes.map(n => n.id);
      const fromIdx = ids.indexOf(noteDrag.fromId);
      const newIds = [...ids];
      newIds.splice(fromIdx, 1);
      const toIdx = newIds.indexOf(noteDrag.overItemId);
      const insertAt = noteDrag.overPos === 'before' ? toIdx : toIdx + 1;
      newIds.splice(insertAt, 0, noteDrag.fromId);
      reorderNotes(newIds);
    }
    setNoteDrag(null);
  };

  // Click-away handler for context menu
  useEffect(() => {
    if (!noteCtx) return;
    const handler = () => setNoteCtx(null);
    window.addEventListener('click', handler);
    return () => window.removeEventListener('click', handler);
  }, [noteCtx]);

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
          data-note-id={note.id}
          className={`note-card${noteDrag?.overItemId === note.id ? ` drag-${noteDrag.overPos}` : ''}${noteDrag?.fromId === note.id ? ' dragging' : ''}${selectedNoteId === note.id ? ' selected' : ''}`}
          style={{ borderLeft: `4px solid ${note.color}` }}
          onClick={() => setSelectedNoteId(note.id)}
          onDoubleClick={() => openNote(note)}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setNoteCtx({ note, x: e.clientX, y: e.clientY });
          }}
        >
          {/* Drag handle */}
          {!note.locked && (
            <span
              className="note-card-grip"
              style={{ touchAction: 'none', cursor: noteDrag?.fromId === note.id ? 'grabbing' : 'grab' }}
              onPointerDown={(e) => onGripPointerDown(e, note)}
              onPointerMove={onGripPointerMove}
              onPointerUp={onGripPointerUp}
              onPointerCancel={() => setNoteDrag(null)}
              title="ドラッグで並び替え"
            >⠿</span>
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
              onClick={(e) => { e.stopPropagation(); setDeleteTarget(note); }}
            >
              🗑
            </button>
          </div>
        </div>
      ))}

      {deleteTarget && (
        <div className="modal-overlay" onClick={() => setDeleteTarget(null)}>
          <div className="modal confirm-modal" onClick={(e) => e.stopPropagation()}>
            <p>「{deleteTarget.title || '（無題）'}」を削除しますか？</p>
            <div className="modal-actions">
              <button
                className="btn-danger"
                autoFocus
                onClick={() => { deleteNote(deleteTarget.id); setDeleteTarget(null); }}
              >
                削除
              </button>
              <button className="btn-secondary" onClick={() => setDeleteTarget(null)}>
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Note card context menu */}
      {noteCtx && (
        <div
          className="context-menu"
          style={{ position: 'fixed', left: noteCtx.x, top: noteCtx.y, zIndex: 1000 }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="context-menu-item"
            onClick={() => {
              invoke('close_note_window', { noteId: noteCtx.note.id }).catch(() => {});
              setNoteCtx(null);
            }}
          >
            <span className="ctx-icon">✕</span> リストを閉じる
          </button>
          <div className="context-menu-sep" />
          <button
            className="context-menu-item danger"
            onClick={() => {
              setDeleteTarget(noteCtx.note);
              setNoteCtx(null);
            }}
          >
            <span className="ctx-icon">🗑</span> リストの削除
          </button>
        </div>
      )}
    </div>
  );
}
