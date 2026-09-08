import { useAppStore } from '../../store/appStore';
import type { AppSettings } from '../../types';
import { useT } from '../../i18n';

interface Props {
  draft: AppSettings;
  setDraft: (updater: (d: AppSettings) => AppSettings) => void;
}

const numberInput = { width: 48, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text)', padding: '2px 6px', outline: 'none' as const };

// Behavior settings — deadline warning, desktop notification interval,
// link browser, tutorial sample lists.
export function BehaviorTab({ draft, setDraft }: Props) {
  const t = useT();

  return (
    <section>
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
    </section>
  );
}
