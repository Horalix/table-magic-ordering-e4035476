import { beforeEach, describe, expect, it } from 'vitest';
import { emitAdd, useCartFx } from '@/lib/cart-fx';

beforeEach(() => {
  useCartFx.setState({ seq: 0, lastAdd: null, queue: [], landed: 0 });
});

describe('cartFx', () => {
  it('records the latest add for the CartBar label and queues a flight', () => {
    const from = { left: 10, top: 20, width: 44, height: 44 } as DOMRect;
    const key = emitAdd({ id: 'item-1', imageUrl: '/a.webp', from, name: 'Ćevapi' });

    const s = useCartFx.getState();
    expect(key).toBe(1);
    expect(s.lastAdd).toMatchObject({ key: 1, name: 'Ćevapi' });
    expect(Date.now() - s.lastAdd!.at).toBeLessThan(1000);
    expect(s.queue).toEqual([{ key: 1, id: 'item-1', imageUrl: '/a.webp', from, name: 'Ćevapi' }]);
  });

  it('gives every add its own key, so repeats of the same dish all register', () => {
    emitAdd({ name: 'Tea' });
    emitAdd({ name: 'Tea' });
    const s = useCartFx.getState();
    expect(s.queue.map((f) => f.key)).toEqual([1, 2]);
    expect(s.lastAdd?.key).toBe(2);
  });

  it('lets FlyToCart take a flight off the queue', () => {
    emitAdd({ name: 'A' });
    emitAdd({ name: 'B' });
    useCartFx.getState().take(1);
    expect(useCartFx.getState().queue.map((f) => f.name)).toEqual(['B']);
  });

  it('counts landings, which is what makes the bag pulse', () => {
    useCartFx.getState().land();
    useCartFx.getState().land();
    expect(useCartFx.getState().landed).toBe(2);
  });

  it('passes a delay through for adds that wait for a sheet to close', () => {
    emitAdd({ name: 'Burger', delayMs: 200 });
    expect(useCartFx.getState().queue[0].delayMs).toBe(200);
  });
});
