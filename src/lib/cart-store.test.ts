import { beforeEach, describe, expect, it } from 'vitest';
import { useCartStore } from '@/lib/cart-store';

beforeEach(() => useCartStore.setState({ items: [] }));

describe('cart-store', () => {
  it('adds an item and increments quantity on re-add', () => {
    const { addItem } = useCartStore.getState();
    addItem({ id: 'a', name: 'Burger', price: 10 });
    addItem({ id: 'a', name: 'Burger', price: 10 });
    const s = useCartStore.getState();
    expect(s.items).toHaveLength(1);
    expect(s.items[0].quantity).toBe(2);
    expect(s.itemCount()).toBe(2);
    expect(s.total()).toBe(20);
  });

  it('updateQuantity sets and removes at zero', () => {
    useCartStore.getState().addItem({ id: 'a', name: 'X', price: 5 });
    useCartStore.getState().updateQuantity('a', 3);
    expect(useCartStore.getState().total()).toBe(15);
    useCartStore.getState().updateQuantity('a', 0);
    expect(useCartStore.getState().items).toHaveLength(0);
  });

  it('does not allow quantity above 10', () => {
    useCartStore.getState().addItem({ id: 'a', name: 'X', price: 1 });
    useCartStore.getState().updateQuantity('a', 99);
    expect(useCartStore.getState().items[0].quantity).toBe(1);
  });

  it('total sums mixed items', () => {
    const { addItem, updateQuantity } = useCartStore.getState();
    addItem({ id: 'a', name: 'A', price: 4.5 });
    addItem({ id: 'b', name: 'B', price: 2 });
    updateQuantity('b', 3);
    expect(useCartStore.getState().total()).toBe(10.5);
    expect(useCartStore.getState().itemCount()).toBe(4);
  });

  it('clearCart empties the cart', () => {
    useCartStore.getState().addItem({ id: 'a', name: 'X', price: 1 });
    useCartStore.getState().clearCart();
    expect(useCartStore.getState().items).toHaveLength(0);
  });

  it('has a stable clientId', () => {
    expect(typeof useCartStore.getState().clientId).toBe('string');
    expect(useCartStore.getState().clientId.length).toBeGreaterThan(0);
  });
});
