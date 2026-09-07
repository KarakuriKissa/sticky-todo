import { invoke } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';
import { useAppStore } from '../../store/appStore';
import type { AppSettings } from '../../types';
import { useT, useI18nStore, type Lang } from '../../i18n';

interface Props {
  draft: AppSettings;
  setDraft: (updater: (d: AppSettings) => AppSettings) => void;
}

// Advanced settings — deadline warning, desktop notification interval,
// autostart, DB export/import/delete actions.
export function AdvancedTab({ draft, setDraft }: Props) {
  const t = useT();
  const lang = useI18nStore((s) => s.lang);
  const setLang = useI18nStore((s) => s.setLang);

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

  // Backup list — (full_path, filename) pairs, newest first.
  const [backups, setBackups] = useState<[string, string][]>([]);
  const refreshBackups = async () => {
    try {
      setBackups(await invoke<[string, string][]>('list_backups'));
    } catch { /* ignore */ }
  };
  useEffect(() => { refreshBackups(); }, []);

  const onExport = async () => {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const ts = new Date().toISOString().slice(0, 10);
    const path = await save({
      title: t('adv.exportDialogTitle'),
      defaultPath: `sticky-todo-${ts}.db`,
      filters: [{ name: 'SQLite Database', extensions: ['db'] }],
    });
    if (!path) return;
    try {
      await invoke('export_database', { destPath: path });
      alert(t('adv.exportedAlert'));
    } catch (e) {
      alert(t('adv.exportFailedAlert', { error: String(e) }));
    }
  };

  const onImport = async () => {
    const { open, confirm } = await import('@tauri-apps/plugin-dialog');
    const path = await open({
      title: t('adv.importDialogTitle'),
      multiple: false,
      directory: false,
      filters: [{ name: 'SQLite Database', extensions: ['db'] }],
    });
    if (!path || typeof path !== 'string') return;
    const ok = await confirm(
      t('adv.importConfirmBody'),
      { title: t('adv.importConfirmTitle'), kind: 'warning' },
    );
    if (!ok) return;
    try { await invoke('import_database', { srcPath: path }); }
    catch (e) { alert(t('adv.importFailedAlert', { error: String(e) })); }
  };

  const onBackupNow = async () => {
    try {
      await invoke<string>('backup_database');
      await refreshBackups();
      alert(t('adv.backupCreatedAlert'));
    } catch (e) {
      alert(t('adv.backupFailedAlert', { error: String(e) }));
    }
  };

  const onRestoreBackup = async (path: string, name: string) => {
    const { confirm } = await import('@tauri-apps/plugin-dialog');
    const ok = await confirm(
      t('adv.restoreConfirmBody', { name }),
      { title: t('adv.restoreConfirmTitle'), kind: 'warning' },
    );
    if (!ok) return;
    try { await invoke('import_database', { srcPath: path }); }
    catch (e) { alert(t('adv.restoreFailedAlert', { error: String(e) })); }
  };

  const onDelete = async () => {
    const { confirm } = await import('@tauri-apps/plugin-dialog');
    const ok = await confirm(
      t('adv.deleteConfirmBody'),
      { title: t('adv.deleteConfirmTitle'), kind: 'warning' },
    );
    if (!ok) return;
    try { await invoke('delete_database'); }
    catch (e) { alert(t('adv.deleteFailedAlert', { error: String(e) })); }
  };

  const onResetTutorial = async () => {
    try {
      // localStorage を先にクリア。delete_database は app.restart() を呼ぶため
      // それ以降の JS は実行されない。
      localStorage.removeItem('sticky-todo:tutorial-seeded');
      localStorage.removeItem('sticky-todo:last-seen-build');
      await invoke('delete_database'); // ← アプリが即座に再起動される
    } catch (e) {
      alert(t('adv.resetFailedAlert', { error: String(e) }));
    }
  };

  const numberInput = { width: 48, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text)', padding: '2px 6px', outline: 'none' as const };

  return (
    <section>
      {/* ── 表示 ── */}
      <h3>{t('adv.sectionDisplay')}</h3>
      <div className="settings-field-row" title={t('adv.langDesc')}>
        <span className="settings-field-label">{t('adv.langTitle')}</span>
        <select value={lang} onChange={(e) => setLang(e.target.value as Lang)}
          style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text)', padding: '3px 8px', fontSize: 12 }}>
          <option value="ja">{t('lang.ja')}</option>
          <option value="en">{t('lang.en')}</option>
        </select>
      </div>

      {/* ── 動作 ── */}
      <h3 style={{ marginTop: 20 }}>{t('adv.sectionBehavior')}</h3>
      <label className="toggle-row" title={t('adv.deadlineDesc')}>
        <span className="settings-field-label">{t('adv.deadlineTitle')}</span>
        {t('adv.deadlinePrefix')}
        <input type="number" min={0} max={30}
          value={draft.deadline_warn_days}
          onChange={(e) => setDraft((d) => ({ ...d, deadline_warn_days: Number(e.target.value) }))}
          style={numberInput} />
        {t('adv.deadlineSuffix')}
      </label>
      <label className="toggle-row" title={`${t('adv.notifDescLine1')} ${t('adv.notifDescLine2Bold')}${t('adv.notifDescLine2Suffix')}`}>
        <span className="settings-field-label">{t('adv.notifShortLabel')}</span>
        {t('adv.checkInterval')}
        <input type="number" min={0} max={1440}
          value={draft.reminder_interval_min ?? 30}
          onChange={(e) => setDraft((d) => ({ ...d, reminder_interval_min: Number(e.target.value) }))}
          style={{ ...numberInput, width: 64 }} />
        {t('adv.minutesSuffix')}
      </label>
      <div
        className="settings-field-row"
        title={`${t('adv.browserDescLine1')} ${t('adv.browserDescLine2Bold')}${t('adv.browserDescLine2Suffix')}\n${t('adv.browserExampleWin')} C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe\n${t('adv.browserExampleMac')} Google Chrome${t('adv.browserExampleMacSuffix')}`}
      >
        <span className="settings-field-label">{t('adv.browserShortLabel')}</span>
        <input
          type="text"
          value={draft.browser_path ?? ''}
          placeholder={t('adv.browserPlaceholder')}
          onChange={(e) => setDraft((d) => ({ ...d, browser_path: e.target.value }))}
          style={{ flex: 1, minWidth: 120, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text)', padding: '4px 8px', fontSize: 12 }}
        />
        <button className="btn-secondary" style={{ fontSize: 12, padding: '5px 10px' }}
          onClick={async () => {
            const { open } = await import('@tauri-apps/plugin-dialog');
            const path = await open({ title: t('adv.browserDialogTitle'), multiple: false, directory: false });
            if (typeof path === 'string') setDraft((d) => ({ ...d, browser_path: path }));
          }}>{t('adv.browse')}</button>
      </div>
      <div className="settings-field-row" title={t('adv.sampleDesc')}>
        <span className="settings-field-label">{t('adv.sampleShortLabel')}</span>
        <button
          className="btn-secondary"
          style={{ fontSize: 12, padding: '5px 12px' }}
          onClick={async () => {
            try {
              await useAppStore.getState().reseedTutorial();
              alert(t('adv.sampleAddedAlert'));
            } catch (e) {
              alert(t('adv.sampleFailedAlert', { error: String(e) }));
            }
          }}
        >{t('adv.addSample')}</button>
      </div>

      {/* ── 起動 ── */}
      <h3 style={{ marginTop: 20 }}>{t('adv.sectionStartup')}</h3>
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

      {/* ── データ ── */}
      <h3 style={{ marginTop: 20 }}>{t('adv.sectionData')}</h3>
      <div className="settings-field-row" title={`${t('adv.dbDescLine1')}\n${t('adv.dbDescLine2')}`}>
        <span className="settings-field-label">{t('adv.dbTitle')}</span>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn-secondary" style={{ fontSize: 12, padding: '5px 12px' }} onClick={onExport}>{t('adv.export')}</button>
          <button className="btn-secondary" style={{ fontSize: 12, padding: '5px 12px' }} onClick={onImport}>{t('adv.import')}</button>
          <button className="btn-secondary" style={{ fontSize: 12, padding: '5px 12px', color: '#ef4444', borderColor: '#ef4444' }} onClick={onDelete}>{t('adv.deleteDb')}</button>
        </div>
      </div>
      <div
        className="settings-field-row"
        title={`${t('adv.backupDescLine1')} ${t('adv.backupDescLine2Bold')}${t('adv.notifDescLine2Suffix')}`}
      >
        <span className="settings-field-label">{t('adv.backupShortLabel')}</span>
        {t('adv.backupInterval')}
        <input type="number" min={0} max={1440}
          value={draft.backup_interval_min ?? 60}
          onChange={(e) => setDraft((d) => ({ ...d, backup_interval_min: Number(e.target.value) }))}
          style={{ ...numberInput, width: 64 }} />
        {t('adv.minutesSuffix')}
        <button className="btn-secondary" style={{ fontSize: 12, padding: '5px 12px' }} onClick={onBackupNow}>{t('adv.backupNow')}</button>
      </div>
      {backups.length > 0 && (
        <div style={{ marginTop: 4, marginLeft: 72 }}>
          <p style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>{t('adv.savedBackups')}</p>
          {backups.map(([path, name]) => (
            <div key={path} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '3px 0' }}>
              <span style={{ flex: 1, fontFamily: 'monospace' }}>{name}</span>
              <button className="btn-secondary" style={{ fontSize: 11, padding: '2px 8px' }}
                onClick={() => onRestoreBackup(path, name)}>{t('adv.restore')}</button>
            </div>
          ))}
        </div>
      )}
      <div style={{ fontSize: 12, lineHeight: 1.7, padding: '10px 12px', background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.3)', borderRadius: 6, marginTop: 12, marginBottom: 10 }}>
        <strong style={{ color: '#ef4444' }}>{t('adv.dangerBold')}</strong><br />
        {t('adv.dangerLine2')}<br />
        {t('adv.dangerLine3')}
      </div>
      <button
        className="btn-secondary"
        style={{ fontSize: 12, padding: '5px 12px', color: '#ef4444', borderColor: '#ef4444' }}
        onClick={async () => {
          const { confirm } = await import('@tauri-apps/plugin-dialog');
          const ok = await confirm(
            t('adv.resetConfirmBody'),
            { title: t('adv.resetConfirmTitle'), kind: 'warning' },
          );
          if (ok) onResetTutorial();
        }}
      >
        {t('adv.resetApp')}
      </button>
    </section>
  );
}
