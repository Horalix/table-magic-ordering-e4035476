import { describe, expect, it } from 'vitest';
import { __analyticsInternals } from '@/lib/analytics';

const { sanitize } = __analyticsInternals;

/**
 * The client-side half of the privacy guarantee. The database enforces the
 * same rules again (see supabase/tests/merchandising-analytics.test.ts) — this
 * layer exists so nothing sensitive ever leaves the device in the first place.
 */
describe('analytics property sanitisation', () => {
  it('keeps ids, counts and flags', () => {
    expect(sanitize({ item_id: 'abc', quantity: 2, accepted: true, reason: null }))
      .toEqual({ item_id: 'abc', quantity: 2, accepted: true, reason: null });
  });

  it('drops free text a guest wrote', () => {
    const clean = sanitize({ item_id: 'abc', notes: 'no onions, allergic to peanuts' } as never);
    expect(clean).not.toHaveProperty('notes');
    expect(clean).toHaveProperty('item_id');
  });

  it('drops anything that identifies a person', () => {
    const clean = sanitize({ guest_name: 'Amina', email: 'a@b.c', phone: '+387...' } as never);
    expect(Object.keys(clean)).toHaveLength(0);
  });

  it('drops payment and session credentials', () => {
    const clean = sanitize({
      card: '4111111111111111',
      pan: '4111111111111111',
      cvv: '123',
      client_secret: 'cs_live_xyz',
      session_token: 'tok',
      qr_token: 'qr',
      order_code: '047',
    } as never);
    expect(clean).toEqual({ order_code: '047' });
  });

  it('is case-insensitive about blocked keys', () => {
    expect(sanitize({ Notes: 'x', GUEST_NAME: 'y' } as never)).toEqual({});
  });

  it('truncates long strings rather than shipping an essay', () => {
    const long = 'x'.repeat(500);
    const clean = sanitize({ reason: long });
    expect((clean.reason as string).length).toBe(__analyticsInternals.MAX_STRING);
  });

  it('drops values that are not scalars', () => {
    const clean = sanitize({ nested: { a: 1 }, list: [1, 2], fn: (() => 1) } as never);
    expect(clean).toEqual({});
  });
});
