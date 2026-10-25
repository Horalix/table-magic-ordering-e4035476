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

/**
 * Hour (local) at which one trading day ends and the next begins.
 *
 * Must match `business_day()` in
 * `supabase/migrations/20260805090000_business_day.sql`. A service that runs
 * past midnight is one night of trade: the 00:30 sale belongs with the 23:30
 * one, the drawer counted at 01:15 is that night's drawer, and the waiter rota
 * does not flip to an unplanned tomorrow while guests are still seated.
 */
export const BUSINESS_DAY_CUTOFF_HOUR = 5;

/**
 * The trading day a moment belongs to, as `YYYY-MM-DD`.
 *
 * Assumes the device clock is on Sarajevo time, which every device in the
 * restaurant is. Computed on the local calendar rather than by subtracting
 * five hours of milliseconds, so the two DST nights do not shift the cutoff.
 */
export function businessDayISO(date: Date = new Date()): string {
  const d = new Date(date.getTime());
  if (d.getHours() < BUSINESS_DAY_CUTOFF_HOUR) d.setDate(d.getDate() - 1);
  return localDayISO(d);
}

/**
 * The half-open range of a trading day: `start` inclusive, `end` exclusive.
 *
 * Use with `.gte(start).lt(end)` — the day ends exactly where the next starts.
 */
export function businessDayRange(day: string = businessDayISO()): { start: string; end: string } {
  const [y, m, d] = day.split('-').map(Number);
  const start = new Date(y, (m ?? 1) - 1, d ?? 1, BUSINESS_DAY_CUTOFF_HOUR, 0, 0, 0);
  const end = new Date(y, (m ?? 1) - 1, (d ?? 1) + 1, BUSINESS_DAY_CUTOFF_HOUR, 0, 0, 0);
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

/* ---- Why sales changed ------------------------------------------------- */

/**
 * One factor of net sales in two periods. `dlog` is ln(current / compare):
 * the factors' dlogs add up exactly to net sales' dlog, which is what lets the
 * page say "fewer tables" and "bigger spend" without a remainder.
 */
export interface ChangeTerm {
  key: 'visits' | 'items_per_visit' | 'net_per_item' | 'guests_per_visit' | 'items_per_guest';
  current: number;
  compare: number;
  dlog: number;
  change_pct: number;
}

export interface ChangeTerms {
  comparable: boolean;
  net: number;
  compare_net: number;
  change_pct: number | null;
  dlog?: number;
  terms: ChangeTerm[];
}

/** `sales_decomposition()` — 20261025122000_sales_decomposition.sql. */
export interface SalesDecomposition {
  from: string;
  to: string;
  cmp_from: string;
  cmp_to: string;
  /** Current length over comparison length; the comparison's counts are multiplied by it. */
  scale: number;
  /** 'covers' when head counts were recorded on 70%+ of visits in both periods. */
  basis: 'visits' | 'covers';
  current: { net: number; visits: number; units: number; covered_visits: number; covers: number };
  compare: { net: number; visits: number; units: number; covered_visits: number; covers: number };
  total: ChangeTerms;
  dayparts: (ChangeTerms & { daypart: string; visits: number; compare_visits: number })[];
}

const DAYPART_PHRASE: Record<string, string> = {
  morning: 'in the morning',
  lunch: 'at lunch',
  afternoon: 'in the afternoon',
  evening: 'in the evening',
  late: 'late at night',
};

/** "+2%", "−8%" — a real minus sign, rounded to whole percent. */
export function signedPct(fraction: number): string {
  const n = Math.round(fraction * 100);
  if (n === 0) return '0%';
  return `${n > 0 ? '+' : '−'}${Math.abs(n)}%`;
}

/**
 * Where most of a change in tables happened, if one daypart carries it.
 *
 * Daypart visits can overlap (a table that ordered at lunch and again in the
 * afternoon counts in both), so this only names a daypart when it accounts for
 * at least 60% of the movement in the same direction.
 */
function whereTablesMoved(d: SalesDecomposition): string {
  const totalDelta = d.current.visits - d.compare.visits * Number(d.scale);
  if (totalDelta === 0) return '';
  const sign = Math.sign(totalDelta);
  const moves = d.dayparts
    .map((p) => ({ part: p.daypart, delta: Number(p.visits) - Number(p.compare_visits) }))
    .filter((m) => Math.sign(m.delta) === sign);
  const sum = moves.reduce((s, m) => s + Math.abs(m.delta), 0);
  const top = moves.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0];
  if (!top || sum <= 0 || Math.abs(top.delta) / sum < 0.6) return '';
  return DAYPART_PHRASE[top.part] ? ` ${DAYPART_PHRASE[top.part]}` : '';
}

/**
 * The one sentence: "Net sales −8% vs last week: 10% fewer tables at lunch;
 * spend per table +2%." Parts are ordered by how much of the change each
 * explains.
 */
export function describeSalesChange(d: SalesDecomposition, vs = 'last week'): string {
  const total = d.total;
  if (!total.comparable) {
    if (Number(total.compare_net) <= 0) return `No sales to compare with ${vs} yet.`;
    return `Net sales ${signedPct(Number(total.change_pct ?? 0) / 100)} vs ${vs}; too few sales to say why.`;
  }

  const term = (key: ChangeTerm['key']) => total.terms.find((t) => t.key === key);
  const dlog = (key: ChangeTerm['key']) => Number(term(key)?.dlog ?? 0);
  const parts: { text: string; weight: number }[] = [];

  const tables = Math.exp(dlog('visits')) - 1;
  parts.push({
    text: Math.abs(tables) < 0.005
      ? 'as many tables'
      : `${Math.round(Math.abs(tables) * 100)}% ${tables < 0 ? 'fewer' : 'more'} tables${whereTablesMoved(d)}`,
    weight: Math.abs(dlog('visits')),
  });

  if (d.basis === 'covers') {
    const party = dlog('guests_per_visit');
    if (Math.abs(Math.exp(party) - 1) >= 0.03) {
      parts.push({
        text: `parties ${Math.round(Math.abs(Math.exp(party) - 1) * 100)}% ${party < 0 ? 'smaller' : 'bigger'}`,
        weight: Math.abs(party),
      });
    }
    const spend = dlog('items_per_guest') + dlog('net_per_item');
    parts.push({ text: `spend per guest ${signedPct(Math.exp(spend) - 1)}`, weight: Math.abs(spend) });
  } else {
    const spend = dlog('items_per_visit') + dlog('net_per_item');
    parts.push({ text: `spend per table ${signedPct(Math.exp(spend) - 1)}`, weight: Math.abs(spend) });
  }

  const change = Math.exp(Number(total.dlog ?? 0)) - 1;
  const head = Math.abs(change) < 0.005 ? `Net sales flat vs ${vs}` : `Net sales ${signedPct(change)} vs ${vs}`;
  return `${head}: ${parts.sort((a, b) => b.weight - a.weight).map((p) => p.text).join('; ')}.`;
}

/** Plain names for the factors, for the chips under the sentence. */
export const CHANGE_TERM_LABELS: Record<ChangeTerm['key'], string> = {
  visits: 'Tables',
  items_per_visit: 'Items per table',
  guests_per_visit: 'Guests per table',
  items_per_guest: 'Items per guest',
  net_per_item: 'Net per item',
};

/* ---- Is today normal? ---------------------------------------------------- */

export interface DayAnomaly {
  day: string;
  weekday: string;
  net: number;
  traded: boolean;
  /** Same-weekday trading days the baseline rests on (up to six). */
  history: number;
  median: number | null;
  z: number | null;
  status: 'closed' | 'learning' | 'normal' | 'low' | 'high';
  alert: boolean;
}

export interface TodayPace {
  day: string;
  so_far: number;
  history: number;
  usual_so_far: number | null;
  usual_total: number | null;
  usual_share: number | null;
  pace: number | null;
  projected: number | null;
  z: number | null;
  status: 'learning' | 'too_early' | 'normal' | 'behind' | 'ahead';
  alert: boolean;
}

/** `daily_anomalies()` — 20261025124000_service_alerts.sql. */
export interface DailyAnomalies {
  today: TodayPace;
  days: DayAnomaly[];
}

export interface StationNow {
  station: string;
  daypart: string;
  tickets: number;
  p50: number | null;
  p90: number | null;
  baseline_p90: number | null;
  baseline_tickets: number;
  baseline_daypart: string;
  ratio: number | null;
  status: 'learning' | 'too_few_tickets' | 'normal' | 'slow';
  alert: boolean;
}

/** `station_timings()` — 20261025124000_service_alerts.sql. */
export interface StationTimings {
  window_days: number;
  daypart_now: string;
  baseline: { station: string; daypart: string; tickets: number; p50: number; p90: number }[];
  now: StationNow[];
}

const kmWhole = (n: number | null | undefined) => `${Math.round(Number(n ?? 0)).toLocaleString('en')} KM`;

const weekdayOf = (day: string) =>
  new Date(`${day}T12:00:00`).toLocaleDateString('en', { weekday: 'long' });

/** Today so far against the same moment of the last six same weekdays. */
export function describePace(t: TodayPace): string {
  const so = kmWhole(t.so_far);
  const weekday = weekdayOf(t.day);
  if (t.status === 'learning') {
    return `${so} so far. Pace needs four ${weekday}s of history; there ${t.history === 1 ? 'is' : 'are'} ${t.history}.`;
  }
  if (t.status === 'too_early' || t.usual_so_far === null || t.pace === null) {
    return `${so} so far. Too early in the day to judge the pace.`;
  }
  const pace = Math.round(Number(t.pace) * 100);
  const projected = t.projected === null ? '' : ` — on course for about ${kmWhole(t.projected)}`;
  return `${so} so far, ${pace}% of a usual ${weekday} by this time${projected} (a usual ${weekday} takes ${kmWhole(t.usual_total)}).`;
}

/** One past day that broke from its weekday. */
export function describeAnomaly(a: DayAnomaly): string {
  const pct = a.median ? Math.round(Math.abs(a.net / a.median - 1) * 100) : 0;
  const label = new Date(`${a.day}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });
  return `${label}: ${kmWhole(a.net)}, ${pct}% ${a.net < Number(a.median) ? 'below' : 'above'} a usual ${a.weekday} (${kmWhole(a.median)}).`;
}

const STATION_NAMES: Record<string, string> = { kitchen: 'Kitchen', bar: 'Bar' };

/** "Kitchen: slowest 1 in 10 tickets 18 min in the last 2 hours, usually 12 (1.5×)." */
export function describeStation(s: StationNow): string {
  const name = STATION_NAMES[s.station] ?? s.station;
  if (s.status === 'learning') return `${name}: still learning what a normal service looks like.`;
  if (s.status === 'too_few_tickets') return `${name}: ${s.tickets} ticket${s.tickets === 1 ? '' : 's'} in the last 2 hours — too few to judge.`;
  const ratio = s.ratio === null ? '' : ` (${Number(s.ratio).toFixed(1)}×)`;
  return `${name}: slowest 1 in 10 tickets ${Math.round(Number(s.p90))} min in the last 2 hours, usually ${Math.round(Number(s.baseline_p90))}${ratio}.`;
}
