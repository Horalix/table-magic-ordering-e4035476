import React, { useMemo } from 'react';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useCartStore } from '@/lib/cart-store';
import SmartImage from '@/components/ui/SmartImage';
import { useT, useLanguageStore, getLocalizedName } from '@/lib/i18n';
import { getRecentItems } from '@/lib/recent-items';
import { track } from '@/lib/analytics';

interface LiveItem {
  id: string;
  name: string;
  name_bs: string | null;
  name_ar: string | null;
  price: number;
  image_url: string | null;
  is_available: boolean;
}

/**
 * "Order again" — the guest's recent items, re-priced from the live menu.
 *
 * localStorage only supplies the *ids*. It used to supply the names and prices
 * too, which meant a guest could be shown — and add at — a price the restaurant
 * changed weeks ago, and could re-add a dish that has since been taken off the
 * menu. (The server always re-prices, so there was never a financial loss; the
 * damage was quoting one number and charging another, and offering food that
 * would then be refused at checkout.)
 */
const RecentOrdersRow = () => {
  const t = useT();
  const locale = useLanguageStore((s) => s.locale);
  const addItem = useCartStore((s) => s.addItem);

  // Read once per mount — the ids only change when an order is placed, which
  // remounts the menu anyway.
  const recentIds = useMemo(() => getRecentItems().map((r) => r.id), []);

  const { data: live = [] } = useQuery({
    queryKey: ['recent-items-live', recentIds.join(',')],
    queryFn: async (): Promise<LiveItem[]> => {
      if (recentIds.length === 0) return [];
      const { data } = await supabase
        .from('menu_items')
        .select('id, name, name_bs, name_ar, price, image_url, is_available')
        .in('id', recentIds);
      const order = new Map(recentIds.map((id, i) => [id, i]));
      return ((data ?? []) as LiveItem[])
        .filter((i) => i.is_available)
        .map((i) => ({ ...i, price: Number(i.price) }))
        .sort((a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99));
    },
    enabled: recentIds.length > 0,
    staleTime: 60_000,
  });

  if (live.length === 0) return null;

  return (
    <div className="mb-4">
      <p className="text-[11px] font-sans font-semibold text-muted-foreground uppercase tracking-wider px-1 mb-2">
        {t('order_again')}
      </p>
      <div className="flex gap-3 overflow-x-auto scrollbar-hide -mx-1 px-1 pb-1">
        {live.map((it) => {
          const name = getLocalizedName(it, locale);
          return (
            <button
              key={it.id}
              onClick={() => {
                // menuItemId set so this merges with the same dish added from
                // the menu rather than creating a second, separate line.
                addItem({ id: it.id, menuItemId: it.id, name: it.name, price: it.price, image_url: it.image_url || undefined });
                track('reorder_tapped', { item_id: it.id });
                toast.success(t('added_to_order'), { description: name, duration: 1400 });
                if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
                  try { navigator.vibrate(8); } catch { /* gesture-gated */ }
                }
              }}
              className="relative shrink-0 w-28 text-left tap-sm"
              aria-label={`${t('add_to_order')} ${name}`}
            >
              <div className="card-lux card-lux-hover overflow-hidden">
                <SmartImage
                  src={it.image_url || undefined}
                  id={it.id}
                  alt=""
                  width={112}
                  height={80}
                  wrapperClassName="w-full h-20"
                  fallbackText={name}
                />
                <div className="p-2">
                  <p className="text-xs font-serif font-semibold text-foreground line-clamp-1">{name}</p>
                  <p className="text-[11px] font-sans font-bold text-primary mt-0.5 tabular-nums">
                    {it.price.toFixed(2)} KM
                  </p>
                </div>
              </div>
              <span className="absolute top-1.5 right-1.5 w-7 h-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-md">
                <Plus className="w-3.5 h-3.5" aria-hidden />
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default RecentOrdersRow;
