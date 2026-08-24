/**
 * 認証まわりの純粋関数（KV/fetch非依存・Node/Workers両対応）
 * spaceId + passphrase 方式の Bearer トークン発行/検証を担う。
 * ネットワークI/O（KV読み書き）を含まないため、そのままNodeテストできる。
 * hmac/timingSafeEqual は Pano360 (worker/src/auth.js) からそのまま流用。
 */

export async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function timingSafeEqual(a, b) {
  const ab = new TextEncoder().encode(String(a == null ? '' : a));
  const bb = new TextEncoder().encode(String(b == null ? '' : b));
  if (ab.length !== bb.length) {
    let x = 0;
    for (let i = 0; i < ab.length; i++) x |= ab[i];
    return false;
  }
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

const TOKEN_DAYS = 365;

// Bearer トークンは "spaceId.exp.sig"（HMAC-SHA256）。
export async function createToken(secret, spaceId, days = TOKEN_DAYS) {
  const exp = Date.now() + days * 24 * 60 * 60 * 1000;
  const sig = await hmac(secret, `${spaceId}.${exp}`);
  return `${spaceId}.${exp}.${sig}`;
}

export async function verifyToken(secret, token) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [spaceId, expStr, sig] = parts;
  const exp = parseInt(expStr, 10);
  if (!spaceId || !exp || Date.now() > exp) return null;
  const expect = await hmac(secret, `${spaceId}.${expStr}`);
  if (!timingSafeEqual(sig, expect)) return null;
  return spaceId;
}

// クライアントが生成する spaceId は randId(22) 相当（小文字英数字）を想定。
export function isValidSpaceId(id) {
  return typeof id === 'string' && /^[a-z0-9]{10,64}$/.test(id);
}
