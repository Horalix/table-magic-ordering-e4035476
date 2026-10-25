import { describe, expect, it } from 'vitest';
import { formatPrice } from '@/lib/i18n';

/**
 * Menu lists show bare prices ("12,50", "12") under one "Prices in KM" note;
 * everything a guest pays keeps "12.50 KM".
 */
describe('formatPrice bare mode', () => {
  it('drops the currency and keeps the cents', () => {
    expect(formatPrice(12.5, 'en', { bare: true })).toBe('12.50');
    expect(formatPrice(12.5, 'bs', { bare: true })).toBe('12,50');
    expect(formatPrice(12.5, 'ar', { bare: true })).toBe('12.50');
  });

  it('drops zero cents', () => {
    expect(formatPrice(12, 'en', { bare: true })).toBe('12');
    expect(formatPrice('18.00', 'bs', { bare: true })).toBe('18');
    expect(formatPrice(7, 'ar', { bare: true })).toBe('7');
  });

  it('keeps non-zero cents that end in zero', () => {
    expect(formatPrice(3.1, 'bs', { bare: true })).toBe('3,10');
    expect(formatPrice(0.05, 'en', { bare: true })).toBe('0.05');
  });

  it('never prints KM or a no-break space', () => {
    for (const l of ['en', 'bs', 'ar'] as const) {
      expect(formatPrice(9.99, l, { bare: true })).not.toMatch(/KM|\u00a0/);
    }
  });

  it('leaves the full form unchanged', () => {
    expect(formatPrice(12, 'en')).toBe('12.00\u00a0KM');
    expect(formatPrice(12, 'bs', { bare: false })).toBe('12,00\u00a0KM');
  });
});
