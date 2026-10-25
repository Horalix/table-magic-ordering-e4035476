import { describe, expect, it } from 'vitest';
import { computeTip, roundUpTip, TIP_CHOICES } from '@/lib/tip';

describe('computeTip', () => {
  it('computes a percentage of the items total', () => {
    expect(computeTip(20, 10, 0)).toBe(2);
    expect(computeTip(20, 5, 0)).toBe(1);
    expect(computeTip(33.33, 15, 0)).toBe(5);
  });

  it('returns 0 for the no-tip preset', () => {
    expect(computeTip(20, 0, 0)).toBe(0);
  });

  it('uses a flat custom amount, clamped non-negative and rounded', () => {
    expect(computeTip(20, 'custom', 3)).toBe(3);
    expect(computeTip(20, 'custom', -5)).toBe(0);
    expect(computeTip(20, 'custom', 2.555)).toBe(2.56);
  });
});

describe('round up and the card tip choices', () => {
  it('rounds the bill up to the next whole KM', () => {
    expect(roundUpTip(23.4)).toBe(0.6);
    expect(roundUpTip(17.05)).toBe(0.95);
    expect(computeTip(23.4, 'round', 0)).toBe(0.6);
  });

  it('adds one KM to a bill that is already whole, and nothing to an empty one', () => {
    expect(roundUpTip(18)).toBe(1);
    expect(roundUpTip(0)).toBe(0);
  });

  it('offers No tip, Round up, 5% and 10%, with No tip first and neutral', () => {
    expect(TIP_CHOICES).toEqual([0, 'round', 5, 10]);
    expect(computeTip(40, TIP_CHOICES[0], 0)).toBe(0);
  });
});
