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
  total_revenue: number;
  attributed_revenue: number;
  uplift_pct: number;
  orders: number;
  orders_with_suggestion: number;
  attach_rate_pct: number;
  avg_order_with_suggestion: number;
  avg_order_without_suggestion: number;
  shown: number;
  accepted: number;
  overall_acceptance_pct: number;
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
  orders_analysed: number;
}

export interface HoldoutComparison {
  holdout_pct: number;
  with_suggestions: { orders: number; avg_order: number };
  holdout: { orders: number; avg_order: number };
  difference: number;
  /** False below ~100 orders a side — the difference is noise until then. */
  reliable: boolean;
}

export interface SoldOutRow {
  item_id: string;
  name: string;
  views: number;
  avg_daily_revenue_when_available: number;
  estimated_lost_revenue: number;
}

export const getItemPerformance = (days = 30) =>
  rpc<ItemPerformance[]>('menu_item_performance', { _days: days });

export const getPairings = (limit = 30) =>
  rpc<Pairing[]>('menu_pairings', { _limit: limit });

export const getSuggestionPerformance = (limit = 50) =>
  rpc<SuggestionRow[]>('suggestion_performance', { _limit: limit });

export const getSuggestionImpact = (days = 30) =>
  rpc<SuggestionImpact>('suggestion_impact', { _days: days });

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
 * Items that get looked at and not bought.
 *
 * A low order rate on a high-view item is almost always a description, a photo
 * or a price problem — not a demand problem. Needs enough views to mean
 * something, hence the floor.
 */
export function findLeaks(items: ItemPerformance[], minViews = 20): ItemPerformance[] {
  return items
    .filter((i) => i.views >= minViews && i.order_rate !== null && i.order_rate < 10)
    .sort((a, b) => b.views - a.views);
}

/** Available items nobody is buying. Candidates to cut or re-merchandise. */
export function findDeadWeight(items: ItemPerformance[]): ItemPerformance[] {
  return items
    .filter((i) => i.is_available && i.units === 0)
    .sort((a, b) => b.views - a.views);
}

/** Sells well and earns well — the dishes worth protecting and promoting. */
export function findStars(items: ItemPerformance[]): ItemPerformance[] {
  return items
    .filter((i) => i.units > 0)
    .sort((a, b) => (b.revenue * (b.margin_score || 50)) - (a.revenue * (a.margin_score || 50)))
    .slice(0, 8);
}
