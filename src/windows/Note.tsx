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

const PRIORITY_OPTIONS = [
  { value: null,     label: '（なし）' },
  { value: 'high',   label: '高' },
  { value: 'medium', label: '中' },
  { value: 'low',    label: '低' },
];

export function NoteWindow({ noteId }: Props) {
  const {
    load, items, note, setNote, addItem, flush, undo, redo,
    selectAll, clearSelection, selectedIds,
  } = useNoteStore();
  const { notes, updateNote, statuses, assigneeGroups, assigneePersons, settings } = useAppStore();
  const [alwaysOnTop, setAlwaysOnTop] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showStatusPicker, setShowStatusPicker] = useState(false);
  const [showAssigneePicker, setShowAssigneePicker] = useState(false);
  const [showPriorityPicker, setShowPriorityPicker] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const appWin = getCurrentWindow();

  // Load note + items
  useEffect(() => {
    const found = notes.find((n) => n.id === noteId);
    if (found) {
      setNote(found);
      setAlwaysOnTop(found.always_on_top);
    } else {
      invoke<Note[]>('get_all_notes').then((all) => {
        const n = all.find((x) => x.id === noteId);
        if (n) { setNote(n); setAlwaysOnTop(n.always_on_top); }
      });
    }
    load(noteId);
  }, [noteId]);

  // Keep note in sync with appStore changes (e.g. title edits from launcher)
  useEffect(() => {
    const found = notes.find((n) => n.id === noteId);
    if (found && note && found.updated_at !== note.updated_at) {
      setNote(found);
    }
  }, [notes]);

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

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) { e.preventDefault(); redo(); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') { e.preventDefault(); selectAll(); }
      if (e.key === 'Escape') { clearSelection(); setShowColorPicker(false); setShowStatusPicker(false); setShowAssigneePicker(false); setShowPriorityPicker(false); }
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
    const updated = { ...note, color };
    updateNote(updated);
    setNote(updated);  // update local state immediately
    setShowColorPicker(false);
  };

  const close = async () => {
    await flush();
    await invoke('close_note_window', { noteId });
  };

  const handleTitleChange = (title: string) => {
    if (!note) return;
    const updated = { ...note, title };
    updateNote(updated);
    setNote(updated);
  };

  // Assign to selected items
  const applyToSelected = (patch: Partial<TodoItem>) => {
    const store = useNoteStore.getState();
    if (store.selectedIds.size > 0) {
      store.selectedIds.forEach((id) => store.updateItem(id, patch));
    }
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

  // Active assignee group
  const activeGroup = settings.active_group_id
    ? assigneeGroups.find((g) => g.id === settings.active_group_id)
    : assigneeGroups[0];

  const groupPersons = activeGroup
    ? assigneePersons.filter((p) => p.group_id === activeGroup.id)
    : [];

  const selCount = selectedIds.size;

  return (
    <div
      className="note-window"
      style={{ background: noteColor }}
      data-tauri-drag-region=""
      onClick={() => {
        setShowColorPicker(false);
        setShowStatusPicker(false);
        setShowAssigneePicker(false);
        setShowPriorityPicker(false);
      }}
    >
      {/* ── Title bar ── */}
      <div className="note-titlebar" data-tauri-drag-region="">
        <input
          ref={titleRef}
          className="note-title-input"
          value={titleText}
          placeholder="タイトル"
          onChange={(e) => handleTitleChange(e.target.value)}
          onClick={(e) => e.stopPropagation()}
        />
        <div className="note-titlebar-actions">
          <button
            className={`btn-icon${alwaysOnTop ? ' active' : ''}`}
            onClick={togglePin}
            title="最前面固定"
          >📌</button>
          <div style={{ position: 'relative' }}>
            <button
              className="btn-icon"
              onClick={(e) => { e.stopPropagation(); setShowColorPicker((o) => !o); }}
              title="色"
              style={{ background: noteColor, border: '1px solid rgba(0,0,0,.2)', borderRadius: 4, width: 20, height: 20 }}
            />
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

      {/* ── Toolbar ── */}
      <div className="note-type-bar">
        <button className="type-btn" onClick={() => addItem()} title="項目を追加 (Shift+Enter)">＋</button>
        <button className="type-btn" onClick={() => addTyped('heading')} title="見出し">H</button>
        <button className="type-btn" onClick={() => addTyped('separator')} title="区切り線">—</button>
        <button
          className="type-btn"
          onClick={() => {
            const store = useNoteStore.getState();
            if (store.selectedIds.size > 0) {
              store.selectedIds.forEach((id) => store.indent(id));
            }
          }}
          title="インデント (Tab)"
        >→</button>
        <button
          className="type-btn"
          onClick={() => {
            const store = useNoteStore.getState();
            if (store.selectedIds.size > 0) {
              store.selectedIds.forEach((id) => store.dedent(id));
            }
          }}
          title="アウトデント (Shift+Tab)"
        >←</button>

        {/* Status picker for selection */}
        {settings.feature_status && selCount > 0 && (
          <div style={{ position: 'relative' }}>
            <button
              className="type-btn"
              onClick={(e) => { e.stopPropagation(); setShowStatusPicker((o) => !o); }}
              title="選択項目のステータス"
            >
              ● ST
            </button>
            {showStatusPicker && (
              <div className="status-dropdown" style={{ top: '100%', left: 0, bottom: 'auto' }} onClick={(e) => e.stopPropagation()}>
                <div className="status-option" onClick={() => { applyToSelected({ status: null }); setShowStatusPicker(false); }}>（なし）</div>
                {statuses.map((s) => (
                  <div
                    key={s.id}
                    className="status-option"
                    style={{ borderLeft: `3px solid ${s.color}` }}
                    onClick={() => { applyToSelected({ status: s.id }); setShowStatusPicker(false); }}
                  >
                    {s.name}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Assignee picker for selection */}
        {settings.feature_assignee && selCount > 0 && groupPersons.length > 0 && (
          <div style={{ position: 'relative' }}>
            <button
              className="type-btn"
              onClick={(e) => { e.stopPropagation(); setShowAssigneePicker((o) => !o); }}
              title="担当者を割り当て"
            >
              👤
            </button>
            {showAssigneePicker && (
              <div className="status-dropdown" style={{ top: '100%', left: 0, bottom: 'auto' }} onClick={(e) => e.stopPropagation()}>
                <div className="status-option" onClick={() => { applyToSelected({ assignee_person_id: null }); setShowAssigneePicker(false); }}>（なし）</div>
                {groupPersons.map((p) => (
                  <div
                    key={p.id}
                    className="status-option"
                    style={{ borderLeft: `3px solid ${p.color}` }}
                    onClick={() => { applyToSelected({ assignee_person_id: p.id }); setShowAssigneePicker(false); }}
                  >
                    {p.name}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Priority picker for selection */}
        {settings.feature_priority && selCount > 0 && (
          <div style={{ position: 'relative' }}>
            <button
              className="type-btn"
              onClick={(e) => { e.stopPropagation(); setShowPriorityPicker((o) => !o); }}
              title="優先度"
            >
              ★
            </button>
            {showPriorityPicker && (
              <div className="status-dropdown" style={{ top: '100%', left: 0, bottom: 'auto' }} onClick={(e) => e.stopPropagation()}>
                {PRIORITY_OPTIONS.map((p) => (
                  <div
                    key={String(p.value)}
                    className="status-option"
                    onClick={() => { applyToSelected({ priority: p.value }); setShowPriorityPicker(false); }}
                  >
                    {p.label}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="type-bar-spacer" />

        {selCount > 0 && (
          <span className="sel-count">{selCount}件選択</span>
        )}
        <button
          className="type-btn"
          onClick={() => useNoteStore.getState().checkAll(true)}
          title="全チェック"
        >☑ 全</button>
        <button
          className="type-btn"
          onClick={() => useNoteStore.getState().checkAll(false)}
          title="全解除"
        >☐ 全</button>
      </div>

      {/* ── Item list ── */}
      <div className="note-items" onClick={() => clearSelection()}>
        {visibleItems.length === 0 && (
          <div
            className="note-items-empty"
            onClick={(e) => { e.stopPropagation(); addItem(); }}
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
