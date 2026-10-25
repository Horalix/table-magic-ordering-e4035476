import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  t, getLocalizedName, getLocalizedDescription, useLanguageStore, translationTable, pluralTable,
  plural, pluralCategory, formatPrice, formatList, interpolate, isStaffPath, applyDocumentLocale,
} from '@/lib/i18n';

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

  it('fills placeholders through t()', () => {
    useLanguageStore.getState().setLocale('bs');
    expect(t('table_n', { n: 7 })).toBe('Sto 7');
  });
});

describe('every guest string exists in all three languages', () => {
  const locales = ['en', 'bs', 'ar'] as const;

  it('has en, bs and ar for every key, none empty', () => {
    for (const [key, v] of Object.entries(translationTable)) {
      for (const l of locales) expect(v[l]?.trim(), `${key}.${l}`).toBeTruthy();
    }
  });

  it('keeps the same placeholders in every language', () => {
    const holes = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');
    for (const [key, v] of Object.entries(translationTable)) {
      expect(holes(v.bs), `${key}.bs`).toBe(holes(v.en));
      expect(holes(v.ar), `${key}.ar`).toBe(holes(v.en));
    }
  });

  it('uses Latin digits in Arabic, like the bill and the card terminal', () => {
    for (const [key, v] of Object.entries(translationTable)) expect(v.ar, key).not.toMatch(/[٠-٩]/);
  });

  // A t('key') with no entry renders the raw key to the guest.
  it('has an entry for every literal key the code asks for', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = path.join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(f) && !/\.test\./.test(f)) files.push(p);
      }
    };
    walk(path.join(__dirname, '..'));
    const missing = new Set<string>();
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/\bt\('([a-z0-9_]+)'/g)) {
        if (!(m[1] in translationTable)) missing.add(`${m[1]} (${path.basename(f)})`);
      }
    }
    expect([...missing]).toEqual([]);
  });
});

describe('plurals, prices and lists', () => {
  it('follows Bosnian one/few/other', () => {
    expect(plural('orders_count', 1, 'bs')).toBe('1 narudžba');
    expect(plural('orders_count', 3, 'bs')).toBe('3 narudžbe');
    expect(plural('orders_count', 5, 'bs')).toBe('5 narudžbi');
    expect(plural('orders_count', 21, 'bs')).toBe('21 narudžba');
    expect(plural('orders_count', 12, 'bs')).toBe('12 narudžbi');
  });

  it('follows Arabic dual and plural forms', () => {
    expect(plural('orders_count', 1, 'ar')).toBe('طلب واحد');
    expect(plural('orders_count', 2, 'ar')).toBe('طلبان');
    expect(plural('orders_count', 5, 'ar')).toBe('5 طلبات');
    expect(plural('orders_count', 11, 'ar')).toBe('11 طلبًا');
    expect(plural('orders_count', 100, 'ar')).toBe('100 طلب');
  });

  it('agrees with the platform plural rules for 0–200', () => {
    for (const l of ['en', 'bs', 'ar'] as const) {
      const intl = new Intl.PluralRules(l);
      for (let n = 0; n <= 200; n++) expect(pluralCategory(n, l), `${l} ${n}`).toBe(intl.select(n));
    }
  });

  it('defines an "other" form for every plural in every language', () => {
    for (const [key, v] of Object.entries(pluralTable)) {
      for (const l of ['en', 'bs', 'ar'] as const) expect(v[l].other, key).toBeTruthy();
    }
  });

  it('formats money per language, never splitting the amount from KM', () => {
    expect(formatPrice(12.5, 'en')).toBe('12.50 KM');
    expect(formatPrice(12.5, 'bs')).toBe('12,50 KM');
    expect(formatPrice('1234', 'ar')).toBe('1234.00 KM');
  });

  it('joins names the way each language does', () => {
    expect(formatList(['Amina', 'Haris', 'Lejla'], 'en')).toBe('Amina, Haris and Lejla');
    expect(formatList(['Amina', 'Haris', 'Lejla'], 'bs')).toBe('Amina, Haris i Lejla');
  });

  it('fills placeholders and leaves unknown ones visible', () => {
    expect(interpolate('Table {n}', { n: 7 })).toBe('Table 7');
    expect(interpolate('{a} {b}', { a: 'x' })).toBe('x {b}');
  });
});

describe('staff screens stay English and left-to-right', () => {
  it('recognises staff paths', () => {
    expect(isStaffPath('/kitchen')).toBe(true);
    expect(isStaffPath('/admin/orders')).toBe(true);
    expect(isStaffPath('/waiter')).toBe(true);
    expect(isStaffPath('/menu')).toBe(false);
    expect(isStaffPath('/administrator')).toBe(false);
  });

  it('never applies Arabic direction to a staff path', () => {
    applyDocumentLocale('ar', '/kitchen');
    expect(document.documentElement.dir).toBe('ltr');
    expect(document.documentElement.lang).toBe('en');
    applyDocumentLocale('ar', '/menu');
    expect(document.documentElement.dir).toBe('rtl');
    expect(document.documentElement.lang).toBe('ar');
  });
});
