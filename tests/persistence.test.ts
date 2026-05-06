// Persistence / round-trip tests:
//   - archived items survive a "reload" (DB → store → DB cycle)
//   - export/import the items as JSON keeps every field intact
//   - localStorage fallback returns the same items the SQLite invoke would
import { describe, it, expect, beforeEach, mock } from 'bun:test';
import type { TodoItem } from '../src/types';

// -------- mock Tauri APIs (stand-in SQLite) --------------------------------
const fakeDb: { items: TodoItem[] } = { items: [] };
mock.module('@tauri-apps/api/core', () => ({
  invoke: async (cmd: string, args?: any) => {
    if (cmd === 'save_items') {
      const incoming: TodoItem[] = args?.items ?? [];
      const incomingIds = new Set(incoming.map((i) => i.id));
      fakeDb.items = [
        ...fakeDb.items.filter((i) => !incomingIds.has(i.id)),
        ...incoming,
      ];
      return undefined;
    }
    if (cmd === 'get_note_items') {
      // Mirrors the fixed db.rs: returns ALL items for the note, archived too.
      return fakeDb.items.filter((i) => i.note_id === args?.noteId);
    }
    if (cmd === 'delete_item') {
      fakeDb.items = fakeDb.items.filter((i) => i.id !== args?.id);
      return undefined;
    }
    return undefined;
  },
}));
mock.module('@tauri-apps/api/event', () => ({
  emit: async () => undefined, emitTo: async () => undefined,
  listen: async () => () => {},
}));
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

const mkNote = (id: string) => ({
  id, title: 't', category_id: null,
  window_x: 0, window_y: 0, window_width: 1, window_height: 1,
  always_on_top: false, color: '#fef08a', sort_order: 0,
  locked: false, warn_days: null,
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  dirty: false,
});

const reset = () => {
  fakeDb.items = [];
  useNoteStore.setState({
    note: null, items: [], selectedIds: new Set(), searchQuery: '',
    history: [], historyIdx: -1, saveStatus: 'idle', lastSavedAt: null,
  });
};

const flushMicrotasks = () => new Promise((r) => setTimeout(r, 30));

describe('archive round-trip', () => {
  beforeEach(reset);

  it('archived items are persisted and reloaded after restart', async () => {
    useNoteStore.getState().setNote(mkNote('n1'));
    const id = useNoteStore.getState().addItem();
    useNoteStore.getState().updateItem(id, { archived: true });
    await flushMicrotasks();

    // Confirm the fakeDB now has the archived row.
    expect(fakeDb.items).toHaveLength(1);
    expect(fakeDb.items[0].archived).toBe(true);

    // Simulate restart: clear in-memory state, reload from DB.
    useNoteStore.setState({ items: [], history: [], historyIdx: -1 });
    await useNoteStore.getState().load('n1');

    const reloaded = useNoteStore.getState().items;
    expect(reloaded).toHaveLength(1);
    expect(reloaded[0].id).toBe(id);
    expect(reloaded[0].archived).toBe(true);
  });

  it('toggling archive back to false also persists', async () => {
    useNoteStore.getState().setNote(mkNote('n1'));
    const id = useNoteStore.getState().addItem();
    useNoteStore.getState().updateItem(id, { archived: true });
    await flushMicrotasks();
    useNoteStore.getState().updateItem(id, { archived: false });
    await flushMicrotasks();

    useNoteStore.setState({ items: [], history: [], historyIdx: -1 });
    await useNoteStore.getState().load('n1');
    expect(useNoteStore.getState().items[0].archived).toBe(false);
  });
});

describe('JSON export/import round-trip', () => {
  beforeEach(reset);

  it('serialises items to JSON and back without losing fields', async () => {
    useNoteStore.getState().setNote(mkNote('n1'));
    const id = useNoteStore.getState().addItem();
    useNoteStore.getState().updateItem(id, {
      text: 'export me', bold: true, locked: true, archived: false,
      memo: 'hi', priority: 'high', limit_date: '2026-12-31',
    });
    await flushMicrotasks();

    // Export.
    const exported = JSON.stringify(useNoteStore.getState().items);

    // Wipe + re-import.
    reset();
    useNoteStore.getState().setNote(mkNote('n1'));
    const restored = JSON.parse(exported);
    useNoteStore.setState({ items: restored });

    const got = useNoteStore.getState().items[0];
    expect(got.text).toBe('export me');
    expect(got.bold).toBe(true);
    expect(got.locked).toBe(true);
    expect(got.memo).toBe('hi');
    expect(got.priority).toBe('high');
    expect(got.limit_date).toBe('2026-12-31');
  });
});

describe('localStorage fallback', () => {
  beforeEach(reset);

  it('items survive even when the DB layer reports empty (LS rescue)', async () => {
    useNoteStore.getState().setNote(mkNote('n1'));
    useNoteStore.getState().addItem();
    useNoteStore.getState().addItem();
    await flushMicrotasks();
    // doSave wrote both to fakeDb AND to localStorage. Now wipe just the DB
    // (simulates a corrupted SQLite file).
    fakeDb.items = [];

    useNoteStore.setState({ items: [], history: [], historyIdx: -1 });
    await useNoteStore.getState().load('n1');

    // load() should have restored from localStorage.
    expect(useNoteStore.getState().items.length).toBeGreaterThan(0);
  });
});
