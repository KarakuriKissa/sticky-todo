import { useEffect, useState } from 'react';
import {
  applySyncCode, countDirtyNotes, generateSyncCode, getSyncSettings,
  setSyncEnabled, setSyncEndpoint, syncNow,
} from '../../utils/sync';

// ネット同期（Phase 1・手動同期のみ）。
// 設定は AppSettings ではなく settings テーブルの KV（sync_*）に保存される。
export function SyncTab() {
  const [enabled, setEnabled] = useState(false);
  const [endpoint, setEndpoint] = useState('');
  const [spaceId, setSpaceId] = useState('');
  const [hasToken, setHasToken] = useState(false);
  const [lastOk, setLastOk] = useState<string | null>(null);
  const [dirtyCount, setDirtyCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [newCode, setNewCode] = useState<string | null>(null); // 発行直後だけ表示（再表示不可）
  const [codeInput, setCodeInput] = useState('');

  const refresh = async () => {
    const s = await getSyncSettings();
    setEnabled(s.enabled);
    setEndpoint(s.endpoint);
    setSpaceId(s.spaceId);
    setHasToken(!!s.token);
    setLastOk(s.lastOk);
    setDirtyCount(await countDirtyNotes());
  };

  useEffect(() => { refresh(); }, []);

  const toggleEnabled = async (on: boolean) => {
    await setSyncEnabled(on);
    setEnabled(on);
  };

  const commitEndpoint = async () => {
    await setSyncEndpoint(endpoint);
    await refresh();
  };

  const onCreateCode = async () => {
    if (!endpoint.trim()) { alert('先に同期サーバーのURLを入力してください'); return; }
    setBusy(true);
    try {
      await commitEndpoint();
      const code = generateSyncCode();
      await applySyncCode(endpoint.trim(), code);
      setNewCode(code);
      await refresh();
    } catch (e) {
      alert('同期コードの作成に失敗しました: ' + e);
    } finally {
      setBusy(false);
    }
  };

  const onApplyCode = async () => {
    if (!codeInput.trim()) return;
    setBusy(true);
    try {
      await commitEndpoint();
      await applySyncCode(endpoint.trim(), codeInput.trim());
      setCodeInput('');
      alert('同期コードを適用しました。「今すぐ同期」でこのパソコンのデータを同期できます。');
      await refresh();
    } catch (e) {
      alert('同期コードの適用に失敗しました: ' + e);
    } finally {
      setBusy(false);
    }
  };

  const onSyncNow = async () => {
    setBusy(true);
    setLastError(null);
    try {
      const r = await syncNow();
      await refresh();
      if (r.errors.length > 0) setLastError(r.errors.join(' / '));
      alert(`同期完了\n送信: ${r.pushed}件 / 受信: ${r.pulled}件 / 競合解決: ${r.conflicts}件${r.errors.length ? `\nエラー: ${r.errors.length}件` : ''}`);
    } catch (e) {
      setLastError(String(e));
      alert('同期に失敗しました: ' + e);
    } finally {
      setBusy(false);
    }
  };

  const para = { fontSize: 11, color: 'var(--muted)', marginBottom: 10, lineHeight: 1.6 };
  const inputStyle = { flex: 1, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text)', padding: '4px 8px', fontSize: 12 };

  return (
    <section>
      <h3>ネット同期（β）</h3>
      <p style={para}>
        別のパソコンとリスト・タスクを同期します。データはこのアプリ専用のサーバーに保存され、
        「同期コード」を知っている端末だけがアクセスできます。<br />
        自動同期はしません。「今すぐ同期」を押したときだけ通信します。
      </p>
      <label className="toggle-row">
        <input type="checkbox" checked={enabled} onChange={(e) => toggleEnabled(e.target.checked)} />
        ネット同期を有効にする
      </label>

      {enabled && (
        <>
          <h3 style={{ marginTop: 20 }}>同期サーバー</h3>
          <p style={para}>
            Cloudflare Workers のURL（例: <code>https://sticky-todo-sync.xxxx.workers.dev</code>）
          </p>
          <input
            type="text"
            value={endpoint}
            placeholder="https://sticky-todo-sync.xxxx.workers.dev"
            onChange={(e) => setEndpoint(e.target.value)}
            onBlur={commitEndpoint}
            style={{ ...inputStyle, width: '100%' }}
          />

          <h3 style={{ marginTop: 20 }}>同期コード</h3>
          {spaceId ? (
            <p style={para}>
              現在のスペースID: <code>{spaceId}</code>（{hasToken ? 'ログイン済み' : '未ログイン'}）
            </p>
          ) : (
            <p style={para}>まだ同期コードが設定されていません。</p>
          )}

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
            <button className="btn-secondary" style={{ fontSize: 12, padding: '5px 12px' }} disabled={busy} onClick={onCreateCode}>
              🆕 新しい同期コードを作成
            </button>
          </div>

          {newCode && (
            <div style={{ marginBottom: 12, padding: 10, background: 'rgba(74,222,128,.1)', border: '1px solid rgba(74,222,128,.4)', borderRadius: 6 }}>
              <p style={{ fontSize: 12, marginBottom: 6 }}>
                <strong>この同期コードは今だけ表示されます。</strong>他のパソコンの設定画面にコピーして貼り付けてください。
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                <input readOnly value={newCode} style={{ ...inputStyle, fontFamily: 'monospace' }} onFocus={(e) => e.target.select()} />
                <button className="btn-secondary" style={{ fontSize: 12, padding: '5px 10px' }}
                  onClick={() => { navigator.clipboard.writeText(newCode); }}>📋 コピー</button>
              </div>
            </div>
          )}

          <p style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>
            他のパソコンで発行した同期コードを、このパソコンにも入力してください：
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="text"
              value={codeInput}
              placeholder="st1.xxxxxxxx...xxxxxxxx"
              onChange={(e) => setCodeInput(e.target.value)}
              style={{ ...inputStyle, fontFamily: 'monospace' }}
            />
            <button className="btn-primary" style={{ fontSize: 12, padding: '5px 12px' }} disabled={busy || !codeInput.trim()} onClick={onApplyCode}>
              適用
            </button>
          </div>

          <h3 style={{ marginTop: 20 }}>同期状態</h3>
          <p style={{ fontSize: 12, lineHeight: 1.8, marginBottom: 8 }}>
            最終同期: {lastOk ? new Date(lastOk).toLocaleString('ja-JP') : '未実施'}<br />
            未同期のリスト: {dirtyCount}件<br />
            {lastError && <span style={{ color: '#ef4444' }}>直近のエラー: {lastError}</span>}
          </p>
          <button className="btn-primary" style={{ fontSize: 12, padding: '6px 14px' }} disabled={busy || !spaceId} onClick={onSyncNow}>
            {busy ? '同期中…' : '🔄 今すぐ同期'}
          </button>
        </>
      )}
    </section>
  );
}
