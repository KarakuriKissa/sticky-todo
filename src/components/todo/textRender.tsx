import { openExternal } from '../../utils/openExternal';

// Long links are visually noisy. Show a compact label but keep the full target
// for the click / hover-title. URLs → "domain/…last-segment"; paths → "…\\last".
function shortLabel(link: string): string {
  const MAX = 48;
  if (link.length <= MAX) return link;
  if (/^https?:\/\//i.test(link)) {
    try {
      const u = new URL(link);
      const tail = (u.pathname + u.search).replace(/\/$/, '');
      const last = tail.split('/').filter(Boolean).pop() ?? '';
      const compact = last ? `${u.hostname}/…/${last}` : u.hostname;
      return compact.length <= MAX ? compact : `${u.hostname}/…`;
    } catch {
      return link.slice(0, MAX - 1) + '…';
    }
  }
  // File path → keep the last segment after the final slash/backslash.
  const seg = link.split(/[\\/]/).filter(Boolean).pop() ?? link;
  return `…${link.includes('\\') ? '\\' : '/'}${seg}`.slice(0, MAX);
}

// Render free text with clickable URLs / file-system paths and (optionally)
// wrap a search term in <mark>. Used by TodoItemRow's view-mode div and the
// comment popup.
//
// Linkified:
//   - http(s):// URLs            → opens in the preferred / default browser
//   - C:\... , C:/... , \\srv\.. → opens the folder/file in Explorer
//   - /Users/... (absolute unix) → opens in the file manager
export function renderTextWithLinks(text: string, searchTerm?: string): React.ReactNode {
  // URL OR Windows drive path OR UNC path OR absolute unix path.
  const linkRe = /(https?:\/\/[^\s]+|[A-Za-z]:[\\/][^\s]+|\\\\[^\s]+|\/[^\s/][^\s]*)/g;
  const parts: { text: string; isLink: boolean }[] = [];
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(text)) !== null) {
    if (m.index > lastIdx) parts.push({ text: text.slice(lastIdx, m.index), isLink: false });
    parts.push({ text: m[0], isLink: true });
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < text.length) parts.push({ text: text.slice(lastIdx), isLink: false });

  const term = (searchTerm ?? '').trim().toLowerCase();
  let key = 0;
  const result: React.ReactNode[] = [];
  for (const p of parts) {
    if (p.isLink) {
      result.push(
        <a
          key={key++}
          className="todo-link"
          href={p.text}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            openExternal(p.text);
          }}
          title={p.text}
        >{shortLabel(p.text)}</a>,
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
