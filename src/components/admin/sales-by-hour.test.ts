import { describe, expect, it } from 'vitest';
import { busiestIndex, salesByHour, trimQuietHours } from './sales-by-hour';

/** An order placed at a local wall-clock time on 14 Nov 2026 (or the 15th, past midnight). */
const at = (hour: number, minute: number, total: number, nextDay = false) => ({
  created_at: new Date(2026, 10, nextDay ? 15 : 14, hour, minute).toISOString(),
  total,
});

describe('salesByHour', () => {
  it('runs the hours in trading-day order, 05:00 first and 04:00 last', () => {
    const hours = salesByHour([]);
    expect(hours).toHaveLength(24);
    expect(hours[0].label).toBe('05:00');
    expect(hours[23].label).toBe('04:00');
    expect(hours.map((h) => h.hour)).toEqual([5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 0, 1, 2, 3, 4]);
  });

  it('puts a sale after midnight after the evening, not before breakfast', () => {
    const hours = salesByHour([at(23, 30, 40), at(0, 30, 25, true), at(9, 5, 12)]);
    const index = (label: string) => hours.findIndex((h) => h.label === label);
    expect(index('09:00')).toBeLessThan(index('23:00'));
    expect(index('23:00')).toBeLessThan(index('00:00'));
    expect(hours[index('00:00')]).toMatchObject({ sales: 25, orders: 1 });
  });

  it('adds up each hour to the cent, and counts its orders', () => {
    const hours = salesByHour([at(19, 1, 10.1), at(19, 59, 20.2), at(20, 0, '7.50' as unknown as number)]);
    const seven = hours.find((h) => h.hour === 19)!;
    const eight = hours.find((h) => h.hour === 20)!;
    expect(seven).toMatchObject({ sales: 30.3, orders: 2 });
    expect(eight).toMatchObject({ sales: 7.5, orders: 1 });
    // Nothing is lost or invented.
    expect(hours.reduce((sum, h) => sum + h.sales, 0)).toBeCloseTo(37.8, 2);
  });
});

describe('trimQuietHours', () => {
  it('keeps the service and one quiet hour either side', () => {
    const trimmed = trimQuietHours(salesByHour([at(9, 0, 5), at(22, 10, 5)]));
    expect(trimmed[0].label).toBe('08:00');
    expect(trimmed[trimmed.length - 1].label).toBe('23:00');
  });

  it('never pads past the edges of the day', () => {
    const trimmed = trimQuietHours(salesByHour([at(5, 0, 5), at(4, 30, 5, true)]));
    expect(trimmed).toHaveLength(24);
  });

  it('returns nothing for a day with no orders', () => {
    expect(trimQuietHours(salesByHour([]))).toEqual([]);
  });
});

describe('busiestIndex', () => {
  it('finds the hour that took the most, first one on a tie', () => {
    expect(busiestIndex([{ sales: 0 }, { sales: 30 }, { sales: 50 }, { sales: 50 }])).toBe(2);
    expect(busiestIndex([{ sales: 0 }, { sales: 0 }])).toBe(-1);
  });
});
