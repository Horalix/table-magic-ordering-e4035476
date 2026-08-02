import { supabase } from '@/integrations/supabase/client';
import type { Locale } from '@/lib/i18n';

export type RecommendationType =
  | 'pair_with'
  | 'upgrade_to'
  | 'frequently_bought_together'
  | 'after_meal'
  | 'alternative'
  | 'add_on';

export type Placement = 'cart' | 'after_meal' | 'item';

export interface Recommendation {
  /**
   * The server-side decision this suggestion came from.
   *
   * Carried through the impression and into the order line, so a completed
   * sale can be tied back to the exact decision, policy version and experiment
   * arm that produced it. Without it, "suggestions earned X" is an inference;
   * with it, it is a join.
   */
  decision_id: string;
  id: string;
  name: string;
  name_bs: string | null;
  name_ar: string | null;
  price: number;
  image_url: string | null;
  dietary_tags: string[];
  recommendation_type: RecommendationType;
  /** Which cart item triggered this, if any. Needed for attribution. */
  source_item_id: string | null;
}

/**
 * Ask the server what to suggest.
 *
 * Availability, time windows, cart de-duplication and the same-shelf rule are
 * all enforced in SQL — the browser cannot talk the server into recommending a
 * sold-out dish, and the internal margin weight never crosses the wire.
 */
export interface RecommendationResult {
  decisionId: string | null;
  items: Recommendation[];
}

export async function fetchRecommendations(
  sessionId: string,
  sessionToken: string,
  cartItemIds: string[],
  placement: Placement,
  locale: Locale,
  limit = 4,
  excludeAllergens: string[] = [],
): Promise<RecommendationResult> {
  const { data, error } = await supabase.rpc('guest_get_recommendations' as never, {
    _session_id: sessionId,
    _session_token: sessionToken,
    _cart_item_ids: cartItemIds,
    _placement: placement,
    _language: locale,
    _limit: limit,
    // Never suggest around a filter the guest has already set.
    _exclude_allergens: excludeAllergens,
  } as never);

  if (error) return { decisionId: null, items: [] };

  const rows = (data ?? []) as Recommendation[];
  return {
    // Every row of one response shares a decision; an empty response still has
    // one server-side, but the client has nothing to mark as seen.
    decisionId: rows[0]?.decision_id ?? null,
    items: rows.map((row) => ({ ...row, price: Number(row.price) })),
  };
}

/**
 * Tell the server the guest actually saw a suggestion.
 *
 * Idempotent server-side by primary key, so this is safe to call from more
 * than one place and safe to retry. The client no longer has to be trusted to
 * count correctly — it only has to report a sighting.
 */
export async function markSuggestionSeen(
  decisionId: string,
  sessionId: string,
  sessionToken: string,
): Promise<void> {
  await supabase.rpc('guest_mark_suggestion_seen' as never, {
    _decision_id: decisionId,
    _session_id: sessionId,
    _session_token: sessionToken,
  } as never);
}

/** The line of copy shown above a suggestion, by intent. */
export const headlineKeyFor = (placement: Placement, type?: RecommendationType): string => {
  if (placement === 'after_meal') return 'anything_else';
  if (type === 'upgrade_to') return 'goes_well_with';
  if (placement === 'cart') return 'complete_your_order';
  return 'goes_well_with';
};
