import { useEffect, useRef, CSSProperties } from 'react';

export interface ContextMenuItem {
  label: string;
  icon?: string;
  action: () => void;
  danger?: boolean;
  separator?: boolean;
  disabled?: boolean;
}

interface Props {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', keyHandler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', keyHandler);
    };
  }, [onClose]);

  // Adjust position so menu stays in viewport
  const style: CSSProperties = {
    position: 'fixed',
    left: x,
    top: y,
    zIndex: 9999,
  };

  return (
    <div ref={ref} className="context-menu" style={style}>
      {items.map((item, i) =>
        item.separator ? (
          <div key={i} className="context-menu-sep" />
        ) : (
          <button
            key={i}
            className={`context-menu-item${item.danger ? ' danger' : ''}${item.disabled ? ' disabled' : ''}`}
            onClick={() => {
              if (!item.disabled) {
                item.action();
                onClose();
              }
            }}
          >
            {item.icon && <span className="ctx-icon">{item.icon}</span>}
            {item.label}
          </button>
        ),
      )}
    </div>
  );
}
