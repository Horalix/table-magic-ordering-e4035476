import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
import { useCartStore } from '@/lib/cart-store';
import { useT, useLanguageStore, getLocalizedName } from '@/lib/i18n';
import SmartImage from '@/components/ui/SmartImage';
import {
  fetchRecommendations, fetchSuggestionEvidence, markSuggestionSeen, headlineKeyFor, type Placement,
} from '@/lib/recommendations';
import { allergensToAvoid, useDietFilterStore } from '@/lib/dietary';
import { track } from '@/lib/analytics';

interface Props {
  placement: Placement;
  /** Suppress the suggestion entirely (e.g. the restaurant turned it off). */
  disabled?: boolean;
  /**
   * Pair against these items instead of the cart.
   *
   * Used by the dish page, where the question is "what goes with THIS?" — the
   * guest is looking at one thing and has not decided to buy anything yet, so
   * pairing against a cart they may not have started would suggest against the
   * wrong context entirely.
   */
  forItemIds?: string[];
}

/**
 * One relevant suggestion at a time — never a wall, never a modal.
 *
 * The ethical constraints are structural rather than stylistic:
 *   - a single primary suggestion, with a visible, equally sized dismiss
 *   - nothing is preselected and nothing is added without a tap
 *   - dismissing hides it for the rest of the visit; it does not come back
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
  const [dismissed, setDismissed] = useState<string[]>([]);
  const activeDiets = useDietFilterStore((st) => st.activeDiets);
  const avoid = useMemo(() => allergensToAvoid(activeDiets), [activeDiets]);

  const cartIds = useMemo(
    () => forItemIds ?? items.map((i) => i.menuItemId ?? i.id).sort(),
    [forItemIds, items],
  );

  const { data } = useQuery({
    queryKey: ['recommendations', placement, locale, cartIds.join(','), sessionId, avoid.join(',')],
    queryFn: () => fetchRecommendations(sessionId!, sessionToken!, cartIds, placement, locale, 4, avoid),
    staleTime: 5 * 60 * 1000,
    enabled: !disabled && !!sessionId && !!sessionToken,
  });

  const visible = (data?.items ?? []).filter((r) => !dismissed.includes(r.id));
  const primary = visible[0];
  const decisionId = data?.decisionId ?? null;

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
  const reported = useRef<string | null>(null);

  useEffect(() => {
    const node = cardRef.current;
    if (!node || !primary || !decisionId || !sessionId || !sessionToken) return;
    if (reported.current === decisionId) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) { clearTimeout(timer); return; }
      timer = setTimeout(() => {
        if (reported.current === decisionId) return;
        reported.current = decisionId;
        void markSuggestionSeen(decisionId, sessionId, sessionToken);
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
  }, [decisionId, primary, placement, sessionId, sessionToken]);

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
    setDismissed((prev) => [...prev, primary.id]);
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
    setDismissed((prev) => [...prev, primary.id]);
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
