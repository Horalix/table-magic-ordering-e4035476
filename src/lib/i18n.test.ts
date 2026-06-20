import { afterEach, describe, expect, it } from 'vitest';
import { t, getLocalizedName, getLocalizedDescription, useLanguageStore } from '@/lib/i18n';

afterEach(() => useLanguageStore.getState().setLocale('en'));

describe('i18n', () => {
  it('translates a known key in English', () => {
    useLanguageStore.getState().setLocale('en');
    expect(t('total')).toBe('Total');
  });

  it('translates to Bosnian', () => {
    useLanguageStore.getState().setLocale('bs');
    expect(t('total')).toBe('Ukupno');
  });

  it('falls back to the key when missing', () => {
    expect(t('___nonexistent_key___')).toBe('___nonexistent_key___');
  });

  it('getLocalizedName prefers the locale and falls back to default', () => {
    expect(getLocalizedName({ name: 'Wine', name_bs: 'Vino' }, 'bs')).toBe('Vino');
    expect(getLocalizedName({ name: 'Wine' }, 'bs')).toBe('Wine');
    expect(getLocalizedName({ name: 'Wine', name_ar: 'نبيذ' }, 'ar')).toBe('نبيذ');
  });

  it('getLocalizedDescription returns null when absent', () => {
    expect(getLocalizedDescription({ description: null }, 'en')).toBeNull();
    expect(getLocalizedDescription({ description: 'Dry red' }, 'en')).toBe('Dry red');
  });
});
