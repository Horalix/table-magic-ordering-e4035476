import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The heartbeat test needs to decide what the server says; everything else in
// guest-api is untouched.
const touchSession = vi.fn();
vi.mock('@/lib/guest-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/guest-api')>()),
  touchSession: (...args: unknown[]) => touchSession(...args),
}));

import { useCartStore } from '@/lib/cart-store';
import { unorderableReason } from '@/lib/availability';
import { orderErrorKey, unavailableItemIds } from '@/lib/guest-api';

const atSarajevo = (hhmm: string) => {
  // October in Sarajevo is UTC+2 until the last Sunday, so 20 Oct 12:00 local = 10:00Z.
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(2026, 9, 20, h - 2, m));
};

beforeEach(() => {
  useCartStore.setState({
    items: [], checkoutKey: null, unavailableIds: [],
    sessionId: 's1', sessionToken: 'tok', tableNumber: 7, qrToken: 'venue',
  });
});

describe('ordering on restaurant Wi-Fi', () => {
  afterEach(() => {
    useCartStore.getState().stopHeartbeat();
    vi.useRealTimers();
    touchSession.mockReset();
  });

  it('keeps the cart and the table when a heartbeat request fails', async () => {
    vi.useFakeTimers();
    touchSession.mockRejectedValue(new Error('Failed to fetch'));
    useCartStore.getState().addItem({ id: 'burger', name: 'Burger', price: 18 });
    useCartStore.getState().startHeartbeat();

    await vi.advanceTimersByTimeAsync(61_000);

    const s = useCartStore.getState();
    expect(s.items).toHaveLength(1);
    expect(s.sessionId).toBe('s1');
  });

  it('reuses one key for every retry of a checkout, and a changed cart gets a new one', () => {
    useCartStore.getState().addItem({ id: 'burger', name: 'Burger', price: 18 });
    const first = useCartStore.getState().beginCheckout();
    expect(useCartStore.getState().beginCheckout()).toBe(first);

    useCartStore.getState().addItem({ id: 'fries', name: 'Fries', price: 6 });
    expect(useCartStore.getState().beginCheckout()).not.toBe(first);

    useCartStore.getState().finishCheckout();
    expect(useCartStore.getState().checkoutKey).toBeNull();
  });

  it('reprices the cart from the live menu and reports that something moved', () => {
    useCartStore.getState().addItem({ id: 'americano', name: 'Americano', price: 5 });
    const moved = useCartStore.getState().reprice([{ id: 'americano', price: 6, name: 'Americano', name_bs: 'Americano', name_ar: 'أمريكانو' }]);
    expect(moved).toBe(true);
    expect(useCartStore.getState().total()).toBe(6);
    expect(useCartStore.getState().items[0].name_ar).toBe('أمريكانو');
    expect(useCartStore.getState().reprice([{ id: 'americano', price: 6, name: 'Americano' }])).toBe(false);
  });

  it('changing table keeps what the guest has not sent yet', () => {
    useCartStore.getState().addItem({ id: 'burger', name: 'Burger', price: 18 });
    useCartStore.getState().leaveTable();
    const s = useCartStore.getState();
    expect(s.items).toHaveLength(1);
    expect(s.sessionId).toBeNull();
    expect(s.tableNumber).toBeNull();
  });
});

describe('serving windows, on the restaurant clock', () => {
  const breakfast = { is_available: true, available_from: '07:00', available_to: '11:30' };
  const lateMenu = { is_available: true, available_from: '22:00', available_to: '02:00' };

  it('reads Sarajevo time, not the phone or UTC', () => {
    expect(unorderableReason(breakfast, atSarajevo('11:15'))).toBeNull();
    expect(unorderableReason(breakfast, atSarajevo('12:30'))).toBe('off_hours');
  });

  it('understands a window that crosses midnight', () => {
    expect(unorderableReason(lateMenu, atSarajevo('23:00'))).toBeNull();
    expect(unorderableReason(lateMenu, atSarajevo('01:30'))).toBeNull();
    expect(unorderableReason(lateMenu, atSarajevo('15:00'))).toBe('off_hours');
  });

  it('a sold-out item is sold out whatever the time', () => {
    expect(unorderableReason({ ...breakfast, is_available: false }, atSarajevo('09:00'))).toBe('sold_out');
  });
});

describe('telling the guest why an order did not go', () => {
  it('names the items the server refused', () => {
    const err = { code: 'P0002', message: 'Unavailable: Turkish Egg', details: '["a1b2"]' };
    expect(unavailableItemIds(err)).toEqual(['a1b2']);
    expect(orderErrorKey(err)).toBe('some_items_unavailable');
  });

  it('maps server wording to something a guest can act on', () => {
    expect(orderErrorKey({ message: 'Ordering is paused' })).toBe('ordering_paused_title');
    expect(orderErrorKey({ message: 'Too many orders — please wait a moment' })).toBe('slow_down');
    expect(orderErrorKey({ message: 'Invalid order size' })).toBe('order_too_large');
    expect(orderErrorKey(new TypeError('Failed to fetch'))).toBe('order_not_sent_retry');
  });
});
