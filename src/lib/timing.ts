import { useEffect, useState } from 'react';
import { useNow, useNowBucketed } from '@/lib/clock';

/**
 * Elapsed-time formatting and urgency thresholds, shared by every staff screen.
 *
 * Two things used to go wrong here and both showed up on the floor:
 *
 *  - Each `useElapsed` call site owned its own `setInterval`. See `clock.tsx`.
 *  - The thresholds were duplicated with different values in three places, so
 *    the same order read "fine" to a cook and "late" to a waiter, and the
 *    *order*-lateness colours were applied to *table seated duration*, turning
 *    every table twenty minutes into a normal meal destructive-red.
 *
 * There is now one set of thresholds, and separate scales for the two things
 * that are genuinely different: how long an order has been waiting, and how
 * long a table has been sitting.
 */

/* ---- Formatting ------------------------------------------------------- */

export function formatDuration(ms: number): string {
  if (ms < 0) ms = 0;
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function formatMinutes(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** An absolute time, for handovers — "ordered at 20:14" beats "34m ago". */
export function formatClock(at: string | Date | null | undefined): string {
  if (!at) return '—';
  const d = typeof at === 'string' ? new Date(at) : at;
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/* ---- Ticking ---------------------------------------------------------- */

/**
 * @deprecated Use the shared clock (`useNow` / `useNowBucketed`) instead. Left
 * only so an older caller does not break; it has no remaining consumers here.
 */
export function useTick(intervalMs = 1000): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return tick;
}

const toMs = (since: string | Date | null | undefined): number | null => {
  if (!since) return null;
  const ts = typeof since === 'string' ? new Date(since).getTime() : since.getTime();
  return Number.isFinite(ts) ? ts : null;
};

/**
 * Elapsed ms since `since`, ticking once a second off the shared clock.
 *
 * Same signature as before, so no call site changed.
 */
export function useElapsed(since: string | Date | null | undefined): number {
  const now = useNow();
  const ts = toMs(since);
  return ts === null ? 0 : Math.max(0, now - ts);
}

/**
 * Elapsed ms, updating only when the displayed minute changes.
 *
 * Use this wherever the UI renders `formatMinutes` — which is most cards.
 */
export function useElapsedMinutes(since: string | Date | null | undefined): number {
  const now = useNowBucketed(60_000);
  const ts = toMs(since);
  return ts === null ? 0 : Math.max(0, now - ts);
}

/* ---- Urgency ---------------------------------------------------------- */

export type Urgency = 'fresh' | 'attention' | 'late' | 'critical';

/**
 * How overdue an ORDER is, in minutes since it reached the kitchen.
 *
 * Four levels rather than three so "getting on" and "someone go and look" are
 * distinguishable at a glance, which is the whole job of this scale.
 */
export const ORDER_THRESHOLDS = { attention: 8, late: 15, critical: 25 } as const;

export function orderUrgency(ms: number): Urgency {
  const mins = ms / 60000;
  if (mins >= ORDER_THRESHOLDS.critical) return 'critical';
  if (mins >= ORDER_THRESHOLDS.late) return 'late';
  if (mins >= ORDER_THRESHOLDS.attention) return 'attention';
  return 'fresh';
}

/**
 * How long a TABLE has been seated.
 *
 * Deliberately a different, far longer scale: a table forty minutes into a meal
 * is having dinner, not having a crisis. Applying the order scale here is what
 * used to turn the whole floor red within an hour of opening and made the
 * colour meaningless.
 */
export const TABLE_THRESHOLDS = { attention: 75, late: 110, critical: 150 } as const;

export function tableUrgency(ms: number): Urgency {
  const mins = ms / 60000;
  if (mins >= TABLE_THRESHOLDS.critical) return 'critical';
  if (mins >= TABLE_THRESHOLDS.late) return 'late';
  if (mins >= TABLE_THRESHOLDS.attention) return 'attention';
  return 'fresh';
}

const URGENCY_TEXT: Record<Urgency, string> = {
  fresh: 'text-primary',
  attention: 'text-accent',
  late: 'text-destructive',
  critical: 'text-destructive font-semibold',
};

const URGENCY_BG: Record<Urgency, string> = {
  fresh: 'bg-primary/10 text-primary border-primary/20',
  attention: 'bg-accent/10 text-accent border-accent/20',
  late: 'bg-destructive/10 text-destructive border-destructive/20',
  critical: 'bg-destructive/15 text-destructive border-destructive/40 font-semibold',
};

/**
 * A short glyph so urgency is never colour-only.
 *
 * Roughly 1 in 12 men has some colour-vision deficiency, and a kitchen is read
 * from across a room in bad light by someone carrying two plates.
 */
const URGENCY_MARK: Record<Urgency, string> = {
  fresh: '', attention: '!', late: '!!', critical: '!!!',
};

export const urgencyText = (u: Urgency) => URGENCY_TEXT[u];
export const urgencyBg = (u: Urgency) => URGENCY_BG[u];
export const urgencyMark = (u: Urgency) => URGENCY_MARK[u];
export const urgencyLabel = (u: Urgency) =>
  u === 'critical' ? 'critical' : u === 'late' ? 'late' : u === 'attention' ? 'getting on' : '';

/** Order-lateness colours. Kept for existing call sites. */
export const waitColor = (ms: number) => urgencyText(orderUrgency(ms));
export const waitBg = (ms: number) => urgencyBg(orderUrgency(ms));
/** Table-seated colours — the correct scale for a table card. */
export const seatedBg = (ms: number) => urgencyBg(tableUrgency(ms));
