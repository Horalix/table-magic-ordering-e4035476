import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
import { useCartStore } from '@/lib/cart-store';
import { useT, useLanguageStore, getLocalizedName } from '@/lib/i18n';
import SmartImage from '@/components/ui/SmartImage';
import {
  fetchRecommendations, fetchSuggestionEvidence, markSuggestionSeen, headlineKeyFor,
  impressionKey, pairingContextIds, useDismissedSuggestions, type Placement,
} from '@/lib/recommendations';
import { allergensToAvoid, useDietFilterStore } from '@/lib/dietary';
import { track } from '@/lib/analytics';

interface Props {
  placement: Placement;
  /** Suppress the suggestion entirely (e.g. the restaurant turned it off). */
  disabled?: boolean;
  /**
   * Pair against these items first.
   *
   * Used by the dish page, where the question is "what goes with THIS?". The
   * cart is added after them on the `item` placement: pairing against the
   * dish alone offered a second drink to a guest who already had one in the
   * cart, which the coursing rules can only prevent if they can see it.
   */
  forItemIds?: string[];
}

/** Stable empty list, so a session with no dismissals does not re-render. */
const NONE: string[] = [];

/**
 * One relevant suggestion at a time — never a wall, never a modal.
 *
 * The ethical constraints are structural rather than stylistic:
 *   - a single primary suggestion, with a visible, equally sized dismiss
 *   - nothing is preselected and nothing is added without a tap
 *   - dismissing hides it for the rest of the visit, across pages and
 *     remounts; it does not come back
 *   - the server never returns a sold-out item or something already in the cart
 *
 * A secondary row of alternatives is shown only after the primary is used or
 * dismissed, so the guest is never presented with a decision they did not ask
 * for while they are trying to check out.
 */
const CartSuggestion = ({ placement, disabled, forItemIds }: Props) => {
  const t = useT();
  const locale = useLanguageStore((s) => s.locale);
  const { items, addItem } = useCartStore();
  const sessionId = useCartStore((st) => st.sessionId);
  const sessionToken = useCartStore((st) => st.sessionToken);
  /*
   * "No thanks" is remembered per visit (session storage) and sent to the
   * server as an exclusion, so the next suggestion is a fresh decision rather
   * than the second row of an old one. Accepted items are only hidden
   * locally: they are in the cart now, which the server already excludes.
   */
  const dismissed = useDismissedSuggestions((st) => (sessionId ? st.bySession[sessionId] : undefined)) ?? NONE;
  const dismissSuggestion = useDismissedSuggestions((st) => st.dismiss);
  const [accepted, setAccepted] = useState<string[]>([]);
  const activeDiets = useDietFilterStore((st) => st.activeDiets);
  const avoid = useMemo(() => allergensToAvoid(activeDiets), [activeDiets]);
  const dietKey = useMemo(() => [...activeDiets].sort(), [activeDiets]);

  const cartIds = useMemo(() => {
    const inCart = items.map((i) => i.menuItemId ?? i.id).sort();
    if (!forItemIds) return inCart;
    return placement === 'item' ? pairingContextIds(forItemIds, inCart) : forItemIds;
  }, [forItemIds, items, placement]);

  // Everything the suggestion depends on except the dismissals.
  const contextKey = JSON.stringify([placement, locale, cartIds, sessionId, avoid, dietKey]);

  const { data, isPlaceholderData } = useQuery({
    queryKey: ['recommendations', contextKey, dismissed.join(',')],
    queryFn: () => fetchRecommendations(sessionId!, sessionToken!, cartIds, placement, locale, 4, avoid, {
      requireTags: dietKey,
      excludeItemIds: dismissed,
    }),
    staleTime: 5 * 60 * 1000,
    enabled: !disabled && !!sessionId && !!sessionToken,
    // While the post-dismissal decision loads, keep showing the previous
    // shortlist (minus what was dismissed) rather than collapsing the card.
    // Only for a dismissal: after the cart changes, the old shortlist answers
    // a question nobody is asking any more.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === contextKey ? previous : undefined,
  });

  const visible = (data?.items ?? []).filter((r) => !dismissed.includes(r.id) && !accepted.includes(r.id));
  const primary = visible[0];
  const decisionId = data?.decisionId ?? null;
  /*
   * The server's ledger records the FIRST row as what the decision chose.
   * Only that row's sighting may be reported against the decision; anything
   * else on screen (a placeholder after a dismissal, or the next row after an
   * accept) is not what the ledger says was shown.
   */
  const isDecisionChoice = !isPlaceholderData && !!primary && data?.items[0]?.id === primary.id;

  /**
   * Report a sighting only when the card is genuinely on screen.
   *
   * The previous version fired on mount, which counted a suggestion the guest
   * scrolled past, counted it again on every remount, and counted it twice
   * because `placement="cart"` is rendered from both the cart page and the
   * cart sheet. The server dedupes by decision id regardless, so this is
   * belt and braces — but reporting a sighting that did not happen is still a
   * lie, even if the database throws it away.
   */
  const cardRef = useRef<HTMLDivElement | null>(null);
  // Keyed by (decision, item): keyed by decision alone, the dish shown after
  // a dismissal under the same decision was never counted as seen.
  const reported = useRef<Set<string>>(new Set());

  useEffect(() => {
    const node = cardRef.current;
    if (!node || !primary || !decisionId || !sessionId || !sessionToken || isPlaceholderData) return;
    const key = impressionKey(decisionId, primary.id);
    if (reported.current.has(key)) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) { clearTimeout(timer); return; }
      timer = setTimeout(() => {
        if (reported.current.has(key)) return;
        reported.current.add(key);
        if (isDecisionChoice) void markSuggestionSeen(decisionId, sessionId, sessionToken);
        track('suggestion_shown', {
          placement,
          decision_id: decisionId,
          item_id: primary.id,
          source_item_id: primary.source_item_id ?? null,
          type: primary.recommendation_type,
        });
      }, 400);
    }, { threshold: 0.5 });

    observer.observe(node);
    return () => { clearTimeout(timer); observer.disconnect(); };
  }, [decisionId, primary, placement, sessionId, sessionToken, isPlaceholderData, isDecisionChoice]);

  /*
   * Social proof, but only what the data supports.
   *
   * The server decides whether a claim may be made at all and, if a number is
   * allowed, returns the conservative end of the interval. The client never
   * computes a percentage — that is how "4 out of 4 visits" turns into a
   * confident 100% on a card.
   */
  const { data: evidence } = useQuery({
    queryKey: ['suggestion-evidence', primary?.source_item_id, primary?.id],
    queryFn: () => fetchSuggestionEvidence(primary!.source_item_id, primary!.id),
    enabled: !!primary?.source_item_id,
    staleTime: 10 * 60 * 1000,
  });

  if (disabled || !primary) return null;

  const name = getLocalizedName(primary, locale);
  // The dish in the cart this goes with, so the card can say why it is here.
  // A suggestion with a reason reads as a waiter's advice; one without reads
  // as an advert.
  const sourceLine = primary.source_item_id
    ? items.find((line) => (line.menuItemId ?? line.id) === primary.source_item_id)
    : undefined;

  const accept = () => {
    addItem({
      id: primary.id,
      menuItemId: primary.id,
      name: primary.name,
      price: primary.price,
      image_url: primary.image_url || undefined,
      // Lets the server attribute what this suggestion actually earned.
      fromSuggestion: {
        sourceItemId: primary.source_item_id ?? null,
        placement,
        decisionId,
      },
    });
    track('suggestion_accepted', {
      placement,
      decision_id: decisionId,
      item_id: primary.id,
      source_item_id: primary.source_item_id ?? null,
      type: primary.recommendation_type,
    });
    setAccepted((prev) => [...prev, primary.id]);
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try { navigator.vibrate(8); } catch { /* not supported */ }
    }
  };

  const dismiss = () => {
    track('suggestion_dismissed', {
      placement,
      decision_id: decisionId,
      item_id: primary.id,
      source_item_id: primary.source_item_id ?? null,
      type: primary.recommendation_type,
    });
    if (sessionId) dismissSuggestion(sessionId, primary.id);
  };

  return (
    <section className="px-4 pt-5" aria-label={t(headlineKeyFor(placement, primary.recommendation_type))}>
      <p className="text-xs uppercase tracking-wide text-muted-foreground font-sans mb-2">
        {t(headlineKeyFor(placement, primary.recommendation_type))}
      </p>

      <div ref={cardRef} className="card-lux p-3 flex items-center gap-3">
        <SmartImage
          src={primary.image_url || undefined}
          id={primary.id}
          alt=""
          width={64}
          height={64}
          wrapperClassName="w-16 h-16 rounded-xl shrink-0"
          fallbackText={name}
        />
        <div className="flex-1 min-w-0">
          <p className="font-serif text-base font-semibold text-foreground leading-tight truncate">{name}</p>
          <p className="text-sm font-sans font-bold text-primary tabular-nums mt-0.5">
            {primary.price.toFixed(2)} KM
          </p>
          {/* Only what the data supports, and only when it supports it. */}
          {evidence?.kind === 'quantified' && (
            <p className="text-[11px] font-sans text-muted-foreground mt-0.5">
              {t('ordered_by_share').replace('{pct}', String(evidence.percent))}
            </p>
          )}
          {evidence?.kind === 'qualitative' && (
            <p className="text-[11px] font-sans text-muted-foreground mt-0.5">
              {t('often_ordered_with')}
            </p>
          )}
          {evidence?.kind !== 'quantified' && evidence?.kind !== 'qualitative' && sourceLine && (
            <p className="text-xs font-sans text-muted-foreground mt-0.5 truncate">
              {t('goes_with_your').replace('{name}', getLocalizedName(sourceLine, locale))}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={dismiss}
            aria-label={t('no_thanks')}
            className="w-11 h-11 rounded-full grid place-items-center text-muted-foreground hover:bg-muted transition-colors tap-sm"
          >
            <X className="w-4 h-4" aria-hidden />
          </button>
          <button
            onClick={accept}
            aria-label={`${t('add_to_order')} — ${name}`}
            className="h-11 px-4 rounded-full bg-primary text-primary-foreground font-sans font-semibold text-sm inline-flex items-center gap-1.5 hover:bg-sage-dark transition-colors tap-sm"
          >
            <Plus className="w-4 h-4" aria-hidden /> {t('add')}
          </button>
        </div>
      </div>
    </section>
  );
};

export default CartSuggestion;
