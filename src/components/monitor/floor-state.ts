import { ORDER_THRESHOLDS } from '@/lib/timing';

/**
 * What one table on the floor monitor is, as one word.
 *
 * Free and taken are the first distinction (an outline against a solid tile).
 * Among taken tables, the loudest thing wins the tile, in the staff colours:
 * a guest calling, then a guest who wants the bill, then food ready to run,
 * then an order late in the kitchen; otherwise the table is simply seated.
 * The same order the waiter cards on the rail use (calls, bills, food up).
 */
export type FloorKind = 'calling' | 'bill' | 'ready' | 'late' | 'seated' | 'free';

export const FLOOR_RANK: Record<FloorKind, number> = {
  calling: 5, bill: 4, ready: 3, late: 2, seated: 1, free: 0,
};

/** The kinds that need a waiter now: what "need you" counts. */
export const NEEDS_YOU: readonly FloorKind[] = ['calling', 'bill', 'ready', 'late'];

export const FLOOR_LABEL: Record<FloorKind, string> = {
  calling: 'Calling',
  bill: 'Wants bill',
  ready: 'Food up',
  late: 'Late',
  seated: 'Seated',
  free: 'Free',
};

/** The word on the tile itself, short enough to stay whole in capitals on a phone. */
export const FLOOR_WORD: Record<FloorKind, string> = {
  calling: 'Calling',
  bill: 'Bill',
  ready: 'Food up',
  late: 'Late',
  seated: 'Seated',
  free: 'Free',
};

export interface FloorFacts {
  /** An active session sits at the table. */
  seated: boolean;
  /** When the oldest open call was made (ISO), or null. */
  callAt?: string | null;
  /** When the oldest open bill request was made (ISO), or null. */
  billAt?: string | null;
  /** Plates waiting at the pass for this table. */
  readyCount?: number;
  /** When the first of them came up (ISO), when the database knows. */
  readyAt?: string | null;
  /** When the oldest order still being cooked reached the kitchen (ISO). Ready plates are not counted. */
  cookingSince?: string | null;
}

export interface FloorStatus {
  kind: FloorKind;
  /** Since when the loud signal has been true (ms), for "4m"; null when unknown or not urgent. */
  since: number | null;
  /** The other signals at this table, quieter, most urgent first. */
  also: FloorKind[];
}

const ms = (iso: string | null | undefined) => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : null;
};

/** An order is late on this screen when the kitchen would call it late (src/lib/timing.ts, 15 minutes). */
export const LATE_AFTER_MS = ORDER_THRESHOLDS.late * 60_000;

export function floorStatus(f: FloorFacts, now: number): FloorStatus {
  if (!f.seated) return { kind: 'free', since: null, also: [] };
  const active: { kind: FloorKind; since: number | null }[] = [];
  if (f.callAt) active.push({ kind: 'calling', since: ms(f.callAt) });
  if (f.billAt) active.push({ kind: 'bill', since: ms(f.billAt) });
  if ((f.readyCount ?? 0) > 0) active.push({ kind: 'ready', since: ms(f.readyAt) });
  const cooking = ms(f.cookingSince);
  if (cooking !== null && now - cooking >= LATE_AFTER_MS) active.push({ kind: 'late', since: cooking });
  if (active.length === 0) return { kind: 'seated', since: null, also: [] };
  active.sort((a, b) => FLOOR_RANK[b.kind] - FLOOR_RANK[a.kind]);
  return { kind: active[0].kind, since: active[0].since, also: active.slice(1).map((a) => a.kind) };
}

export const needsYou = (s: FloorStatus) => NEEDS_YOU.includes(s.kind);

/** "9 taken · 5 free · 2 need you". */
export function floorSummary(statuses: FloorStatus[]) {
  const free = statuses.filter((s) => s.kind === 'free').length;
  return {
    taken: statuses.length - free,
    free,
    needYou: statuses.filter(needsYou).length,
  };
}

/**
 * "Needs you first": the loudest kind first, and within a kind whoever has
 * waited longest. Ties keep table order, so equal tables do not swap places.
 */
export function compareNeedsFirst(
  a: { status: FloorStatus; number: number },
  b: { status: FloorStatus; number: number },
): number {
  const rank = FLOOR_RANK[b.status.kind] - FLOOR_RANK[a.status.kind];
  if (rank !== 0) return rank;
  const as = a.status.since ?? Infinity;
  const bs = b.status.since ?? Infinity;
  if (as !== bs) return as - bs;
  return a.number - b.number;
}
