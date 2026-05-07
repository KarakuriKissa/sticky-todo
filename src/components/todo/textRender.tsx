import { open as shellOpen } from '@tauri-apps/plugin-shell';

// Render free text with clickable URLs and (optionally) wrap a search term in
// <mark> so the user can see what they searched for. Used by TodoItemRow's
// view-mode div.
export function renderTextWithLinks(text: string, searchTerm?: string): React.ReactNode {
  const urlRe = /(https?:\/\/[^\s]+)/g;
  // 1. Split into URL and non-URL chunks.
  const parts: { text: string; isUrl: boolean }[] = [];
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  while ((m = urlRe.exec(text)) !== null) {
    if (m.index > lastIdx) parts.push({ text: text.slice(lastIdx, m.index), isUrl: false });
    parts.push({ text: m[0], isUrl: true });
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < text.length) parts.push({ text: text.slice(lastIdx), isUrl: false });

  // 2. For non-URL chunks, highlight the search term with <mark>.
  const term = (searchTerm ?? '').trim().toLowerCase();
  let key = 0;
  const result: React.ReactNode[] = [];
  for (const p of parts) {
    if (p.isUrl) {
      result.push(
        <a
          key={key++}
          className="todo-link"
          href={p.text}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            // Open in the user's default browser, never inside the webview.
            shellOpen(p.text).catch(() => {});
          }}
          title={p.text}
        >{p.text}</a>,
      );
      continue;
    }
    if (!term) { result.push(<span key={key++}>{p.text}</span>); continue; }
    const lower = p.text.toLowerCase();
    let i = 0;
    while (i < p.text.length) {
      const at = lower.indexOf(term, i);
      if (at < 0) { result.push(<span key={key++}>{p.text.slice(i)}</span>); break; }
      if (at > i) result.push(<span key={key++}>{p.text.slice(i, at)}</span>);
      result.push(<mark key={key++} className="todo-text-match">{p.text.slice(at, at + term.length)}</mark>);
      i = at + term.length;
    }
  }
  return result;
}
