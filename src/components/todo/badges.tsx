import { useRef, useState } from 'react';
import type { Status } from '../../types';
import { FloatingDropdown } from './FloatingDropdown';

// Status badge — colored pill that opens a status picker on mousedown.
export function StatusBadge({
  status,
  allStatuses,
  onSelect,
}: {
  status: Status;
  allStatuses: Status[];
  onSelect: (id: string) => void;
}) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const btnRef = useRef<HTMLSpanElement>(null);

  return (
    <span
      ref={btnRef}
      className="status-badge"
      style={{ background: status.color }}
      onMouseDown={(e) => {
        e.stopPropagation();
        setAnchor((a) => a ? null : btnRef.current?.getBoundingClientRect() ?? null);
      }}
    >
      {status.name}
      {anchor && (
        <FloatingDropdown anchor={anchor} onClose={() => setAnchor(null)}>
          <div className="status-option" onClick={() => { onSelect(''); setAnchor(null); }}>（なし）</div>
          {allStatuses.map((s) => (
            <div
              key={s.id}
              className="status-option"
              style={{ borderLeft: `3px solid ${s.color}` }}
              onClick={() => { onSelect(s.id); setAnchor(null); }}
            >
              {s.name}
            </div>
          ))}
        </FloatingDropdown>
      )}
    </span>
  );
}

// Priority constants — exported so the toolbar can reuse them too.
export const PRIORITIES_HML = [
  { value: 'high',   label: '高', color: '#ef4444' },
  { value: 'medium', label: '中', color: '#f97316' },
  { value: 'low',    label: '低', color: '#22c55e' },
];
export const PRIORITIES_ABC = [
  { value: 'high',   label: 'A', color: '#ef4444' },
  { value: 'medium', label: 'B', color: '#f97316' },
  { value: 'low',    label: 'C', color: '#22c55e' },
];

export function PriorityBadge({
  priority,
  onSelect,
  mode = 'hml',
}: {
  priority: string;
  onSelect: (p: string | null) => void;
  mode?: 'hml' | 'abc';
}) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const btnRef = useRef<HTMLSpanElement>(null);
  const PRIORITIES = mode === 'abc' ? PRIORITIES_ABC : PRIORITIES_HML;
  const p = PRIORITIES.find((x) => x.value === priority);
  if (!p) return null;
  return (
    <span
      ref={btnRef}
      className="priority-badge"
      style={{ background: p.color }}
      onMouseDown={(e) => {
        e.stopPropagation();
        setAnchor((a) => a ? null : btnRef.current?.getBoundingClientRect() ?? null);
      }}
    >
      {p.label}
      {anchor && (
        <FloatingDropdown anchor={anchor} onClose={() => setAnchor(null)}>
          <div className="status-option" onClick={() => { onSelect(null); setAnchor(null); }}>（なし）</div>
          {PRIORITIES.map((px) => (
            <div
              key={px.value}
              className="status-option"
              style={{ borderLeft: `3px solid ${px.color}` }}
              onClick={() => { onSelect(px.value); setAnchor(null); }}
            >
              {px.label}
            </div>
          ))}
        </FloatingDropdown>
      )}
    </span>
  );
}

export function AssigneeBadge({
  person,
  persons,
  onSelect,
}: {
  person: { id: string; name: string; color: string };
  persons: { id: string; name: string; color: string }[];
  onSelect: (id: string | null) => void;
}) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const btnRef = useRef<HTMLSpanElement>(null);
  return (
    <span
      ref={btnRef}
      className="assignee-badge"
      style={{ borderColor: person.color, cursor: 'pointer' }}
      onMouseDown={(e) => {
        e.stopPropagation();
        setAnchor((a) => a ? null : btnRef.current?.getBoundingClientRect() ?? null);
      }}
    >
      {person.name}
      {anchor && (
        <FloatingDropdown anchor={anchor} onClose={() => setAnchor(null)}>
          <div className="status-option" onClick={() => { onSelect(null); setAnchor(null); }}>（なし）</div>
          {persons.map((p) => (
            <div
              key={p.id}
              className="status-option"
              style={{ borderLeft: `3px solid ${p.color}` }}
              onClick={() => { onSelect(p.id); setAnchor(null); }}
            >
              {p.name}
            </div>
          ))}
        </FloatingDropdown>
      )}
    </span>
  );
}

export function DateBadge({
  date,
  isWarn,
  isOverdue,
  onSelect,
}: {
  date: string;
  isWarn: boolean;
  isOverdue: boolean;
  onSelect: (d: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(date);
  if (editing) {
    return (
      <input
        type="date"
        className="inline-date-input"
        autoFocus
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        onBlur={() => { onSelect(val || null); setEditing(false); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { onSelect(val || null); setEditing(false); }
          if (e.key === 'Escape') setEditing(false);
          if (e.key === 'Delete' || e.key === 'Backspace') { onSelect(null); setEditing(false); }
          e.stopPropagation();
        }}
      />
    );
  }
  return (
    <span
      className={`date-badge${isOverdue ? ' overdue' : isWarn ? ' warn' : ''}`}
      title="期限（クリックで変更）"
      onClick={(e) => { e.stopPropagation(); setEditing(true); }}
      style={{ cursor: 'pointer' }}
    >
      {date}
    </span>
  );
}
