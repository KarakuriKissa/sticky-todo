// Note window toolbar — buttons for add, indent, group/priority, bulk check,
// archive. Extracted from Note.tsx so the main file focuses on hooks + layout.
import type { AppSettings, AssigneeGroup, ItemType, TodoItem } from '../../types';
import { useNoteStore } from '../../store/noteStore';

export interface ToolbarProps {
  settings: AppSettings;
  assigneeGroups: AssigneeGroup[];
  activeGroupId: string;
  setActiveGroupId: (id: string) => void;
  selectedIds: Set<string>;
  showPriorityPicker: boolean;
  setShowPriorityPicker: (fn: (o: boolean) => boolean) => void;
  applyToSelected: (patch: Partial<TodoItem>) => void;
  priorityMode: 'hml' | 'abc';
  setPriorityMode: (fn: (m: 'hml' | 'abc') => 'hml' | 'abc') => void;
  archiveCheckedAll: () => void;
  checkedNonArchived: TodoItem[];
  showArchived: boolean;
  setShowArchived: (fn: (v: boolean) => boolean) => void;
  archivedCount: number;
  addItem: (afterId?: string, indent?: number, position?: 'before' | 'after') => string;
  addTyped: (t: ItemType) => void;
}

const PRIORITY_OPTIONS = [
  { value: null, label: '（なし）' },
  { value: 'high', label: '高' },
  { value: 'medium', label: '中' },
  { value: 'low', label: '低' },
] as const;

export function NoteToolbar(p: ToolbarProps) {
  const selCount = p.selectedIds.size;
  // Priority can only be applied to normal tasks — headings/separators have none.
  // The ★ button stays visible at all times (so the toolbar layout never jumps)
  // but is disabled unless at least one selected item is a normal task.
  const items = useNoteStore.getState().items;
  const hasNormalSelected = [...p.selectedIds].some((id) => {
    const it = items.find((i) => i.id === id);
    return it && (it.item_type ?? 'normal') === 'normal';
  });
  return (
    <div className="note-type-bar">
      <button className="type-btn" onClick={() => p.addItem()} title="項目追加">＋</button>
      <button className="type-btn" onClick={() => p.addTyped('heading')} title="見出し">H</button>
      <button className="type-btn" onClick={() => p.addTyped('separator')} title="区切り線">—</button>
      <button className="type-btn"
        onClick={() => { if (selCount > 0) [...p.selectedIds].forEach((id) => useNoteStore.getState().indent(id)); }}
        title="インデント (Tab)">→</button>
      <button className="type-btn"
        onClick={() => { if (selCount > 0) [...p.selectedIds].forEach((id) => useNoteStore.getState().dedent(id)); }}
        title="アウトデント (Shift+Tab)">←</button>

      {p.settings.feature_assignee && p.assigneeGroups.length > 0 && (
        <select className="group-selector"
          value={p.activeGroupId}
          onChange={(e) => p.setActiveGroupId(e.target.value)}
          title="担当者グループ"
          onClick={(e) => e.stopPropagation()}>
          {p.assigneeGroups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
      )}

      {p.settings.feature_priority && (
        <div style={{ position: 'relative' }}>
          <button
            className={`type-btn${hasNormalSelected ? ' active-feature' : ''}`}
            disabled={!hasNormalSelected}
            title={hasNormalSelected ? '選択タスクの優先度を設定' : 'タスクを選択すると優先度を設定できます'}
            onClick={(e) => {
              e.stopPropagation();
              if (hasNormalSelected) p.setShowPriorityPicker((o) => !o);
            }}
          >★</button>
          {p.showPriorityPicker && hasNormalSelected && (
            <div className="status-dropdown"
              style={{ top: '100%', left: 0, bottom: 'auto' }}
              onClick={(e) => e.stopPropagation()}>
              {PRIORITY_OPTIONS.map((opt) => (
                <div key={String(opt.value)} className="status-option"
                  onClick={() => { p.applyToSelected({ priority: opt.value ?? null }); p.setShowPriorityPicker(() => false); }}>
                  {opt.label}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="type-bar-spacer" />

      {p.settings.feature_priority && (
        <button className="type-btn"
          onClick={() => p.setPriorityMode((m) => m === 'hml' ? 'abc' : 'hml')}
          title={p.priorityMode === 'hml' ? 'ABC表記に切替' : '高中低表記に切替'}
          style={{ fontSize: 10 }}>
          {p.priorityMode === 'hml' ? '高中低' : 'ABC'}
        </button>
      )}

      {selCount > 0 && <span className="sel-count">{selCount}件</span>}

      <button className="type-btn"
        onClick={() => useNoteStore.getState().checkSelected(true)}
        title="選択をチェック">☑</button>
      <button className="type-btn"
        onClick={() => useNoteStore.getState().checkSelected(false)}
        title="選択のチェックを外す">☐</button>

      <button className="type-btn"
        onClick={p.archiveCheckedAll}
        disabled={p.checkedNonArchived.length === 0}
        title={`チェック済を一括アーカイブ (${p.checkedNonArchived.length}件)`}>📥</button>

      <button className={`type-btn${p.showArchived ? ' active-feature' : ''}`}
        onClick={() => p.setShowArchived((v) => !v)}
        title={p.showArchived ? '通常表示に戻る' : `アーカイブを表示 (${p.archivedCount}件)`}>
        🗄️{p.archivedCount > 0 && <sup style={{ fontSize: 8 }}>{p.archivedCount}</sup>}
      </button>
    </div>
  );
}
