import React, { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useCartStore } from '@/lib/cart-store';
import SmartImage from '@/components/ui/SmartImage';
import { useT, useLanguageStore, getLocalizedName } from '@/lib/i18n';
import { forgetRecentItems, getRecentItems, getUsualItem } from '@/lib/recent-items';
import { supabase as sb } from '@/integrations/supabase/client';
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
  const clientId = useCartStore((s) => s.clientId);
  const rotateClientId = useCartStore((s) => s.rotateClientId);

  // Read once per mount — the ids only change when an order is placed, which
  // remounts the menu anyway.
  const recentIds = useMemo(() => getRecentItems().map((r) => r.id), []);

  /**
   * The one thing this phone orders more than anything else.
   *
   * Distinct from the "order again" strip below it, which is chronological.
   * A regular's flat white is buried in that strip the moment they try
   * anything else; here it is one tap. Null when the device has no habit
   * yet — a "usual" someone ordered once reads as the app pretending to
   * know them.
   */
  const [usual, setUsual] = useState(() => getUsualItem());

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

  const usualLive = usual ? live.find((i) => i.id === usual.id) : undefined;

  if (live.length === 0) return null;

  return (
    <div className="mb-4">
      {/* Priced and checked for availability like everything else — a usual
          that is off the menu tonight must not be offered. */}
      {usualLive && (
        <div className="mb-3 flex items-center gap-3 card-lux p-3">
          <SmartImage
            src={usualLive.image_url || undefined}
            id={usualLive.id}
            alt=""
            width={56}
            height={56}
            wrapperClassName="w-14 h-14 rounded-xl shrink-0"
            fallbackText={getLocalizedName(usualLive, locale)}
          />
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-sans font-semibold text-primary uppercase tracking-wider">
              {t('your_usual')}
            </p>
            <p className="font-serif text-base font-semibold text-foreground truncate">
              {getLocalizedName(usualLive, locale)}
            </p>
            <p className="text-sm font-sans font-bold text-primary tabular-nums">
              {usualLive.price.toFixed(2)} KM
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              addItem({
                id: usualLive.id,
                menuItemId: usualLive.id,
                name: usualLive.name,
                price: usualLive.price,
                image_url: usualLive.image_url || undefined,
              });
              track('reorder_tapped', { item_id: usualLive.id, source: 'usual' });
              toast.success(t('added_to_order'), { description: getLocalizedName(usualLive, locale) });
            }}
            className="h-11 px-4 rounded-full bg-primary text-primary-foreground font-sans font-semibold text-sm shrink-0 tap-sm"
          >
            {t('usual_add')}
          </button>
        </div>
      )}

      <div className="flex items-baseline justify-between gap-2 px-1 mb-2">
        <p className="text-[11px] font-sans font-semibold text-muted-foreground uppercase tracking-wider">
          {t('order_again')}
        </p>
        {/*
          The way out, next to the thing that remembers rather than buried in
          a settings screen. This history never leaves the phone, so clearing
          it here genuinely is all of it.
        */}
        <button
          type="button"
          onClick={async () => {
            /*
             * All three, in this order.
             *
             * Clearing local history alone would leave the server profile
             * standing. Deleting the server profile alone would leave this
             * phone rebuilding the same one under the same id on its next
             * visit — so the identifier is rotated too, which is what makes
             * the deletion real rather than cosmetic.
             */
            forgetRecentItems();
            setUsual(null);
            try {
              await sb.rpc('guest_forget_me' as never, { _client_id: clientId } as never);
            } catch { /* the local clear is the part that must not fail */ }
            rotateClientId();
            toast.success(t('forget_device_done'));
          }}
          className="text-[11px] font-sans text-muted-foreground underline underline-offset-2 min-h-[32px]"
        >
          {t('forget_device')}
        </button>
      </div>
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
