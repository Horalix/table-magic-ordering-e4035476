import { describe, expect, it } from 'vitest';
import { binEntries, binReady, deletedWhen, liveMenu, whatWent } from './menu-bin';

const T1 = '2026-11-05T17:10:00.000Z';
const T2 = '2026-11-05T17:40:00.000Z';

/** La Soul's Food course: Burgers (two dishes) and Sides (two dishes), some deleted. */
const menu = (over: { cat?: string | null; burgers?: string | null; fries?: string | null; strips?: string | null; slider?: string | null } = {}) => [
  {
    id: 'food', name: 'Food', deleted_at: over.cat ?? null,
    subcategories: [
      {
        id: 'burgers', name: 'Burgers', deleted_at: over.burgers ?? over.cat ?? null,
        menu_items: [
          { id: 'burger', name: 'La Soul Burger', deleted_at: over.burgers ?? over.cat ?? null },
          { id: 'slider', name: 'Grilled Chicken Slider', deleted_at: over.slider ?? over.burgers ?? over.cat ?? null },
        ],
      },
      {
        id: 'sides', name: 'Sides', deleted_at: over.cat ?? null,
        menu_items: [
          { id: 'fries', name: 'La Soul Fries', deleted_at: over.fries ?? over.cat ?? null },
          { id: 'strips', name: 'Chicken Strips', deleted_at: over.strips ?? over.cat ?? null },
        ],
      },
    ],
  },
  { id: 'drinks', name: 'Drinks', deleted_at: null, subcategories: [] },
];

describe('the menu bin', () => {
  it('knows whether the database has a bin from the rows it sent', () => {
    expect(binReady([])).toBeNull();
    expect(binReady([{ id: 'x', name: 'Food' }])).toBe(false);
    expect(binReady([{ id: 'x', name: 'Food', deleted_at: null }])).toBe(true);
  });

  it('shows the menu as guests see it', () => {
    const live = liveMenu(menu({ fries: T1 }));
    expect(live[0].subcategories!.flatMap((s) => s.menu_items!.map((i) => i.name)))
      .toEqual(['La Soul Burger', 'Grilled Chicken Slider', 'Chicken Strips']);
    expect(liveMenu(menu({ cat: T1 })).map((c) => c.name)).toEqual(['Drinks']);
  });

  it('lists a deleted dish on its own, newest first', () => {
    const bin = binEntries(menu({ fries: T1, strips: T2 }));
    expect(bin.map((e) => [e.kind, e.name, e.where])).toEqual([
      ['item', 'Chicken Strips', 'Food › Sides'],
      ['item', 'La Soul Fries', 'Food › Sides'],
    ]);
  });

  it('lists a deleted course once, with what went with it', () => {
    const bin = binEntries(menu({ cat: T2 }));
    expect(bin).toEqual([{ kind: 'category', id: 'food', name: 'Food', where: null, deletedAt: T2, sections: 2, dishes: 4 }]);
    expect(whatWent(bin[0])).toBe('Food and its 2 sections and 4 dishes');
  });

  it('counts only what went at the same moment', () => {
    // The slider was deleted on its own first, then the whole Burgers section.
    const bin = binEntries(menu({ slider: T1, burgers: T2 }));
    expect(bin).toHaveLength(1);
    expect(bin[0]).toMatchObject({ kind: 'subcategory', name: 'Burgers', where: 'Food', dishes: 1 });
    expect(whatWent(bin[0])).toBe('Burgers and its 1 dish');
  });

  it('says when, in words a manager reads at a glance', () => {
    const now = new Date('2026-11-05T18:00:00');
    expect(deletedWhen(new Date('2026-11-05T17:59:40').toISOString(), now)).toBe('just now');
    expect(deletedWhen(new Date('2026-11-05T17:48:00').toISOString(), now)).toBe('12 min ago');
    expect(deletedWhen(new Date('2026-11-05T15:00:00').toISOString(), now)).toBe('3 h ago');
    expect(deletedWhen(new Date('2026-11-04T23:30:00').toISOString(), now)).toBe('yesterday');
    expect(deletedWhen(new Date('2026-10-28T12:00:00').toISOString(), now)).toBe('28 Oct');
  });
});
