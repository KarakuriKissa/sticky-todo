import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// FloatingDropdown — renders via React portal into document.body so parent
// overflow never clips it. The trigger uses onMouseDown+stopPropagation to
// toggle; this dropdown stops its own onMouseDown so the document handler
// only fires for true outside-clicks.
export function FloatingDropdown({
  anchor,
  onClose,
  children,
}: {
  anchor: DOMRect;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: anchor.left, y: anchor.bottom + 2 });

  useLayoutEffect(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let x = anchor.left;
    let y = anchor.bottom + 2;
    if (y + rect.height > vh - 4) y = Math.max(4, anchor.top - rect.height - 2);
    if (x + rect.width > vw - 4) x = Math.max(4, vw - rect.width - 4);
    setPos({ x, y });
  }, [anchor.left, anchor.bottom, anchor.top]);

  useEffect(() => {
    const handler = (e: globalThis.MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      className="floating-dropdown"
      style={{ position: 'fixed', left: pos.x, top: pos.y, zIndex: 9999 }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onMouseLeave={onClose}
    >
      {children}
    </div>,
    document.body,
  );
}
