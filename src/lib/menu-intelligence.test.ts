import { describe, expect, it } from 'vitest';
import {
  findDeadWeight, findLeaks, placementLabel, LEAK_MIN_VIEWS, type ItemPerformance,
  FUNNEL_STAGES, groupByQuadrant, insightSentence, INSIGHT_MIN_KM_PER_WEEK, mergeInsights, normaliseEngineering,
  QUADRANTS, summariseFunnel, trendInsights,
  type Insight, type MenuEngineeringRow, type RecoFunnelRow,
} from '@/lib/menu-intelligence';

/**
 * The client half of the shared rules. The SQL half is
 * `looked_at_not_ordered()`, tested in supabase/tests/analytics-fixes.test.ts;
 * the two must agree, or Menu Intelligence and the impact page name different
 * dishes as the problem.
 */

const NOW = new Date('2026-10-24T12:00:00Z');
const LONG_AGO = '2026-01-01T00:00:00Z';

const item = (over: Partial<ItemPerformance>): ItemPerformance => ({
  item_id: over.name ?? 'x',
  name: 'Dish',
  category_name: 'Food',
  subcategory_name: 'Mains',
  price: 10,
  is_available: true,
  margin_score: 50,
  created_at: LONG_AGO,
  views: 0,
  adds: 0,
  removes: 0,
  orders: 0,
  units: 0,
  revenue: 0,
  add_rate: null,
  order_rate: null,
  abandon_rate: null,
  ...over,
});

describe('looked at, not ordered', () => {
  it('names a well-viewed dish that rarely sells', () => {
    const leaks = findLeaks([item({ name: 'Risotto', views: 180, orders: 4, order_rate: 2.2 })]);
    expect(leaks.map((i) => i.name)).toEqual(['Risotto']);
  });

  it('leaves out a sold-out dish — nobody could order it', () => {
    expect(findLeaks([item({ views: 200, order_rate: 0, is_available: false })])).toHaveLength(0);
  });

  it('needs enough views for the rate to mean anything', () => {
    expect(findLeaks([item({ views: LEAK_MIN_VIEWS - 1, order_rate: 0 })])).toHaveLength(0);
    expect(findLeaks([item({ views: LEAK_MIN_VIEWS, order_rate: 0 })])).toHaveLength(1);
  });

  it('does not flag a dish that converts at 10% or better', () => {
    expect(findLeaks([item({ views: 100, order_rate: 10 })])).toHaveLength(0);
  });
});

describe('not selling at all', () => {
  it('lists an old, available dish that sold nothing', () => {
    expect(findDeadWeight([item({ name: 'Old' })], 30, NOW).map((i) => i.name)).toEqual(['Old']);
  });

  it('gives a dish added inside the window a fair chance', () => {
    const added = new Date(NOW.getTime() - 3 * 86_400_000).toISOString();
    expect(findDeadWeight([item({ created_at: added })], 30, NOW)).toHaveLength(0);
    // …but the same dish counts once the window no longer reaches back past it.
    expect(findDeadWeight([item({ created_at: added })], 2, NOW)).toHaveLength(1);
  });

  it('ignores sold-out dishes and anything that sold', () => {
    expect(findDeadWeight([item({ is_available: false }), item({ units: 1 })], 30, NOW)).toHaveLength(0);
  });
});

describe('placement names', () => {
  it('calls the dish-page placement what it is, not "Cart"', () => {
    expect(placementLabel('item')).toBe('On the dish page');
    expect(placementLabel('cart')).toBe('In the cart');
    expect(placementLabel('after_meal')).toBe('After the meal');
  });
});

describe('menu engineering boxes', () => {
  const eng = (over: Partial<MenuEngineeringRow>): MenuEngineeringRow => ({
    item_id: over.name ?? 'x', name: 'Dish', menu_class: 'main', category_name: 'Food', is_available: true,
    units: 10, lines: 10, revenue: 100, available_days: 28, trading_days: 28, availability_basis: 'assumed',
    class_units: 100, class_lines: 100, class_items: 5, menu_mix: 0.1, mix_low: 0.08, mix_high: 0.12,
    popularity_threshold: 0.14, price: 10, unit_cost: 3, unit_cm: 7, class_avg_cm: 6, cost_estimated: false,
    popularity: 'low', profitability: 'high', quadrant: 'puzzle', units_per_week: 2.5, class_units_per_week: 25,
    ...over,
  });

  it('files every dish in its box, busiest first, optionally for one class', () => {
    const rows = [
      eng({ name: 'Quiet star', quadrant: 'star', units: 20 }),
      eng({ name: 'Busy star', quadrant: 'star', units: 90 }),
      eng({ name: 'Espresso', quadrant: 'plowhorse', menu_class: 'hot_drink' }),
      eng({ name: 'Unsure', quadrant: 'insufficient' }),
    ];
    const all = groupByQuadrant(rows);
    expect(all.star.map((r) => r.name)).toEqual(['Busy star', 'Quiet star']);
    expect(all.insufficient).toHaveLength(1);
    expect(groupByQuadrant(rows, 'hot_drink').plowhorse.map((r) => r.name)).toEqual(['Espresso']);
    expect(groupByQuadrant(rows, 'hot_drink').star).toHaveLength(0);
  });

  it('turns the server\'s numeric strings into numbers', () => {
    const [r] = normaliseEngineering([eng({ unit_cm: '7.50' as unknown as number, menu_mix: null })]);
    expect(r.unit_cm).toBe(7.5);
    expect(r.menu_mix).toBeNull();
  });

  it('gives each box one plain action', () => {
    expect(QUADRANTS.puzzle.action).toMatch(/rename/i);
    expect(QUADRANTS.dog.action).toMatch(/anchor/i);
    expect(QUADRANTS.star.action).toMatch(/protect/i);
    expect(QUADRANTS.plowhorse.action).toMatch(/plate cost/i);
  });
});

describe('the recommendation funnel, per placement', () => {
  it('adds the weeks up and keeps every stage within the one before', () => {
    const week = (placement: string, w: string, n: [number, number, number, number, number], km: number): RecoFunnelRow => ({
      placement, week_start: w, decisions: n[0], with_suggestion: n[1], seen: n[2], tapped: n[3], paid: n[4],
      paid_km: km, km_per_1000_seen: null,
    });
    const totals = summariseFunnel([
      week('cart', '2026-10-12', [100, 90, 80, 10, 5], 30),
      week('cart', '2026-10-19', [100, 95, 70, 12, 6], 36),
      week('item', '2026-10-19', [40, 40, 30, 2, 1], 4),
    ]);
    expect(totals.map((t) => t.placement)).toEqual(['cart', 'item']);
    expect(totals[0]).toMatchObject({ decisions: 200, seen: 150, paid: 11, paid_km: 66, km_per_1000_seen: 440, weeks: 2 });
    for (const t of totals) {
      const stages = FUNNEL_STAGES.map((s) => t[s.key]);
      for (let i = 1; i < stages.length; i += 1) expect(stages[i]).toBeLessThanOrEqual(stages[i - 1]);
    }
  });
});

describe('what to do next', () => {
  const card = (over: Partial<Insight>): Insight => ({
    kind: 'leak', item_id: 'i', related_item_id: null, headline: 'H', why: 'W', action: 'Do the thing',
    est_km_per_week: 50, confidence: 'high', evidence: 300, evidence_label: 'visits', link: '/admin',
    ...over,
  });

  it('merges server and trend cards worth first, with a stable tie-break, and drops anything under 20 KM', () => {
    const server = [
      card({ kind: 'sold_out', headline: 'Cake has been sold out', est_km_per_week: '100' as unknown as number }),
      card({ kind: 'pairing', headline: 'Suggest Cola with Burger', est_km_per_week: 35 }),
      card({ kind: 'dog', headline: 'Tiny', est_km_per_week: 19.4 }),
      card({ kind: 'leak', headline: 'B leak', est_km_per_week: 35 }),
    ];
    const trends = trendInsights([{
      item_id: 'lem', name: 'Peach lemonade', direction: 'up', ratio: 2.1, n: 120, p: 0.0001, visits: 7000,
      km_per_week: 35, cost_estimated: false,
      message: 'Peach lemonade: 2.1× more orders per table than the previous 8 weeks.',
    }]);
    const merged = mergeInsights(server, trends);
    expect(merged.map((i) => `${i.kind}:${i.est_km_per_week}`)).toEqual([
      'sold_out:100', 'leak:35', 'pairing:35', 'trend_up:35',
    ]);
    expect(mergeInsights([...server].reverse(), trends)).toEqual(merged);
    expect(merged.every((i) => i.est_km_per_week >= INSIGHT_MIN_KM_PER_WEEK)).toBe(true);
  });

  it('says it in one line: do X; worth about Y KM a week; based on Z', () => {
    expect(insightSentence(card({ action: 'Add Cola as a suggestion for Burger', est_km_per_week: 1240, evidence: 5000, evidence_label: 'orders with Burger' })))
      .toBe('Add Cola as a suggestion for Burger; worth about 1,240 KM a week; based on 5,000 orders with Burger.');
    expect(insightSentence(card({ kind: 'anomaly', action: 'Find out what was different', est_km_per_week: 400, evidence: 6, evidence_label: 'previous Tuesdays' })))
      .toBe('Find out what was different; about 400 KM away from a usual day; based on 6 previous Tuesdays.');
  });
});
