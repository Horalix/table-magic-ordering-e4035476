import { describe, expect, it } from 'vitest';
import {
  findDeadWeight, findLeaks, placementLabel, LEAK_MIN_VIEWS, type ItemPerformance,
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
