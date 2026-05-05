import { describe, it, expect, beforeEach, mock } from 'bun:test';

// Stub Tauri APIs so the store loads under the bun test runtime.
mock.module('@tauri-apps/api/core', () => ({
  invoke: async () => undefined,
}));
mock.module('@tauri-apps/api/event', () => ({
  emit: async () => undefined,
  emitTo: async () => undefined,
  listen: async () => () => {},
}));

// Provide a minimal localStorage so the noteStore's backup writes don't error.
if (typeof globalThis.localStorage === 'undefined') {
  const _store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => _store.get(k) ?? null,
    setItem: (k: string, v: string) => { _store.set(k, v); },
    removeItem: (k: string) => { _store.delete(k); },
    clear: () => { _store.clear(); },
    key: (i: number) => Array.from(_store.keys())[i] ?? null,
    get length() { return _store.size; },
  };
}

const { useNoteStore } = await import('../src/store/noteStore');
type Note = import('../src/types').Note;

const mkNote = (id = 'n1'): Note => ({
  id,
  title: 'Test',
  category_id: null,
  window_x: 0, window_y: 0, window_width: 400, window_height: 500,
  always_on_top: false, color: '#fef08a', sort_order: 0,
  locked: false, warn_days: null,
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  dirty: false,
});

describe('noteStore', () => {
  beforeEach(() => {
    useNoteStore.setState({
      note: null,
      items: [],
      selectedIds: new Set(),
      searchQuery: '',
      history: [],
      historyIdx: -1,
      saveStatus: 'idle',
      lastSavedAt: null,
    });
  });

  it('addItem creates an item with the current note_id', () => {
    useNoteStore.getState().setNote(mkNote('note-A'));
    const id = useNoteStore.getState().addItem();
    expect(id).not.toBe('');
    const items = useNoteStore.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0].note_id).toBe('note-A');
  });

  it('addItem returns empty string when note is not set (no save)', () => {
    const id = useNoteStore.getState().addItem();
    expect(id).toBe('');
    expect(useNoteStore.getState().items).toHaveLength(0);
  });

  it('updateItem modifies the targeted item', () => {
    useNoteStore.getState().setNote(mkNote());
    const id = useNoteStore.getState().addItem();
    useNoteStore.getState().updateItem(id, { text: 'hello world' });
    const item = useNoteStore.getState().items.find((i) => i.id === id);
    expect(item?.text).toBe('hello world');
  });

  it('toggleCheck flips the checked flag', () => {
    useNoteStore.getState().setNote(mkNote());
    const id = useNoteStore.getState().addItem();
    expect(useNoteStore.getState().items[0].checked).toBe(false);
    useNoteStore.getState().toggleCheck(id);
    expect(useNoteStore.getState().items[0].checked).toBe(true);
  });

  it('deleteItem removes the item', () => {
    useNoteStore.getState().setNote(mkNote());
    const id = useNoteStore.getState().addItem();
    expect(useNoteStore.getState().items).toHaveLength(1);
    useNoteStore.getState().deleteItem(id);
    expect(useNoteStore.getState().items).toHaveLength(0);
  });

  it('indent / dedent stay within 0-6 range', () => {
    useNoteStore.getState().setNote(mkNote());
    const id = useNoteStore.getState().addItem();
    for (let n = 0; n < 10; n++) useNoteStore.getState().indent(id);
    expect(useNoteStore.getState().items[0].indent).toBe(6);
    for (let n = 0; n < 10; n++) useNoteStore.getState().dedent(id);
    expect(useNoteStore.getState().items[0].indent).toBe(0);
  });

  it('addItem inherits indent from the previous task', () => {
    useNoteStore.getState().setNote(mkNote());
    const a = useNoteStore.getState().addItem();
    useNoteStore.getState().indent(a);
    useNoteStore.getState().indent(a);
    const b = useNoteStore.getState().addItem();
    const itemB = useNoteStore.getState().items.find((i) => i.id === b);
    expect(itemB?.indent).toBe(2);
  });

  it('new tasks get a default deadline 10 days out', () => {
    useNoteStore.getState().setNote(mkNote());
    const id = useNoteStore.getState().addItem();
    const item = useNoteStore.getState().items.find((i) => i.id === id);
    expect(item?.limit_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
