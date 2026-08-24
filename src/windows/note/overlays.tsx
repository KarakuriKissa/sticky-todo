// Small UI overlays used inside the NoteWindow.
//   - ClosingOverlay: shows "saving / failed" while flush() runs on close
//   - SearchOverlay: in-note Ctrl+F bar with up/down nav and match counter
//   - CheatSheet: "?" key shortcut list
import { useT } from '../../i18n';

interface ClosingOverlayProps { state: null | 'saving' | 'failed'; }
export function ClosingOverlay({ state }: ClosingOverlayProps) {
  const t = useT();
  if (!state) return null;
  return (
    <div className="closing-overlay">
      <div className="closing-overlay-box">
        {state === 'saving'
          ? <><div className="spinner" />{t('overlay.savingLine1')}<br />{t('overlay.savingLine2')}</>
          : <>{t('overlay.saveFailed')}</>}
      </div>
    </div>
  );
}

interface SearchOverlayProps {
  query: string;
  onQueryChange: (q: string) => void;
  onClose: () => void;
  onNav: (delta: number) => void;
  matchCount: number;
  matchIdx: number;
  findMode: boolean;
}
export function SearchOverlay({
  query, onQueryChange, onClose, onNav, matchCount, matchIdx, findMode,
}: SearchOverlayProps) {
  const t = useT();
  return (
    <div className="search-overlay-bar" onClick={(e) => e.stopPropagation()}>
      <input
        className="search-overlay-input"
        placeholder={t('overlay.searchPlaceholder')}
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); onNav(e.shiftKey ? -1 : 1); }
          if (e.key === 'Escape') onClose();
        }}
        autoFocus
      />
      <span className="search-overlay-count">
        {findMode ? (matchCount > 0 ? `${matchIdx + 1} / ${matchCount}` : t('overlay.zeroMatches')) : ''}
      </span>
      <button className="search-overlay-nav" onClick={() => onNav(-1)} title={t('overlay.prevMatch')} disabled={matchCount === 0}>↑</button>
      <button className="search-overlay-nav" onClick={() => onNav(1)} title={t('overlay.nextMatch')} disabled={matchCount === 0}>↓</button>
      <button className="search-overlay-close" onClick={onClose} title={t('search.close')}>✕</button>
    </div>
  );
}

interface CheatSheetProps { onClose: () => void; }
export function CheatSheet({ onClose }: CheatSheetProps) {
  const t = useT();
  const rows: [string, string][] = [
    [t('cheat.undo'), 'Ctrl+Z'],
    [t('cheat.redo'), 'Ctrl+Y'],
    [t('cheat.selectAll'), 'Ctrl+A'],
    [t('cheat.search'), 'Ctrl+F'],
    [t('cheat.copyTask'), 'Ctrl+C'],
    [t('cheat.pasteTask'), 'Ctrl+V'],
    [t('ctx.indent'), 'Tab'],
    [t('ctx.outdent'), 'Shift+Tab'],
    [t('ctx.bold'), 'Ctrl+B'],
    [t('ctx.strike'), 'Ctrl+Alt+S'],
    [t('ctx.duplicate'), 'Ctrl+D'],
    [t('ctx.lock'), 'Ctrl+L'],
    [t('ctx.comment'), 'Ctrl+M'],
    [t('cheat.headingToggle'), 'Ctrl+H / Ctrl+Shift+H'],
    [t('ctx.archive'), 'Ctrl+E'],
    [t('ctx.addAbove'), 'Ctrl+Shift+Enter'],
    [t('ctx.addBelow'), 'Shift+Enter'],
    [t('cheat.moveSelection'), '↑ / ↓'],
    [t('cheat.multiSelect'), 'Shift+↑/↓'],
    [t('cheat.moveRow'), 'Ctrl+Shift+↑/↓'],
    [t('ctx.delete'), 'Delete'],
    [t('cheat.cancelClose'), 'Esc'],
    [t('cheat.hyperlink'), t('cheat.hyperlinkFormat')],
    [t('cheat.showThisList'), '?'],
  ];
  return (
    <div className="cheat-sheet-backdrop" onClick={onClose}>
      <div className="cheat-sheet" onClick={(e) => e.stopPropagation()}>
        <h4>{t('cheat.heading')}</h4>
        {rows.map(([label, key]) => (
          <div key={key} className="cheat-sheet-row">
            <span>{label}</span>
            <span className="cheat-sheet-key">{key}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
