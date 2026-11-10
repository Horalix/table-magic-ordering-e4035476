import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, Plus } from 'lucide-react';
import SmartImage from '@/components/ui/SmartImage';
import { supabase } from '@/integrations/supabase/client';
import { track } from '@/lib/analytics';
import { useCartFx } from '@/lib/cart-fx';
import { useCartStore } from '@/lib/cart-store';
import { haptic } from '@/lib/haptics';
import { getLocalizedName, useI18n, useLanguageStore, useT } from '@/lib/i18n';
import { useComboMap } from '@/lib/promotions-api';

/**
 * "Sold out — similar, and available now": what to have instead, on the page
 * of a dish that cannot be ordered.
 *
 * A guest who opened a sold-out dish was told so and offered nothing: the
 * sale was simply lost, and Menu intelligence could only count what selling
 * out cost. The database has long known what to offer (guest_get_substitutes:
 * the owner's own alternative for the dish first, then dishes of the same
 * section within 40% of its price, only ones that can be ordered right now),
 * and nothing in the app asked it.
 *
 * Not a suggestion in the ledger's sense: it is offered because the dish is
 * unavailable, not chosen by the ranker, so it is counted as an ordinary add
 * (source "substitute") and never as a suggestion taken.
 */

interface Substitute {
  id: string;
  name: string;
  name_bs: string | null;
  name_ar: string | null;
  price: number;
  image_url: string | null;
}

async function fetchSubstitutes(itemId: string): Promise<Substitute[]> {
  const { data, error } = await supabase.rpc('guest_get_substitutes' as never, { _item_id: itemId, _limit: 4 } as never);
  if (error || !Array.isArray(data)) return [];
  return (data as Substitute[]).map((row) => ({ ...row, price: Number(row.price) }));
}

const DishSubstitutes = ({ itemId, canOrder }: {
  /** The dish that cannot be ordered. */
  itemId: string;
  /** The guest is at a table and may order; otherwise the list is only shown. */
  canOrder: boolean;
}) => {
  const t = useT();
  const { price } = useI18n();
  const locale = useLanguageStore((s) => s.locale);
  const { addItem } = useCartStore();
  const combos = useComboMap();
  const [added, setAdded] = useState<string[]>([]);

  const { data = [] } = useQuery({
    queryKey: ['dish-substitutes', itemId],
    queryFn: () => fetchSubstitutes(itemId),
    staleTime: 5 * 60 * 1000,
  });
  // A combo needs its parts chosen on its own page; one tap here could not order it.
  const shown = data.filter((row) => !combos.has(row.id)).slice(0, 3);
  if (shown.length === 0) return null;

  const add = (row: Substitute, from: DOMRect) => {
    addItem({
      id: row.id,
      menuItemId: row.id,
      name: row.name,
      name_bs: row.name_bs,
      name_ar: row.name_ar,
      price: row.price,
      image_url: row.image_url || undefined,
    });
    track('item_added', { item_id: row.id, source: 'substitute', for_item_id: itemId });
    setAdded((prev) => [...prev, row.id]);
    useCartFx.getState().emitAdd({ id: row.id, imageUrl: row.image_url, from, name: getLocalizedName(row, locale) });
    haptic('add');
  };

  return (
    <section className="mt-5" aria-label={t('similar_available_now')}>
      <p className="text-xs uppercase tracking-wide rtl:tracking-normal text-muted-foreground font-sans mb-2">
        {t('similar_available_now')}
      </p>
      <ul className="space-y-2">
        {shown.map((row) => {
          const name = getLocalizedName(row, locale);
          const done = added.includes(row.id);
          return (
            <li key={row.id} className="card-lux p-3 flex items-center gap-3">
              <SmartImage
                src={row.image_url || undefined}
                id={row.id}
                alt=""
                width={56}
                height={56}
                square
                wrapperClassName="w-14 h-14 rounded-xl shrink-0"
                fallbackText={name}
              />
              <div className="flex-1 min-w-0">
                <p className="font-serif text-base font-semibold text-foreground leading-tight line-clamp-2 break-words">{name}</p>
                <p className="text-sm font-sans font-semibold text-foreground tabular-nums mt-0.5">{price(row.price)}</p>
              </div>
              {canOrder && (
                <button
                  type="button"
                  disabled={done}
                  onClick={(e) => add(row, e.currentTarget.getBoundingClientRect())}
                  aria-label={done ? t('added_to_order') : t('add_item_to_order', { name })}
                  className="h-11 px-4 shrink-0 rounded-full bg-primary text-primary-foreground font-sans font-semibold text-sm inline-flex items-center gap-1.5 hover:bg-sage-dark transition-colors tap-sm disabled:bg-muted disabled:text-foreground"
                >
                  {done ? <Check className="w-4 h-4" aria-hidden /> : <Plus className="w-4 h-4" aria-hidden />}
                  {done ? t('added_to_order') : t('add')}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
};

export default DishSubstitutes;
