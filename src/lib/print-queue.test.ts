import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  enqueuePrint, retryPrintQueue, clearPrintQueue, printQueueSnapshot, __printQueueForTests,
} from '@/lib/print-queue';
import type { PrintOutcome } from '@/lib/print-outcome';

/**
 * The queue exists for one failure: a Bluetooth write to a printer that has
 * been switched off never settles and never rejects. Awaiting it stops the
 * whole pipeline with no error anywhere — the screen still says "Printing".
 *
 * These tests pin the three properties that make that survivable: the wait
 * ends, the queue says so, and nothing after it is quietly fed into the same
 * hole.
 */

const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

beforeEach(() => {
  vi.useFakeTimers();
  __printQueueForTests.reset();
});

afterEach(() => {
  clearPrintQueue();
  vi.useRealTimers();
});

const ok = (verified = false): PrintOutcome => ({ ok: true, verified });

describe('draining', () => {
  it('prints one job at a time, in order', async () => {
    const order: string[] = [];
    const slow = (label: string) => () => new Promise<PrintOutcome>((resolve) => {
      setTimeout(() => { order.push(label); resolve(ok()); }, 100);
    });

    enqueuePrint({ id: 'a', label: 'A', run: slow('a') });
    enqueuePrint({ id: 'b', label: 'B', run: slow('b') });

    // B must not start while A is in flight — two concurrent ESC/POS writes
    // interleave into one garbled ticket.
    await vi.advanceTimersByTimeAsync(100);
    expect(order).toEqual(['a']);

    await vi.advanceTimersByTimeAsync(100);
    expect(order).toEqual(['a', 'b']);
  });

  it('never queues the same ticket twice', async () => {
    const run = vi.fn(async () => ok());
    enqueuePrint({ id: 'same', label: 'A', run });
    enqueuePrint({ id: 'same', label: 'A', run });

    await flush();
    await vi.advanceTimersByTimeAsync(10);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('reports how many are waiting', async () => {
    const never = () => new Promise<PrintOutcome>(() => {});
    enqueuePrint({ id: 'a', label: 'A', run: never });
    enqueuePrint({ id: 'b', label: 'B', run: never });
    enqueuePrint({ id: 'c', label: 'C', run: never });

    await flush();
    expect(printQueueSnapshot().pending).toBe(2);
    expect(printQueueSnapshot().state).toBe('printing');
  });
});

describe('a printer that stops answering', () => {
  it('gives up after twenty seconds instead of waiting forever', async () => {
    const settled: PrintOutcome[] = [];
    enqueuePrint({
      id: 'hang',
      label: 'Table 7',
      run: () => new Promise<PrintOutcome>(() => {}),
      onSettled: (o) => settled.push(o),
    });

    await flush();
    expect(printQueueSnapshot().state).toBe('printing');

    await vi.advanceTimersByTimeAsync(20_000);

    expect(printQueueSnapshot().state).toBe('stuck');
    expect(settled).toEqual([{ ok: false, reason: 'The printer stopped responding' }]);
  });

  it('stops draining, so the rest of the queue is not lost the same way', async () => {
    const second = vi.fn(async () => ok());
    enqueuePrint({ id: 'hang', label: 'Table 7', run: () => new Promise<PrintOutcome>(() => {}) });
    enqueuePrint({ id: 'next', label: 'Table 8', run: second });

    await vi.advanceTimersByTimeAsync(20_000);

    expect(printQueueSnapshot().state).toBe('stuck');
    expect(second).not.toHaveBeenCalled();
    // Still queued, not discarded — a human fixes the printer and presses Retry.
    expect(printQueueSnapshot().pending).toBe(1);
  });

  it('says which ticket stuck, because someone has to go and look', async () => {
    enqueuePrint({ id: 'hang', label: 'Table 7', run: () => new Promise<PrintOutcome>(() => {}) });
    await vi.advanceTimersByTimeAsync(20_000);

    expect(printQueueSnapshot().lastError).toContain('Table 7');
  });

  it('resumes only when a human says the printer is fixed', async () => {
    const second = vi.fn(async () => ok());
    enqueuePrint({ id: 'hang', label: 'Table 7', run: () => new Promise<PrintOutcome>(() => {}) });
    enqueuePrint({ id: 'next', label: 'Table 8', run: second });
    await vi.advanceTimersByTimeAsync(20_000);

    retryPrintQueue();
    await vi.advanceTimersByTimeAsync(10);

    expect(second).toHaveBeenCalledTimes(1);
    expect(printQueueSnapshot().state).toBe('idle');
  });

  it('ignores a late reply from a job it already gave up on', async () => {
    let release: ((o: PrintOutcome) => void) | null = null;
    const settled: PrintOutcome[] = [];
    enqueuePrint({
      id: 'late',
      label: 'Table 7',
      run: () => new Promise<PrintOutcome>((resolve) => { release = resolve; }),
      onSettled: (o) => settled.push(o),
    });

    await vi.advanceTimersByTimeAsync(20_000);
    release?.(ok(true));
    await flush();

    // One outcome, and it is the failure. A resurrected job would restart a
    // queue a human has taken responsibility for.
    expect(settled).toHaveLength(1);
    expect(settled[0].ok).toBe(false);
    expect(printQueueSnapshot().state).toBe('stuck');
  });
});

describe('outcomes', () => {
  it('carries a failure reason through to the UI', async () => {
    enqueuePrint({ id: 'x', label: 'Table 7', run: async () => ({ ok: false, reason: 'out of paper' }) });
    await vi.advanceTimersByTimeAsync(10);

    expect(printQueueSnapshot().lastError).toBe('Table 7 — out of paper');
    // Not stuck: the printer answered, it just said no. The queue keeps going.
    expect(printQueueSnapshot().state).toBe('idle');
  });

  it('remembers whether the last success was actually confirmed', async () => {
    enqueuePrint({ id: 'x', label: 'A', run: async () => ok(false) });
    await vi.advanceTimersByTimeAsync(10);
    expect(printQueueSnapshot().lastVerified).toBe(false);

    enqueuePrint({ id: 'y', label: 'B', run: async () => ok(true) });
    await vi.advanceTimersByTimeAsync(10);
    expect(printQueueSnapshot().lastVerified).toBe(true);
  });

  it('treats a thrown error as a failure rather than a hang', async () => {
    enqueuePrint({ id: 'x', label: 'Table 7', run: async () => { throw new Error('GATT busy'); } });
    await vi.advanceTimersByTimeAsync(10);

    expect(printQueueSnapshot().state).toBe('idle');
    expect(printQueueSnapshot().lastError).toContain('GATT busy');
  });
});
