import { describe, expect, it } from 'vitest';
import type { HoldoutComparison, MenuEngineeringRow, SuggestionImpact } from './menu-intelligence';
import {
  costOrder, marginPct, MATRIX_MAX, matrixPoints, parseCost, priceNudge, quadrantCounts, suggestionsHeadline,
} from './menu-matrix';
import { editDishLink, insightActions, insightKey } from './insight-actions';

/**
 * The menu as a picture, the summary's numbers, the cost editor's order, and
 * which button each "What to do next" card gets.
 */

const row = (over: Partial<MenuEngineeringRow>): MenuEngineeringRow => ({
  item_id: 'x', name: 'Dish', menu_class: 'main', category_name: 'Food', is_available: true,
  units: 100, lines: 100, revenue: 1800, available_days: 28, trading_days: 28, availability_basis: 'logged',
  class_units: 600, class_lines: 600, class_items: 5, menu_mix: 0.2, mix_low: 0.18, mix_high: 0.22,
  popularity_threshold: 0.14, price: 18, unit_cost: 6, unit_cm: 12, class_avg_cm: 10, cost_estimated: false,
  popularity: 'high', profitability: 'high', quadrant: 'star', units_per_week: 25, class_units_per_week: 150,
  ...over,
});

describe('matrixPoints', () => {
  it('places a dish by how far it is from its own two lines', () => {
    const [p] = matrixPoints([row({ item_id: 'burger', name: 'Burger' })]);
    expect(p).toMatchObject({ id: 'burger', name: 'Burger', quadrant: 'star' });
    expect(p.x).toBeCloseTo(0.2 / 0.14);
    expect(p.y).toBeCloseTo(1.2);
    expect(p.weekly).toBe(25 * 18);
  });

  it('puts a coffee and a burger on the same picture: each against its own kind', () => {
    const points = matrixPoints([
      row({ item_id: 'burger', menu_mix: 0.14, popularity_threshold: 0.14, unit_cm: 10, class_avg_cm: 10 }),
      row({ item_id: 'espresso', menu_class: 'hot_drink', menu_mix: 0.05, popularity_threshold: 0.05, price: 3, unit_cm: 2.4, class_avg_cm: 2.4 }),
    ]);
    expect(points.map((p) => [p.x, p.y])).toEqual([[1, 1], [1, 1]]);
  });

  it('draws a runaway best-seller at the edge, not off the picture', () => {
    const [p] = matrixPoints([row({ menu_mix: 0.9, unit_cm: 80 })]);
    expect(p.x).toBe(MATRIX_MAX);
    expect(p.y).toBe(MATRIX_MAX);
  });

  it('leaves out what cannot be placed, and narrows to one kind', () => {
    const rows = [
      row({ item_id: 'a' }), row({ item_id: 'b', menu_mix: null }), row({ item_id: 'c', class_avg_cm: 0 }),
      row({ item_id: 'd', menu_class: 'dessert' }),
    ];
    expect(matrixPoints(rows).map((p) => p.id)).toEqual(['a', 'd']);
    expect(matrixPoints(rows, 'dessert').map((p) => p.id)).toEqual(['d']);
  });
});

describe('the summary', () => {
  it('counts the dishes in each box', () => {
    expect(quadrantCounts([row({}), row({ quadrant: 'dog' }), row({ quadrant: 'dog' }), row({ quadrant: 'insufficient' })]))
      .toEqual({ star: 1, plowhorse: 0, puzzle: 0, dog: 2, insufficient: 1 });
  });

  it('says what the suggestions earn only as far as it was measured', () => {
    const impact = { attributed_revenue: 412.4 } as SuggestionImpact;
    const measured = (over: Partial<HoldoutComparison>) => suggestionsHeadline({ days: 30, status: 'positive', ...over } as HoldoutComparison, impact);
    expect(measured({ conservative_monthly_value: 1234.4 }).big).toBe('+1,234 KM a month');
    expect(measured({ status: 'negative' }).big).toBe('Costing money');
    expect(measured({ status: 'no_measurable_effect' }).big).toBe('No effect yet');
    expect(measured({ status: 'too_early', with_suggestions: { sessions: 12 }, holdout: { sessions: 3 } } as Partial<HoldoutComparison>).sub)
      .toBe('12 visits with suggestions and 3 without so far.');
    // Not measured: the attributed figure, called what it is.
    expect(suggestionsHeadline({ days: 30, status: 'not_running' } as HoldoutComparison, impact))
      .toEqual({ big: 'up to 412 KM', sub: 'Paid for after a suggestion. An upper bound: start a holdout to measure it.' });
    expect(suggestionsHeadline(null, null).big).toBe('Not measured');
  });

  it('prices a nudge as arithmetic at today\'s sales', () => {
    expect(priceNudge({ units_per_week: 25 })).toBe(13);
    expect(priceNudge({ units_per_week: 25 }, 1)).toBe(25);
    expect(priceNudge({ units_per_week: -3 })).toBe(0);
  });

  it('gives the share of the price the house keeps', () => {
    expect(marginPct(18, 6)).toBe(67);
    expect(marginPct(4, 5)).toBe(-25);
    expect(marginPct(0, 0)).toBeNull();
  });
});

describe('the cost editor', () => {
  it('reads a cost typed either way, and nothing else', () => {
    expect(parseCost('3,20')).toBe(3.2);
    expect(parseCost(' 3.2 ')).toBe(3.2);
    expect(parseCost('7')).toBe(7);
    expect(parseCost('')).toBeNull();
    expect(parseCost('abc')).toBeNull();
    expect(parseCost('-2')).toBeNull();
    expect(parseCost('3.205')).toBeNull();
  });

  it('leads with the dishes that have no cost and take the most money', () => {
    const dishes = [
      { id: 'known', name: 'Burger', price: 18, food_cost: 6 },
      { id: 'small', name: 'Toast', price: 4, food_cost: null },
      { id: 'big', name: 'Risotto', price: 22, food_cost: null },
      { id: 'unsold', name: 'Apple pie', price: 9, food_cost: null },
    ];
    const weekly = new Map([['known', 900], ['small', 40], ['big', 500]]);
    expect(costOrder(dishes, weekly).map((d) => d.id)).toEqual(['big', 'small', 'unsold', 'known']);
  });
});

describe('a card\'s buttons', () => {
  const card = (kind: string, over: Record<string, unknown> = {}) => ({
    kind, item_id: 'dish-1', related_item_id: null, headline: 'H', why: '', action: '', est_km_per_week: 30,
    confidence: 'high', evidence: 1, evidence_label: '', link: '', ...over,
  }) as Parameters<typeof insightKey>[0];

  it('are what the advice comes down to, the first being the main one', () => {
    const keys = (kind: string, over = {}) => insightActions(card(kind, over)).map((a) => a.key);
    expect(keys('puzzle')).toEqual(['feature', 'edit']);
    expect(keys('dog')).toEqual(['take_off', 'edit']);
    expect(keys('sold_out')).toEqual(['bring_back']);
    expect(keys('leak')).toEqual(['edit']);
    expect(keys('trend_up')).toEqual(['feature']);
    expect(keys('trend_down')).toEqual(['edit']);
    expect(keys('pairing', { related_item_id: 'dish-2' })).toEqual(['suggest']);
  });

  it('are none where there is nothing to press', () => {
    expect(insightActions(card('anomaly'))).toEqual([]);
    expect(insightActions(card('retired'))).toEqual([]);
    expect(insightActions(card('pairing'))).toEqual([]);
    expect(insightActions(card('dog', { item_id: null }))).toEqual([]);
  });

  it('link to the dish\'s editor, and tell two cards apart', () => {
    expect(editDishLink('a b/c')).toBe('/admin/menu?dish=a%20b%2Fc');
    expect(insightKey(card('dog'))).not.toBe(insightKey(card('leak')));
  });
});
