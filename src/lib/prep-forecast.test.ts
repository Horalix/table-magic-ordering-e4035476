import { describe, expect, it } from 'vitest';
import {
  backtest, buildContext, criticalRatio, empiricalQuantile, forecastCell, poissonQuantile, prepForecast,
  weightedMean, type PrepHistory, type PrepItem,
} from '@/lib/prep-forecast';

/** A dish selling only at lunch; `lunch[k-1]` is k same-weekdays before the target. */
const dish = (over: Partial<PrepItem> & { lunch?: (number | null)[] }): PrepItem => {
  const { lunch = [], ...rest } = over;
  return {
    item_id: rest.name ?? 'x', name: 'Dish', is_available: true, subcategory_id: 'sub-1', subcategory: 'Mains',
    unit_cm: 7, unit_cost: 3, cost_estimated: false,
    series: { lunch, morning: lunch.map((v) => (v === null ? null : 0)) },
    last28: { lunch: lunch.reduce<number>((s, v) => s + (v ?? 0), 0) },
    ...rest,
  };
};

const history = (items: PrepItem[]): PrepHistory => ({
  day: '2026-10-27', weekday: 'Tuesday', weeks: [], items,
});

/** Steady demand around 20 with week-to-week noise: last week alone is a poor guide. */
const STEADY = [22, 17, 21, 18, 24, 16, 20, 23, 17, 21];
/** Climbing 10 a week: last week is the best guide, and an average lags. */
const CLIMBING = [100, 90, 80, 70, 60, 50, 40, 30, 20, 10];

describe('the pieces', () => {
  it('weights the newest same weekday most, and skips days the dish was off', () => {
    expect(weightedMean([10, 20, 30, 40])).toBeCloseTo(4 + 6 + 6 + 4, 10);
    // Sold out three weeks ago: unknown, not zero.
    expect(weightedMean([10, 20, null, 40])).toBeCloseTo((4 + 6 + 4) / 0.8, 10);
    expect(weightedMean([null, null, null, null])).toBeNull();
  });

  it('preps to the newsvendor quantile', () => {
    expect(criticalRatio(7, 3)).toBeCloseTo(0.7, 10);
    expect(criticalRatio(0, 0)).toBe(0.5);
    // Poisson(4): P(X<=3) = 0.433, P(X<=4) = 0.629, P(X<=5) = 0.785.
    expect(poissonQuantile(4, 0.5)).toBe(4);
    expect(poissonQuantile(4, 0.7)).toBe(5);
    expect(poissonQuantile(0, 0.9)).toBe(0);
    expect(empiricalQuantile([5, 1, 9, 3], 0.7)).toBe(5);
  });

  it('forecasts a slow dish from its subcategory and its share of it', () => {
    const busy = dish({ name: 'Burger', lunch: [40, 40, 40, 40, 40, 40, 40, 40, 40, 40] });
    const slow = dish({ name: 'Risotto', lunch: [2, 0, 1, 1, 2, 0, 1, 1, 2, 0] });
    const ctx = buildContext([busy, slow]);
    const f = forecastCell(slow, 'lunch', 0, ctx);
    expect(f.method).toBe('subcategory');
    // Subcategory ≈ 41/day; the risotto's share of the last 28 days' lunches.
    const share = slow.last28.lunch! / (busy.last28.lunch! + slow.last28.lunch!);
    expect(f.value).toBeCloseTo(weightedMean([42, 40, 41, 41])! * share, 6);
    expect(forecastCell(busy, 'lunch', 0, ctx).method).toBe('item');
  });
});

describe('the backtest decides whether the card is shown', () => {
  it('shows the forecast when it beats "same as last week"', () => {
    const f = prepForecast(history([dish({ name: 'Burger', lunch: STEADY }), dish({ name: 'Ćevapi', lunch: STEADY.map((v) => v + 5) })]));
    expect(f.mase).not.toBeNull();
    expect(f.mase!).toBeLessThan(1);
    expect(f.show).toBe(true);
    const burger = f.rows.find((r) => r.name === 'Burger')!;
    expect(burger.method).toBe('item');
    expect(burger.forecast).toBeCloseTo(weightedMean(STEADY)!, 1);
    // A 70% critical ratio preps above the mean.
    expect(burger.prep).toBeGreaterThan(burger.forecast);
  });

  it('hides it when a plain "same as last week" would have done better', () => {
    const f = prepForecast(history([dish({ name: 'Burger', lunch: CLIMBING }), dish({ name: 'Ćevapi', lunch: CLIMBING })]));
    expect(f.mase!).toBeGreaterThan(1);
    expect(f.show).toBe(false);
  });

  it('will not judge from too few comparisons', () => {
    const { points } = backtest([dish({ lunch: [20, 18, 22, 21, 19, null, null, null, null, null] })]);
    expect(points).toBeLessThan(20);
    expect(prepForecast(history([dish({ lunch: [20, 18, 22, 21, 19, null, null, null, null, null] })])).show).toBe(false);
  });

  it('uses the observed spread when demand is far lumpier than Poisson', () => {
    const lumpy = [5, 60, 4, 55, 6, 58, 5, 62, 4, 57];
    const [row] = prepForecast(history([dish({ name: 'Platter', lunch: lumpy })])).rows;
    expect(row.spread).toBe('empirical');
    expect(row.prep).toBe(empiricalQuantile(lumpy.slice(0, 8), 0.7));
  });

  it('leaves out a dish that is sold out now', () => {
    const f = prepForecast(history([dish({ name: 'Cake', lunch: STEADY, is_available: false })]));
    expect(f.rows).toHaveLength(0);
  });
});
