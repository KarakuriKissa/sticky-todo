// Update-check failure classification. Pure logic (no Tauri calls) so it can
// be unit-tested with bun test. See SettingsModal.tsx / Launcher.tsx for the
// actual invoke('preflight_update_check') + check() call sites.

// A version baked into tauri.conf.json / package.json / Cargo.toml for local
// dev builds. CI overwrites this to "0.1.<run_number>" only inside the
// ephemeral checkout (never committed), so a running app reporting exactly
// this version is always a local/dev build, never an official release.
export const DEV_APP_VERSION = '0.1.0';

// Mirrors the Rust `UpdatePreflight` enum (src-tauri/src/commands.rs).
export type UpdatePreflight =
  | { kind: 'Ok' }
  | { kind: 'Offline' }
  | { kind: 'RateLimited'; retry_after_secs: number | null }
  | { kind: 'NotFound' }
  | { kind: 'HttpError'; status: number };

export type UpdateCheckFailure =
  | { kind: 'offline' }
  | { kind: 'rate-limited'; waitMinutes: number | null }
  | { kind: 'not-found' }
  | { kind: 'signature' }
  | { kind: 'http'; status: number }
  | { kind: 'unknown'; detail: string };

// Failure from the reqwest-based preflight (has real HTTP status/headers).
export function classifyPreflight(p: UpdatePreflight): UpdateCheckFailure | null {
  switch (p.kind) {
    case 'Ok':
      return null;
    case 'Offline':
      return { kind: 'offline' };
    case 'RateLimited': {
      const waitMinutes = p.retry_after_secs != null
        ? Math.max(1, Math.ceil(p.retry_after_secs / 60))
        : null;
      return { kind: 'rate-limited', waitMinutes };
    }
    case 'NotFound':
      return { kind: 'not-found' };
    case 'HttpError':
      return { kind: 'http', status: p.status };
  }
}

// Best-effort classification of whatever the Tauri updater plugin's check()/
// downloadAndInstall() rejects with. The plugin serializes its Rust error via
// Display, so this is always a plain string (see tauri-plugin-updater's
// error.rs `impl Serialize for Error`), but we defensively accept Error/unknown too.
export function classifyCheckError(raw: unknown): UpdateCheckFailure {
  const msg = typeof raw === 'string'
    ? raw
    : raw instanceof Error
      ? raw.message
      : String(raw);

  if (/dns error|error trying to connect|connection refused|network is unreachable|timed out/i.test(msg)) {
    return { kind: 'offline' };
  }
  if (/signature|minisign/i.test(msg)) {
    return { kind: 'signature' };
  }
  if (/could not fetch a valid release json|releasenotfound/i.test(msg)) {
    return { kind: 'not-found' };
  }
  return { kind: 'unknown', detail: msg };
}

export function messageForUpdateFailure(f: UpdateCheckFailure): string {
  switch (f.kind) {
    case 'offline':
      return 'ネットに接続できませんでした。接続状態を確認してください。';
    case 'rate-limited':
      return f.waitMinutes != null
        ? `GitHubの通信回数制限に達しました。約${f.waitMinutes}分後にもう一度お試しください。`
        : 'GitHubの通信回数制限に達しました。しばらく待ってからもう一度お試しください。';
    case 'not-found':
      return '更新情報が見つかりませんでした（リリースが未公開の可能性があります）。';
    case 'signature':
      return '更新データの署名検証に失敗しました。配布元が改ざんされている可能性があるため中止しました。';
    case 'http':
      return `更新確認に失敗しました（HTTP ${f.status}）。`;
    case 'unknown':
      return `更新確認に失敗しました: ${f.detail}`;
  }
}
