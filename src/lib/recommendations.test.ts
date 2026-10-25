import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The client half of the suggestion guardrails.
 *
 * The server already filters by diet and dismissals; these pin the parts that
 * live in the browser — the same diet rule as the menu, the fallback for a
 * database that has not run the migration yet, dismissals that survive a
 * remount, and the dish page seeing the cart.
 */

const rpc = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: (...args: unknown[]) => rpc(...args) } }));

const breadcrumbs: unknown[] = [];
vi.mock('@sentry/react', () => ({ addBreadcrumb: (b: unknown) => { breadcrumbs.push(b); } }));

const {
  fetchRecommendations, pairingContextIds, impressionKey, isDecisionChoice, useDismissedSuggestions,
  headlineKeyFor,
} = await import('@/lib/recommendations');
const { matchesDietFilter } = await import('@/lib/dietary');

const row = (id: string, tags: string[] = []) => ({
  decision_id: 'd1', id, name: id, name_bs: null, name_ar: null, price: '4.00', image_url: null,
  dietary_tags: tags, recommendation_type: 'popular', source_item_id: null,
});

beforeEach(() => {
  rpc.mockReset();
  breadcrumbs.length = 0;
  sessionStorage.clear();
  useDismissedSuggestions.setState({ bySession: {} });
});

describe('the diet rule', () => {
  it('is the menu filter: every active tag must be on the item', () => {
    expect(matchesDietFilter({ dietary_tags: ['vegan', 'gluten_free'] }, ['vegan', 'gluten_free'])).toBe(true);
    expect(matchesDietFilter({ dietary_tags: ['vegan'] }, ['vegan', 'gluten_free'])).toBe(false);
    expect(matchesDietFilter({ dietary_tags: [] }, [])).toBe(true);
    expect(matchesDietFilter({}, ['vegetarian'])).toBe(false);
  });
});

describe('fetchRecommendations', () => {
  it('sends the diet filter and dismissals, and asks for the full shortlist', async () => {
    rpc.mockResolvedValue({ data: [row('a', ['vegan'])], error: null });
    await fetchRecommendations('s', 't', ['x'], 'cart', 'en', 4, [], { requireTags: ['vegan'], excludeItemIds: ['b'] });

    const [, args] = rpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(args._require_tags).toEqual(['vegan']);
    expect(args._exclude_item_ids).toEqual(['b']);
    expect(args._limit).toBe(8);
  });

  it('filters by the same rule even if the server did not', async () => {
    rpc.mockResolvedValue({ data: [row('a', ['gluten_free']), row('b', ['vegan', 'gluten_free']), row('c', ['vegan'])], error: null });
    const result = await fetchRecommendations('s', 't', [], 'cart', 'en', 4, [], {
      requireTags: ['vegan'], excludeItemIds: ['c'],
    });
    expect(result.items.map((r) => r.id)).toEqual(['b']);
    expect(result.items[0].price).toBe(4);
  });

  it('falls back to the old signature on a database without the migration', async () => {
    rpc
      .mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'not found' } })
      .mockResolvedValueOnce({ data: [row('a')], error: null });
    const result = await fetchRecommendations('s', 't', [], 'cart', 'en');

    expect(rpc).toHaveBeenCalledTimes(2);
    const [, retry] = rpc.mock.calls[1] as [string, Record<string, unknown>];
    expect(retry).not.toHaveProperty('_require_tags');
    expect(result.items.map((r) => r.id)).toEqual(['a']);
  });

  it('never treats halal as a filter: every dish in the house is halal', async () => {
    rpc.mockResolvedValue({ data: [row('a'), row('b', ['halal'])], error: null });
    const result = await fetchRecommendations('s', 't', [], 'cart', 'en', 4, [], {
      requireTags: ['halal', 'alcohol_free'],
    });
    const [, args] = rpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(args._require_tags).toEqual([]);
    // The untagged dish is not hidden.
    expect(result.items.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('sends portions for the cart, and reads the offered quantity', async () => {
    rpc.mockResolvedValue({ data: [{ ...row('lemonade'), suggested_quantity: 3 }, row('fries')], error: null });
    const result = await fetchRecommendations('s', 't', ['burger', 'cola'], 'cart', 'en', 4, [], {
      cartQuantities: [3, 1],
    });
    const [, args] = rpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(args._cart_quantities).toEqual([3, 1]);
    expect(result.items.map((r) => r.suggested_quantity)).toEqual([3, 1]);
  });

  it('never trusts a quantity outside 1 to 6', async () => {
    rpc.mockResolvedValue({ data: [{ ...row('a'), suggested_quantity: 40 }, { ...row('b'), suggested_quantity: -2 }], error: null });
    const result = await fetchRecommendations('s', 't', [], 'tab', 'en');
    expect(result.items.map((r) => r.suggested_quantity)).toEqual([6, 1]);
  });

  it('steps down through older signatures, one at a time', async () => {
    rpc
      .mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'not found' } })
      .mockResolvedValueOnce({ data: [row('a')], error: null });
    await fetchRecommendations('s', 't', ['burger'], 'cart', 'en', 4, [], { cartQuantities: [2] });

    expect(rpc).toHaveBeenCalledTimes(2);
    const [, retry] = rpc.mock.calls[1] as [string, Record<string, unknown>];
    expect(retry).not.toHaveProperty('_cart_quantities');
    expect(retry).toHaveProperty('_require_tags');
  });

  it('shows nothing on failure, but leaves a trail', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'denied' } });
    const result = await fetchRecommendations('s', 't', [], 'cart', 'en');
    expect(result.items).toEqual([]);
    expect(breadcrumbs).toHaveLength(1);
  });
});

describe('the dish page sees the cart', () => {
  it('pairs against the dish first, then the cart, without repeats', () => {
    expect(pairingContextIds(['burger'], ['cola', 'burger'])).toEqual(['burger', 'cola']);
  });
});

describe('dismissals', () => {
  it('are remembered per visit and only for the current one', () => {
    const { dismiss } = useDismissedSuggestions.getState();
    dismiss('visit-1', 'cake');
    dismiss('visit-1', 'cake');
    expect(useDismissedSuggestions.getState().bySession['visit-1']).toEqual(['cake']);

    dismiss('visit-2', 'cola');
    expect(useDismissedSuggestions.getState().bySession).toEqual({ 'visit-2': ['cola'] });
    // Persisted to session storage, so a remount reads them back.
    expect(sessionStorage.getItem('lasoul-dismissed-suggestions')).toContain('cola');
  });

  it('keys impressions by decision and item', () => {
    expect(impressionKey('d1', 'a')).not.toBe(impressionKey('d1', 'b'));
  });
});

describe('which card belongs to the decision', () => {
  const result = {
    decisionId: 'd1',
    items: [row('salad'), row('cola')].map((r) => ({ ...r, price: 4 })) as never[],
  };

  it('is only the first row of a fresh response', () => {
    expect(isDecisionChoice(result, 'salad', false)).toBe(true);
    // The next row, shown after the first was accepted or dismissed.
    expect(isDecisionChoice(result, 'cola', false)).toBe(false);
  });

  it('is never a placeholder kept on screen while the next decision loads', () => {
    expect(isDecisionChoice(result, 'salad', true)).toBe(false);
  });

  it('is nothing without a decision or a card', () => {
    expect(isDecisionChoice({ decisionId: null, items: [] }, 'salad', false)).toBe(false);
    expect(isDecisionChoice(result, undefined, false)).toBe(false);
    expect(isDecisionChoice(undefined, 'salad', false)).toBe(false);
  });
});

describe('the headline says why the card is there', () => {
  it('asks the table, not a person, when it offers one each', () => {
    expect(headlineKeyFor('cart', 'add_on', 3)).toBe('reco_for_the_table');
    expect(headlineKeyFor('cart', 'add_on', 1)).toBe('complete_your_order');
  });

  it('offers something while the table waits on the running tab', () => {
    expect(headlineKeyFor('tab', 'add_on')).toBe('reco_while_you_wait');
    expect(headlineKeyFor('after_meal', 'after_meal')).toBe('anything_else');
  });
});
