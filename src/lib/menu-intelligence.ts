import { supabase } from '@/integrations/supabase/client';

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

/** Sells well and earns well — the dishes worth protecting and promoting. */
export function findStars(items: ItemPerformance[]): ItemPerformance[] {
  return items
    .filter((i) => i.units > 0)
    .sort((a, b) => (b.revenue * (b.margin_score || 50)) - (a.revenue * (a.margin_score || 50)))
    .slice(0, 8);
}
