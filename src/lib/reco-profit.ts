import { supabase } from '@/integrations/supabase/client';

/**
 * What the suggestions added, in contribution margin, against tables kept
 * without them (reco_profit_check, 20261116120000_reco_always_measured.sql).
 */
export type ProfitStatus = 'not_running' | 'too_early' | 'positive' | 'negative' | 'no_clear_difference';

export interface AttachCell {
  daypart: 'morning' | 'lunch' | 'afternoon' | 'evening' | 'late';
  arm: 'treatment' | 'holdout' | 'none';
  visits: number;
  drink_with_food: number | null;
  dessert_after_main: number | null;
  coffee_after_main: number | null;
  food_visits: number;
  main_visits: number;
}

export interface ProfitCheck {
  status: ProfitStatus;
  days: number;
  auto_holdout_pct: number;
  experiment?: {
    id: string;
    name: string;
    auto: boolean;
    policy_version: string;
    holdout_pct: number;
    started_at: string;
    ended_at: string | null;
    measured_days: number;
  };
  with_suggestions?: { visits: number; margin_per_visit: number | null; sales_per_visit: number | null };
  without?: { visits: number; margin_per_visit: number | null; sales_per_visit: number | null };
  margin_per_visit?: { difference: number | null; low: number | null; high: number | null };
  per_week?: { treated_visits: number; estimate: number | null; low: number | null; high: number | null };
  tables_needed?: number | null;
  cost_estimated_share?: number | null;
  attach: AttachCell[];
}

export const getProfitCheck = async (days = 28): Promise<ProfitCheck> => {
  const { data, error } = await supabase.rpc('reco_profit_check' as never, { _days: days } as never);
  if (error) throw new Error(error.message);
  return data as unknown as ProfitCheck;
};

/**
 * Open the always-on check if it should be running and is not. Only a
 * manager may; for anyone else it is a no-op, never an error on screen.
 */
export const keepMeasuring = async (): Promise<void> => {
  await supabase.rpc('reco_keep_measuring' as never);
};

/** 0 switches the always-on check off; 1–50 is the share of tables kept without suggestions. */
export const setAutoHoldout = async (pct: number): Promise<void> => {
  const { error } = await supabase.rpc('set_reco_auto_holdout' as never, { _pct: pct } as never);
  if (error) throw new Error(error.message);
};

const km = (n: number | null | undefined) => {
  const v = Math.round(Number(n ?? 0));
  return `${v < 0 ? '−' : ''}${Math.abs(v).toLocaleString('en')} KM`;
};
const km2 = (n: number | null | undefined) => {
  const v = Number(n ?? 0);
  return `${v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)} KM`;
};

export interface ProfitSummary {
  tone: 'good' | 'bad' | 'neutral';
  /** The figure, or a short state when there is none yet. */
  headline: string;
  /** One plain sentence under it. */
  detail: string;
  /** Whether the weekly figure is a measured result. */
  measured: boolean;
}

/**
 * The card's words for a profit check. The weekly figure is the cautious end
 * of the interval, never the point estimate: a figure that overstates once is
 * never believed again.
 */
export function summariseProfitCheck(r: ProfitCheck | null | undefined): ProfitSummary {
  if (!r || r.status === 'not_running') {
    return r && r.auto_holdout_pct > 0
      ? { tone: 'neutral', measured: false, headline: 'Not measured yet', detail: `Measuring keeps ${r.auto_holdout_pct}% of tables without suggestions, so the difference is real money, not a guess. It starts by itself within a quarter of an hour where the scheduler runs, or now with Measure.` }
      : { tone: 'neutral', measured: false, headline: 'Not measured', detail: 'No tables are kept without suggestions, so nobody can say what they earn.' };
  }
  const t = r.with_suggestions?.visits ?? 0;
  const h = r.without?.visits ?? 0;
  const w = r.per_week;
  const m = r.margin_per_visit;
  switch (r.status) {
    case 'too_early':
      return {
        tone: 'neutral', measured: false, headline: 'Not enough tables yet',
        detail: `${t} tables with suggestions and ${h} without so far.`
          + (r.tables_needed ? ` About ${r.tables_needed.toLocaleString('en')} more tables before there is an answer.` : ' An answer needs at least a week.'),
      };
    case 'positive':
      return {
        tone: 'good', measured: true, headline: `+${km(w?.low)} a week`,
        detail: `At least this much extra margin a week, likely ${km(w?.low)} to ${km(w?.high)} (${km2(m?.low)} to ${km2(m?.high)} a table), from ${(t + h).toLocaleString('en')} tables.`,
      };
    case 'negative':
      return {
        tone: 'bad', measured: true, headline: `${km(w?.estimate)} a week`,
        detail: `Tables with suggestions keep less margin than tables without, likely ${km2(m?.low)} to ${km2(m?.high)} a table. Look at what is being suggested before carrying on.`,
      };
    default:
      return {
        tone: 'neutral', measured: true, headline: 'No clear difference yet',
        detail: `Likely ${km2(m?.low)} to ${km2(m?.high)} a table, which includes zero.`
          + (r.tables_needed ? ` About ${r.tables_needed.toLocaleString('en')} more tables would tell, if the difference holds.` : ''),
      };
  }
}

export const DAYPART_LABEL: Record<AttachCell['daypart'], string> = {
  morning: 'Morning', lunch: 'Lunch', afternoon: 'Afternoon', evening: 'Evening', late: 'Late',
};

export interface AttachRow {
  daypart: AttachCell['daypart'];
  label: string;
  /** With suggestions (treatment, or every table when nothing is held out) vs without. */
  drink: [number | null, number | null];
  dessert: [number | null, number | null];
  coffee: [number | null, number | null];
  visits: number;
}

/** One row per daypart: with suggestions, without. Tables outside any experiment count as "with". */
export function attachRows(cells: AttachCell[]): AttachRow[] {
  const by = new Map<AttachCell['daypart'], AttachCell[]>();
  for (const c of cells) by.set(c.daypart, [...(by.get(c.daypart) ?? []), c]);
  const rate = (xs: AttachCell[], key: 'drink_with_food' | 'dessert_after_main' | 'coffee_after_main',
                base: 'food_visits' | 'main_visits') => {
    const n = xs.reduce((s, x) => s + Number(x[base] ?? 0), 0);
    if (!n) return null;
    return xs.reduce((s, x) => s + Number(x[key] ?? 0) * Number(x[base] ?? 0), 0) / n;
  };
  return (['morning', 'lunch', 'afternoon', 'evening', 'late'] as const)
    .filter((d) => by.has(d))
    .map((d) => {
      const xs = by.get(d) ?? [];
      const on = xs.filter((x) => x.arm !== 'holdout');
      const off = xs.filter((x) => x.arm === 'holdout');
      return {
        daypart: d,
        label: DAYPART_LABEL[d],
        drink: [rate(on, 'drink_with_food', 'food_visits'), rate(off, 'drink_with_food', 'food_visits')],
        dessert: [rate(on, 'dessert_after_main', 'main_visits'), rate(off, 'dessert_after_main', 'main_visits')],
        coffee: [rate(on, 'coffee_after_main', 'main_visits'), rate(off, 'coffee_after_main', 'main_visits')],
        visits: xs.reduce((s, x) => s + Number(x.visits), 0),
      };
    });
}
