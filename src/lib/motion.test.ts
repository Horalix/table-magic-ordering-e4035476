import { describe, expect, it } from 'vitest';
import {
  duration, easeEnter, easeExit, easeStandard, shouldDismissSheet,
  springPill, springSheet, springSnappy, springSuccess, fadeUpCapped, STAGGER, STAGGER_MAX,
} from '@/lib/motion';

describe('motion tokens', () => {
  it('pins the researched curves, durations and springs', () => {
    expect(easeEnter).toEqual([0.16, 1, 0.3, 1]);
    expect(easeExit).toEqual([0.3, 0, 0.8, 0.15]);
    expect(easeStandard).toEqual([0.2, 0, 0, 1]);
    expect(duration).toMatchObject({ press: 0.1, fast: 0.15, base: 0.25, exit: 0.2, page: 0.18, emphasis: 0.45 });
    expect(springSheet).toEqual({ type: 'spring', visualDuration: 0.35, bounce: 0.1 });
    expect(springSnappy).toEqual({ type: 'spring', visualDuration: 0.25, bounce: 0.12 });
    expect(springPill).toEqual({ type: 'spring', visualDuration: 0.2, bounce: 0 });
    expect(springSuccess).toEqual({ type: 'spring', visualDuration: 0.4, bounce: 0.3 });
    expect(STAGGER).toBe(0.03);
    expect(STAGGER_MAX).toBe(6);
  });

  it('animates only the first six list items', () => {
    const hidden = fadeUpCapped.hidden as (i: number) => { opacity: number };
    const show = fadeUpCapped.show as (i: number) => { transition: { delay: number } };
    expect(hidden(0).opacity).toBe(0);
    expect(hidden(5).opacity).toBe(0);
    expect(hidden(6).opacity).toBe(1);
    expect(show(1).transition.delay).toBeCloseTo(0.03);
    expect(show(40).transition.delay).toBeCloseTo(0.15);
  });
});

describe('shouldDismissSheet', () => {
  it('closes past a quarter of the height', () => {
    expect(shouldDismissSheet(151, 0, 600)).toBe(true);
    expect(shouldDismissSheet(149, 0, 600)).toBe(false);
  });

  it('closes on a flick faster than 500 px/s, however short', () => {
    expect(shouldDismissSheet(20, 501, 600)).toBe(true);
    expect(shouldDismissSheet(20, 500, 600)).toBe(false);
  });

  it('does not close on an upward drag', () => {
    expect(shouldDismissSheet(-200, -900, 600)).toBe(false);
  });
});
