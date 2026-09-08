import { invoke } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';
import type { AppSettings } from '../../types';
import { useT } from '../../i18n';

interface Props {
  draft: AppSettings;
  setDraft: (updater: (d: AppSettings) => AppSettings) => void;
}

// Startup settings — reopen previously open lists, launch at Windows startup.
export function StartupTab({ draft, setDraft }: Props) {
  const t = useT();

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
    </section>
  );
}
