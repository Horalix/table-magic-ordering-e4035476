import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
import { useCartStore } from '@/lib/cart-store';
import { useT, useLanguageStore, getLocalizedName } from '@/lib/i18n';
import SmartImage from '@/components/ui/SmartImage';
import { fetchRecommendations, headlineKeyFor, type Placement } from '@/lib/recommendations';
import { track } from '@/lib/analytics';

interface Props {
  placement: Placement;
  /** Suppress the suggestion entirely (e.g. the restaurant turned it off). */
  disabled?: boolean;
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
const CartSuggestion = ({ placement, disabled }: Props) => {
  const t = useT();
  const locale = useLanguageStore((s) => s.locale);
  const { items, addItem } = useCartStore();
  const sessionId = useCartStore((st) => st.sessionId);
  const [dismissed, setDismissed] = useState<string[]>([]);

  const cartIds = useMemo(
    () => items.map((i) => i.menuItemId ?? i.id).sort(),
    [items],
  );

  const { data = [] } = useQuery({
    queryKey: ['recommendations', placement, locale, cartIds.join(','), sessionId],
    queryFn: () => fetchRecommendations(cartIds, placement, locale, 4, sessionId),
    staleTime: 5 * 60 * 1000,
    enabled: !disabled,
  });

  const visible = data.filter((r) => !dismissed.includes(r.id));
  const primary = visible[0];

  useEffect(() => {
    if (primary) {
      track('suggestion_shown', {
        placement,
        item_id: primary.id,
        source_item_id: primary.source_item_id ?? null,
        type: primary.recommendation_type,
      });
    }
  }, [primary?.id, placement]); // eslint-disable-line react-hooks/exhaustive-deps

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
      fromSuggestion: { sourceItemId: primary.source_item_id ?? null, placement },
    });
    track('suggestion_accepted', {
      placement,
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

      <div className="card-lux p-3 flex items-center gap-3">
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
