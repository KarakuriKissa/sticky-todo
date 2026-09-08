import { useT, useI18nStore, type Lang } from '../../i18n';

// Display settings — currently just the UI language.
export function DisplayTab() {
  const t = useT();
  const lang = useI18nStore((s) => s.lang);
  const setLang = useI18nStore((s) => s.setLang);

  return (
    <section>
      <div className="settings-field-row" title={t('adv.langDesc')}>
        <span className="settings-field-label">{t('adv.langTitle')}</span>
        <select value={lang} onChange={(e) => setLang(e.target.value as Lang)}
          style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text)', padding: '3px 8px', fontSize: 12 }}>
          <option value="ja">{t('lang.ja')}</option>
          <option value="en">{t('lang.en')}</option>
        </select>
      </div>
    </section>
  );
}
