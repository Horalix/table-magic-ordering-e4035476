import { describe, expect, it } from 'vitest';
import { computeTip } from '@/lib/tip';

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
