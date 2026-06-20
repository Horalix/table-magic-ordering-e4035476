import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useCartStore } from '@/lib/cart-store';
import { useT, useLanguageStore, getLocalizedName } from '@/lib/i18n';
import SmartImage from '@/components/ui/SmartImage';

interface UpsellItem {
  id: string;
  name: string;
  name_bs: string | null;
  name_ar: string | null;
  price: number;
  image_url: string | null;
}

/**
 * "You might also like" — popular items (from order history) not already in the
 * cart. Self-contained: reads the cart and adds to it. Renders nothing if there
 * are no suggestions (or the popular RPC isn't available).
 */
const UpsellRow = () => {
  const t = useT();
  const locale = useLanguageStore((s) => s.locale);
  const { items, addItem } = useCartStore();

  const { data = [] } = useQuery({
    queryKey: ['upsell-items'],
    queryFn: async (): Promise<UpsellItem[]> => {
      const { data: pop, error } = await supabase.rpc('get_popular_items' as never, { _limit: 12, _days: 60 } as never);
      if (error) return [];
      const ids = ((pop ?? []) as { menu_item_id: string }[]).map((p) => p.menu_item_id);
      if (ids.length === 0) return [];
      const { data: rows } = await supabase
        .from('menu_items')
        .select('id, name, name_bs, name_ar, price, image_url')
        .in('id', ids)
        .eq('is_available', true);
      const order = new Map(ids.map((id, i) => [id, i]));
      return ((rows ?? []) as UpsellItem[]).sort((a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99));
    },
    staleTime: 10 * 60 * 1000,
  });

  const cartIds = new Set(items.map((i) => i.menuItemId ?? i.id));
  const suggestions = data.filter((i) => !cartIds.has(i.id)).slice(0, 6);
  if (suggestions.length === 0) return null;

  const add = (item: UpsellItem) => {
    addItem({ id: item.id, menuItemId: item.id, name: item.name, price: Number(item.price), image_url: item.image_url || undefined });
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(8); } catch { /* ignore */ } }
  };

  return (
    <div className="px-4 pt-5">
      <p className="text-xs uppercase tracking-wide text-muted-foreground font-sans mb-2">{t('you_might_like')}</p>
      <div className="flex gap-3 overflow-x-auto scrollbar-hide -mx-4 px-4 pb-1">
        {suggestions.map((item) => {
          const name = getLocalizedName(item, locale);
          return (
            <button
              key={item.id}
              onClick={() => add(item)}
              className="shrink-0 w-32 text-left card-lux card-lux-hover overflow-hidden tap"
            >
              <SmartImage src={item.image_url || undefined} id={item.id} alt={name} width={128} height={96} wrapperClassName="w-full h-24" fallbackText={name} />
              <div className="p-2">
                <p className="text-xs font-sans font-medium text-foreground leading-tight line-clamp-2 min-h-[2rem]">{name}</p>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-xs font-sans font-bold text-primary tabular-nums">{Number(item.price).toFixed(2)} KM</span>
                  <span className="w-6 h-6 rounded-full bg-primary/10 text-primary grid place-items-center"><Plus className="w-3.5 h-3.5" /></span>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default UpsellRow;
