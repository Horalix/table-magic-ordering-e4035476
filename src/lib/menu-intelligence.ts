import { supabase } from '@/integrations/supabase/client';
import { detectTrends, type ItemTrendRow, type TrendAlert } from '@/lib/trends';

/**
 * Read model for Admin → Menu Intelligence.
 *
 * Every figure here comes from one of two places and the two are never blended:
 * behaviour from `analytics_events`, money from `completed_orders`. A single
 * averaged number would hide which half is weak, which is exactly the thing a
 * manager needs to see.
 */

const rpc = async <T>(fn: string, args: Record<string, unknown> = {}): Promise<T> => {
  const { data, error } = await supabase.rpc(fn as never, args as never);
  if (error) throw new Error(error.message);
  return data as T;
};

export interface ItemPerformance {
  item_id: string;
  name: string;
  category_name: string;
  subcategory_name: string;
  price: number;
  is_available: boolean;
  margin_score: number;
  /** When the dish was added. A dish added mid-window has not had a fair chance to sell. */
  created_at: string;
  views: number;
  adds: number;
  removes: number;
  orders: number;
  units: number;
  revenue: number;
  /** % of guests who looked and then added. Null when nobody looked. */
  add_rate: number | null;
  /** % of guests who looked and then actually bought. */
  order_rate: number | null;
  /** % of adds that were taken back out again. */
  abandon_rate: number | null;
}

export interface Pairing {
  item_a: string;
  name_a: string;
  item_b: string;
  name_b: string;
  pair_orders: number;
  confidence: number;
  /** >1 means a genuine pairing rather than one item simply being popular. */
  lift: number;
  already_curated: boolean;
}

export type SuggestionStatus = 'learning' | 'strong' | 'working' | 'weak' | 'retired';

export interface SuggestionRow {
  source_item_id: string | null;
  source_name: string;
  recommended_item_id: string;
  recommended_name: string;
  placement: string;
  shown: number;
  accepted: number;
  dismissed: number;
  acceptance_rate: number | null;
  smoothed_rate: number;
  attributed_revenue: number;
  revenue_per_impression: number | null;
  status: SuggestionStatus;
}

export interface SuggestionImpact {
  days: number;
  /** Net sales — items, minus refunds, without tips. Same figure as `net_sales`. */
  total_revenue: number;
  net_sales: number;
  tips: number;
  attributed_revenue: number;
  uplift_pct: number;
  orders: number;
  orders_with_suggestion: number;
  attach_rate_pct: number;
  avg_order_with_suggestion: number;
  avg_order_without_suggestion: number;
  /** Client TAPS: fired on mount and on tap, with no link to a paid order. */
  shown: number;
  accepted: number;
  overall_acceptance_pct: number;
  /** Server-recorded sightings (one per decision), from the decision ledger. */
  seen: number;
  /** Of those sightings, how many became a line on a completed order. */
  paid: number;
  paid_acceptance_pct: number | null;
  /**
   * Net sales per head, per VISIT, which removes party size from the
   * comparison. `sessions_counted` is the honesty: only visits where staff
   * recorded a head count.
   */
  per_cover: { sessions_counted: number; orders_counted: number; with_suggestions: number; holdout: number };
}

export interface EngineHealth {
  enabled: boolean;
  weights: {
    curated: number;
    observed: number;
    learned: number;
    margin: number;
    exploration: number;
  };
  retire_below_acceptance_pct: number;
  retire_after_impressions: number;
  curated_rules: number;
  learned_pairs: number;
  tracked_pairs: number;
  pairs_still_learning: number;
  pairs_retired: number;
  affinity_computed_at: string | null;
  stats_updated_at: string | null;
  /** The window pairings and suggestion stats are rebuilt over, whatever range the page shows. */
  window_days?: number;
  orders_analysed: number;
  /**
   * What tables taught it (20261026110000_reco_adaptive.sql). Counted the
   * moment each order reaches the kitchen; the rest is refreshed when due.
   * Absent on a database that predates it.
   */
  learning?: {
    tables: number;
    /** Dish-to-dish pairs with at least three tables. */
    dish_pairs: number;
    /** Pairs a dish can inherit from its section or kind. */
    family_pairs: number;
    last_learned_at: string | null;
    refreshed_at: string | null;
    scheduler: string;
  };
}

/**
 * The causal number: what suggestions are actually worth.
 *
 * `status` is the headline and is allowed to say "we do not know yet" — which
 * is the correct answer far more often than a dashboard usually admits.
 *
 * The unit is the VISIT (a table session) and the money is net sales — items
 * minus refunds, without tips — because treatment is assigned per session and
 * a tip is not something a suggestion earned. Shared by Menu Intelligence and
 * the impact page, so the two cannot drift apart again.
 */
export type HoldoutStatus =
  /** No experiment overlaps the window, so there is nothing to compare against. */
  | 'not_running'
  /** Fewer than 30 visits on a side. Any difference is noise. */
  | 'too_early'
  /** The split does not match what was configured. No result can be trusted. */
  | 'invalid_srm'
  /** Enough data, and the interval spans zero. */
  | 'no_measurable_effect'
  | 'positive'
  | 'negative';

export interface HoldoutArm {
  sessions: number;
  avg_net_sales: number;
}

export interface HoldoutComparison {
  days: number;
  /** Days of the window the experiment actually ran; the projection's denominator. */
  measured_days?: number;
  status: HoldoutStatus;
  holdout_pct?: number;
  with_suggestions?: HoldoutArm;
  holdout?: HoldoutArm;
  difference?: number | null;
  /** 95% interval on the difference. An effect is only claimed when it excludes zero. */
  ci_low?: number | null;
  ci_high?: number | null;
  significant?: boolean;
  /** Money per month, projected from CI_LOW. Null unless the effect is real. */
  conservative_monthly_value?: number | null;
  experiment?: { name: string; policy_version: string; started_at: string } | null;
  srm?: { checked: boolean; healthy: boolean; observed_holdout_pct: number; expected_holdout_pct: number } | null;
  power?: { ready: boolean; sessions_needed_per_arm: number; days_remaining: number | null } | null;
  guardrails?: {
    rating_treatment: number | null; rating_holdout: number | null;
    minutes_treatment: number | null; minutes_holdout: number | null;
  } | null;
}

/** Attribution split by the surface the suggestion appeared on. */
export interface PlacementImpact {
  placement: string;
  shown: number;
  accepted: number;
  acceptance_pct: number;
  attributed_revenue: number;
  /** The number that decides whether a surface earns its space. */
  revenue_per_impression: number;
}

export interface SoldOutRow {
  item_id: string;
  name: string;
  views: number;
  /** Takings in the window, and the last trading day it sold. */
  revenue: number;
  last_sold_day: string | null;
  /** Trading days from the window start (or when it was added) to the last day it sold. */
  selling_days: number;
  avg_daily_revenue_when_available: number;
  /**
   * The same per-day figure: what each further trading day without the dish
   * forgoes, before allowing for guests who order something else instead.
   * Per day, and an upper bound — not a running total.
   */
  estimated_lost_revenue: number;
}

/** How each suggestion surface is named on screen. One place, so no table calls the dish page "Cart". */
export function placementLabel(placement: string): string {
  switch (placement) {
    case 'cart': return 'In the cart';
    case 'item': return 'On the dish page';
    case 'after_meal': return 'After the meal';
    default: return placement;
  }
}

export const getItemPerformance = (days = 30) =>
  rpc<ItemPerformance[]>('menu_item_performance', { _days: days });

export const getPairings = (limit = 30) =>
  rpc<Pairing[]>('menu_pairings', { _limit: limit });

export const getSuggestionPerformance = (limit = 50) =>
  rpc<SuggestionRow[]>('suggestion_performance', { _limit: limit });

export const getSuggestionImpact = (days = 30) =>
  rpc<SuggestionImpact>('suggestion_impact', { _days: days });

export const getPlacementImpact = (days = 30) =>
  rpc<PlacementImpact[]>('suggestion_impact_by_placement', { _days: days });

export const getEngineHealth = () =>
  rpc<EngineHealth>('recommendation_engine_health');

export const getHoldoutComparison = (days = 30) =>
  rpc<HoldoutComparison>('reco_holdout_comparison', { _days: days });

export const getSoldOutImpact = (days = 30) =>
  rpc<SoldOutRow[]>('sold_out_impact', { _days: days });

/** Recompute pairings and learned acceptance from the raw record. */
export const refreshIntelligence = () =>
  rpc<{ pairs: number; suggestion_rows: number; refreshed_at: string }>('refresh_menu_intelligence');

/** Turn a discovered pairing into a curated rule with one click. */
export const curatePairing = async (sourceItemId: string, recommendedItemId: string, priority = 70) => {
  const { error } = await supabase.from('menu_item_recommendations').insert({
    source_item_id: sourceItemId,
    recommended_item_id: recommendedItemId,
    recommendation_type: 'frequently_bought_together',
    priority,
  } as never);
  if (error) throw new Error(error.message);
};

/**
 * "Looked at, not ordered" — the shared rule.
 *
 * Mirrors `looked_at_not_ordered()` in
 * supabase/migrations/20261024150000_analytics_fixes.sql; change both or
 * neither. A low order rate on a high-view dish is almost always a
 * description, a photo or a price problem — not a demand problem. Sold-out
 * dishes are excluded: nobody could order them, so their rate says nothing.
 */
export const LEAK_MIN_VIEWS = 20;
export const LEAK_MAX_ORDER_RATE = 10;

export function findLeaks(items: ItemPerformance[]): ItemPerformance[] {
  return items
    .filter((i) => i.is_available
      && i.views >= LEAK_MIN_VIEWS
      && (i.order_rate ?? 0) < LEAK_MAX_ORDER_RATE)
    .sort((a, b) => b.views - a.views);
}

/**
 * Available dishes nobody bought in the window. Candidates to cut or
 * re-merchandise — but only if they were on the menu for the whole window: a
 * dish added on Tuesday has not failed by Thursday.
 */
export function findDeadWeight(items: ItemPerformance[], days: number, now: Date = new Date()): ItemPerformance[] {
  const windowStart = now.getTime() - days * 24 * 60 * 60 * 1000;
  return items
    .filter((i) => i.is_available && i.units === 0
      && (!i.created_at || new Date(i.created_at).getTime() <= windowStart))
    .sort((a, b) => b.views - a.views);
}

/* ---- Menu engineering ---------------------------------------------------- */

/**
 * Kasavana & Smith's four boxes, plus the honest fifth: "too close to call".
 *
 * Computed by `menu_engineering()` in
 * supabase/migrations/20261025121000_menu_engineering.sql — per menu class
 * (mains with mains, coffees with coffees), popularity by the 70% rule on the
 * days the dish was actually on sale, profitability against the class's
 * sales-weighted average contribution margin. This replaces the old "worth
 * protecting" list, which multiplied revenue by a 0–100 hint and called the
 * result money.
 */
export type Quadrant = 'star' | 'plowhorse' | 'puzzle' | 'dog' | 'insufficient';

export interface MenuEngineeringRow {
  item_id: string;
  name: string;
  /** meal_role, or 'other' when none is set. */
  menu_class: string;
  category_name: string | null;
  is_available: boolean;
  units: number;
  lines: number;
  revenue: number;
  /** Trading days in the window on which the dish could be ordered. */
  available_days: number;
  trading_days: number;
  /** 'assumed' when there is no availability history for the dish yet. */
  availability_basis: 'logged' | 'assumed';
  class_units: number;
  class_lines: number;
  class_items: number;
  /** Share of its class's portions on the days it was on sale. */
  menu_mix: number | null;
  /** 80% interval on that share. */
  mix_low: number;
  mix_high: number;
  /** 0.7 / items in the class. */
  popularity_threshold: number;
  price: number;
  unit_cost: number;
  /** Contribution margin per portion: price minus ingredient cost. */
  unit_cm: number;
  class_avg_cm: number;
  /** True when the food cost is the default percentage, not a recorded cost. */
  cost_estimated: boolean;
  popularity: 'high' | 'low' | 'insufficient';
  profitability: 'high' | 'low';
  quadrant: Quadrant;
  units_per_week: number;
  class_units_per_week: number;
}

export const QUADRANTS: Record<Quadrant, { label: string; summary: string; action: string }> = {
  star: {
    label: 'Stars',
    summary: 'Popular and profitable',
    action: 'Protect it: keep its place and its photo, and do not discount it.',
  },
  plowhorse: {
    label: 'Plowhorses',
    summary: 'Popular, low margin',
    action: 'Trim the plate cost or nudge the price up, and pair it with a high-margin side or drink.',
  },
  puzzle: {
    label: 'Puzzles',
    summary: 'Profitable, not popular',
    action: 'Rename it, give it a better photo and move it up its section.',
  },
  dog: {
    label: 'Dogs',
    summary: 'Neither popular nor profitable',
    action: 'Take it off, unless it is there on purpose as a cheaper anchor.',
  },
  insufficient: {
    label: 'Too close to call',
    summary: 'Its share is within noise of the popularity line',
    action: 'Leave it for now: it needs more orders before it can be judged fairly.',
  },
};

export const QUADRANT_ORDER: Quadrant[] = ['star', 'plowhorse', 'puzzle', 'dog', 'insufficient'];

const MENU_CLASS_LABELS: Record<string, string> = {
  starter: 'Starters', main: 'Mains', side: 'Sides', dessert: 'Desserts',
  hot_drink: 'Hot drinks', cold_drink: 'Cold drinks', alcohol: 'Alcohol', other: 'Other',
};

export const menuClassLabel = (c: string) => MENU_CLASS_LABELS[c] ?? c;

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));

/** Coerce PostgREST's numeric strings, so arithmetic on the page is arithmetic. */
export function normaliseEngineering(rows: MenuEngineeringRow[]): MenuEngineeringRow[] {
  return rows.map((r) => ({
    ...r,
    units: num(r.units), lines: num(r.lines), revenue: num(r.revenue),
    available_days: num(r.available_days), trading_days: num(r.trading_days),
    class_units: num(r.class_units), class_lines: num(r.class_lines), class_items: num(r.class_items),
    menu_mix: r.menu_mix === null || r.menu_mix === undefined ? null : Number(r.menu_mix),
    mix_low: num(r.mix_low), mix_high: num(r.mix_high), popularity_threshold: num(r.popularity_threshold),
    price: num(r.price), unit_cost: num(r.unit_cost), unit_cm: num(r.unit_cm), class_avg_cm: num(r.class_avg_cm),
    units_per_week: num(r.units_per_week), class_units_per_week: num(r.class_units_per_week),
  }));
}

/** One list per box, busiest first, so the 2×2 reads like the textbook's. */
export function groupByQuadrant(rows: MenuEngineeringRow[], menuClass?: string): Record<Quadrant, MenuEngineeringRow[]> {
  const out: Record<Quadrant, MenuEngineeringRow[]> = { star: [], plowhorse: [], puzzle: [], dog: [], insufficient: [] };
  for (const r of rows) {
    if (menuClass && r.menu_class !== menuClass) continue;
    out[r.quadrant]?.push(r);
  }
  for (const q of QUADRANT_ORDER) {
    out[q].sort((a, b) => b.units - a.units || a.name.localeCompare(b.name));
  }
  return out;
}

export const getMenuEngineering = async (days = 28) =>
  normaliseEngineering(await rpc<MenuEngineeringRow[]>('menu_engineering', { _days: days }));

/* ---- One recommendation funnel ------------------------------------------ */

export interface RecoFunnelRow {
  placement: string;
  week_start: string;
  decisions: number;
  with_suggestion: number;
  seen: number;
  tapped: number;
  paid: number;
  paid_km: number;
  km_per_1000_seen: number | null;
}

export type FunnelTotals = Omit<RecoFunnelRow, 'week_start'> & { weeks: number };

export const FUNNEL_STAGES = [
  { key: 'decisions', label: 'Engine asked' },
  { key: 'with_suggestion', label: 'Had a suggestion' },
  { key: 'seen', label: 'Seen by the guest' },
  { key: 'tapped', label: 'Tapped' },
  { key: 'paid', label: 'Paid for' },
] as const;

/** Add the weeks up per placement. Ordered by what each placement took. */
export function summariseFunnel(rows: RecoFunnelRow[]): FunnelTotals[] {
  const by = new Map<string, FunnelTotals>();
  for (const r of rows) {
    const t = by.get(r.placement) ?? {
      placement: r.placement, decisions: 0, with_suggestion: 0, seen: 0, tapped: 0, paid: 0,
      paid_km: 0, km_per_1000_seen: null, weeks: 0,
    };
    t.decisions += num(r.decisions);
    t.with_suggestion += num(r.with_suggestion);
    t.seen += num(r.seen);
    t.tapped += num(r.tapped);
    t.paid += num(r.paid);
    t.paid_km += num(r.paid_km);
    t.weeks += 1;
    by.set(r.placement, t);
  }
  return [...by.values()]
    .map((t) => ({
      ...t,
      paid_km: Math.round(t.paid_km * 100) / 100,
      km_per_1000_seen: t.seen > 0 ? Math.round(((1000 * t.paid_km) / t.seen) * 100) / 100 : null,
    }))
    .sort((a, b) => b.paid_km - a.paid_km || a.placement.localeCompare(b.placement));
}

export const getRecoFunnel = (days = 28) => rpc<RecoFunnelRow[]>('reco_funnel', { _days: days });

/* ---- What to do next ----------------------------------------------------- */

export type InsightKind =
  | 'puzzle' | 'dog' | 'leak' | 'sold_out' | 'anomaly' | 'pairing' | 'retired'
  | 'trend_up' | 'trend_down';

export interface Insight {
  kind: InsightKind;
  item_id: string | null;
  related_item_id: string | null;
  headline: string;
  why: string;
  action: string;
  /** Contribution margin a week at stake, in KM. For an anomaly: that day's gap. */
  est_km_per_week: number;
  confidence: 'high' | 'medium';
  evidence: number;
  evidence_label: string;
  link: string;
}

/**
 * The floor every card must clear. Mirrors the `_min_km` default of
 * `management_insights()` (20261025126000_management_insights.sql).
 */
export const INSIGHT_MIN_KM_PER_WEEK = 20;

export const getManagementInsights = (days = 28) =>
  rpc<Insight[]>('management_insights', { _days: days });

export const getItemTrends = () => rpc<ItemTrendRow[]>('item_trends');

/** Trend alerts (tested in the browser) in the same shape as the server's cards. */
export function trendInsights(alerts: TrendAlert[]): Insight[] {
  return alerts.map((a) => ({
    kind: a.direction === 'up' ? 'trend_up' : 'trend_down',
    item_id: a.item_id,
    related_item_id: null,
    headline: a.message,
    why: a.direction === 'up'
      ? 'More tables are ordering it than chance explains, after allowing for every other dish on the menu.'
      : 'Fewer tables are ordering it than chance explains, after allowing for every other dish on the menu.',
    action: a.direction === 'up'
      ? `Keep ${a.name} stocked and visible, and make sure the kitchen can keep up`
      : `Taste ${a.name} and check what changed: recipe, price, photo or its place on the menu`,
    est_km_per_week: a.km_per_week,
    confidence: 'high',
    evidence: a.visits,
    evidence_label: 'visits',
    link: '/admin/menu-intelligence#insights',
  }));
}

/**
 * Server cards and trend cards, as one list: anything under the floor out,
 * worth first, then a fixed tie-break so the order never shuffles on reload.
 */
export function mergeInsights(server: Insight[], trends: Insight[], minKm = INSIGHT_MIN_KM_PER_WEEK): Insight[] {
  return [...server, ...trends]
    .map((i) => ({ ...i, est_km_per_week: Math.round(num(i.est_km_per_week)), evidence: num(i.evidence) }))
    .filter((i) => i.est_km_per_week >= minKm)
    .sort((a, b) => b.est_km_per_week - a.est_km_per_week
      || a.kind.localeCompare(b.kind)
      || a.headline.localeCompare(b.headline)
      || (a.item_id ?? '').localeCompare(b.item_id ?? ''));
}

/** "Do X; worth about Y KM a week; based on Z visits." */
export function insightSentence(i: Insight): string {
  const km = Math.round(i.est_km_per_week).toLocaleString('en');
  const worth = i.kind === 'anomaly'
    ? `about ${km} KM away from a usual day`
    : `worth about ${km} KM a week`;
  return `${i.action}; ${worth}; based on ${num(i.evidence).toLocaleString('en')} ${i.evidence_label}.`;
}

/**
 * Everything the "what to do next" cards need, in one call. A failed trend
 * read does not cost the owner the other cards.
 */
export async function loadInsights(days = 28): Promise<{ insights: Insight[]; trendsFailed: boolean }> {
  const [server, trends] = await Promise.allSettled([getManagementInsights(days), getItemTrends()]);
  if (server.status === 'rejected') throw server.reason;
  const trendCards = trends.status === 'fulfilled' ? trendInsights(detectTrends(trends.value ?? [])) : [];
  return { insights: mergeInsights(server.value ?? [], trendCards), trendsFailed: trends.status === 'rejected' };
}
