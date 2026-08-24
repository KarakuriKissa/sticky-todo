// Note window toolbar — buttons for add, indent, group/priority, bulk check,
// archive. Extracted from Note.tsx so the main file focuses on hooks + layout.
import type { AppSettings, AssigneeGroup, ItemType, TodoItem } from '../../types';
import { useNoteStore } from '../../store/noteStore';
import { useT } from '../../i18n';

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
  onInsertLink: () => void;
}

const PRIORITY_VALUES = [
  { value: null as null, key: 'tb.priorityNone' },
  { value: 'high', key: 'tb.priorityHigh' },
  { value: 'medium', key: 'tb.priorityMedium' },
  { value: 'low', key: 'tb.priorityLow' },
] as const;

export function NoteToolbar(p: ToolbarProps) {
  const t = useT();
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
      <button className="type-btn" onClick={() => p.addItem()} title={t('tb.add')}>＋</button>
      <button className="type-btn" onClick={() => p.addTyped('heading')} title={t('tb.heading')}>H</button>
      <button className="type-btn" onClick={() => p.addTyped('separator')} title={t('tb.separator')}>—</button>
      {/* Hyperlink: select text in a task, then click. mousedown (not click) so
          the input keeps its selection before focus moves to the button. */}
      <button className="type-btn link-btn"
        onMouseDown={(e) => { e.preventDefault(); p.onInsertLink(); }}
        title={t('tb.link')}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </svg>
      </button>
      <button className="type-btn"
        onClick={() => { if (selCount > 0) [...p.selectedIds].forEach((id) => useNoteStore.getState().indent(id)); }}
        title={t('tb.indent')}>→</button>
      <button className="type-btn"
        onClick={() => { if (selCount > 0) [...p.selectedIds].forEach((id) => useNoteStore.getState().dedent(id)); }}
        title={t('tb.outdent')}>←</button>

      {p.settings.feature_assignee && p.assigneeGroups.length > 0 && (
        <select className="group-selector"
          value={p.activeGroupId}
          onChange={(e) => p.setActiveGroupId(e.target.value)}
          title={t('tb.group')}
          onClick={(e) => e.stopPropagation()}>
          {p.assigneeGroups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
      )}

      {p.settings.feature_priority && (
        <div style={{ position: 'relative' }}>
          <button
            className={`type-btn${hasNormalSelected ? ' active-feature' : ''}`}
            disabled={!hasNormalSelected}
            title={hasNormalSelected ? t('tb.priorityOn') : t('tb.priorityOff')}
            onClick={(e) => {
              e.stopPropagation();
              if (hasNormalSelected) p.setShowPriorityPicker((o) => !o);
            }}
          >★</button>
          {p.showPriorityPicker && hasNormalSelected && (
            <div className="status-dropdown"
              style={{ top: '100%', left: 0, bottom: 'auto' }}
              onClick={(e) => e.stopPropagation()}>
              {PRIORITY_VALUES.map((opt) => (
                <div key={String(opt.value)} className="status-option"
                  onClick={() => { p.applyToSelected({ priority: opt.value ?? null }); p.setShowPriorityPicker(() => false); }}>
                  {t(opt.key)}
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
          title={p.priorityMode === 'hml' ? t('tb.priorityModeToAbc') : t('tb.priorityModeToHml')}
          style={{ fontSize: 10 }}>
          {p.priorityMode === 'hml' ? t('tb.priorityHml') : 'ABC'}
        </button>
      )}

      {/* Always reserve a fixed-width slot so the rest of the toolbar doesn't
          shift when a selection appears/disappears. */}
      <span className="sel-count">{selCount > 0 ? t('tb.selCount', { n: selCount }) : ''}</span>

      <button className="type-btn"
        onClick={() => useNoteStore.getState().checkSelected(true)}
        title={t('tb.checkSelected')}>☑</button>
      <button className="type-btn"
        onClick={() => useNoteStore.getState().checkSelected(false)}
        title={t('tb.uncheckSelected')}>☐</button>

      <button className="type-btn"
        onClick={p.archiveCheckedAll}
        disabled={p.checkedNonArchived.length === 0}
        title={t('tb.archiveSelected', { n: p.checkedNonArchived.length })}>📥</button>

      <button className={`type-btn${p.showArchived ? ' active-feature' : ''}`}
        onClick={() => p.setShowArchived((v) => !v)}
        title={p.showArchived ? t('tb.showNormal') : t('tb.showArchived', { n: p.archivedCount })}>
        🗄️{p.archivedCount > 0 && <sup style={{ fontSize: 8 }}>{p.archivedCount}</sup>}
      </button>
    </div>
  );
}
