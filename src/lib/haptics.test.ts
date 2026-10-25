import { afterEach, describe, expect, it, vi } from 'vitest';
import { HAPTICS, haptic, hapticPattern } from '@/lib/haptics';

const original = Object.getOwnPropertyDescriptor(navigator, 'vibrate');

afterEach(() => {
  if (original) Object.defineProperty(navigator, 'vibrate', original);
  else delete (navigator as { vibrate?: unknown }).vibrate;
});

const mockVibrate = (impl: (p: number | number[]) => boolean) => {
  const fn = vi.fn(impl);
  Object.defineProperty(navigator, 'vibrate', { value: fn, configurable: true, writable: true });
  return fn;
};

describe('haptics', () => {
  it('uses the four researched patterns', () => {
    expect(HAPTICS).toEqual({ tick: 10, add: 15, success: [20, 60, 30], error: [40, 60, 40] });
    expect(hapticPattern('tick')).toBe(10);
    expect(hapticPattern('add')).toBe(15);
    expect(hapticPattern('success')).toEqual([20, 60, 30]);
    expect(hapticPattern('error')).toEqual([40, 60, 40]);
  });

  it('hands navigator.vibrate a fresh array, never the frozen constant', () => {
    const fn = mockVibrate(() => true);
    haptic('success');
    const arg = fn.mock.calls[0][0] as number[];
    expect(arg).toEqual([20, 60, 30]);
    expect(arg).not.toBe(HAPTICS.success);
  });

  it('plays each kind through navigator.vibrate where it exists (Android)', () => {
    const fn = mockVibrate(() => true);
    expect(haptic('tick')).toBe(true);
    expect(haptic('add')).toBe(true);
    expect(haptic('error')).toBe(true);
    expect(fn.mock.calls.map((c) => c[0])).toEqual([10, 15, [40, 60, 40]]);
  });

  it('does nothing where the API does not exist (iOS, desktop)', () => {
    Object.defineProperty(navigator, 'vibrate', { value: undefined, configurable: true, writable: true });
    expect(haptic('add')).toBe(false);
  });

  it('never throws when the browser refuses', () => {
    mockVibrate(() => { throw new Error('needs a user gesture'); });
    expect(() => haptic('tick')).not.toThrow();
    expect(haptic('tick')).toBe(false);
  });
});
