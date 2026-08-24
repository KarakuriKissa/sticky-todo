/**
 * Phase 1 ネット同期: ノート単位スナップショット + サーバー採番 rev による
 * 楽観ロック + トゥームストーン論理削除。手動同期のみ（自動同期はしない）。
 *
 * サーバーとの通信はここだけに閉じる。Rust 側の窓口は4つ:
 *   list_note_revs     — 全ノートの id/rev/deleted_at/dirty（push対象の判定・pull判定に使う）
 *   get_note_snapshot  — 1ノート分の全フィールド + 全アイテム（tombstoneも含む）
 *   apply_remote_note  — pull/マージ結果をローカルDBへ書き込む（dirtyは呼び出し側が指定）
 *   mark_note_synced   — push成功後、dirtyを落としてrevを更新（同期中の編集は保護される）
 */
import { invoke } from '@tauri-apps/api/core';
import { log } from './log';

// ── Wire types — src-tauri/src/models.rs の SyncNoteMeta/SyncItem/NoteSnapshot と対応 ──
export interface SyncNoteMeta {
  id: string;
  title: string;
  category_id: string | null;
  color: string;
  sort_order: number;
  locked: boolean;
  warn_days: number | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  rev: number;
}

export interface SyncItem {
  id: string;
  note_id: string;
  parent_id: string | null;
  text: string;
  checked: boolean;
  indent: number;
  collapsed: boolean;
  locked: boolean;
  status: string | null;
  assignees: string;
  assignee_person_id: string | null;
  memo: string | null;
  bold: boolean;
  priority: string | null;
  start_date: string | null;
  end_date: string | null;
  limit_date: string | null;
  item_type: string;
  sort_order: number;
  archived: boolean;
  strikethrough: boolean;
  updated_at: string;
  deleted_at: string | null;
}

export interface NoteSnapshot {
  note: SyncNoteMeta;
  items: SyncItem[];
}

export interface NoteRevInfo {
  id: string;
  rev: number;
  updated_at: string;
  deleted_at: string | null;
  dirty: boolean;
}

// ── 同期コード "st1.<spaceId>.<passphrase>" ─────────────────────────────────
const CODE_PREFIX = 'st1';
const ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';
const SPACE_ID_LEN = 22;
const PASSPHRASE_LEN = 20;

function randomId(len: number): string {
  const buf = new Uint8Array(len);
  crypto.getRandomValues(buf);
  let s = '';
  for (const b of buf) s += ID_CHARS[b % ID_CHARS.length];
  return s;
}

export interface SyncCode {
  spaceId: string;
  passphrase: string;
}

export function parseSyncCode(code: string): SyncCode | null {
  const parts = code.trim().split('.');
  if (parts.length !== 3 || parts[0] !== CODE_PREFIX) return null;
  const [, spaceId, passphrase] = parts;
  if (!/^[a-z0-9]{10,64}$/.test(spaceId) || passphrase.length < 6) return null;
  return { spaceId, passphrase };
}

export function generateSyncCode(): string {
  return `${CODE_PREFIX}.${randomId(SPACE_ID_LEN)}.${randomId(PASSPHRASE_LEN)}`;
}

// ── 設定の読み書き（既存の get_kv_setting/set_kv_setting 経由。AppSettings構造体には入れない）──
export interface SyncSettings {
  enabled: boolean;
  endpoint: string;
  spaceId: string;
  token: string;
  lastOk: string | null;
}

async function getKv(key: string): Promise<string | null> {
  return invoke<string | null>('get_kv_setting', { key });
}
async function setKv(key: string, value: string): Promise<void> {
  await invoke('set_kv_setting', { key, value });
}

export async function getSyncSettings(): Promise<SyncSettings> {
  const [enabled, endpoint, spaceId, token, lastOk] = await Promise.all([
    getKv('sync_enabled'),
    getKv('sync_endpoint'),
    getKv('sync_space_id'),
    getKv('sync_token'),
    getKv('sync_last_ok'),
  ]);
  return {
    enabled: enabled === '1',
    endpoint: endpoint ?? '',
    spaceId: spaceId ?? '',
    token: token ?? '',
    lastOk,
  };
}

export async function setSyncEnabled(on: boolean): Promise<void> {
  await setKv('sync_enabled', on ? '1' : '0');
}

export async function setSyncEndpoint(url: string): Promise<void> {
  await setKv('sync_endpoint', url.trim().replace(/\/+$/, ''));
}

export async function countDirtyNotes(): Promise<number> {
  try {
    const revs = await invoke<NoteRevInfo[]>('list_note_revs');
    return revs.filter((r) => r.dirty).length;
  } catch {
    return 0;
  }
}

async function login(endpoint: string, spaceId: string, passphrase: string): Promise<string> {
  const res = await fetch(`${endpoint}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ spaceId, passphrase }),
  });
  if (!res.ok) {
    if (res.status === 401) throw new Error('パスフレーズが違います（同じコードを使う端末は同じパスフレーズが必要です）');
    throw new Error(`ログインに失敗しました (${res.status})`);
  }
  const data = (await res.json()) as { token: string };
  await setKv('sync_token', data.token);
  return data.token;
}

// 同期コードを適用: spaceIdを保存し、その場でログインしてトークンを取得する。
// パスフレーズ自体は保存しない（トークンだけ保持し、期限切れ時は再入力してもらう）。
export async function applySyncCode(endpoint: string, code: string): Promise<void> {
  const parsed = parseSyncCode(code);
  if (!parsed) throw new Error('同期コードの形式が正しくありません（st1.から始まる文字列を貼り付けてください）');
  if (!endpoint) throw new Error('先に同期サーバーのURLを設定してください');
  await setKv('sync_space_id', parsed.spaceId);
  await login(endpoint, parsed.spaceId, parsed.passphrase);
}

// ── マージ（コンフリクト解決）: deleted_at がある側が LWW より優先 ──────────
function mergeNoteMeta(local: SyncNoteMeta, server: SyncNoteMeta): SyncNoteMeta {
  const deletedAt = server.deleted_at ?? local.deleted_at ?? null;
  const winner = deletedAt
    ? (server.deleted_at ? server : local)
    : (local.updated_at >= server.updated_at ? local : server);
  return { ...winner, deleted_at: deletedAt, rev: server.rev };
}

function mergeItem(local: SyncItem, server: SyncItem): SyncItem {
  const deletedAt = server.deleted_at ?? local.deleted_at ?? null;
  if (deletedAt) return server.deleted_at ? server : local;
  return local.updated_at >= server.updated_at ? local : server;
}

export function mergeSnapshots(local: NoteSnapshot, server: NoteSnapshot): NoteSnapshot {
  const itemMap = new Map<string, SyncItem>();
  for (const it of server.items) itemMap.set(it.id, it);
  for (const it of local.items) {
    const serverItem = itemMap.get(it.id);
    itemMap.set(it.id, serverItem ? mergeItem(it, serverItem) : it);
  }
  return { note: mergeNoteMeta(local.note, server.note), items: [...itemMap.values()] };
}

// ── 同期本体 ─────────────────────────────────────────────────────────────
export interface SyncResult {
  pushed: number;
  pulled: number;
  conflicts: number;
  errors: string[];
}

export async function syncNow(): Promise<SyncResult> {
  const settings = await getSyncSettings();
  if (!settings.enabled) throw new Error('同期がオフになっています');
  if (!settings.endpoint) throw new Error('同期サーバーのURLが設定されていません');
  if (!settings.spaceId) throw new Error('同期コードが設定されていません');
  if (!settings.token) throw new Error('未ログインです。設定画面で同期コードを再入力してください。');

  const { endpoint, spaceId, token } = settings;
  const authHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const result: SyncResult = { pushed: 0, pulled: 0, conflicts: 0, errors: [] };
  let authExpired = false;

  // ── Push: dirtyなノートだけ。0件ならHTTPを投げない ──
  const revs = await invoke<NoteRevInfo[]>('list_note_revs');
  const dirty = revs.filter((r) => r.dirty);

  for (const info of dirty) {
    if (authExpired) break;
    try {
      const syncedAt = new Date().toISOString();
      const snapshot = await invoke<NoteSnapshot>('get_note_snapshot', { noteId: info.id });
      const res = await fetch(`${endpoint}/api/space/${spaceId}/note/${info.id}`, {
        method: 'PUT',
        headers: authHeaders,
        body: JSON.stringify({ expectedRev: info.rev, snapshot }),
      });
      if (res.status === 401) {
        authExpired = true;
        result.errors.push('認証切れ: 設定画面で同期コードを再入力してください');
        break;
      }
      if (res.status === 409) {
        const data = (await res.json()) as { server: NoteSnapshot };
        const merged = mergeSnapshots(snapshot, data.server);
        await invoke('apply_remote_note', { snapshot: merged, markDirty: true });
        result.conflicts++;
        continue;
      }
      if (!res.ok) {
        result.errors.push(`同期に失敗しました (${info.id.slice(0, 8)}…): ${res.status}`);
        continue;
      }
      const { rev } = (await res.json()) as { rev: number };
      await invoke('mark_note_synced', { noteId: info.id, rev, syncedAt });
      result.pushed++;
    } catch (e) {
      log.error('[sync] push failed:', info.id, e);
      result.errors.push(`同期に失敗しました (${info.id.slice(0, 8)}…): ${e}`);
    }
  }

  // ── Pull: サーバー側の軽量indexを見て、ローカルより新しいノートだけ取得 ──
  if (!authExpired) {
    try {
      const res = await fetch(`${endpoint}/api/space/${spaceId}/index`, { headers: authHeaders });
      if (res.status === 401) {
        result.errors.push('認証切れ: 設定画面で同期コードを再入力してください');
      } else if (res.ok) {
        const { notes: serverIndex } = (await res.json()) as { notes: { id: string; rev: number }[] };
        const localRevs = await invoke<NoteRevInfo[]>('list_note_revs');
        const localMap = new Map(localRevs.map((r) => [r.id, r]));
        for (const entry of serverIndex) {
          const local = localMap.get(entry.id);
          if (local?.dirty) continue; // 次回pushで扱う。pullで上書きしない
          if (local && local.rev >= entry.rev) continue; // 既に最新
          try {
            const noteRes = await fetch(`${endpoint}/api/space/${spaceId}/note/${entry.id}`, { headers: authHeaders });
            if (!noteRes.ok) continue;
            const { body } = (await noteRes.json()) as { body: NoteSnapshot };
            await invoke('apply_remote_note', { snapshot: body, markDirty: false });
            result.pulled++;
          } catch (e) {
            log.error('[sync] pull failed:', entry.id, e);
            result.errors.push(`受信に失敗しました (${entry.id.slice(0, 8)}…): ${e}`);
          }
        }
      }
    } catch (e) {
      log.error('[sync] index fetch failed:', e);
      result.errors.push(`同期一覧の取得に失敗しました: ${e}`);
    }
  }

  await setKv('sync_last_ok', new Date().toISOString());
  return result;
}
