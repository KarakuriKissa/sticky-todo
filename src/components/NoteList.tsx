import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { emitTo } from '@tauri-apps/api/event';
import { useAppStore } from '../store/appStore';
import type { Note, TodoItem } from '../types';
import { log } from '../utils/log';
import { useT, useI18nStore, t } from '../i18n';

// ── リスト エクスポート ───────────────────────────────────────────────────────
async function exportNote(note: Note) {
  const items = await invoke<TodoItem[]>('get_note_items', { noteId: note.id });
  if (items.length === 0) {
    const { confirm } = await import('@tauri-apps/plugin-dialog');
    const proceed = await confirm(
      t('notelist.exportEmptyBody', { title: note.title }),
      { title: t('notelist.exportEmptyTitle'), kind: 'info', okLabel: t('notelist.exportOk'), cancelLabel: t('btn.cancel') },
    );
    if (!proceed) return;
  }
  const { save } = await import('@tauri-apps/plugin-dialog');
  const safe = note.title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 40);
  const path = await save({
    title: t('notelist.exportDialogTitle'),
    defaultPath: `${safe}-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (!path) return;
  await invoke('write_text_file', { path, content: JSON.stringify({ version: 1, note, items }, null, 2) });
  alert(t('notelist.exportedAlert', { n: items.length }));
}

// ── リストをテキスト(.txt)でエクスポート ──────────────────────────────────────
// ファイル名 = リスト名、内容は見た目で構造が分かる整形テキスト。
async function exportNoteAsText(note: Note) {
  const items = await invoke<TodoItem[]>('get_note_items', { noteId: note.id });
  const sorted = [...items].sort((a, b) => a.sort_order - b.sort_order);
  const lines: string[] = [`# ${note.title}`, ''];
  for (const it of sorted) {
    const indent = '    '.repeat(Math.max(0, it.indent));
    if (it.item_type === 'separator') {
      lines.push(`${indent}----------------------------------------`);
    } else if (it.item_type === 'heading') {
      lines.push(`${indent}■ ${it.text}`);
    } else {
      const box = it.checked ? '[x]' : '[ ]';
      let line = `${indent}${box} ${it.text}`;
      if (it.memo) line += `   ※ ${it.memo.replace(/\r?\n/g, ' ')}`;
      lines.push(line);
    }
  }
  const { save } = await import('@tauri-apps/plugin-dialog');
  const safe = note.title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 60) || 'todo';
  const path = await save({
    title: t('notelist.exportTextDialogTitle'),
    defaultPath: `${safe}.txt`,
    filters: [{ name: t('notelist.textFilterName'), extensions: ['txt'] }],
  });
  if (!path) return;
  await invoke('write_text_file', { path, content: lines.join('\r\n') });
  alert(t('notelist.exportedTextAlert'));
}

// ── リスト インポート ─────────────────────────────────────────────────────────
async function importNote(
  existingNotes: Note[],
  createNote: (title?: string) => Promise<Note>,
  updateNote: (n: Note) => void,
) {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const path = await open({ title: t('notelist.importDialogTitle'), filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (!path || typeof path !== 'string') return;
  const text = await invoke<string>('read_text_file', { path });
  let data: any;
  try { data = JSON.parse(text); } catch { alert(t('status.jsonParseError')); return; }
  if (!data?.note || !Array.isArray(data?.items) || typeof data.note.title !== 'string') {
    alert(t('status.invalidFormat'));
    return;
  }
  const srcNote: Note = data.note;
  const srcItems: TodoItem[] = data.items;

  // 同名リストの確認
  const sameName = existingNotes.filter(n => n.title === srcNote.title);
  let title = srcNote.title;
  if (sameName.length > 0) {
    const { confirm } = await import('@tauri-apps/plugin-dialog');
    const overwrite = await confirm(
      t('notelist.importDupBody', { title: srcNote.title, n: sameName.length }),
      { title: t('notelist.importDupTitle'), kind: 'warning', okLabel: t('notelist.importDupOk'), cancelLabel: t('btn.cancel') },
    );
    if (!overwrite) return;
    title = t('notelist.copyTitle', { title: srcNote.title });
  }

  // 新規リストとして作成（新IDを発行）
  const newNote = await createNote(title);
  updateNote({
    ...newNote,
    color: typeof srcNote.color === 'string' ? srcNote.color : newNote.color,
    warn_days: typeof srcNote.warn_days === 'number' ? srcNote.warn_days : null,
  });
  // Flag the new list so the launcher shows a "NEW" badge on it.
  try {
    const existing = JSON.parse(localStorage.getItem('sticky-todo:new-notes') || '[]');
    localStorage.setItem('sticky-todo:new-notes', JSON.stringify([...existing, newNote.id]));
    window.dispatchEvent(new CustomEvent('sticky-new-note', { detail: newNote.id }));
  } catch { /* ignore */ }

  // アイテムを新しいnote_idで保存（必須フィールドの欠落に備えてデフォルトを埋める）
  if (srcItems.length > 0) {
    const nowIso = new Date().toISOString();
    const newItems: TodoItem[] = srcItems.map((item, idx) => ({
      id: crypto.randomUUID(),
      note_id: newNote.id,
      parent_id: null, // 親子参照は古いIDなのでリセット
      text: typeof item?.text === 'string' ? item.text : '',
      checked: !!item?.checked,
      indent: typeof item?.indent === 'number' ? item.indent : 0,
      collapsed: !!item?.collapsed,
      locked: !!item?.locked,
      status: typeof item?.status === 'string' ? item.status : null,
      assignees: typeof item?.assignees === 'string' ? item.assignees : '[]',
      assignee_person_id: typeof item?.assignee_person_id === 'string' ? item.assignee_person_id : null,
      memo: typeof item?.memo === 'string' ? item.memo : null,
      bold: !!item?.bold,
      priority: typeof item?.priority === 'string' ? item.priority : null,
      start_date: typeof item?.start_date === 'string' ? item.start_date : null,
      end_date: typeof item?.end_date === 'string' ? item.end_date : null,
      limit_date: typeof item?.limit_date === 'string' ? item.limit_date : null,
      item_type: (item?.item_type === 'heading' || item?.item_type === 'separator') ? item.item_type : 'normal',
      sort_order: typeof item?.sort_order === 'number' ? item.sort_order : idx,
      archived: !!item?.archived,
      strikethrough: !!item?.strikethrough,
      updated_at: nowIso,
      dirty: true,
    }));
    await invoke('save_items', { items: newItems });
    // Flag these items so the note window shows a temporary "NEW" badge
    // instead of a blocking alert popup.
    try {
      localStorage.setItem('sticky-todo:new-items', JSON.stringify(newItems.map((i) => i.id)));
    } catch { /* ignore */ }
  }
  // No alert — the new list simply appears in the launcher list.
}


interface Props {
  onNew: () => void;
}

export function NoteList({ onNew }: Props) {
  const t = useT();
  const lang = useI18nStore((s) => s.lang);
  const { notes: allNotes, filteredNotes, openNote, deleteNote, duplicateNote, updateNote, createNote, categories, reorderNotes, itemMatches, searchQuery } =
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
  // Note IDs that were just imported — show a temporary "NEW" badge, auto-clear.
  const [newNoteIds, setNewNoteIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    const pickUp = () => {
      try {
        const ids: string[] = JSON.parse(localStorage.getItem('sticky-todo:new-notes') || '[]');
        if (ids.length > 0) {
          setNewNoteIds(new Set(ids));
          // Clear the badges after a few seconds.
          setTimeout(() => {
            setNewNoteIds(new Set());
            localStorage.removeItem('sticky-todo:new-notes');
          }, 6000);
        }
      } catch { /* ignore */ }
    };
    pickUp();
    window.addEventListener('sticky-new-note', pickUp);
    return () => window.removeEventListener('sticky-new-note', pickUp);
  }, []);

  // Pointer-based drag state
  const [noteDrag, setNoteDrag] = useState<{
    fromId: string;
    overItemId: string | null;
    overPos: 'before' | 'after';
  } | null>(null);

  // Returns the category name, or null for "no category" (rendered separately).
  const catInfo = (id: string | null): { name: string; noCat: boolean } => {
    if (!id) return { name: t('notelist.noCategory'), noCat: true };
    return { name: categories.find((c) => c.id === id)?.name ?? '', noCat: false };
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
          <p>{t('notelist.emptyTitle')}</p>
          <button className="btn-primary" onClick={onNew}>{t('notelist.newBtn')}</button>
          <button className="btn-secondary" style={{ marginTop: 8, fontSize: 12 }}
            onClick={() => importNote(allNotes, createNote, updateNote)}>{t('notelist.importBtn')}</button>
        </div>
      )}
      {notes.length > 0 && (
        <div style={{ padding: '4px 8px 0', display: 'flex', justifyContent: 'flex-end' }}>
          <button className="btn-secondary" style={{ fontSize: 11, padding: '2px 8px', opacity: 0.7 }}
            onClick={() => importNote(allNotes, createNote, updateNote)}
            title={t('notelist.importBtnTitle')}>{t('notelist.importBtn')}</button>
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
              title={t('item.dragHandle')}
            >⠿</span>
          )}
          {note.locked && (
            <span className="note-card-grip locked" title={t('notelist.lockedTitle')}>🔒</span>
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
                title={t('notelist.dblClickEditTitle')}
              >
                {note.title || t('notelist.untitled')}
                {newNoteIds.has(note.id) && <span className="new-item-badge" style={{ marginLeft: 6 }}>NEW</span>}
              </div>
            )}
            <div className="note-card-meta">
              {(() => {
                const { name, noCat } = catInfo(note.category_id);
                return name ? (
                  <span
                    className="note-card-cat"
                    style={noCat ? { color: '#9ca3af', borderColor: '#9ca3af', opacity: 0.8 } : {}}
                  >{name}</span>
                ) : null;
              })()}
              <span className="note-card-date">
                {new Date(note.updated_at).toLocaleDateString(lang === 'en' ? 'en-US' : 'ja-JP')}
              </span>
            </div>
            {/* Global-search match hint: shows the matching task text inside this note */}
            {matchHintByNote.has(note.id) && (
              <div className="note-card-match-hint" title={t('notelist.matchHintTitle')}>
                🔍 {matchHintByNote.get(note.id)?.slice(0, 60)}
                {(matchHintByNote.get(note.id)?.length ?? 0) > 60 ? '…' : ''}
              </div>
            )}
          </div>

          {/* Hover actions */}
          <div className="note-card-actions">
            <button
              className={`btn-icon note-action-btn${note.locked ? ' active' : ''}`}
              title={note.locked ? t('ctx.unlock') : t('ctx.lock')}
              onClick={(e) => { e.stopPropagation(); updateNote({ ...note, locked: !note.locked }); }}
            >
              {note.locked ? '🔒' : '🔓'}
            </button>
            <button
              className="btn-icon note-action-btn"
              title={t('ctx.duplicate')}
              onClick={(e) => { e.stopPropagation(); duplicateNote(note.id).catch(log.error); }}
            >
              📋
            </button>
            <button
              className="btn-icon note-action-btn danger"
              title={t('ctx.delete')}
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
            <p>{t('notelist.deleteConfirm', { title: deleteTarget.title || t('notelist.untitled') })}</p>
            <div className="modal-actions">
              <button
                className="btn-danger"
                autoFocus
                onClick={() => { deleteNote(deleteTarget.id); setDeleteTarget(null); }}
              >
                {t('ctx.delete')}
              </button>
              <button className="btn-secondary" onClick={() => setDeleteTarget(null)}>
                {t('btn.cancel')}
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
            <span className="ctx-label">{t('notelist.ctxCloseList')}</span>
          </button>
          <div className="context-menu-sep" />
          <div style={{ padding: '4px 12px 2px', fontSize: 10, color: 'var(--muted)' }}>{t('notelist.ctxChangeCategory')}</div>
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
            className="context-menu-item"
            onClick={() => { exportNote(noteCtx.note); setNoteCtx(null); }}
          >
            <span className="ctx-icon">📤</span>
            <span className="ctx-label">{t('notelist.ctxExportJson')}</span>
          </button>
          <button
            className="context-menu-item"
            onClick={() => { exportNoteAsText(noteCtx.note); setNoteCtx(null); }}
          >
            <span className="ctx-icon">📝</span>
            <span className="ctx-label">{t('notelist.ctxExportText')}</span>
          </button>
          <div className="context-menu-sep" />
          <button
            className="context-menu-item danger"
            onClick={() => {
              setDeleteTarget(noteCtx.note);
              setNoteCtx(null);
            }}
          >
            <span className="ctx-icon">🗑</span>
            <span className="ctx-label">{t('notelist.ctxDeleteList')}</span>
          </button>
        </div>
      )}
    </div>
  );
}
