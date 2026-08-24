// Sync (Phase 1) pure-logic tests: sync-code parsing/generation and the
// conflict-merge rule (deleted_at wins over LWW-by-updated_at).
import { describe, it, expect, mock } from 'bun:test';
import type { NoteSnapshot, SyncItem, SyncNoteMeta } from '../src/utils/sync';

mock.module('@tauri-apps/api/core', () => ({
  invoke: async () => undefined,
}));

const { parseSyncCode, generateSyncCode, mergeSnapshots } = await import('../src/utils/sync');

const mkNoteMeta = (over: Partial<SyncNoteMeta> = {}): SyncNoteMeta => ({
  id: 'n1', title: 'note', category_id: null, color: '#fef08a', sort_order: 0,
  locked: false, warn_days: null, created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z', deleted_at: null, rev: 1,
  ...over,
});

const mkItem = (over: Partial<SyncItem> = {}): SyncItem => ({
  id: 'i1', note_id: 'n1', parent_id: null, text: 'task', checked: false,
  indent: 0, collapsed: false, locked: false, status: null, assignees: '[]',
  assignee_person_id: null, memo: null, bold: false, priority: null,
  start_date: null, end_date: null, limit_date: null, item_type: 'normal',
  sort_order: 0, archived: false, strikethrough: false,
  updated_at: '2026-01-01T00:00:00Z', deleted_at: null,
  ...over,
});

describe('parseSyncCode', () => {
  it('parses a well-formed st1 code', () => {
    const code = generateSyncCode();
    const parsed = parseSyncCode(code);
    expect(parsed).not.toBeNull();
    expect(code.startsWith('st1.')).toBe(true);
  });

  it('rejects malformed codes', () => {
    expect(parseSyncCode('not-a-code')).toBeNull();
    expect(parseSyncCode('st1.short.abc')).toBeNull(); // spaceId too short
    expect(parseSyncCode('st2.abcdefghij0123456789ab.longenoughpass')).toBeNull(); // wrong prefix
    expect(parseSyncCode('st1.abcdefghij0123456789ab.short')).toBeNull(); // passphrase too short
  });

  it('generateSyncCode always yields a code parseSyncCode accepts', () => {
    for (let i = 0; i < 20; i++) {
      expect(parseSyncCode(generateSyncCode())).not.toBeNull();
    }
  });
});

describe('mergeSnapshots', () => {
  it('note: deleted_at on the server wins even if local was edited later', () => {
    const local: NoteSnapshot = { note: mkNoteMeta({ title: 'local edit', updated_at: '2026-01-02T00:00:00Z' }), items: [] };
    const server: NoteSnapshot = { note: mkNoteMeta({ deleted_at: '2026-01-01T12:00:00Z', rev: 2 }), items: [] };
    const merged = mergeSnapshots(local, server);
    expect(merged.note.deleted_at).toBe('2026-01-01T12:00:00Z');
    expect(merged.note.rev).toBe(2);
  });

  it('note: deleted_at on the local side wins even if server was edited later', () => {
    const local: NoteSnapshot = { note: mkNoteMeta({ deleted_at: '2026-01-02T00:00:00Z' }), items: [] };
    const server: NoteSnapshot = { note: mkNoteMeta({ title: 'server edit', updated_at: '2026-01-03T00:00:00Z', rev: 2 }), items: [] };
    const merged = mergeSnapshots(local, server);
    expect(merged.note.deleted_at).toBe('2026-01-02T00:00:00Z');
    expect(merged.note.rev).toBe(2); // always takes the server's authoritative rev
  });

  it('note: without any deletion, the later updated_at wins (LWW)', () => {
    const local: NoteSnapshot = { note: mkNoteMeta({ title: 'newer local', updated_at: '2026-01-05T00:00:00Z' }), items: [] };
    const server: NoteSnapshot = { note: mkNoteMeta({ title: 'older server', updated_at: '2026-01-01T00:00:00Z', rev: 3 }), items: [] };
    const merged = mergeSnapshots(local, server);
    expect(merged.note.title).toBe('newer local');
    expect(merged.note.rev).toBe(3);
  });

  it('items: server-only and local-only items both survive the merge', () => {
    const local: NoteSnapshot = {
      note: mkNoteMeta(),
      items: [mkItem({ id: 'local-only', text: 'added locally' })],
    };
    const server: NoteSnapshot = {
      note: mkNoteMeta(),
      items: [mkItem({ id: 'server-only', text: 'added on server' })],
    };
    const merged = mergeSnapshots(local, server);
    const ids = merged.items.map((i) => i.id).sort();
    expect(ids).toEqual(['local-only', 'server-only']);
  });

  it('items: a tombstoned item wins over a later text edit of the same item', () => {
    const local: NoteSnapshot = {
      note: mkNoteMeta(),
      items: [mkItem({ text: 'edited after deletion', updated_at: '2026-01-05T00:00:00Z' })],
    };
    const server: NoteSnapshot = {
      note: mkNoteMeta(),
      items: [mkItem({ deleted_at: '2026-01-02T00:00:00Z', updated_at: '2026-01-02T00:00:00Z' })],
    };
    const merged = mergeSnapshots(local, server);
    expect(merged.items).toHaveLength(1);
    expect(merged.items[0].deleted_at).toBe('2026-01-02T00:00:00Z');
  });

  it('items: without deletion, later updated_at wins per item', () => {
    const local: NoteSnapshot = {
      note: mkNoteMeta(),
      items: [mkItem({ text: 'stale local', updated_at: '2026-01-01T00:00:00Z' })],
    };
    const server: NoteSnapshot = {
      note: mkNoteMeta(),
      items: [mkItem({ text: 'fresh server', updated_at: '2026-01-03T00:00:00Z' })],
    };
    const merged = mergeSnapshots(local, server);
    expect(merged.items[0].text).toBe('fresh server');
  });
});
