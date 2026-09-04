// Detects whether a keyboard event's target is a text-editing surface: a
// native <input>/<textarea>, or a contentEditable element (RichTextEdit's
// task-text / comment editor, which is a `contenteditable` div — NOT an
// <input>, so tagName checks alone miss it).
//
// Used by the note window's global shortcut handler to stop list-level
// shortcuts (Ctrl+A select-all-tasks, Ctrl+C/V task clipboard, "?" cheat
// sheet, arrow-key selection nav) from hijacking keys while the user is
// typing inside a task.
export function isEditableTarget(target: EventTarget | null): boolean {
  // Duck-typed instead of `instanceof HTMLElement` — works the same for real
  // DOM elements and is trivially unit-testable without pulling in a DOM lib.
  const el = target as { tagName?: unknown; isContentEditable?: unknown } | null;
  if (!el || typeof el.tagName !== 'string') return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || !!el.isContentEditable;
}
