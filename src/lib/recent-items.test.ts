import { describe, expect, it, beforeEach } from 'vitest';
import {
  addRecentItems, getRecentItems, getUsualItem, forgetRecentItems,
} from '@/lib/recent-items';

/**
 * "Your usual".
 *
 * The distinction this file exists to protect: what you had LAST TIME and what
 * you ALWAYS have are different questions, and the previous storage — a
 * deduplicated list, most recent first — could only answer the first. A café
 * runs on the second.
 *
 * The other property under test is restraint. Offering someone a "usual" they
 * ordered once reads as the app pretending to know them, which costs more
 * trust than the convenience is worth.
 */

const KEY = 'lasoul-recent-items';
const item = (id: string, name = id) => ({ id, name, price: 3, image_url: undefined });

beforeEach(() => localStorage.clear());

describe('counting', () => {
  it('counts orders, not quantities', () => {
    // Three flat whites in one round is one order containing it. "I have this
    // every time" is a statement about visits.
    addRecentItems([item('a'), item('a'), item('a')]);
    expect(getRecentItems().find((i) => i.id === 'a')?.count).toBe(1);
  });

  it('accumulates across separate orders', () => {
    addRecentItems([item('a')]);
    addRecentItems([item('a')]);
    addRecentItems([item('a')]);
    expect(getRecentItems().find((i) => i.id === 'a')?.count).toBe(3);
  });

  it('keeps the most recent items when it overflows', () => {
    for (let i = 0; i < 30; i += 1) addRecentItems([item(`i${i}`)]);
    const stored = getRecentItems();
    expect(stored.length).toBeLessThanOrEqual(20);
    expect(stored[0].id).toBe('i29');
  });
});

describe('the usual', () => {
  it('is nothing at all for a first-time device', () => {
    expect(getUsualItem()).toBeNull();
  });

  it('is nothing after a single order', () => {
    // The restraint test. One coffee is not a habit, and claiming otherwise
    // is the app pretending to know someone.
    addRecentItems([item('a')]);
    expect(getUsualItem()).toBeNull();
  });

  it('is the most-ordered item, not the most recent', () => {
    /*
     * THE distinction. The old storage sorted by recency and deduplicated, so
     * a one-off ordered five minutes ago outranked the thing this guest has
     * every single morning.
     */
    addRecentItems([item('flat-white')]);
    addRecentItems([item('flat-white')]);
    addRecentItems([item('flat-white')]);
    addRecentItems([item('one-off')]);

    expect(getRecentItems()[0].id).toBe('one-off');   // most recent
    expect(getUsualItem()?.id).toBe('flat-white');    // most usual
  });

  it('breaks a tie on recency', () => {
    addRecentItems([item('a')]);
    addRecentItems([item('a')]);
    addRecentItems([item('b')]);
    addRecentItems([item('b')]);
    expect(getUsualItem()?.id).toBe('b');
  });
});

describe('devices already in the wild', () => {
  it('does not throw away history written by the old format', () => {
    // The previous shape had no counts and no dates. Discarding those entries
    // would silently reset every existing guest on upgrade.
    localStorage.setItem(KEY, JSON.stringify([
      { id: 'old-a', name: 'Old A', price: 3 },
      { id: 'old-b', name: 'Old B', price: 4 },
    ]));

    const stored = getRecentItems();
    expect(stored).toHaveLength(2);
    expect(stored.every((i) => i.count === 1)).toBe(true);
  });

  it('lets a migrated item become a usual once ordered again', () => {
    localStorage.setItem(KEY, JSON.stringify([{ id: 'old-a', name: 'Old A', price: 3 }]));
    addRecentItems([item('old-a', 'Old A')]);
    expect(getUsualItem()?.id).toBe('old-a');
  });
});

describe('forgetting', () => {
  it('drops history a device has not used in months', () => {
    const old = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString();
    localStorage.setItem(KEY, JSON.stringify([
      { id: 'stale', name: 'Stale', price: 3, count: 9, lastOrderedAt: old },
    ]));
    expect(getRecentItems()).toHaveLength(0);
  });

  it('clears everything on request', () => {
    addRecentItems([item('a')]);
    addRecentItems([item('a')]);
    forgetRecentItems();
    expect(getRecentItems()).toHaveLength(0);
    expect(getUsualItem()).toBeNull();
  });
});

describe('hostile storage', () => {
  it('survives junk in localStorage', () => {
    localStorage.setItem(KEY, 'not json at all');
    expect(getRecentItems()).toEqual([]);
    expect(getUsualItem()).toBeNull();
  });

  it('survives entries missing an id', () => {
    localStorage.setItem(KEY, JSON.stringify([{ name: 'nameless' }, { id: 'ok', name: 'Ok' }]));
    expect(getRecentItems().map((i) => i.id)).toEqual(['ok']);
  });
});
