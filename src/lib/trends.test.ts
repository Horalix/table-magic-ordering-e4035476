import { describe, expect, it } from 'vitest';
import {
  benjaminiHochberg, binomialPmf, binomialTwoSidedP, detectTrends, normalUpperTail, type ItemTrendRow,
} from '@/lib/trends';

/**
 * The trend alerts must be quiet when nothing has changed and still speak up
 * when something has. Simulated with a fixed seed so the suite is
 * deterministic.
 */

/** mulberry32: a small, well-mixed, seedable PRNG. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Poisson draw: Knuth for small means, normal approximation for large. */
function poisson(mean: number, u: () => number): number {
  if (mean > 50) {
    const z = Math.sqrt(-2 * Math.log(u() || 1e-12)) * Math.cos(2 * Math.PI * u());
    return Math.max(0, Math.round(mean + Math.sqrt(mean) * z));
  }
  const limit = Math.exp(-mean);
  let k = 0;
  let p = 1;
  do { k += 1; p *= u(); } while (p > limit);
  return k - 1;
}

const row = (over: Partial<ItemTrendRow>): ItemTrendRow => ({
  item_id: over.name ?? 'x', name: 'Dish', is_available: true,
  k1: 0, k0: 0, e1: 1400, e0: 5600, days1: 14, days0: 56, units1: 0,
  price: 6, unit_cm: 4, cost_estimated: false,
  ...over,
});

/** 150 dishes whose order rate per visit did not change between the windows. */
function nullMenu(seed: number): ItemTrendRow[] {
  const u = rng(seed);
  return Array.from({ length: 150 }, (_, i) => {
    const visitsPerDay = 50 + u() * 250;
    const e1 = Math.round(visitsPerDay * 14);
    const e0 = Math.round(visitsPerDay * 56);
    // From a dish ordered once a week to one on every third table.
    const rate = Math.exp(Math.log(0.0005) + u() * (Math.log(0.33) - Math.log(0.0005)));
    const k1 = poisson(rate * e1, u);
    return row({
      item_id: `null-${i}`, name: `Dish ${i}`, e1, e0,
      k1, k0: poisson(rate * e0, u), units1: k1,
    });
  });
}

describe('the arithmetic', () => {
  it('computes binomial probabilities and an exact two-sided test', () => {
    expect(binomialPmf(3, 10, 0.5)).toBeCloseTo(120 / 1024, 10);
    // 9 of 10 at even odds: P = 2 × 11/1024.
    expect(binomialTwoSidedP(9, 10, 0.5)).toBeCloseTo(22 / 1024, 10);
    expect(binomialTwoSidedP(5, 10, 0.5)).toBeCloseTo(1, 10);
  });

  it('switches to a continuity-corrected normal approximation that agrees with the exact test', () => {
    expect(normalUpperTail(1.959964)).toBeCloseTo(0.025, 6);
    expect(normalUpperTail(0)).toBeCloseTo(0.5, 7);
    const exact = binomialTwoSidedP(20, 40, 0.333, 1000);
    const approx = binomialTwoSidedP(20, 40, 0.333);
    expect(Math.abs(exact - approx)).toBeLessThan(0.01);
  });

  it('applies Benjamini–Hochberg step-up', () => {
    expect(benjaminiHochberg([0.01, 0.02, 0.04, 0.2], 0.05)).toEqual([true, true, false, false]);
    // Step-up: a later p under its own line rescues the earlier ones.
    expect(benjaminiHochberg([0.04, 0.03, 0.045, 0.02], 0.05)).toEqual([true, true, true, true]);
    expect(benjaminiHochberg([], 0.1)).toEqual([]);
  });
});

describe('trend alerts', () => {
  it('stays silent on 150 dishes where nothing changed', () => {
    expect(detectTrends(nullMenu(20261025))).toEqual([]);
  });

  it('raises almost no false alarms across many simulated menus', () => {
    let alarms = 0;
    const runs = 40;
    for (let s = 1; s <= runs; s += 1) alarms += detectTrends(nullMenu(s)).length;
    // Under no change at all, BH at q = 0.10 allows a false alarm in at most
    // about one menu in ten; the 1.5× floor makes it rarer still.
    expect(alarms / runs).toBeLessThan(0.15);
  });

  it('flags a dish that truly doubled, on 40 orders', () => {
    // Same visits per day in both windows, so a fifth of the orders are
    // expected in the recent fortnight. Doubled, a third are: 13 of 40.
    const alerts = detectTrends([row({ item_id: 'lemonade', name: 'Peach lemonade', k1: 13, k0: 27, units1: 13 })]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].direction).toBe('up');
    expect(alerts[0].ratio).toBeCloseTo(1.93, 2);
    expect(alerts[0].message).toBe('Peach lemonade: 1.9× more orders per table than the previous 8 weeks.');
    expect(alerts[0].km_per_week).toBeGreaterThan(0);
  });

  it('still finds a large change among 150 quiet dishes, and says what a small one costs', () => {
    const menu = nullMenu(7);
    // Tripled on 80 orders: clears the multiple-testing bar.
    menu.push(row({ item_id: 'tripled', name: 'Tufahija', k1: 34, k0: 46, units1: 34 }));
    // Doubled on 40 orders: real, but at 151 dishes not yet distinguishable
    // from luck. This is the price of not crying wolf, and it is documented.
    menu.push(row({ item_id: 'doubled', name: 'Peach lemonade', k1: 13, k0: 27, units1: 13 }));
    const flagged = detectTrends(menu).map((a) => a.item_id);
    expect(flagged).toContain('tripled');
    expect(flagged).not.toContain('doubled');
  });

  it('reports a fall, and ignores tiny changes and thin evidence', () => {
    const alerts = detectTrends([
      row({ item_id: 'falling', name: 'Burek', k1: 10, k0: 200, units1: 10 }),
      // Significant on huge numbers but only 10% up: not worth anyone's time.
      row({ item_id: 'tiny', name: 'Espresso', k1: 2200, k0: 8000, units1: 2200 }),
      // Big ratio, but six orders in total.
      row({ item_id: 'thin', name: 'Sahlab', k1: 5, k0: 1, units1: 5 }),
    ]);
    expect(alerts.map((a) => a.item_id)).toEqual(['falling']);
    expect(alerts[0].direction).toBe('down');
    expect(alerts[0].message).toBe('Burek: 80% fewer orders per table than the previous 8 weeks.');
  });

  it('does not test a dish with no baseline, and orders the alerts by money then name', () => {
    expect(detectTrends([row({ k1: 40, k0: 0, e0: 0 })])).toEqual([]);
    const alerts = detectTrends([
      row({ item_id: 'b', name: 'B dish', k1: 60, k0: 40, units1: 60, unit_cm: 2 }),
      row({ item_id: 'a', name: 'A dish', k1: 60, k0: 40, units1: 60, unit_cm: 2 }),
      row({ item_id: 'c', name: 'C dish', k1: 60, k0: 40, units1: 60, unit_cm: 9 }),
    ]);
    expect(alerts.map((a) => a.item_id)).toEqual(['c', 'a', 'b']);
  });
});
