// Save layer for noteStore — extracted to keep noteStore focused on actions.
//
// Strategy:
//   - localStorage is the always-on safety net: backup written every time,
//     survives even if SQLite save fails completely.
//   - SQLite is the durable store, but slow / failable — sequential promise
//     chain (saveChain) ensures saves never overlap, preserving order.
//   - flush() drains the chain and writes one final save_items so close→reopen
//     is guaranteed to land every change.
import { invoke } from '@tauri-apps/api/core';
import type { TodoItem } from '../types';
import { log } from '../utils/log';

const lsKey = (noteId: string) => `sticky-todo:note-items:${noteId}`;

export function backupToLocalStorage(items: TodoItem[]) {
  if (items.length === 0) return;
  const noteId = items[0].note_id;
  if (!noteId) return;
  try {
    localStorage.setItem(lsKey(noteId), JSON.stringify(items));
  } catch (e) {
    log.warn('[save] localStorage backup failed:', e);
  }
}

export function readLocalStorage(noteId: string): TodoItem[] | null {
  try {
    const cached = localStorage.getItem(lsKey(noteId));
    if (!cached) return null;
    const parsed = JSON.parse(cached) as TodoItem[];
    return Array.isArray(parsed) ? parsed : null;
  } catch (e) {
    log.warn('[load] localStorage read failed:', e);
    return null;
  }
}

interface SaveCallbacks {
  getItems: () => TodoItem[];
  setStatus: (s: 'idle' | 'saving' | 'saved' | 'error', at?: number) => void;
}

export function createSaveQueue(cb: SaveCallbacks) {
  let textTimer: ReturnType<typeof setTimeout> | null = null;
  let chain: Promise<void> = Promise.resolve();

  const doSave = async () => {
    const items = cb.getItems().filter((i) => i.note_id !== '' && i.note_id != null);
    if (items.length === 0) {
      log.debug('[save] skip — no items with valid note_id');
      return;
    }
    backupToLocalStorage(items);

    log.debug('[save] start, count=', items.length, 'first note_id=', items[0].note_id);
    cb.setStatus('saving');
    try {
      await invoke('save_items', { items });
      log.debug('[save] OK count=', items.length);
      cb.setStatus('saved', Date.now());
      return;
    } catch (e) {
      log.error('[save] FAILED 1st attempt:', e);
    }
    await new Promise((r) => setTimeout(r, 400));
    try {
      await invoke('save_items', { items });
      log.debug('[save] OK on retry, count=', items.length);
      cb.setStatus('saved', Date.now());
    } catch (e) {
      log.error('[save] FAILED on retry too — data is in localStorage backup:', e);
      cb.setStatus('error');
    }
  };

  const saveAll = () => { chain = chain.then(doSave); };

  const saveAllDebounced = () => {
    if (textTimer) clearTimeout(textTimer);
    textTimer = setTimeout(() => { textTimer = null; saveAll(); }, 300);
  };

  // flush: cancel any pending text-debounce, drain the chain, then one final save.
  const flush = async () => {
    if (textTimer) { clearTimeout(textTimer); textTimer = null; saveAll(); }
    await chain;
    const items = cb.getItems().filter((i) => i.note_id);
    if (items.length === 0) return;
    try {
      await invoke('save_items', { items });
    } catch (e) {
      log.error('[noteStore] flush save_items failed:', e);
    }
  };

  return { saveAll, saveAllDebounced, flush };
}
