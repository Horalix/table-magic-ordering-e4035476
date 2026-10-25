import { describe, expect, it } from 'vitest';
import { parsePrice } from '@/lib/price-input';

describe('a price typed on a phone', () => {
  it('takes the ways people write it', () => {
    expect(parsePrice('18')).toBe(18);
    expect(parsePrice('18.5')).toBe(18.5);
    expect(parsePrice('18,50')).toBe(18.5);
    expect(parsePrice(' 3.20 KM ')).toBe(3.2);
  });

  it('refuses what should never reach the menu', () => {
    expect(parsePrice('')).toBeNull();
    expect(parsePrice('0')).toBeNull();
    expect(parsePrice('-4')).toBeNull();
    expect(parsePrice('1800')).toBeNull();   // two slipped zeros
    expect(parsePrice('18.505')).toBeNull();
    expect(parsePrice('1e2')).toBeNull();
    expect(parsePrice('abc')).toBeNull();
  });
});
