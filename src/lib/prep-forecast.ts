/**
 * Tomorrow's prep list — and the honesty to hide it when it is no good.
 *
 * Built from `prep_history()` (20261025127000_prep_history.sql): per dish and
 * daypart, what sold on each of the last ten same weekdays (null on days the
 * dish could not be ordered).
 *
 *  FORECAST  Weighted mean of the last four same weekdays, newest first, with
 *            weights 0.4 / 0.3 / 0.2 / 0.1 (renormalised over the days the dish
 *            was on sale). A Tuesday is forecast from Tuesdays.
 *
 *  SLOW DISHES  A dish averaging under 3 portions a day is too noisy to
 *            forecast alone: forecast its subcategory the same way and give the
 *            dish its share of the subcategory's last 28 days, per daypart.
 *
 *  HOW MUCH TO PREP  The newsvendor answer. Running out loses the margin on a
 *            portion (c_u = unit contribution margin); over-prepping wastes its
 *            ingredients (c_o = unit cost). Prep the quantile of demand at the
 *            critical ratio c_u / (c_u + c_o). Demand is taken as Poisson around
 *            the forecast, unless the history varies more than 1.5× its mean
 *            (overdispersed), in which case the observed history's own quantile
 *            is used instead.
 *
 *  BACKTEST  On each of the last six same weekdays, the same method is run on
 *            only the weeks before it and compared with what sold, against the
 *            seasonal-naive forecast "same as that weekday last week". The
 *            ratio of their mean absolute errors (MASE against seasonal naive,
 *            Hyndman & Athanasopoulos, FPP3 §5.8) must be below 1, or the
 *            card is not shown at all: a forecast that loses to "same as last
 *            week" should not be telling a kitchen what to prep.
 *
 * Known shortcut: a slow dish's subcategory share uses the latest 28 days in
 * the backtest too, which flatters the backtest very slightly for slow dishes.
 */

export const DAYPARTS = ['morning', 'lunch', 'afternoon', 'evening', 'late'] as const;
export type Daypart = (typeof DAYPARTS)[number];

export interface PrepItem {
  item_id: string;
  name: string;
  is_available: boolean;
  subcategory_id: string;
  subcategory: string | null;
  unit_cm: number;
  unit_cost: number;
  cost_estimated: boolean;
  /** series[daypart][k-1]: portions k same-weekdays before the target day; null = not on sale. */
  series: Partial<Record<Daypart, (number | null)[]>>;
  last28: Partial<Record<Daypart, number>>;
}

export interface PrepHistory {
  day: string;
  weekday: string;
  weeks: string[];
  items: PrepItem[];
}

export const WEIGHTS = [0.4, 0.3, 0.2, 0.1];
export const SLOW_PER_DAY = 3;
export const BACKTEST_WEEKS = 6;
export const OVERDISPERSION = 1.5;

const n = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/** Weighted mean of up to four values, newest first, skipping unknown days. */
export function weightedMean(values: (number | null)[]): number | null {
  let sum = 0;
  let weight = 0;
  WEIGHTS.forEach((w, i) => {
    const v = n(values[i]);
    if (v !== null && Number.isFinite(v)) { sum += w * v; weight += w; }
  });
  return weight > 0 ? sum / weight : null;
}

/** Smallest q with P(X <= q) >= p for X ~ Poisson(mean). */
export function poissonQuantile(mean: number, p: number): number {
  if (!(mean > 0)) return 0;
  let k = 0;
  let pmf = Math.exp(-mean);
  let cdf = pmf;
  while (cdf < p && k < 10_000) {
    k += 1;
    pmf *= mean / k;
    cdf += pmf;
  }
  return k;
}

/** Nearest-rank quantile of observed values. */
export function empiricalQuantile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
}

/** Newsvendor critical ratio: the share of demand worth covering. */
export function criticalRatio(unitCm: number, unitCost: number): number {
  const cu = Math.max(Number(unitCm) || 0, 0);
  const co = Math.max(Number(unitCost) || 0, 0);
  return cu + co > 0 ? cu / (cu + co) : 0.5;
}

const variance = (xs: number[]) => {
  if (xs.length < 2) return 0;
  const m = xs.reduce((s, x) => s + x, 0) / xs.length;
  return xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1);
};

/** Values `offset` weeks back and older (series index = weeks back − 1). */
const window = (series: (number | null)[] | undefined, offset: number, length = 4) =>
  (series ?? []).slice(offset, offset + length);

export interface Context {
  /** Subcategory totals per daypart, per week index (null when no dish in it was on sale). */
  subSeries: Map<string, Record<string, (number | null)[]>>;
  subLast28: Map<string, Record<string, number>>;
}

export function buildContext(items: PrepItem[]): Context {
  const subSeries = new Map<string, Record<string, (number | null)[]>>();
  const subLast28 = new Map<string, Record<string, number>>();
  for (const it of items) {
    const s = subSeries.get(it.subcategory_id) ?? {};
    const l = subLast28.get(it.subcategory_id) ?? {};
    for (const dp of DAYPARTS) {
      const arr = s[dp] ?? new Array<number | null>(10).fill(null);
      (it.series[dp] ?? []).forEach((v, i) => {
        const x = n(v);
        if (x !== null) arr[i] = (arr[i] ?? 0) + x;
      });
      s[dp] = arr;
      l[dp] = (l[dp] ?? 0) + (n(it.last28[dp]) ?? 0);
    }
    subSeries.set(it.subcategory_id, s);
    subLast28.set(it.subcategory_id, l);
  }
  return { subSeries, subLast28 };
}

/** Average portions a day over the four lags, across dayparts. */
function perDay(item: PrepItem, offset: number): number {
  let total = 0;
  let days = 0;
  for (let i = offset; i < offset + 4; i += 1) {
    const vals = DAYPARTS.map((dp) => n(item.series[dp]?.[i]));
    if (vals.every((v) => v === null)) continue;
    total += vals.reduce<number>((s, v) => s + (v ?? 0), 0);
    days += 1;
  }
  return days > 0 ? total / days : 0;
}

/**
 * The forecast for the day `offset` weeks before the target (0 = the target
 * itself), from the four same weekdays before that day.
 */
export function forecastCell(item: PrepItem, dp: Daypart, offset: number, ctx: Context): { value: number | null; method: 'item' | 'subcategory' } {
  if (perDay(item, offset) >= SLOW_PER_DAY) {
    return { value: weightedMean(window(item.series[dp], offset)), method: 'item' };
  }
  const sub = weightedMean(window(ctx.subSeries.get(item.subcategory_id)?.[dp], offset));
  const subTotal = ctx.subLast28.get(item.subcategory_id)?.[dp] ?? 0;
  const share = subTotal > 0 ? (n(item.last28[dp]) ?? 0) / subTotal : 0;
  return { value: sub === null ? null : sub * share, method: 'subcategory' };
}

export interface PrepRow {
  item_id: string;
  name: string;
  forecast: number;
  prep: number;
  method: 'item' | 'subcategory';
  /** Poisson unless the history is overdispersed. */
  spread: 'poisson' | 'empirical';
  critical_ratio: number;
  cost_estimated: boolean;
  dayparts: { daypart: Daypart; forecast: number; prep: number }[];
}

export interface PrepForecast {
  day: string;
  weekday: string;
  /** Mean absolute error of this method over that of "same as last week"; null if it cannot be judged. */
  mase: number | null;
  /** Item-daypart-days the backtest compared. */
  points: number;
  /** Only true when the backtest beat seasonal naive. */
  show: boolean;
  rows: PrepRow[];
}

/** Six past same-weekdays, forecast blind and compared with what sold. */
export function backtest(items: PrepItem[], ctx: Context = buildContext(items)): { mase: number | null; points: number } {
  let model = 0;
  let naive = 0;
  let points = 0;
  for (const it of items) {
    for (const dp of DAYPARTS) {
      const s = it.series[dp] ?? [];
      for (let t = 1; t <= BACKTEST_WEEKS; t += 1) {
        const actual = n(s[t - 1]);
        const lastWeek = n(s[t]);
        const f = forecastCell(it, dp, t, ctx).value;
        if (actual === null || lastWeek === null || f === null) continue;
        model += Math.abs(f - actual);
        naive += Math.abs(lastWeek - actual);
        points += 1;
      }
    }
  }
  return { mase: naive > 0 ? model / naive : null, points };
}

export function prepForecast(history: PrepHistory): PrepForecast {
  const items = (history.items ?? []).filter((i) => i.is_available);
  const ctx = buildContext(history.items ?? []);
  const { mase, points } = backtest(history.items ?? [], ctx);

  const rows: PrepRow[] = [];
  for (const it of items) {
    const cr = criticalRatio(it.unit_cm, it.unit_cost);
    let method: PrepRow['method'] = 'item';
    let spread: PrepRow['spread'] = 'poisson';
    const parts: PrepRow['dayparts'] = [];
    for (const dp of DAYPARTS) {
      const { value, method: m } = forecastCell(it, dp, 0, ctx);
      method = m;
      if (value === null || value <= 0) continue;
      const observed = (it.series[dp] ?? []).slice(0, 8).map(n).filter((v): v is number => v !== null);
      const overdispersed = observed.length >= 4 && m === 'item' && variance(observed) > OVERDISPERSION * value;
      if (overdispersed) spread = 'empirical';
      const prep = overdispersed ? empiricalQuantile(observed, cr) : poissonQuantile(value, cr);
      parts.push({ daypart: dp, forecast: Math.round(value * 10) / 10, prep });
    }
    const forecast = parts.reduce((s, p) => s + p.forecast, 0);
    const prep = parts.reduce((s, p) => s + p.prep, 0);
    if (prep <= 0) continue;
    rows.push({
      item_id: it.item_id, name: it.name, forecast: Math.round(forecast * 10) / 10, prep, method, spread,
      critical_ratio: Math.round(cr * 100) / 100, cost_estimated: it.cost_estimated, dayparts: parts,
    });
  }
  rows.sort((a, b) => b.prep - a.prep || a.name.localeCompare(b.name));

  return {
    day: history.day,
    weekday: history.weekday,
    mase: mase === null ? null : Math.round(mase * 100) / 100,
    points,
    show: mase !== null && mase < 1 && points >= 20,
    rows,
  };
}
