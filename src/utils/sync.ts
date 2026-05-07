/**
 * Differential sync logic.
 * Only dirty (modified) notes/items are sent to the server.
 * After a successful sync, dirty flags are cleared via mark_synced.
 */
import { invoke } from '@tauri-apps/api/core';
import type { Note, TodoItem } from '../types';
import { log } from './log';

export interface SyncPayload {
  notes: Note[];
  items: TodoItem[];
}

export interface SyncConfig {
  endpoint: string; // e.g. "https://api.example.com/sync"
  token: string;
}

/**
 * Collect all dirty data and POST to sync endpoint.
 * Server should accept the payload and return merged/server-side data.
 */
export async function syncNow(config: SyncConfig): Promise<void> {
  const [dirtyNotes, dirtyItems] = await invoke<[Note[], TodoItem[]]>('get_dirty_data');

  if (dirtyNotes.length === 0 && dirtyItems.length === 0) return;

  const payload: SyncPayload = { notes: dirtyNotes, items: dirtyItems };

  const res = await fetch(config.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.token}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(`Sync failed: ${res.status} ${res.statusText}`);
  }

  // Clear dirty flags on success
  await invoke('mark_synced');
}

let syncTimer: ReturnType<typeof setInterval> | null = null;

export function startAutoSync(config: SyncConfig, intervalMs = 30_000): () => void {
  if (syncTimer) clearInterval(syncTimer);
  syncTimer = setInterval(() => {
    syncNow(config).catch((e) => log.error('[sync]', e));
  }, intervalMs);
  return () => {
    if (syncTimer) clearInterval(syncTimer);
    syncTimer = null;
  };
}

export function stopAutoSync() {
  if (syncTimer) clearInterval(syncTimer);
  syncTimer = null;
}
