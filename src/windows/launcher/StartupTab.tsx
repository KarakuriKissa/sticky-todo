import { invoke } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import type { AppSettings } from '../../types';
import {
  DEV_APP_VERSION,
  classifyCheckError,
  classifyPreflight,
  messageForUpdateFailure,
  type UpdateCheckFailure,
  type UpdatePreflight,
} from '../../utils/updateCheck';
import { useT } from '../../i18n';

interface Props {
  draft: AppSettings;
  setDraft: (updater: (d: AppSettings) => AppSettings) => void;
}

// Startup settings — reopen previously open lists, launch at Windows startup,
// check for app updates.
export function StartupTab({ draft, setDraft }: Props) {
  const t = useT();

  const [appVersion, setAppVersion] = useState<string>('');
  useEffect(() => { getVersion().then(setAppVersion).catch(() => {}); }, []);

  // 'idle' | 'dev' | 'checking' | 'latest' | 'update' | 'downloading' | 'error'
  const [updateState, setUpdateState] = useState<
    | { kind: 'idle' }
    | { kind: 'dev' }
    | { kind: 'checking' }
    | { kind: 'latest' }
    | { kind: 'update'; update: Update }
    | { kind: 'downloading'; percent: number }
    | { kind: 'error'; failure: UpdateCheckFailure }
  >({ kind: 'idle' });

  const checkUpdate = async () => {
    // 開発版(ローカルビルド)は常に v0.1.0 のまま。公式リリースは CI が
    // 0.1.<run番号> を焼き込むため、この一致は「未リリースの開発版」の確実な判定になる
    if (appVersion === DEV_APP_VERSION) {
      setUpdateState({ kind: 'dev' });
      return;
    }
    setUpdateState({ kind: 'checking' });
    try {
      // Tauri updater plugin: 埋め込み公開鍵で署名検証したうえで
      // latest.json (GitHub Releases) と現在のバージョンを比較する
      const update = await check();
      if (update) {
        setUpdateState({ kind: 'update', update });
      } else {
        setUpdateState({ kind: 'latest' });
      }
    } catch (e) {
      // tauri-plugin-updater の check() は HTTPステータスを握りつぶし、オフライン・
      // レート制限(403)・未検出(404)がすべて同じ汎用エラーになってしまう。
      // 素のHTTPで同じURLへ再アクセスし、実際の理由を区別してから表示する
      try {
        const preflight = await invoke<UpdatePreflight>('preflight_update_check');
        const failure = classifyPreflight(preflight);
        if (failure) {
          setUpdateState({ kind: 'error', failure });
          return;
        }
      } catch {
        // プリフライトも失敗した場合は元のエラーをそのまま出す
      }
      setUpdateState({ kind: 'error', failure: classifyCheckError(e) });
    }
  };

  const installUpdate = async (update: Update) => {
    setUpdateState({ kind: 'downloading', percent: 0 });
    try {
      let total = 0;
      let received = 0;
      await update.downloadAndInstall((event) => {
        if (event.event === 'Started') {
          total = event.data.contentLength ?? 0;
        } else if (event.event === 'Progress') {
          received += event.data.chunkLength;
          setUpdateState({ kind: 'downloading', percent: total > 0 ? Math.round((received / total) * 100) : 0 });
        }
      });
      // インストール(NSISをサイレント実行)完了。再起動して新バージョンを反映する
      await relaunch();
    } catch (e) {
      setUpdateState({ kind: 'error', failure: classifyCheckError(e) });
    }
  };

  // PC autostart — managed by the OS, not part of AppSettings, so we read/write
  // it directly via the autostart plugin.
  const [autostart, setAutostart] = useState(false);
  const [autostartBusy, setAutostartBusy] = useState(false);

  // Read current autostart state. On Windows use our own Rust command
  // (registry, properly quoted). On other OS fall back to the plugin.
  const readAutostart = async (): Promise<boolean> => {
    try {
      return await invoke<boolean>('get_launch_at_startup');
    } catch {
      try {
        const { isEnabled } = await import('@tauri-apps/plugin-autostart');
        return await isEnabled();
      } catch { return false; }
    }
  };
  useEffect(() => { readAutostart().then(setAutostart).catch(() => {}); }, []);

  const toggleAutostart = async (on: boolean) => {
    setAutostartBusy(true);
    try {
      let usedRust = true;
      try {
        // Windows: 自前のレジストリ登録（引用符付きフルパス）で確実に。
        await invoke('set_launch_at_startup', { enabled: on });
      } catch {
        // 非Windows等：プラグインへフォールバック。
        usedRust = false;
        const { enable, disable } = await import('@tauri-apps/plugin-autostart');
        if (on) await enable(); else await disable();
      }
      // 反映後の実状態を読み戻して表示（書き込み失敗の検知）。
      const actual = await readAutostart();
      setAutostart(actual);
      if (actual !== on) {
        alert(t('adv.autostartFailedAlert'));
      } else if (on && usedRust) {
        // 成功時の軽い確認（任意）。うるさければ削除可。
      }
    } catch (e) {
      alert(t('adv.autostartErrorAlert', { error: String(e) }));
    } finally {
      setAutostartBusy(false);
    }
  };

  return (
    <section>
      <label className="toggle-row" title={t('adv.startupDesc')}>
        <input type="checkbox"
          checked={draft.reopen_windows_on_start ?? true}
          onChange={(e) => setDraft((d) => ({ ...d, reopen_windows_on_start: e.target.checked }))} />
        {t('adv.reopenLabel')}
      </label>
      <label className="toggle-row">
        <input type="checkbox"
          checked={autostart}
          disabled={autostartBusy}
          onChange={(e) => toggleAutostart(e.target.checked)} />
        {t('adv.autostartLabel')}
      </label>

      <h4 style={{ marginTop: 16 }}>{t('upd.heading')}</h4>
      <p style={{ fontSize: 11, color: 'var(--muted)', margin: '0 0 6px' }}>
        {t('upd.currentVersionLabel')}: {appVersion ? `v${appVersion}` : t('upd.checking')}
      </p>
      <div style={{ fontSize: 12, lineHeight: 1.8 }}>
        <button
          className="btn-secondary"
          style={{ fontSize: 12, padding: '5px 12px' }}
          onClick={checkUpdate}
          disabled={updateState.kind === 'checking' || updateState.kind === 'downloading'}
        >
          {updateState.kind === 'checking' ? t('upd.checking') : t('upd.checkButton')}
        </button>
        {updateState.kind === 'dev' && (
          <span style={{ marginLeft: 12, color: 'var(--muted)', fontSize: 11 }}>{t('upd.devNotice')}</span>
        )}
        {updateState.kind === 'latest' && (
          <span style={{ marginLeft: 12, color: '#4ade80', fontWeight: 600 }}>{t('upd.latest')}</span>
        )}
        {updateState.kind === 'update' && (
          <div style={{ marginTop: 10, padding: 10, background: 'rgba(251,191,36,.12)', borderRadius: 6, borderLeft: '3px solid #fbbf24' }}>
            <b>{t('upd.found', { version: updateState.update.version })}</b>
            {updateState.update.body && (
              <p style={{ fontSize: 11, color: 'var(--muted)', margin: '6px 0', whiteSpace: 'pre-wrap' }}>{updateState.update.body}</p>
            )}
            <button
              className="btn-secondary"
              style={{ fontSize: 12, padding: '4px 10px', marginTop: 6 }}
              onClick={() => installUpdate(updateState.update)}
            >{t('upd.installRestart')}</button>
          </div>
        )}
        {updateState.kind === 'downloading' && (
          <span style={{ marginLeft: 12, color: 'var(--muted)' }}>
            {t('upd.downloading')} {updateState.percent > 0 ? `${updateState.percent}%` : ''}
          </span>
        )}
        {updateState.kind === 'error' && (
          <div style={{ marginTop: 8 }}>
            {/* messageForUpdateFailure() text comes from utils/updateCheck.ts,
                which stays Japanese-only regardless of UI language (out of
                scope for this i18n pass — see task notes). */}
            <span style={{ color: '#f87171', fontSize: 11 }}>{messageForUpdateFailure(updateState.failure)}</span>
            <button
              className="btn-secondary"
              style={{ fontSize: 11, padding: '3px 8px', marginLeft: 10 }}
              onClick={async () => {
                (await import('@tauri-apps/plugin-shell')).open('https://github.com/KarakuriKissa/sticky-todo/releases/latest');
              }}
            >{t('upd.manualDownload')}</button>
          </div>
        )}
      </div>
    </section>
  );
}
