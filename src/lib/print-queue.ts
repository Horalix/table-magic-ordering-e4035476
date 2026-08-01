import { useSyncExternalStore } from 'react';
import type { PrintOutcome } from '@/lib/print-outcome';

/**
 * One printer, one job at a time, and a queue that admits when it is stuck.
 *
 * The failure this exists for: a Bluetooth GATT write to a printer that has
 * been switched off does not reject. It never settles. Every previous print
 * path awaited that promise, so the whole print pipeline stopped — silently,
 * with the kitchen screen still showing a healthy green "Printing" pill and
 * every subsequent ticket queueing behind a job that would never finish.
 *
 * Three rules follow from that:
 *
 *  - **A job that has not settled in 20 seconds has failed.** No real ticket
 *    takes that long. Waiting longer only delays the moment anyone finds out.
 *  - **Stop draining after a timeout.** A hung GATT connection needs a
 *    reconnect, not a retry; continuing would feed every remaining ticket into
 *    the same hole and lose all of them the same way.
 *  - **Say so, loudly.** `PRINTER STUCK — 4 waiting` on the board is the
 *    entire point. The queue's job is not to be clever, it is to be visible.
 */

export type QueueState = 'idle' | 'printing' | 'stuck';

export interface PrintJob {
  /** Stable id, so the UI can tie a failure back to an order. */
  id: string;
  label: string;
  run: () => Promise<PrintOutcome>;
  onSettled?: (outcome: PrintOutcome) => void;
}

export interface PrintQueueSnapshot {
  state: QueueState;
  pending: number;
  lastError: string | null;
  /** Whether the most recent success was confirmed by the printer itself. */
  lastVerified: boolean | null;
  current: string | null;
}

const JOB_TIMEOUT_MS = 20_000;

let queue: PrintJob[] = [];
let state: QueueState = 'idle';
let lastError: string | null = null;
let lastVerified: boolean | null = null;
let current: string | null = null;
/** The id of the job in flight — dedupe must cover it, not just the backlog. */
let currentId: string | null = null;

let snapshot: PrintQueueSnapshot = {
  state: 'idle', pending: 0, lastError: null, lastVerified: null, current: null,
};

const listeners = new Set<() => void>();

function publish() {
  snapshot = { state, pending: queue.length, lastError, lastVerified, current };
  listeners.forEach((l) => l());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

const getSnapshot = () => snapshot;

/** Live queue state for the kitchen header. */
export function usePrintQueue(): PrintQueueSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export const printQueueSnapshot = () => snapshot;

/**
 * Race a job against the clock.
 *
 * Deliberately does not cancel the underlying write — Web Bluetooth gives no
 * way to — it just stops waiting for it. A late reply from an abandoned job is
 * ignored rather than resurrecting a queue a human has since taken over.
 */
function withTimeout(job: PrintJob): Promise<PrintOutcome | 'timeout'> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve('timeout');
    }, JOB_TIMEOUT_MS);

    job.run().then(
      (outcome) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(outcome);
      },
      (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ ok: false, reason: error instanceof Error ? error.message : 'Print failed' });
      },
    );
  });
}

async function drain() {
  if (state === 'printing' || state === 'stuck') return;

  const job = queue.shift();
  if (!job) { state = 'idle'; current = null; currentId = null; publish(); return; }

  state = 'printing';
  current = job.label;
  currentId = job.id;
  publish();

  const result = await withTimeout(job);

  if (result === 'timeout') {
    // Everything still queued stays queued. It is not lost — it is waiting for
    // a human to fix the printer and press Retry, which is the only thing that
    // can actually help.
    state = 'stuck';
    currentId = null;
    lastError = `${job.label} — the printer stopped responding`;
    lastVerified = null;
    job.onSettled?.({ ok: false, reason: 'The printer stopped responding' });
    publish();
    return;
  }

  if (result.ok) {
    lastError = null;
    lastVerified = result.verified;
  } else {
    lastError = `${job.label} — ${result.reason}`;
    lastVerified = null;
  }
  job.onSettled?.(result);

  state = 'idle';
  current = null;
  currentId = null;
  publish();
  void drain();
}

/** Add a ticket to the queue. Returns immediately; outcome arrives via onSettled. */
export function enqueuePrint(job: PrintJob) {
  // A ticket already waiting OR already printing is not queued again. The
  // in-flight case is the one that bites: enqueue starts the drain
  // synchronously, so by the second tap the job has left the array and a
  // backlog-only check would let a duplicate straight through.
  if (currentId === job.id || queue.some((q) => q.id === job.id)) return;
  queue.push(job);
  publish();
  void drain();
}

/**
 * Clear the stuck state and start again.
 *
 * Called after a human has power-cycled the printer or reconnected it. The
 * queue is intentionally NOT drained automatically out of `stuck`: something
 * physical was wrong, and only a person can know it has been fixed.
 */
export function retryPrintQueue() {
  if (state !== 'stuck') return;
  state = 'idle';
  current = null;
  currentId = null;
  publish();
  void drain();
}

/** Abandon everything waiting — used when a shift ends with a dead printer. */
export function clearPrintQueue() {
  queue = [];
  state = 'idle';
  current = null;
  currentId = null;
  lastError = null;
  publish();
}

/** Test seam. Not used by the app. */
export const __printQueueForTests = {
  reset() {
    queue = [];
    state = 'idle';
    lastError = null;
    lastVerified = null;
    current = null;
    currentId = null;
    publish();
  },
  timeoutMs: JOB_TIMEOUT_MS,
};
