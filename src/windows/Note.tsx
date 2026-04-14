import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { TodoItemRow } from '../components/TodoItem';
import { useNoteStore } from '../store/noteStore';
import { useAppStore } from '../store/appStore';
import type { ItemType, Note, TodoItem } from '../types';

interface Props {
  noteId: string;
}

const NOTE_COLORS = [
  '#fef08a', '#bbf7d0', '#bfdbfe', '#fecaca',
  '#e9d5ff', '#fed7aa', '#f9fafb', '#fce7f3',
];

export function NoteWindow({ noteId }: Props) {
  const { load, items, note, setNote, addItem, updateItem, flush, undo, redo } = useNoteStore();
  const { notes, updateNote, settings, statuses } = useAppStore();
  const [alwaysOnTop, setAlwaysOnTop] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const appWin = getCurrentWindow();

  // Load note + items
  useEffect(() => {
    const found = notes.find((n) => n.id === noteId);
    if (found) {
      setNote(found);
      setAlwaysOnTop(found.always_on_top);
    } else {
      // Fetch from backend if note not in store
      invoke<Note[]>('get_all_notes').then((all) => {
        const n = all.find((x) => x.id === noteId);
        if (n) { setNote(n); setAlwaysOnTop(n.always_on_top); }
      });
    }
    load(noteId);
  }, [noteId]);

  // Save window position/size on close
  useEffect(() => {
    const unlisten = appWin.onCloseRequested(async () => {
      await flush();
      if (note) {
        const pos = await appWin.outerPosition();
        const size = await appWin.outerSize();
        const scale = await appWin.scaleFactor();
        updateNote({
          ...note,
          window_x: pos.x / scale,
          window_y: pos.y / scale,
          window_width: size.width / scale,
          window_height: size.height / scale,
        });
      }
    });
    return () => { unlisten.then((f) => f()); };
  }, [note]);

  // Keyboard: Ctrl+Z/Y global for this window
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) { e.preventDefault(); redo(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const togglePin = async () => {
    const next = !alwaysOnTop;
    setAlwaysOnTop(next);
    await invoke('set_always_on_top', { noteId, onTop: next });
    if (note) updateNote({ ...note, always_on_top: next });
  };

  const setColor = (color: string) => {
    if (!note) return;
    updateNote({ ...note, color });
    setShowColorPicker(false);
  };

  const close = async () => {
    await flush();
    await invoke('close_note_window', { noteId });
  };

  // Build visible item list (collapse children)
  const collapsedIds = new Set(items.filter((i) => i.collapsed).map((i) => i.id));

  const isHidden = (item: TodoItem): boolean => {
    if (!item.parent_id) return false;
    if (collapsedIds.has(item.parent_id)) return true;
    const parent = items.find((i) => i.id === item.parent_id);
    return parent ? isHidden(parent) : false;
  };

  const visibleItems = items.filter((i) => !isHidden(i));

  const noteColor = note?.color ?? '#fef08a';
  const titleText = note?.title ?? '';

  // Type selector for new item
  const addTyped = (type: ItemType) => {
    const id = addItem(undefined, 0);
    useNoteStore.getState().updateItem(id, { item_type: type });
  };

  return (
    <div className="note-window" style={{ background: noteColor }} data-tauri-drag-region="">
      {/* ── Title bar ── */}
      <div className="note-titlebar" data-tauri-drag-region="">
        <input
          ref={titleRef}
          className="note-title-input"
          value={titleText}
          placeholder="タイトル"
          onChange={(e) => note && updateNote({ ...note, title: e.target.value })}
          onClick={(e) => e.stopPropagation()}
          data-tauri-drag-region=""
        />
        <div className="note-titlebar-actions">
          <button
            className={`btn-icon${alwaysOnTop ? ' active' : ''}`}
            onClick={togglePin}
            title="最前面固定"
          >📌</button>
          <div style={{ position: 'relative' }}>
            <button className="btn-icon" onClick={() => setShowColorPicker((o) => !o)} title="色">🎨</button>
            {showColorPicker && (
              <div className="color-picker" onClick={(e) => e.stopPropagation()}>
                {NOTE_COLORS.map((c) => (
                  <div
                    key={c}
                    className={`color-swatch${noteColor === c ? ' selected' : ''}`}
                    style={{ background: c }}
                    onClick={() => setColor(c)}
                  />
                ))}
              </div>
            )}
          </div>
          <button className="btn-icon" onClick={close} title="閉じる">✕</button>
        </div>
      </div>

      {/* ── Item type toolbar ── */}
      <div className="note-type-bar">
        <button className="type-btn" onClick={() => addItem()} title="通常項目">＋ 項目</button>
        <button className="type-btn" onClick={() => addTyped('heading')} title="見出し">H</button>
        <button className="type-btn" onClick={() => addTyped('separator')} title="セパレータ">—</button>
        <div className="type-bar-spacer" />
        <button className="type-btn" onClick={() => useNoteStore.getState().checkAll(true)} title="全チェック">☑ 全</button>
        <button className="type-btn" onClick={() => useNoteStore.getState().checkAll(false)} title="全解除">☐ 全</button>
      </div>

      {/* ── Item list ── */}
      <div className="note-items">
        {visibleItems.length === 0 && (
          <div
            className="note-items-empty"
            onClick={() => addItem()}
          >
            クリックして追加…
          </div>
        )}
        {visibleItems.map((item) => (
          <TodoItemRow
            key={item.id}
            item={item}
            visibleItems={visibleItems}
            allItems={items}
          />
        ))}
      </div>
    </div>
  );
}
