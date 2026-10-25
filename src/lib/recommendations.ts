import * as Sentry from '@sentry/react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { supabase } from '@/integrations/supabase/client';
import type { Locale } from '@/lib/i18n';
import { matchesDietFilter } from '@/lib/dietary';

export type RecommendationType =
  | 'pair_with'
  | 'upgrade_to'
  | 'frequently_bought_together'
  | 'after_meal'
  | 'alternative'
  | 'add_on'
  /**
   * Generic popularity, the fallback when nothing better is known. It used to
   * be labelled `frequently_bought_together`, which claimed co-occurrence
   * evidence it did not have. No copy depends on it: the headline is chosen by
   * placement (see headlineKeyFor).
   */
  | 'popular'
  /**
   * Proposed by the fit graph (reco_fit): the right kind of thing for what is
   * on the table — a croissant for a coffee, a salad for a risotto — with no
   * pairing or history behind it yet.
   */
  | 'goes_with';

/**
 * Where the card is shown.
 *
 * `tab` is the running tab while the table waits for its food: the moment a
 * table that ordered food and nothing to drink is offered a drink.
 */
export type Placement = 'cart' | 'after_meal' | 'item' | 'tab';

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
  /**
   * How many the card offers: one drink for each person at the table still
   * without one, when the server can see the whole order (the cart, the
   * running tab). 1 for everything else, and from a database that predates it.
   */
  suggested_quantity: number;
}

/** The server never offers more than this many of one thing. */
export const MAX_SUGGESTED_QUANTITY = 6;

/**
 * Ask the server what to suggest.
 *
 * Availability, time windows, cart de-duplication, coursing and the
 * same-shelf rule are all enforced in SQL — the browser cannot talk the server
 * into recommending a sold-out dish, and the internal margin weight never
 * crosses the wire.
 */
export interface RecommendationResult {
  decisionId: string | null;
  items: Recommendation[];
}

export interface RecommendationFilters {
  /**
   * Diet tags the guest switched on in the menu. Every one must be on a
   * suggested dish — exactly the menu's own rule, so a suggestion never
   * offers something the menu is hiding from them.
   */
  requireTags?: readonly string[];
  /** What the guest has already said no to this visit. */
  excludeItemIds?: readonly string[];
  /**
   * Portions per cart line, parallel to the cart ids. Lets the server see
   * three burgers rather than one, and offer drinks for the table.
   */
  cartQuantities?: readonly number[];
}

/**
 * Promises the whole house keeps: every dish at La Soul is halal and
 * alcohol-free. As a "filter" they could only ever hide a dish somebody
 * forgot to tag, so they are never sent or applied here.
 */
const HOUSE_GUARANTEES = new Set(['halal', 'alcohol_free', 'no_alcohol']);

/** The server's ceiling; asking for it leaves room to filter without emptying the card. */
const MAX_LIMIT = 8;

/** Enough to remember a visit's worth of "no thanks" without an unbounded payload. */
const MAX_EXCLUDED = 30;

/**
 * A failed suggestion must never break the page — the guest simply sees no
 * card — but it must not be invisible to us either. Swallowing every error as
 * "nothing to suggest" is how a broken RPC signature could go unnoticed for a
 * week. A breadcrumb rather than an exception: it is not an error the guest
 * experiences, but it explains the next one that is.
 */
function reportFailure(stage: string, error: unknown) {
  const detail = error as { code?: string; message?: string } | null;
  if (import.meta.env.DEV) console.warn(`[recommendations] ${stage} failed`, error);
  Sentry.addBreadcrumb({
    category: 'recommendations',
    level: 'warning',
    message: `${stage} failed`,
    data: { code: detail?.code ?? null, message: detail?.message ?? String(error) },
  });
}

export async function fetchRecommendations(
  sessionId: string,
  sessionToken: string,
  cartItemIds: string[],
  placement: Placement,
  locale: Locale,
  limit = 4,
  excludeAllergens: string[] = [],
  filters: RecommendationFilters = {},
): Promise<RecommendationResult> {
  const requireTags = [...(filters.requireTags ?? [])].filter((tag) => !HOUSE_GUARANTEES.has(tag));
  const exclude = [...(filters.excludeItemIds ?? [])].slice(-MAX_EXCLUDED);
  const filtering = requireTags.length > 0 || exclude.length > 0;

  const base = {
    _session_id: sessionId,
    _session_token: sessionToken,
    _cart_item_ids: cartItemIds,
    _placement: placement,
    _language: locale,
    // Filtering removes rows, so ask for the whole shortlist when we filter.
    _limit: filtering ? MAX_LIMIT : limit,
    // Never suggest around a filter the guest has already set.
    _exclude_allergens: excludeAllergens,
  };

  const filtered = { ...base, _require_tags: requireTags, _exclude_item_ids: exclude };
  const quantities = filters.cartQuantities && filters.cartQuantities.length === cartItemIds.length
    ? filters.cartQuantities.map((q) => Math.min(Math.max(Math.round(q) || 1, 1), 10))
    : null;
  const missing = (e: unknown) => (e as { code?: string } | null)?.code === 'PGRST202';

  try {
    let { data, error } = await supabase.rpc('guest_get_recommendations' as never, (
      quantities ? { ...filtered, _cart_quantities: quantities } : filtered
    ) as never);

    /*
     * PGRST202 is "no function with these arguments": a database that has not
     * run the newer migrations yet. Ask again the older ways rather than show
     * nothing; the filter below still keeps the guest's diet and dismissals.
     */
    if (error && missing(error) && quantities) {
      ({ data, error } = await supabase.rpc('guest_get_recommendations' as never, filtered as never));
    }
    if (error && missing(error)) {
      ({ data, error } = await supabase.rpc('guest_get_recommendations' as never, base as never));
    }

    if (error) {
      reportFailure('fetch', error);
      return { decisionId: null, items: [] };
    }

    const rows = (data ?? []) as Recommendation[];
    return {
      // Every row of one response shares a decision; an empty response still
      // has one server-side, but the client has nothing to mark as seen.
      decisionId: rows[0]?.decision_id ?? null,
      // The server applies the same filters; this is belt and braces for the
      // fallback path above, and costs nothing when they already agree.
      items: rows
        .filter((row) => !exclude.includes(row.id) && matchesDietFilter(row, requireTags))
        .slice(0, limit)
        .map((row) => ({
          ...row,
          price: Number(row.price),
          suggested_quantity: Math.min(
            Math.max(Math.round(Number(row.suggested_quantity)) || 1, 1), MAX_SUGGESTED_QUANTITY),
        })),
    };
  } catch (error) {
    reportFailure('fetch', error);
    return { decisionId: null, items: [] };
  }
}

/**
 * What a dish page should pair against: the dish first, then the cart.
 *
 * Pairing against the dish alone answered "what goes with this?" as if the
 * guest had nothing else — so someone with a cola already in the cart, looking
 * at a burger, was offered another drink. The dish stays first so a curated
 * pairing for it still wins; the cart only adds what the table already has.
 */
export const pairingContextIds = (
  viewedItemIds: readonly string[],
  cartItemIds: readonly string[],
): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of [...viewedItemIds, ...cartItemIds]) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
};

/**
 * One sighting per (decision, item).
 *
 * After a dismissal the card can show a different dish under the same
 * decision for a moment; keying by decision alone counted that second dish as
 * never seen, and keying by item alone would merge two decisions.
 */
export const impressionKey = (decisionId: string, itemId: string): string => `${decisionId}:${itemId}`;

/**
 * Is the card on screen the dish this decision chose?
 *
 * The ledger records the FIRST row of a response as the decision's choice,
 * and the server learns only from that. A placeholder shown while the next
 * decision loads, or the next row after an accept, is a different dish under
 * the same decision id: reporting it as seen, or attributing an order line to
 * the decision, would credit the wrong dish.
 */
export const isDecisionChoice = (
  result: RecommendationResult | undefined,
  shownItemId: string | undefined,
  isPlaceholder: boolean,
): boolean =>
  !isPlaceholder && !!shownItemId && !!result?.decisionId && result.items[0]?.id === shownItemId;

/* ---- "No thanks", remembered for the visit ---------------------------- */

interface DismissedState {
  /** Keyed by table session; only the current visit is ever kept. */
  bySession: Record<string, string[]>;
  dismiss: (sessionId: string, itemId: string) => void;
}

/**
 * Dismissals that survive navigation.
 *
 * Kept in component state they were forgotten on every remount, so a guest
 * who said no on the cart page was asked again the moment they reopened the
 * cart. Session storage — not local — because "no thanks" is an answer about
 * this visit, not a permanent preference; and keyed by table session so a new
 * visit on the same phone starts clean. One store rather than per-component
 * state also keeps the cart sheet and the cart page in agreement.
 */
export const useDismissedSuggestions = create<DismissedState>()(persist((set) => ({
  bySession: {},
  dismiss: (sessionId, itemId) => set((state) => {
    const prev = state.bySession[sessionId] ?? [];
    if (prev.includes(itemId)) return state;
    // Other sessions are dropped, not kept: they are finished visits.
    return { bySession: { [sessionId]: [...prev, itemId].slice(-MAX_EXCLUDED) } };
  }),
}), {
  name: 'lasoul-dismissed-suggestions',
  storage: createJSONStorage(() => sessionStorage),
}));

/**
 * What a suggestion card should say on top, by intent.
 *
 * Deliberately keyed by placement rather than recommendation type for
 * everything but upgrades: the type describes where a candidate came from,
 * which is not something a guest needs to be told.
 */
export const headlineKeyFor = (placement: Placement, type?: RecommendationType, quantity = 1): string => {
  if (quantity > 1) return 'reco_for_the_table';
  if (placement === 'tab') return 'reco_while_you_wait';
  if (placement === 'after_meal') return 'anything_else';
  if (type === 'upgrade_to') return 'goes_well_with';
  if (placement === 'cart') return 'complete_your_order';
  return 'goes_well_with';
};

/**
 * What may honestly be claimed about a pairing.
 *
 * `none` means say nothing at all — the pairing is unproven or no better than
 * chance. `qualitative` is a wording claim. `quantified` carries a percentage
 * that has cleared a support threshold and is the CONSERVATIVE end of the
 * interval, not the point estimate: a number printed in front of a guest
 * should survive being wrong. `similar` means the tables that taught it had
 * dishes LIKE this one (its section or kind), not this one, and the card
 * says exactly that.
 */
export interface SuggestionEvidence {
  kind: 'none' | 'qualitative' | 'quantified' | 'similar';
  percent?: number;
  sessions?: number;
  /** For `similar`: how many tables, and whether by section or by kind. */
  tables?: number;
  level?: 'section' | 'kind';
}

export async function fetchSuggestionEvidence(
  sourceItemId: string | null,
  recommendedItemId: string,
): Promise<SuggestionEvidence> {
  if (!sourceItemId) return { kind: 'none' };
  const { data, error } = await supabase.rpc('suggestion_evidence' as never, {
    _source_item_id: sourceItemId,
    _recommended_item_id: recommendedItemId,
  } as never);
  if (error) reportFailure('evidence', error);
  if (error || !data) return { kind: 'none' };
  return data as SuggestionEvidence;
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
  const { error } = await supabase.rpc('guest_mark_suggestion_seen' as never, {
    _decision_id: decisionId,
    _session_id: sessionId,
    _session_token: sessionToken,
  } as never);
  if (error) reportFailure('impression', error);
}
