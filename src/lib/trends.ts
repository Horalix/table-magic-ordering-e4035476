/**
 * Which dishes are genuinely taking off, or dying — without false alarms.
 *
 * With ~150 dishes, some dish moves a lot every single week by chance alone.
 * A list of "biggest movers" is therefore mostly noise, and a manager who acts
 * on it re-photographs dishes that were fine. Three things keep this quiet:
 *
 *  1. A real test per dish. `item_trends()` supplies, on trading days, k1
 *     orders in the last 14 days, k0 in the 56 before, and the visits on the
 *     days the dish could be ordered in each window (e1, e0). If nothing
 *     changed, a dish's orders per visit are the same in both windows, so of
 *     its n = k0 + k1 orders, k1 ~ Binomial(n, e1 / (e0 + e1)). The two-sided
 *     p-value is exact when n < 30 and a continuity-corrected normal
 *     approximation above.
 *
 *  2. Benjamini–Hochberg across every dish at q = 0.10: of the dishes flagged,
 *     at most about one in ten is expected to be a fluke, however many dishes
 *     are on the menu.
 *
 *  3. A floor on size and evidence: the rate must have moved by at least 1.5×
 *     (or fallen to 0.67× or less) and rest on at least 10 orders. A real but
 *     tiny change is not worth a manager's attention.
 *
 * What it cannot see: at 150 dishes, a genuine doubling needs roughly 100+
 * orders before it clears the multiple-testing bar. Quiet dishes will change
 * without being flagged; that is the price of not crying wolf.
 */

export interface ItemTrendRow {
  item_id: string;
  name: string;
  is_available: boolean;
  /** Orders containing the dish, last 14 complete trading days. */
  k1: number;
  /** Orders containing the dish, the 56 trading days before. */
  k0: number;
  /** Visits on the recent days the dish could be ordered. */
  e1: number;
  /** Visits on the prior days the dish could be ordered. */
  e0: number;
  days1: number;
  days0: number;
  /** Portions in the recent window, to turn orders into portions. */
  units1: number;
  price: number;
  unit_cm: number;
  cost_estimated: boolean;
}

export interface TrendOptions {
  /** False discovery rate for Benjamini–Hochberg. */
  q: number;
  /** Smallest rise worth reporting, as a rate ratio. */
  minRise: number;
  /** Largest fall worth reporting, as a rate ratio (0.67 = a third fewer). */
  maxFall: number;
  /** Fewest orders (k0 + k1) a verdict may rest on. */
  minOrders: number;
  /** Exact binomial below this many orders, normal approximation from it. */
  exactBelow: number;
}

export const TREND_DEFAULTS: TrendOptions = {
  q: 0.1,
  minRise: 1.5,
  maxFall: 0.67,
  minOrders: 10,
  exactBelow: 30,
};

export interface TrendAlert {
  item_id: string;
  name: string;
  direction: 'up' | 'down';
  /** Orders per visit, recent over prior. Infinity when the dish had none before. */
  ratio: number;
  n: number;
  p: number;
  /** Visits behind the comparison (e0 + e1). */
  visits: number;
  /** Margin a week the change is worth (rise) or costs (fall), in KM. */
  km_per_week: number;
  cost_estimated: boolean;
  message: string;
}

/* ---- distributions ------------------------------------------------------ */

const LOG_FACT: number[] = [0];
function logFactorial(n: number): number {
  for (let i = LOG_FACT.length; i <= n; i += 1) LOG_FACT[i] = LOG_FACT[i - 1] + Math.log(i);
  return LOG_FACT[n];
}

/** P(X = k) for X ~ Binomial(n, p). */
export function binomialPmf(k: number, n: number, p: number): number {
  if (k < 0 || k > n) return 0;
  if (p <= 0) return k === 0 ? 1 : 0;
  if (p >= 1) return k === n ? 1 : 0;
  return Math.exp(
    logFactorial(n) - logFactorial(k) - logFactorial(n - k) + k * Math.log(p) + (n - k) * Math.log(1 - p),
  );
}

/**
 * Standard normal upper tail, P(Z > z).
 *
 * Complementary error function by the Numerical Recipes Chebyshev fit
 * (erfc, relative error < 1.2e-7 everywhere), which keeps small p-values
 * accurate enough to rank for Benjamini–Hochberg.
 */
export function normalUpperTail(z: number): number {
  const x = z / Math.SQRT2;
  const t = 1 / (1 + 0.5 * Math.abs(x));
  const y = t * Math.exp(-x * x - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418
    + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587
    + t * (-0.82215223 + t * 0.17087277)))))))));
  const erfc = x >= 0 ? y : 2 - y;
  return erfc / 2;
}

/**
 * Two-sided p-value for k successes out of n at probability p.
 *
 * Exact (sum of every outcome no more likely than the one observed) when
 * n < `exactBelow`; otherwise the normal approximation with a continuity
 * correction of one half.
 */
export function binomialTwoSidedP(k: number, n: number, p: number, exactBelow = TREND_DEFAULTS.exactBelow): number {
  if (n <= 0) return 1;
  if (n < exactBelow) {
    const observed = binomialPmf(k, n, p);
    let total = 0;
    for (let i = 0; i <= n; i += 1) {
      const pi = binomialPmf(i, n, p);
      if (pi <= observed * (1 + 1e-7)) total += pi;
    }
    return Math.min(1, total);
  }
  const mean = n * p;
  const sd = Math.sqrt(n * p * (1 - p));
  if (sd === 0) return k === mean ? 1 : 0;
  const z = Math.max(0, Math.abs(k - mean) - 0.5) / sd;
  return Math.min(1, 2 * normalUpperTail(z));
}

/**
 * Benjamini–Hochberg step-up. Returns, per input p-value, whether it is a
 * discovery at false discovery rate `q`.
 */
export function benjaminiHochberg(pValues: number[], q = TREND_DEFAULTS.q): boolean[] {
  const m = pValues.length;
  const order = pValues.map((p, i) => ({ p, i })).sort((a, b) => a.p - b.p || a.i - b.i);
  let cutoff = -1;
  order.forEach(({ p }, rank) => {
    if (p <= ((rank + 1) / m) * q) cutoff = rank;
  });
  const out = new Array<boolean>(m).fill(false);
  for (let r = 0; r <= cutoff; r += 1) out[order[r].i] = true;
  return out;
}

/* ---- the verdict -------------------------------------------------------- */

const pct = (x: number) => Math.round(Math.abs(x) * 100);

function describe(name: string, ratio: number, k1: number, k0: number): string {
  if (!Number.isFinite(ratio)) {
    return `${name}: ${k1} orders in the last 2 weeks, none in the 8 weeks before.`;
  }
  if (ratio >= 1) return `${name}: ${ratio.toFixed(1)}× more orders per table than the previous 8 weeks.`;
  if (k1 === 0) return `${name}: no orders in the last 2 weeks, after ${k0} in the 8 weeks before.`;
  return `${name}: ${pct(1 - ratio)}% fewer orders per table than the previous 8 weeks.`;
}

/**
 * Test every dish, correct for testing them all at once, and keep the ones
 * that changed by enough to matter. Sorted by money at stake, then name.
 */
export function detectTrends(rows: ItemTrendRow[], options: Partial<TrendOptions> = {}): TrendAlert[] {
  const o = { ...TREND_DEFAULTS, ...options };

  // Only dishes with a baseline and a recent window can be tested at all.
  const testable = rows
    .map((r) => ({
      ...r,
      k1: Number(r.k1), k0: Number(r.k0), e1: Number(r.e1), e0: Number(r.e0),
      days1: Number(r.days1), units1: Number(r.units1), unit_cm: Number(r.unit_cm),
    }))
    .filter((r) => r.e0 > 0 && r.e1 > 0 && r.k0 + r.k1 > 0);

  const pValues = testable.map((r) => binomialTwoSidedP(r.k1, r.k0 + r.k1, r.e1 / (r.e0 + r.e1), o.exactBelow));
  const discovered = benjaminiHochberg(pValues, o.q);

  const alerts: TrendAlert[] = [];
  testable.forEach((r, i) => {
    const n = r.k0 + r.k1;
    if (!discovered[i] || n < o.minOrders) return;
    const rate1 = r.k1 / r.e1;
    const rate0 = r.k0 / r.e0;
    const ratio = rate0 > 0 ? rate1 / rate0 : Infinity;
    if (!(ratio >= o.minRise || ratio <= o.maxFall)) return;

    // Orders per visit gained or lost, at the recent visit rate, in portions,
    // at this dish's margin.
    const visitsPerWeek = r.days1 > 0 ? (r.e1 / r.days1) * 7 : 0;
    const portionsPerOrder = r.k1 > 0 && r.units1 > 0 ? r.units1 / r.k1 : 1;
    const km = Math.abs(rate1 - rate0) * visitsPerWeek * portionsPerOrder * r.unit_cm;

    alerts.push({
      item_id: r.item_id,
      name: r.name,
      direction: ratio >= 1 ? 'up' : 'down',
      ratio,
      n,
      p: pValues[i],
      visits: r.e0 + r.e1,
      km_per_week: Math.round(km),
      cost_estimated: r.cost_estimated,
      message: describe(r.name, ratio, r.k1, r.k0),
    });
  });

  return alerts.sort((a, b) => b.km_per_week - a.km_per_week || a.name.localeCompare(b.name) || a.item_id.localeCompare(b.item_id));
}
