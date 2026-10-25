import { describe, expect, it } from 'vitest';
import { stationLines, stationParts, stationsInvolved, worksAt, type StationLineLike } from '@/lib/station-lines';

/**
 * What each station's board shows of an order. The case that matters: a
 * combo whose only bar item is its drink must reach the bar — as a line the
 * barman can read and cannot bump.
 */

const combo: StationLineLike = {
  id: 'oi-combo', quantity: 2, notes: 'lemonade without ice', status: 'preparing', station: 'kitchen',
  menu_item_name: 'Chicken Burger Combo',
  components: [
    { slot_label: 'Burger', item_id: 'item-chicken', name: 'Chicken Burger', station: 'kitchen' },
    { slot_label: 'Drink', item_id: 'item-lemonade', name: 'Strawberry Lemonade', station: 'bar', allergens: ['sulphites'] },
  ],
};
const espresso: StationLineLike = {
  id: 'oi-coffee', quantity: 1, notes: null, status: 'pending', station: 'bar', menu_item_name: 'Espresso',
};
const fries: StationLineLike = {
  id: 'oi-fries', quantity: 1, notes: null, status: 'pending', station: 'kitchen', menu_item_name: 'Fries', components: null,
};

describe('station lines', () => {
  it('a combo-only order is the bar’s too, through its drink', () => {
    expect(worksAt([combo], 'bar')).toBe(true);
    expect(stationLines([combo], 'bar')).toEqual([]);
    expect(stationParts([combo], 'bar')).toEqual([{
      key: 'oi-combo:part:1', lineId: 'oi-combo', lineStation: 'kitchen', quantity: 2,
      name: 'Strawberry Lemonade', slotLabel: 'Drink', itemId: 'item-lemonade', station: 'bar',
      partOf: 'Chicken Burger Combo', notes: 'lemonade without ice', allergens: ['sulphites'], status: 'preparing',
    }]);
  });

  it('the kitchen view is unchanged: the combo line, no derived parts', () => {
    expect(stationLines([combo, espresso], 'kitchen')).toEqual([combo]);
    expect(stationParts([combo, espresso], 'kitchen')).toEqual([]);
  });

  it('"All" shows every line as it is, and derives nothing', () => {
    expect(stationLines([combo, espresso], 'all')).toEqual([combo, espresso]);
    expect(stationParts([combo, espresso], 'all')).toEqual([]);
    expect(worksAt([], 'all')).toBe(true);
  });

  it('food alone, combo or not, is not the bar’s', () => {
    const kidsMenu = { ...combo, components: [{ name: 'Fries', station: 'kitchen' }] };
    expect(worksAt([fries, kidsMenu], 'bar')).toBe(false);
  });

  it('a plain drink is a line of the bar’s own, as before', () => {
    expect(worksAt([espresso], 'bar')).toBe(true);
    expect(stationLines([espresso, combo], 'bar')).toEqual([espresso]);
  });

  it('tolerates rows with junk or no components', () => {
    const odd = { ...fries, components: [null, { name: 42 }, { name: 'Cola' }] as unknown as StationLineLike['components'] };
    expect(stationParts([odd], 'bar')).toEqual([]);
  });

  it('knows every station involved, parts included', () => {
    expect([...stationsInvolved([combo])].sort()).toEqual(['bar', 'kitchen']);
    expect([...stationsInvolved([fries])]).toEqual(['kitchen']);
  });
});
