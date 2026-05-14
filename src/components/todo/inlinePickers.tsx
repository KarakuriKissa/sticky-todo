import { useRef, useState } from 'react';
import type { Status } from '../../types';
import { FloatingDropdown } from './FloatingDropdown';

// Inline + buttons shown on row-hover for empty status / assignee / date cells.
// They're kept separate from the badges so the empty state can collapse to
// zero width when the row is not hovered.

export function InlineStatusPicker({
  statuses,
  onSelect,
}: {
  statuses: Status[];
  onSelect: (id: string) => void;
}) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const btnRef = useRef<HTMLSpanElement>(null);
  if (statuses.length === 0) return null;
  return (
    <span
      ref={btnRef}
      className="inline-add-btn"
      title="ステータスを設定"
      onMouseDown={(e) => {
        e.stopPropagation();
        setAnchor((a) => a ? null : btnRef.current?.getBoundingClientRect() ?? null);
      }}
    >
      ST＋
      {anchor && (
        <FloatingDropdown anchor={anchor} onClose={() => setAnchor(null)}>
          {statuses.map((s) => (
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

export function InlineAssigneePicker({
  persons,
  onSelect,
}: {
  persons: { id: string; name: string; color: string }[];
  onSelect: (id: string) => void;
}) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const btnRef = useRef<HTMLSpanElement>(null);
  if (persons.length === 0) return null;
  return (
    <span
      ref={btnRef}
      className="inline-add-btn"
      title="担当者を設定"
      onMouseDown={(e) => {
        e.stopPropagation();
        setAnchor((a) => a ? null : btnRef.current?.getBoundingClientRect() ?? null);
      }}
    >
      👤＋
      {anchor && (
        <FloatingDropdown anchor={anchor} onClose={() => setAnchor(null)}>
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

export function InlinePriorityPicker({
  onSelect,
  mode = 'hml',
}: {
  onSelect: (p: string | null) => void;
  mode?: 'hml' | 'abc';
}) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const btnRef = useRef<HTMLSpanElement>(null);
  const opts = mode === 'abc'
    ? [{ v: 'high', l: 'A', c: '#ef4444' }, { v: 'medium', l: 'B', c: '#f97316' }, { v: 'low', l: 'C', c: '#22c55e' }]
    : [{ v: 'high', l: '高', c: '#ef4444' }, { v: 'medium', l: '中', c: '#f97316' }, { v: 'low', l: '低', c: '#22c55e' }];
  return (
    <span
      ref={btnRef}
      className="inline-add-btn"
      title="優先度を設定"
      onMouseDown={(e) => {
        e.stopPropagation();
        setAnchor((a) => a ? null : btnRef.current?.getBoundingClientRect() ?? null);
      }}
    >
      ！＋
      {anchor && (
        <FloatingDropdown anchor={anchor} onClose={() => setAnchor(null)}>
          {opts.map((o) => (
            <div key={o.v} className="status-option" style={{ borderLeft: `3px solid ${o.c}` }}
              onClick={() => { onSelect(o.v); setAnchor(null); }}>
              {o.l}
            </div>
          ))}
        </FloatingDropdown>
      )}
    </span>
  );
}

export function InlineDatePicker({ onSelect }: { onSelect: (d: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState('');
  if (!open) {
    return (
      <span
        className="inline-add-btn"
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        title="期日を設定"
      >
        📅＋
      </span>
    );
  }
  return (
    <input
      type="date"
      className="inline-date-input"
      autoFocus
      value={val}
      onChange={(e) => setVal(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onBlur={() => { if (val) onSelect(val); setOpen(false); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { if (val) onSelect(val); setOpen(false); }
        if (e.key === 'Escape') setOpen(false);
        e.stopPropagation();
      }}
    />
  );
}
