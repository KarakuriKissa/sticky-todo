import { useState, useEffect } from 'react';
import { emitTo } from '@tauri-apps/api/event';
import { useAppStore } from '../store/appStore';
import type { Note } from '../types';


interface Props {
  onNew: () => void;
}

export function NoteList({ onNew }: Props) {
  const { filteredNotes, openNote, deleteNote, duplicateNote, updateNote, categories, reorderNotes, itemMatches, searchQuery } =
    useAppStore();
  const notes = filteredNotes();
  // Map note_id → first matching task text (for the global-search hint badge).
  const matchHintByNote = new Map<string, string>();
  if (searchQuery.trim()) {
    for (const m of itemMatches) {
      if (!matchHintByNote.has(m.item.note_id)) {
        matchHintByNote.set(m.item.note_id, m.item.text);
      }
    }
  }
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
    // Tell CategoryList "a note is being dragged" so it can highlight as a drop zone.
    useAppStore.setState({ draggingNoteId: note.id, noteDropOverCatId: null });
  };

  const onGripPointerMove = (e: React.PointerEvent<HTMLSpanElement>) => {
    if (!noteDrag) return;
    const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;

    // 1) Hovering over a category in the sidebar → mark it as the drop target.
    const catEl = el?.closest('[data-cat-id]') as HTMLElement | null;
    if (catEl?.dataset.catId) {
      useAppStore.setState({ noteDropOverCatId: catEl.dataset.catId });
      setNoteDrag((d) => d ? { ...d, overItemId: null } : d);
      return;
    }
    if (useAppStore.getState().noteDropOverCatId) {
      useAppStore.setState({ noteDropOverCatId: null });
    }

    // 2) Otherwise, in-list reorder.
    const cardEl = el?.closest('[data-note-id]') as HTMLElement | null;
    if (cardEl?.dataset.noteId && cardEl.dataset.noteId !== noteDrag.fromId) {
      const rect = cardEl.getBoundingClientRect();
      const pos = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
      setNoteDrag(d => d ? { ...d, overItemId: cardEl.dataset.noteId!, overPos: pos } : d);
    }
  };

  const onGripPointerUp = () => {
    const { noteDropOverCatId } = useAppStore.getState();
    // Priority 1: dropped on a category → change category.
    if (noteDropOverCatId && noteDrag) {
      const dragged = notes.find((n) => n.id === noteDrag.fromId);
      if (dragged && dragged.category_id !== noteDropOverCatId) {
        updateNote({ ...dragged, category_id: noteDropOverCatId });
      }
    }
    // Priority 2: dropped on another note → reorder.
    else if (noteDrag?.overItemId) {
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
    useAppStore.setState({ draggingNoteId: null, noteDropOverCatId: null });
  };

  // Click-away handler for context menu
  useEffect(() => {
    if (!noteCtx) return;
    const handler = () => setNoteCtx(null);
    window.addEventListener('click', handler);
    return () => window.removeEventListener('click', handler);
  }, [noteCtx]);

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((document.activeElement as HTMLElement)?.tagName === 'INPUT') return;
      if (!selectedNoteId && e.key !== 'ArrowDown') return;

      const idx = notes.findIndex(n => n.id === selectedNoteId);

      if (e.key === 'ArrowUp' && idx > 0) {
        e.preventDefault();
        setSelectedNoteId(notes[idx - 1].id);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (idx === -1) {
          if (notes.length > 0) setSelectedNoteId(notes[0].id);
        } else if (idx < notes.length - 1) {
          setSelectedNoteId(notes[idx + 1].id);
        }
      } else if (e.key === 'Enter' && !e.shiftKey && selectedNoteId) {
        e.preventDefault();
        const note = notes.find(n => n.id === selectedNoteId);
        if (note) openNote(note);
      } else if (e.key === 'Enter' && e.shiftKey && selectedNoteId) {
        e.preventDefault();
        const note = notes.find(n => n.id === selectedNoteId);
        if (note) {
          setEditingId(note.id);
          setEditTitle(note.title);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedNoteId, notes, openNote]);

  // Auto-scroll selected card into view
  useEffect(() => {
    if (!selectedNoteId) return;
    const el = document.querySelector(`[data-note-id="${selectedNoteId}"]`) as HTMLElement | null;
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedNoteId]);

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
            {/* Global-search match hint: shows the matching task text inside this note */}
            {matchHintByNote.has(note.id) && (
              <div className="note-card-match-hint" title="検索一致タスク">
                🔍 {matchHintByNote.get(note.id)?.slice(0, 60)}
                {(matchHintByNote.get(note.id)?.length ?? 0) > 60 ? '…' : ''}
              </div>
            )}
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
          style={{ position: 'fixed', left: noteCtx.x, top: noteCtx.y, zIndex: 1000, minWidth: 220 }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="context-menu-item"
            onClick={() => {
              emitTo(`note-${noteCtx.note.id}`, 'request-close', {}).catch(() => {});
              setNoteCtx(null);
            }}
          >
            <span className="ctx-icon">✕</span>
            <span className="ctx-label">リストを閉じる</span>
          </button>
          <div className="context-menu-sep" />
          <div style={{ padding: '4px 12px 2px', fontSize: 10, color: 'var(--muted)' }}>カテゴリを変更</div>
          {categories.map((c) => (
            <button
              key={c.id}
              className="context-menu-item"
              onClick={() => {
                updateNote({ ...noteCtx.note, category_id: c.id });
                setNoteCtx(null);
              }}
            >
              <span className="ctx-icon" style={{ color: c.color }}>●</span>
              <span className="ctx-label">{c.name}{noteCtx.note.category_id === c.id ? ' ✓' : ''}</span>
            </button>
          ))}
          <div className="context-menu-sep" />
          <button
            className="context-menu-item danger"
            onClick={() => {
              setDeleteTarget(noteCtx.note);
              setNoteCtx(null);
            }}
          >
            <span className="ctx-icon">🗑</span>
            <span className="ctx-label">リストの削除</span>
          </button>
        </div>
      )}
    </div>
  );
}
