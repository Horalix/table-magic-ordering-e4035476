import { describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: vi.fn() } }));

import { attachRows, summariseProfitCheck, type ProfitCheck } from './reco-profit';

const base: ProfitCheck = { status: 'not_running', days: 28, auto_holdout_pct: 10, attach: [] };

describe('summariseProfitCheck', () => {
  it('says it is not measured yet, and how it starts, when the always-on check is on but not open', () => {
    const s = summariseProfitCheck(base);
    expect(s).toMatchObject({ headline: 'Not measured yet', measured: false });
    expect(s.detail).toContain('Measure');
    expect(s.detail).toContain('10%');
  });

  it('says it is not measured when switched off', () => {
    expect(summariseProfitCheck({ ...base, auto_holdout_pct: 0 }).headline).toBe('Not measured');
    expect(summariseProfitCheck(null).headline).toBe('Not measured');
  });

  it('gives how many more tables while it is too early, and no figure', () => {
    const s = summariseProfitCheck({
      ...base, status: 'too_early', tables_needed: 240,
      with_suggestions: { visits: 50, margin_per_visit: 20, sales_per_visit: 30 },
      without: { visits: 6, margin_per_visit: 18, sales_per_visit: 27 },
    });
    expect(s.headline).toBe('Not enough tables yet');
    expect(s.detail).toContain('About 240 more tables');
    expect(s.measured).toBe(false);
  });

  it('leads with the cautious end of the weekly interval, never the point estimate', () => {
    const s = summariseProfitCheck({
      ...base, status: 'positive',
      with_suggestions: { visits: 400, margin_per_visit: 24, sales_per_visit: 36 },
      without: { visits: 44, margin_per_visit: 21, sales_per_visit: 32 },
      margin_per_visit: { difference: 3, low: 1.2, high: 4.8 },
      per_week: { treated_visits: 100, estimate: 300, low: 120, high: 480 },
    });
    expect(s).toMatchObject({ tone: 'good', measured: true, headline: '+120 KM a week' });
    expect(s.detail).toContain('120 KM to 480 KM');
    expect(s.detail).not.toContain('300');
  });

  it('is plain about an interval that includes zero, and about a loss', () => {
    expect(summariseProfitCheck({
      ...base, status: 'no_clear_difference', tables_needed: 900,
      margin_per_visit: { difference: 0.5, low: -1, high: 2 },
    }).detail).toMatch(/includes zero.*900 more tables/);
    expect(summariseProfitCheck({
      ...base, status: 'negative',
      margin_per_visit: { difference: -2, low: -3.5, high: -0.5 },
      per_week: { treated_visits: 100, estimate: -200, low: -350, high: -50 },
    })).toMatchObject({ tone: 'bad', headline: '−200 KM a week' });
  });
});

describe('attachRows', () => {
  it('weights each arm by its own visits and keeps dayparts in service order', () => {
    const rows = attachRows([
      { daypart: 'evening', arm: 'treatment', visits: 10, food_visits: 10, main_visits: 10, drink_with_food: 0.9, dessert_after_main: 0.5, coffee_after_main: 0.2 },
      { daypart: 'evening', arm: 'none', visits: 10, food_visits: 10, main_visits: 10, drink_with_food: 0.7, dessert_after_main: 0.3, coffee_after_main: 0.2 },
      { daypart: 'evening', arm: 'holdout', visits: 4, food_visits: 4, main_visits: 4, drink_with_food: 0.5, dessert_after_main: 0.25, coffee_after_main: null },
      { daypart: 'morning', arm: 'treatment', visits: 5, food_visits: 0, main_visits: 0, drink_with_food: null, dessert_after_main: null, coffee_after_main: null },
    ]);
    expect(rows.map((r) => r.daypart)).toEqual(['morning', 'evening']);
    const evening = rows[1];
    expect(evening.drink[0]).toBeCloseTo(0.8);
    expect(evening.dessert).toEqual([0.4, 0.25]);
    expect(evening.coffee[1]).toBe(0);
    expect(rows[0].drink).toEqual([null, null]);
    expect(evening.visits).toBe(24);
  });
});
