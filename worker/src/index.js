/**
 * sticky-todo-sync — ノート単位スナップショット同期 Worker
 *
 * 設計:
 * - サーバーは平文保存（E2E暗号化なし）。将来 enc:"aes-gcm" へ移行できるよう
 *   全データを {"v":1,"enc":"none","body":{...}} の封筒形式でKVに格納する。
 * - アクセスは「スペースID + パスフレーズ」の同期コード1本。POST /api/login で
 *   スペースIDに紐づくパスフレーズを検証し（未登録なら初回ログインで登録=TOFU）、
 *   Bearerトークンを発行する。
 * - PUT /api/space/:id/note/:noteId はサーバー採番の rev による楽観ロック。
 *   クライアントは自分が最後に知っている rev (expectedRev) を送り、現在の
 *   サーバー側revと一致しなければ 409 + サーバー側の現在値を返す。
 * - GET /api/space/:id/index は id/rev/title/updated_at/deleted_at だけの
 *   軽量JSON（1キー）。全ノート走査・全JSONパースはしない（Worker CPU 10ms対策）。
 * - KVは結果整合性なので、PUT成功時は書いた値を読み直さず、その場で計算した
 *   新revをそのままレスポンスする。
 */

import { hmac, timingSafeEqual, createToken, verifyToken, isValidSpaceId } from './auth.js';

const NOTE_KEY = (spaceId, noteId) => `space:${spaceId}:note:${noteId}`;
const INDEX_KEY = (spaceId) => `space:${spaceId}:index`;
const AUTH_KEY = (spaceId) => `space:${spaceId}:auth`;

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Headers': 'authorization,content-type',
    'Access-Control-Allow-Methods': 'GET,PUT,POST,OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function json(data, status, origin, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin), ...extraHeaders },
  });
}

function envelope(body) {
  return { v: 1, enc: 'none', body };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    const origin = request.headers.get('Origin');

    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    try {
      if (path === '/api/login' && method === 'POST') {
        return await handleLogin(request, env, origin);
      }

      let m;
      if ((m = path.match(/^\/api\/space\/([a-z0-9]{10,64})\/note\/([\w-]{1,80})$/))) {
        const [, spaceId, noteId] = m;
        const auth = await requireAuth(request, env, spaceId);
        if (!auth.ok) return json({ error: auth.error }, 401, origin);
        if (method === 'PUT') return await handleNotePut(request, env, spaceId, noteId, origin);
        if (method === 'GET') return await handleNoteGet(env, spaceId, noteId, origin);
      }
      if ((m = path.match(/^\/api\/space\/([a-z0-9]{10,64})\/index$/)) && method === 'GET') {
        const [, spaceId] = m;
        const auth = await requireAuth(request, env, spaceId);
        if (!auth.ok) return json({ error: auth.error }, 401, origin);
        return await handleIndexGet(env, spaceId, origin);
      }

      return json({ error: 'not_found' }, 404, origin);
    } catch (e) {
      return json({ error: 'internal_error', message: String(e) }, 500, origin);
    }
  },
};

async function requireAuth(request, env, spaceId) {
  if (!env.SYNC_SECRET) return { ok: false, error: 'server_misconfigured' };
  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return { ok: false, error: 'missing_token' };
  const tokenSpaceId = await verifyToken(env.SYNC_SECRET, token);
  if (!tokenSpaceId || !timingSafeEqual(tokenSpaceId, spaceId)) {
    return { ok: false, error: 'invalid_token' };
  }
  return { ok: true };
}

async function handleLogin(request, env, origin) {
  if (!env.SYNC_SECRET) return json({ error: 'server_misconfigured' }, 500, origin);
  let data;
  try { data = await request.json(); } catch { return json({ error: 'bad_request' }, 400, origin); }
  const { spaceId, passphrase } = data || {};
  if (!isValidSpaceId(spaceId) || typeof passphrase !== 'string' || passphrase.length < 6) {
    return json({ error: 'bad_request' }, 400, origin);
  }

  const passHash = await hmac(env.SYNC_SECRET, passphrase);
  const existingRaw = await env.SYNC.get(AUTH_KEY(spaceId));
  if (existingRaw) {
    let existing = null;
    try { existing = JSON.parse(existingRaw); } catch { /* corrupt — treat as mismatch below */ }
    if (!existing || !timingSafeEqual(existing.passHash, passHash)) {
      return json({ error: 'invalid_passphrase' }, 401, origin);
    }
  } else {
    // 初回ログイン: このスペースIDのパスフレーズを登録する（TOFU）。
    await env.SYNC.put(AUTH_KEY(spaceId), JSON.stringify({ passHash, createdAt: Date.now() }));
  }

  const token = await createToken(env.SYNC_SECRET, spaceId);
  return json({ token }, 200, origin);
}

async function handleNoteGet(env, spaceId, noteId, origin) {
  const raw = await env.SYNC.get(NOTE_KEY(spaceId, noteId));
  if (!raw) return json({ error: 'not_found' }, 404, origin);
  return new Response(raw, { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) } });
}

async function handleNotePut(request, env, spaceId, noteId, origin) {
  let data;
  try { data = await request.json(); } catch { return json({ error: 'bad_request' }, 400, origin); }
  const { expectedRev, snapshot } = data || {};
  if (
    typeof expectedRev !== 'number' ||
    !snapshot || !snapshot.note || snapshot.note.id !== noteId || !Array.isArray(snapshot.items)
  ) {
    return json({ error: 'bad_request' }, 400, origin);
  }

  const currentRaw = await env.SYNC.get(NOTE_KEY(spaceId, noteId));
  let current = null;
  let currentRev = 0;
  if (currentRaw) {
    try {
      current = JSON.parse(currentRaw).body;
      currentRev = current?.note?.rev ?? 0;
    } catch { current = null; currentRev = 0; }
  }
  if (current && currentRev !== expectedRev) {
    return json({ error: 'conflict', server: current }, 409, origin);
  }

  const newRev = currentRev + 1;
  const body = { note: { ...snapshot.note, rev: newRev }, items: snapshot.items };
  await env.SYNC.put(NOTE_KEY(spaceId, noteId), JSON.stringify(envelope(body)));

  // Lightweight index — single small JSON blob per space, never the full note list.
  const indexRaw = await env.SYNC.get(INDEX_KEY(spaceId));
  let index = [];
  if (indexRaw) {
    try { index = JSON.parse(indexRaw).body ?? []; } catch { index = []; }
  }
  const nextIndex = index.filter((e) => e.id !== noteId);
  nextIndex.push({
    id: noteId,
    rev: newRev,
    title: body.note.title,
    updated_at: body.note.updated_at,
    deleted_at: body.note.deleted_at ?? null,
  });
  await env.SYNC.put(INDEX_KEY(spaceId), JSON.stringify(envelope(nextIndex)));

  // KV is eventually consistent — trust the rev we just computed, don't re-read.
  return json({ rev: newRev }, 200, origin);
}

async function handleIndexGet(env, spaceId, origin) {
  const raw = await env.SYNC.get(INDEX_KEY(spaceId));
  let index = [];
  if (raw) {
    try { index = JSON.parse(raw).body ?? []; } catch { index = []; }
  }
  return json({ notes: index }, 200, origin);
}
