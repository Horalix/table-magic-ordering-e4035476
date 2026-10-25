import { afterEach, describe, expect, it } from 'vitest';
import {
  __clearPriceBook, comboSaving, comboSavingRange, comboSurcharge, comboUnitPrice, fixedChoices, formatSarajevoWhen,
  instantToSarajevoInputs, isNew, missingSlots, nextPriceChange, rememberPrices, sarajevoBusinessDay,
  sarajevoToInstant, saleEndsPhrase, salePrice, saleScheduled, saleView, unitPrice, choicesPayload,
  type ComboDef,
} from '@/lib/promotions';
import { useCartStore } from '@/lib/cart-store';
import { formatComponents } from '@/lib/order-components';

const at = (iso: string) => Date.parse(iso);
const NOON = at('2026-10-25T11:00:00Z'); // 12:00 in Sarajevo (CET, after the October change)

describe('sale prices, as the till computes them', () => {
  it('takes whole percentages off to the cent, rounding half away from zero like PostgreSQL', () => {
    expect(salePrice({ price: 18, sale_kind: 'percent', sale_value: 20 }, NOON)).toBe(14.4);
    // 4.30 × 0.85 = 3.655 exactly; floating point would make it 3.65.
    expect(salePrice({ price: 4.3, sale_kind: 'percent', sale_value: 15 }, NOON)).toBe(3.66);
    expect(salePrice({ price: '12.50', sale_kind: 'percent', sale_value: '10' }, NOON)).toBe(11.25);
  });

  it('takes a fixed sale price, and ignores one that is not cheaper', () => {
    expect(salePrice({ price: 18, sale_kind: 'price', sale_value: 15 }, NOON)).toBe(15);
    expect(salePrice({ price: 18, sale_kind: 'price', sale_value: 18 }, NOON)).toBeNull();
    expect(unitPrice({ price: 18, sale_kind: 'price', sale_value: 19 }, NOON)).toBe(18);
  });

  it('applies only inside the window, the end being exclusive', () => {
    const item = { price: 10, sale_kind: 'percent', sale_value: 50, sale_starts_at: '2026-10-25T10:00:00Z', sale_ends_at: '2026-10-25T12:00:00Z' };
    expect(salePrice(item, at('2026-10-25T09:59:59Z'))).toBeNull();
    expect(salePrice(item, at('2026-10-25T10:00:00Z'))).toBe(5);
    expect(salePrice(item, at('2026-10-25T11:59:59Z'))).toBe(5);
    expect(salePrice(item, at('2026-10-25T12:00:00Z'))).toBeNull();
    expect(saleScheduled(item, at('2026-10-25T09:00:00Z'))).toBe('scheduled');
    expect(saleScheduled(item, NOON)).toBe('running');
    expect(saleScheduled(item, at('2026-10-26T00:00:00Z'))).toBe('ended');
  });

  it('describes a running sale for a card', () => {
    const view = saleView({ price: 18, sale_kind: 'percent', sale_value: 20, sale_label: 'happy_hour', sale_ends_at: '2026-10-25T17:00:00Z' }, NOON);
    expect(view).toEqual({ price: 14.4, regular: 18, label: 'happy_hour', endsAt: at('2026-10-25T17:00:00Z'), percentOff: 20 });
    // An unknown label falls back to the plain badge rather than showing a key.
    expect(saleView({ price: 18, sale_kind: 'price', sale_value: 12, sale_label: 'only_2_left' }, NOON)?.label).toBeNull();
  });

  it('finds the next moment a price changes on its own', () => {
    const items = [
      { price: 5 },
      { price: 9, sale_kind: 'price', sale_value: 7, sale_starts_at: '2026-10-25T15:00:00Z', sale_ends_at: '2026-10-25T17:00:00Z' },
      { price: 9, sale_kind: 'price', sale_value: 7, sale_ends_at: '2026-10-25T13:30:00Z' },
    ];
    expect(nextPriceChange(items, NOON)).toBe(at('2026-10-25T13:30:00Z'));
    expect(nextPriceChange(items, at('2026-10-25T16:00:00Z'))).toBe(at('2026-10-25T17:00:00Z'));
    expect(nextPriceChange(items, at('2026-10-26T00:00:00Z'))).toBeNull();
  });
});

describe('Sarajevo time', () => {
  it('turns what the owner types into the instant, across the October clock change', () => {
    // Summer time (UTC+2) before 25 October 2026, winter time (UTC+1) after.
    expect(new Date(sarajevoToInstant('2026-10-24', '20:00')).toISOString()).toBe('2026-10-24T18:00:00.000Z');
    expect(new Date(sarajevoToInstant('2026-10-25', '20:00')).toISOString()).toBe('2026-10-25T19:00:00.000Z');
    expect(instantToSarajevoInputs(at('2026-10-25T19:00:00Z'))).toEqual({ date: '2026-10-25', time: '20:00' });
  });

  it('says when, briefly, for staff', () => {
    const now = at('2026-10-21T10:00:00Z'); // Wednesday
    expect(formatSarajevoWhen(at('2026-10-21T18:00:00Z'), now)).toBe('today 20:00');
    expect(formatSarajevoWhen(at('2026-10-22T18:00:00Z'), now)).toBe('tomorrow 20:00');
    expect(formatSarajevoWhen(at('2026-10-25T19:00:00Z'), now)).toBe('Sun 20:00');
    expect(formatSarajevoWhen(at('2026-11-02T19:00:00Z'), now)).toBe('2 Nov 20:00');
  });

  it('tells the guest when an offer ends, only when it is soon', () => {
    const now = at('2026-10-21T10:00:00Z');
    expect(saleEndsPhrase(at('2026-10-21T18:00:00Z'), now)).toEqual({ key: 'sale_until_today', vars: { time: '20:00' } });
    expect(saleEndsPhrase(at('2026-10-25T19:00:00Z'), now)).toEqual({ key: 'sale_until_wd_0', vars: { time: '20:00' } });
    expect(saleEndsPhrase(at('2026-11-12T19:00:00Z'), now)).toBeNull();
    expect(saleEndsPhrase(null, now)).toBeNull();
  });

  it('keeps "new" until the end of its last trading day, 05:00 the morning after', () => {
    const item = { merchandising_tags: ['new'], new_until: '2026-10-25' };
    expect(isNew(item, at('2026-10-25T21:00:00Z'))).toBe(true); // 22:00 on the 25th
    expect(isNew(item, at('2026-10-26T03:30:00Z'))).toBe(true); // 04:30 on the 26th, still that night
    expect(isNew(item, at('2026-10-26T04:30:00Z'))).toBe(false); // 05:30
    expect(isNew({ merchandising_tags: ['new'] }, NOON)).toBe(true);
    expect(isNew({ merchandising_tags: [], new_until: '2026-12-01' }, NOON)).toBe(false);
    expect(sarajevoBusinessDay(at('2026-10-26T03:30:00Z'))).toBe('2026-10-25');
  });
});

const COMBO: ComboDef = {
  combo_item_id: 'combo',
  slots: [
    { id: 'burger', label: 'Burger', options: [
      { item_id: 'classic', name: 'Classic', price: 18, surcharge: 0 },
      { item_id: 'cheese', name: 'Cheeseburger', price: 20, surcharge: 2 },
    ] },
    { id: 'side', label: 'Side', options: [{ item_id: 'fries', name: 'Fries', price: 5, surcharge: 0 }] },
    { id: 'drink', label: 'Drink', options: [
      { item_id: 'cola', name: 'Cola', price: 4, surcharge: 0 },
      { item_id: 'lemonade', name: 'Lemonade', price: 5.5, surcharge: 1, sale_kind: 'price', sale_value: 4.5 },
    ] },
  ],
};

describe('combos', () => {
  it('fills single-dish parts and asks for the rest', () => {
    const choices = fixedChoices(COMBO);
    expect(choices).toEqual({ side: 'fries' });
    expect(missingSlots(COMBO, choices).map((s) => s.id)).toEqual(['burger', 'drink']);
    expect(choicesPayload(COMBO, { ...choices, drink: 'cola' })).toEqual([
      { slot_id: 'side', item_id: 'fries' }, { slot_id: 'drink', item_id: 'cola' },
    ]);
  });

  it('prices the combo plus surcharges, the cheapest choice while one is missing', () => {
    const combo = { price: 22 };
    expect(comboUnitPrice(combo, COMBO, { side: 'fries' }, NOON)).toBe(22);
    expect(comboUnitPrice(combo, COMBO, { burger: 'cheese', side: 'fries', drink: 'lemonade' }, NOON)).toBe(25);
    expect(comboSurcharge(COMBO, { burger: 'cheese', side: 'fries', drink: 'lemonade' })).toBe(3);
    // A sale on the combo comes off its own price; surcharges stay on top.
    expect(comboUnitPrice({ price: 22, sale_kind: 'price', sale_value: 19 }, COMBO, { burger: 'cheese', side: 'fries', drink: 'cola' }, NOON)).toBe(21);
  });

  it('claims a saving only against what the parts really cost now', () => {
    // 20 + 5 + 4.50 (lemonade is on sale) = 29.50, against 22 + 2 + 1 = 25.
    expect(comboSaving({ price: 22 }, COMBO, { burger: 'cheese', side: 'fries', drink: 'lemonade' }, NOON)).toBe(4.5);
    expect(comboSaving({ price: 22 }, COMBO, { side: 'fries' }, NOON)).toBeNull();
    expect(comboSaving({ price: 30 }, COMBO, { burger: 'classic', side: 'fries', drink: 'cola' }, NOON)).toBeNull();
  });

  it('gives the owner the range of savings across every choice', () => {
    expect(comboSavingRange(22, COMBO.slots)).toEqual({ separatelyMin: 27, separatelyMax: 30.5, min: 5, max: 5.5 });
    expect(comboSavingRange(22, [{ options: [] }])).toBeNull();
  });
});

describe('the cart with promotions', () => {
  afterEach(() => { __clearPriceBook(); useCartStore.setState({ items: [], unavailableIds: [] }); });

  it('adds a dish at the sale price it is known to have, whichever button added it', () => {
    rememberPrices([{ id: 'burger', price: 18, sale_kind: 'percent', sale_value: 20, sale_label: 'happy_hour' }]);
    useCartStore.getState().addItem({ id: 'burger', name: 'Burger', price: 18 });
    const [line] = useCartStore.getState().items;
    expect(line).toMatchObject({ price: 14.4, regularPrice: 18, saleLabel: 'happy_hour' });
    useCartStore.getState().updateQuantity('burger', 3);
    // Not 43.199999…
    expect(useCartStore.getState().total()).toBe(43.2);
  });

  it('keeps combos with different choices on separate lines', () => {
    const part = (slot_id: string, item_id: string, surcharge = 0) => ({ slot_id, slot_label: slot_id, item_id, name: item_id, surcharge });
    const add = (drink: string, surcharge: number) => useCartStore.getState().addItem({
      id: 'combo', name: 'Combo', price: 22 + surcharge,
      combo: { components: [part('burger', 'classic'), part('drink', drink, surcharge)] },
    });
    add('cola', 0); add('lemonade', 1); add('cola', 0);
    const items = useCartStore.getState().items;
    expect(items.map((i) => [i.combo?.components[1].item_id, i.quantity, i.price])).toEqual([['cola', 2, 22], ['lemonade', 1, 23]]);
    expect(new Set(items.map((i) => i.id)).size).toBe(2);
  });

  it('re-prices when a sale ends, and puts surcharges back on a combo', () => {
    useCartStore.getState().addItem({ id: 'burger', name: 'Burger', price: 14.4, regularPrice: 18 });
    useCartStore.getState().addItem({
      id: 'combo', name: 'Combo', price: 23,
      combo: { components: [{ slot_id: 'drink', slot_label: 'Drink', item_id: 'lemonade', name: 'Lemonade', surcharge: 1 }] },
    });
    const rows = [
      { id: 'burger', name: 'Burger', price: 18, sale_kind: 'percent', sale_value: 20, sale_ends_at: '2026-10-25T12:00:00Z' },
      { id: 'combo', name: 'Combo', price: 22 },
    ];
    expect(useCartStore.getState().reprice(rows, null, at('2026-10-25T11:00:00Z'))).toBe(false);
    expect(useCartStore.getState().reprice(rows, null, at('2026-10-25T12:00:00Z'))).toBe(true);
    const [burger, combo] = useCartStore.getState().items;
    expect(burger).toMatchObject({ price: 18, regularPrice: undefined });
    expect(combo.price).toBe(23);
    // The owner raised the lemonade surcharge to 1.50.
    const def: ComboDef = { combo_item_id: 'combo', slots: [{ id: 'drink', label: 'Drink', options: [{ item_id: 'lemonade', name: 'Lemonade', price: 5.5, surcharge: 1.5 }] }] };
    expect(useCartStore.getState().reprice(rows, [def], at('2026-10-25T12:00:00Z'))).toBe(true);
    expect(useCartStore.getState().items[1].price).toBe(23.5);
  });

  it('takes the prices the server quoted when it refused the order', () => {
    useCartStore.getState().addItem({ id: 'fries', name: 'Fries', price: 5 });
    useCartStore.getState().addItem({ id: 'burger', name: 'Burger', price: 18 });
    const sent = useCartStore.getState().items.map((i) => i.id);
    useCartStore.getState().applyServerPrices([{ line: 1, menu_item_id: 'burger', unit_price: 14.4, regular_unit_price: 18 }], sent);
    expect(useCartStore.getState().items.map((i) => [i.id, i.price, i.regularPrice])).toEqual([
      ['fries', 5, undefined], ['burger', 14.4, 18],
    ]);
    expect(useCartStore.getState().checkoutKey).toBeNull();
  });
});

describe('combo parts on kitchen tickets', () => {
  it('lists each part, and says which ones another station makes', () => {
    const components = [
      { slot_label: 'Burger', item_id: 'a', name: 'Cheeseburger', station: 'kitchen' },
      { slot_label: 'Drink', item_id: 'b', name: 'Lemonade', station: 'bar' },
    ];
    expect(formatComponents(components, 'kitchen')).toEqual(['Burger: Cheeseburger', 'Drink: Lemonade (BAR)']);
    expect(formatComponents(null, 'kitchen')).toEqual([]);
    expect(formatComponents('nonsense')).toEqual([]);
  });
});
