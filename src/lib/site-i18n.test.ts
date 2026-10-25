import { describe, expect, it } from 'vitest';
import { SITE_STRINGS, siteT } from './site-i18n';

const ARABIC = /[؀-ۿ]/;
const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();

describe('website strings', () => {
  const entries = Object.entries(SITE_STRINGS);

  it('has every string in English, Bosnian and Arabic', () => {
    for (const [key, e] of entries) {
      for (const l of ['en', 'bs', 'ar'] as const) {
        expect(e[l]?.trim(), `${key}.${l}`).toBeTruthy();
      }
    }
  });

  it('writes the Arabic in Arabic', () => {
    // Brand and legal lines are the same in every language on purpose.
    const latinOnly = new Set(['footer_rights']);
    for (const [key, e] of entries) {
      if (latinOnly.has(key)) continue;
      expect(ARABIC.test(e.ar), `${key}.ar`).toBe(true);
    }
  });

  it('keeps the same placeholders in every language', () => {
    for (const [key, e] of entries) {
      expect(placeholders(e.bs), `${key}.bs`).toEqual(placeholders(e.en));
      expect(placeholders(e.ar), `${key}.ar`).toEqual(placeholders(e.en));
    }
  });

  it('never promises what is not known yet', () => {
    const all = entries.flatMap(([, e]) => [e.en, e.bs, e.ar]).join('\n');
    expect(all).not.toMatch(/TBD|lorem|since \d{4}|award|founded/i);
  });

  it('fills placeholders', () => {
    expect(siteT('footer_rights', 'en', { year: 2026 })).toBe('© 2026 La Soul');
    expect(siteT('menu_open', 'bs', { name: 'Pića' })).toBe('Otvori: Pića');
  });
});
