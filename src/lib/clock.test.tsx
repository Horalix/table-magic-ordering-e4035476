import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import React from 'react';
import { ClockProvider, useNow, useNowBucketed } from '@/lib/clock';
import { useElapsed, useElapsedMinutes, orderUrgency, tableUrgency, urgencyMark } from '@/lib/timing';

/**
 * The floor monitor renders forty table cards. Before the shared clock, each
 * owned a setInterval and re-rendered once a second — 2400 renders a minute for
 * numbers that change 40 times. These tests pin the two properties that fix it:
 * one interval for everyone, and minute-granularity consumers re-rendering once
 * a minute.
 */

let renders: Record<string, number>;

const Elapsed = ({ id, since }: { id: string; since: string }) => {
  renders[id] = (renders[id] ?? 0) + 1;
  const ms = useElapsed(since);
  return <span data-testid={id}>{Math.floor(ms / 1000)}</span>;
};

const ElapsedMinutes = ({ id, since }: { id: string; since: string }) => {
  renders[id] = (renders[id] ?? 0) + 1;
  const ms = useElapsedMinutes(since);
  return <span data-testid={id}>{Math.floor(ms / 60000)}</span>;
};

beforeEach(() => {
  renders = {};
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-02T12:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

describe('the shared clock', () => {
  it('runs one interval no matter how many components subscribe', () => {
    const spy = vi.spyOn(globalThis, 'setInterval');
    const since = new Date().toISOString();

    render(
      <ClockProvider>
        {Array.from({ length: 50 }, (_, i) => <Elapsed key={i} id={`c${i}`} since={since} />)}
      </ClockProvider>,
    );

    // One for the clock. Fifty components used to mean fifty.
    const clockIntervals = spy.mock.calls.filter(([, delay]) => delay === 1000);
    expect(clockIntervals.length).toBe(1);
  });

  it('ticks every second for second-granularity consumers', () => {
    const since = new Date().toISOString();
    const view = render(<ClockProvider><Elapsed id="a" since={since} /></ClockProvider>);

    advance(3000);
    expect(view.getByTestId('a').textContent).toBe('3');
  });

  it('re-renders minute consumers about once a minute, not sixty times', () => {
    const since = new Date().toISOString();
    render(<ClockProvider><ElapsedMinutes id="m" since={since} /></ClockProvider>);

    const before = renders.m;
    advance(60_000);
    const after = renders.m;

    // One or two re-renders across a whole minute, not ~60.
    expect(after - before).toBeLessThanOrEqual(2);
    expect(after - before).toBeGreaterThanOrEqual(1);
  });

  it('reports zero rather than throwing for a missing timestamp', () => {
    const view = render(<ClockProvider><Elapsed id="z" since={null as unknown as string} /></ClockProvider>);
    expect(view.getByTestId('z').textContent).toBe('0');
  });

  it('never reports negative elapsed time for a future timestamp', () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const view = render(<ClockProvider><Elapsed id="f" since={future} /></ClockProvider>);
    expect(Number(view.getByTestId('f').textContent)).toBe(0);
  });
});

describe('urgency scales', () => {
  const mins = (n: number) => n * 60_000;

  it('escalates an order through four levels', () => {
    expect(orderUrgency(mins(2))).toBe('fresh');
    expect(orderUrgency(mins(10))).toBe('attention');
    expect(orderUrgency(mins(18))).toBe('late');
    expect(orderUrgency(mins(40))).toBe('critical');
  });

  it('does not treat a table mid-meal as an emergency', () => {
    // The old code applied the ORDER scale here, so every table twenty minutes
    // into a normal dinner rendered destructive-red and the colour stopped
    // meaning anything.
    expect(tableUrgency(mins(20))).toBe('fresh');
    expect(tableUrgency(mins(45))).toBe('fresh');
    expect(tableUrgency(mins(80))).toBe('attention');
    expect(tableUrgency(mins(160))).toBe('critical');
  });

  it('carries urgency in glyphs as well as colour', () => {
    expect(urgencyMark('fresh')).toBe('');
    expect(urgencyMark('attention')).toBe('!');
    expect(urgencyMark('late')).toBe('!!');
    expect(urgencyMark('critical')).toBe('!!!');
  });
});

describe('bucketed time', () => {
  it('only changes value when the bucket changes', () => {
    const seen: number[] = [];
    const Probe = () => { seen.push(useNowBucketed(60_000)); return null; };
    render(<ClockProvider><Probe /></ClockProvider>);

    advance(30_000);
    advance(40_000);

    const distinct = new Set(seen);
    // Crossed exactly one minute boundary in 70 seconds.
    expect(distinct.size).toBeLessThanOrEqual(2);
  });

  it('exposes a raw now for anything that genuinely needs seconds', () => {
    const seen: number[] = [];
    const Probe = () => { seen.push(useNow()); return null; };
    render(<ClockProvider><Probe /></ClockProvider>);

    advance(2000);
    expect(new Set(seen).size).toBeGreaterThan(1);
  });
});
