import { describe, expect, it } from 'vitest';
import { compareNeedsFirst, floorStatus, floorSummary, LATE_AFTER_MS } from './floor-state';

const NOW = Date.parse('2026-11-16T20:00:00Z');
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();

describe('floorStatus', () => {
  it('a table with nobody at it is free, whatever else is passed', () => {
    expect(floorStatus({ seated: false, callAt: ago(2) }, NOW).kind).toBe('free');
  });

  it('a seated table with nothing waiting is just seated', () => {
    expect(floorStatus({ seated: true, cookingSince: ago(5) }, NOW)).toEqual({ kind: 'seated', since: null, also: [] });
  });

  it('a call beats a bill, a bill beats food up, food up beats late', () => {
    const s = floorStatus({ seated: true, callAt: ago(3), billAt: ago(6), readyCount: 1, readyAt: ago(1), cookingSince: ago(20) }, NOW);
    expect(s.kind).toBe('calling');
    expect(s.since).toBe(NOW - 3 * 60_000);
    expect(s.also).toEqual(['bill', 'ready', 'late']);
    expect(floorStatus({ seated: true, billAt: ago(6), readyCount: 2 }, NOW).kind).toBe('bill');
    expect(floorStatus({ seated: true, readyCount: 1, cookingSince: ago(30) }, NOW).kind).toBe('ready');
  });

  it('an order is late at the kitchen’s own threshold, not before', () => {
    expect(floorStatus({ seated: true, cookingSince: new Date(NOW - LATE_AFTER_MS + 1000).toISOString() }, NOW).kind).toBe('seated');
    expect(floorStatus({ seated: true, cookingSince: new Date(NOW - LATE_AFTER_MS).toISOString() }, NOW).kind).toBe('late');
  });

  it('food up without a known time has no age rather than a made-up one', () => {
    expect(floorStatus({ seated: true, readyCount: 1, readyAt: null }, NOW)).toEqual({ kind: 'ready', since: null, also: [] });
  });
});

describe('floorSummary', () => {
  it('counts taken, free and the tables that need someone', () => {
    const statuses = [
      floorStatus({ seated: false }, NOW),
      floorStatus({ seated: false }, NOW),
      floorStatus({ seated: true }, NOW),
      floorStatus({ seated: true, billAt: ago(1) }, NOW),
      floorStatus({ seated: true, cookingSince: ago(16) }, NOW),
    ];
    expect(floorSummary(statuses)).toEqual({ taken: 3, free: 2, needYou: 2 });
  });
});

describe('compareNeedsFirst', () => {
  it('puts the loudest first, then the longest wait, then table order', () => {
    const t = (number: number, s: Parameters<typeof floorStatus>[0]) => ({ number, status: floorStatus(s, NOW) });
    const sorted = [
      t(1, { seated: false }),
      t(2, { seated: true }),
      t(3, { seated: true, billAt: ago(2) }),
      t(4, { seated: true, callAt: ago(1) }),
      t(5, { seated: true, callAt: ago(4) }),
      t(6, { seated: true }),
    ].sort(compareNeedsFirst).map((x) => x.number);
    expect(sorted).toEqual([5, 4, 3, 2, 6, 1]);
  });
});
