/**
 * One definition of "a day" and one definition of "a sale", shared by every
 * management screen.
 *
 * Before this, three admin pages reported three different revenues for the same
 * day: the Dashboard and Analytics excluded only `cancelled`, so abandoned card
 * checkouts that never reached the kitchen were counted as takings, while the
 * Daily Report used the stricter rule. Two of them also used the UTC calendar
 * day, which for a UTC+2 venue runs 02:00 to 02:00 local — so "today" on the
 * Dashboard and "today" on Performance were different windows.
 *
 * A manager comparing two screens and finding different numbers stops trusting
 * both. The fix is not better arithmetic on each page; it is one shared answer.
 */

/**
 * Orders that never became a sale.
 *
 * Mirrors the `completed_orders` view in
 * `supabase/migrations/20260731090300_merchandising_and_analytics.sql`, which
 * additionally requires `released_to_kitchen_at IS NOT NULL`. Where a screen can
 * read the view or `day_reconciliation()`, it should — this constant is for the
 * cases where the client already has the rows.
 */
export const NON_SALE_STATUSES = ['awaiting_payment', 'payment_failed', 'cancelled'] as const;

export interface SaleLike {
  status: string;
  released_to_kitchen_at?: string | null;
}

/** Did this order actually happen? */
export function isSale(order: SaleLike): boolean {
  if (NON_SALE_STATUSES.includes(order.status as (typeof NON_SALE_STATUSES)[number])) return false;
  // Only apply the release rule when the column was selected; a screen that did
  // not ask for it should not silently drop every row.
  if (order.released_to_kitchen_at === null) return false;
  return true;
}

export const onlySales = <T extends SaleLike>(orders: T[]): T[] => orders.filter(isSale);

/* ---- The business day, in the restaurant's own timezone --------------- */

/** `YYYY-MM-DD` for a Date, in local time. Never `toISOString()`, which is UTC. */
export function localDayISO(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Start and end instants of a local calendar day, as ISO strings for
 * `timestamptz` comparison.
 */
export function localDayRange(day: string = localDayISO()): { start: string; end: string } {
  const [y, m, d] = day.split('-').map(Number);
  const start = new Date(y, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0);
  const end = new Date(y, (m ?? 1) - 1, d ?? 1, 23, 59, 59, 999);
  return { start: start.toISOString(), end: end.toISOString() };
}

/* ---- Service timings, from the stamps the schema already keeps -------- */

export interface TimedOrder {
  created_at: string;
  released_to_kitchen_at?: string | null;
  confirmed_at?: string | null;
  preparing_at?: string | null;
  ready_at?: string | null;
  served_at?: string | null;
}

const minutesBetween = (from?: string | null, to?: string | null): number | null => {
  if (!from || !to) return null;
  const ms = new Date(to).getTime() - new Date(from).getTime();
  return ms >= 0 ? ms / 60000 : null;
};

/**
 * How long the kitchen took, how long the pass took.
 *
 * The Dashboard used to compute `now - created_at` and bucket it by *current*
 * status, which meant a lunch order served at 12:10 still read "480 min" at
 * 20:00. These use the actual stage stamps, so a completed order's numbers stop
 * moving once it is complete — which is the only way an average means anything.
 */
export const timeToAccept = (o: TimedOrder) => minutesBetween(o.released_to_kitchen_at ?? o.created_at, o.confirmed_at);
export const timeToReady = (o: TimedOrder) => minutesBetween(o.released_to_kitchen_at ?? o.created_at, o.ready_at);
export const timeToServe = (o: TimedOrder) => minutesBetween(o.ready_at, o.served_at);

/** Age of an order that has not finished yet. Null once it is served. */
export function openAgeMinutes(o: TimedOrder & { status: string }): number | null {
  if (o.status === 'served' || o.status === 'cancelled') return null;
  return minutesBetween(o.released_to_kitchen_at ?? o.created_at, new Date().toISOString());
}

/**
 * Median, not mean.
 *
 * One order that sat forgotten for two hours drags a mean average far enough to
 * hide a service that was otherwise fine — and the outlier is exactly the thing
 * a manager wants to see separately, not blended in.
 */
export function median(values: number[]): number | null {
  const clean = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (clean.length === 0) return null;
  const mid = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[mid] : (clean[mid - 1] + clean[mid]) / 2;
}

/** The slowest tail, which is what guests complain about. */
export function percentile(values: number[], p: number): number | null {
  const clean = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (clean.length === 0) return null;
  const idx = Math.min(clean.length - 1, Math.max(0, Math.ceil((p / 100) * clean.length) - 1));
  return clean[idx];
}

/** Coverage disclosure: "median 14 min (from 38 of 52 orders)". */
export function summarise(values: (number | null)[], total: number) {
  const present = values.filter((v): v is number => v !== null);
  return {
    median: median(present),
    p90: percentile(present, 90),
    counted: present.length,
    total,
  };
}
