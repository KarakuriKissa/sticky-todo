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

// Render free text with clickable links and (optionally) wrap a search term
// in <mark>. Used by TodoItemRow's view-mode div and the comment popup.
//
// Three link forms are supported:
//   1. Markdown hyperlink:  [表示文字](https://... or C:\path)  → shows 表示文字
//   2. Bare URL:            https://...   → opens in preferred / default browser
//   3. File path:           C:\... , \\srv\.. , /Users/...  → opens in Explorer
type Token =
  | { kind: 'text'; text: string }
  | { kind: 'link'; label: string; target: string };

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  // [label](target) — label has no ']' , target has no ')' or whitespace
  const mdRe = /\[([^\]]+)\]\(([^)\s]+)\)/g;
  // bare URL / win path / UNC / absolute unix path
  const bareRe = /(https?:\/\/[^\s]+|[A-Za-z]:[\\/][^\s]+|\\\\[^\s]+|\/[^\s/][^\s]*)/g;

  // First split out markdown links.
  let last = 0;
  let m: RegExpExecArray | null;
  const pushBare = (chunk: string) => {
    let li = 0;
    let bm: RegExpExecArray | null;
    bareRe.lastIndex = 0;
    while ((bm = bareRe.exec(chunk)) !== null) {
      if (bm.index > li) tokens.push({ kind: 'text', text: chunk.slice(li, bm.index) });
      tokens.push({ kind: 'link', label: bm[0], target: bm[0] });
      li = bm.index + bm[0].length;
    }
    if (li < chunk.length) tokens.push({ kind: 'text', text: chunk.slice(li) });
  };
  while ((m = mdRe.exec(text)) !== null) {
    if (m.index > last) pushBare(text.slice(last, m.index));
    tokens.push({ kind: 'link', label: m[1], target: m[2] });
    last = m.index + m[0].length;
  }
  if (last < text.length) pushBare(text.slice(last));
  return tokens;
}

export function renderTextWithLinks(text: string, searchTerm?: string): React.ReactNode {
  const tokens = tokenize(text);
  const term = (searchTerm ?? '').trim().toLowerCase();
  let key = 0;
  const result: React.ReactNode[] = [];
  for (const tok of tokens) {
    if (tok.kind === 'link') {
      // For bare links keep the smart shortening; for markdown links show the
      // author-chosen label verbatim.
      const display = tok.label === tok.target ? shortLabel(tok.target) : tok.label;
      result.push(
        <a
          key={key++}
          className="todo-link"
          href={tok.target}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); openExternal(tok.target); }}
          title={tok.target}
        >{display}</a>,
      );
      continue;
    }
    const p = tok.text;
    if (!term) { result.push(<span key={key++}>{p}</span>); continue; }
    const lower = p.toLowerCase();
    let i = 0;
    while (i < p.length) {
      const at = lower.indexOf(term, i);
      if (at < 0) { result.push(<span key={key++}>{p.slice(i)}</span>); break; }
      if (at > i) result.push(<span key={key++}>{p.slice(i, at)}</span>);
      result.push(<mark key={key++} className="todo-text-match">{p.slice(at, at + term.length)}</mark>);
      i = at + term.length;
    }
  }
  return result;
}
