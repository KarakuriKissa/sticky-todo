import { invoke } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';
import type { AppSettings } from '../../types';
import { useT } from '../../i18n';

interface Props {
  draft: AppSettings;
  setDraft: (updater: (d: AppSettings) => AppSettings) => void;
}

const numberInput = { width: 48, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text)', padding: '2px 6px', outline: 'none' as const };

// Data settings — DB export/import/delete, backups, app reset.
export function DataTab({ draft, setDraft }: Props) {
  const t = useT();

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

  return (
    <section>
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
