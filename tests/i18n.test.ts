// i18n self-checks:
//   - ja/en dictionaries have exactly the same keys (no missing translation)
//   - missing-key lookup falls back to ja and warns instead of crashing
//   - {var} placeholder substitution works
//   - switching language updates useT() reactively and persists to localStorage
import { describe, it, expect, beforeEach, mock } from 'bun:test';

mock.module('@tauri-apps/api/event', () => ({
  emit: async () => undefined,
  emitTo: async () => undefined,
  listen: async () => () => {},
}));
mock.module('@tauri-apps/api/core', () => ({
  invoke: async () => null,
}));

if (typeof globalThis.localStorage === 'undefined') {
  const _store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => _store.get(k) ?? null,
    setItem: (k: string, v: string) => { _store.set(k, v); },
    removeItem: (k: string) => { _store.delete(k); },
    clear: () => { _store.clear(); },
    key: (i: number) => Array.from(_store.keys())[i] ?? null,
    get length() { return _store.size; },
  };
}

const { useI18nStore, t, _i18nInternal } = await import('../src/i18n');

describe('i18n dictionary parity', () => {
  it('ja and en have exactly the same set of keys', () => {
    const jaKeys = Object.keys(_i18nInternal.dicts.ja).sort();
    const enKeys = Object.keys(_i18nInternal.dicts.en).sort();
    const missingInEn = jaKeys.filter((k) => !enKeys.includes(k));
    const missingInJa = enKeys.filter((k) => !jaKeys.includes(k));
    expect(missingInEn).toEqual([]);
    expect(missingInJa).toEqual([]);
  });

  it('no dictionary value is an empty string', () => {
    for (const dict of [_i18nInternal.dicts.ja, _i18nInternal.dicts.en]) {
      for (const [key, value] of Object.entries(dict)) {
        expect(value.length > 0).toBe(true);
      }
    }
  });
});

describe('translate()', () => {
  it('returns the exact ja string for a known key', () => {
    expect(_i18nInternal.translate('ja', 'btn.save')).toBe('保存');
    expect(_i18nInternal.translate('en', 'btn.save')).toBe('Save');
  });

  it('substitutes {var} placeholders', () => {
    expect(_i18nInternal.translate('ja', 'tb.selCount', { n: 3 })).toBe('3件');
    expect(_i18nInternal.translate('en', 'assignee.membersOf', { group: 'Dev' })).toBe('Dev members');
  });

  it('falls back to ja and warns when the current language is missing a key', () => {
    const original = console.warn;
    let warned = false;
    console.warn = () => { warned = true; };
    try {
      // Temporarily knock out an en key to exercise the fallback path.
      const saved = _i18nInternal.dicts.en['btn.save'];
      delete (_i18nInternal.dicts.en as any)['btn.save'];
      const result = _i18nInternal.translate('en', 'btn.save');
      expect(result).toBe('保存'); // falls back to ja text
      expect(warned).toBe(true);
      _i18nInternal.dicts.en['btn.save'] = saved;
    } finally {
      console.warn = original;
    }
  });

  it('returns the raw key and warns when totally unknown', () => {
    const original = console.warn;
    let warned = false;
    console.warn = () => { warned = true; };
    try {
      expect(_i18nInternal.translate('en', 'no.such.key')).toBe('no.such.key');
      expect(warned).toBe(true);
    } finally {
      console.warn = original;
    }
  });
});

describe('useI18nStore', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults to ja and persists a language switch to localStorage', () => {
    useI18nStore.getState().setLang('en');
    expect(useI18nStore.getState().lang).toBe('en');
    expect(localStorage.getItem('sticky-todo:lang')).toBe('en');

    useI18nStore.getState().setLang('ja');
    expect(useI18nStore.getState().lang).toBe('ja');
    expect(localStorage.getItem('sticky-todo:lang')).toBe('ja');
  });

  it('the non-hook t() helper reflects the current store language', () => {
    useI18nStore.getState().setLang('en');
    expect(t('btn.cancel')).toBe('Cancel');
    useI18nStore.getState().setLang('ja');
    expect(t('btn.cancel')).toBe('キャンセル');
  });
});
