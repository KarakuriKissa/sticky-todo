// Regression test for the Ctrl+A/Ctrl+C hijack bug: while editing a task's
// text (a contentEditable RichTextEdit div, not an <input>/<textarea>), the
// note window's global shortcut handler used to miss it and treat Ctrl+A as
// "select all tasks" / Ctrl+C as "copy tasks to the internal clipboard"
// instead of leaving native text selection/copy alone.
//
// No DOM lib here (project convention — see errorBoundary.test.tsx): targets
// are duck-typed plain objects exposing just what isEditableTarget reads.
import { describe, it, expect } from 'bun:test';

const { isEditableTarget } = await import('../src/utils/keyboardTarget');

describe('isEditableTarget', () => {
  it('is true for <input>', () => {
    expect(isEditableTarget({ tagName: 'INPUT' })).toBe(true);
  });

  it('is true for <textarea>', () => {
    expect(isEditableTarget({ tagName: 'TEXTAREA' })).toBe(true);
  });

  it('is true for a contentEditable div (RichTextEdit task/comment editor)', () => {
    expect(isEditableTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true);
  });

  it('is false for a plain div (task row, list container)', () => {
    expect(isEditableTarget({ tagName: 'DIV', isContentEditable: false })).toBe(false);
  });

  it('is false for a link span inside RichTextEdit marked contenteditable=false', () => {
    expect(isEditableTarget({ tagName: 'SPAN', isContentEditable: false })).toBe(false);
  });

  it('is false for null / non-element targets', () => {
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget({} as any)).toBe(false);
  });
});
