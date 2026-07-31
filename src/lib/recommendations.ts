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
  id: string;
  name: string;
  name_bs: string | null;
  name_ar: string | null;
  price: number;
  image_url: string | null;
  dietary_tags: string[];
  recommendation_type: RecommendationType;
}

/**
 * Ask the server what to suggest.
 *
 * Availability, time windows, cart de-duplication and the same-shelf rule are
 * all enforced in SQL — the browser cannot talk the server into recommending a
 * sold-out dish, and the internal margin weight never crosses the wire.
 */
export async function fetchRecommendations(
  cartItemIds: string[],
  placement: Placement,
  locale: Locale,
  limit = 4,
): Promise<Recommendation[]> {
  const { data, error } = await supabase.rpc('guest_get_recommendations' as never, {
    _cart_item_ids: cartItemIds,
    _placement: placement,
    _language: locale,
    _limit: limit,
  } as never);

  if (error) return [];
  return ((data ?? []) as Recommendation[]).map((row) => ({ ...row, price: Number(row.price) }));
}

/** The line of copy shown above a suggestion, by intent. */
export const headlineKeyFor = (placement: Placement, type?: RecommendationType): string => {
  if (placement === 'after_meal') return 'anything_else';
  if (type === 'upgrade_to') return 'goes_well_with';
  if (placement === 'cart') return 'complete_your_order';
  return 'goes_well_with';
};
