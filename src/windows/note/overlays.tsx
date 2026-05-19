// Small UI overlays used inside the NoteWindow.
//   - ClosingOverlay: shows "saving / failed" while flush() runs on close
//   - SearchOverlay: in-note Ctrl+F bar with up/down nav and match counter
//   - CheatSheet: "?" key shortcut list

interface ClosingOverlayProps { state: null | 'saving' | 'failed'; }
export function ClosingOverlay({ state }: ClosingOverlayProps) {
  if (!state) return null;
  return (
    <div className="closing-overlay">
      <div className="closing-overlay-box">
        {state === 'saving'
          ? <><div className="spinner" />保存中…<br />しばらくお待ちください</>
          : <>⚠ 保存に失敗しました</>}
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
  return (
    <div className="search-overlay-bar" onClick={(e) => e.stopPropagation()}>
      <input
        className="search-overlay-input"
        placeholder="🔍 このリスト内を検索"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); onNav(e.shiftKey ? -1 : 1); }
          if (e.key === 'Escape') onClose();
        }}
        autoFocus
      />
      <span className="search-overlay-count">
        {findMode ? (matchCount > 0 ? `${matchIdx + 1} / ${matchCount}` : '0 件') : ''}
      </span>
      <button className="search-overlay-nav" onClick={() => onNav(-1)} title="前の一致 (Shift+Enter)" disabled={matchCount === 0}>↑</button>
      <button className="search-overlay-nav" onClick={() => onNav(1)} title="次の一致 (Enter)" disabled={matchCount === 0}>↓</button>
      <button className="search-overlay-close" onClick={onClose} title="閉じる (Esc)">✕</button>
    </div>
  );
}

interface CheatSheetProps { onClose: () => void; }
export function CheatSheet({ onClose }: CheatSheetProps) {
  const rows: [string, string][] = [
    ['元に戻す', 'Ctrl+Z'],
    ['やり直し', 'Ctrl+Y'],
    ['全選択', 'Ctrl+A'],
    ['検索', 'Ctrl+F'],
    ['タスクをコピー', 'Ctrl+C'],
    ['タスクを貼り付け', 'Ctrl+V'],
    ['インデント', 'Tab'],
    ['アウトデント', 'Shift+Tab'],
    ['太字', 'Ctrl+B'],
    ['打ち消し線', 'Ctrl+Alt+S'],
    ['複製', 'Ctrl+D'],
    ['ロック', 'Ctrl+L'],
    ['コメント', 'Ctrl+M'],
    ['見出しに変更 / 戻す', 'Ctrl+H / Ctrl+Shift+H'],
    ['アーカイブ', 'Ctrl+E'],
    ['上に項目を追加', 'Ctrl+Shift+Enter'],
    ['下に項目を追加', 'Shift+Enter'],
    ['選択を上下に移動', '↑ / ↓'],
    ['複数選択', 'Shift+↑/↓'],
    ['行を移動', 'Ctrl+Shift+↑/↓'],
    ['削除', 'Delete'],
    ['キャンセル / 閉じる', 'Esc'],
    ['この一覧を表示', '?'],
  ];
  return (
    <div className="cheat-sheet-backdrop" onClick={onClose}>
      <div className="cheat-sheet" onClick={(e) => e.stopPropagation()}>
        <h4>キーボードショートカット</h4>
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
