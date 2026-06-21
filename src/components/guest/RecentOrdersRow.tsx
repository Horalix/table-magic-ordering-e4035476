import React from 'react';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { useCartStore } from '@/lib/cart-store';
import SmartImage from '@/components/ui/SmartImage';
import { useT } from '@/lib/i18n';
import { getRecentItems } from '@/lib/recent-items';

/** "Order again" — a horizontal rail of the guest's recently ordered items. */
const RecentOrdersRow = () => {
  const t = useT();
  const addItem = useCartStore((s) => s.addItem);
  const recents = getRecentItems();
  if (recents.length === 0) return null;

  return (
    <div className="mb-4">
      <p className="text-[11px] font-sans font-semibold text-muted-foreground uppercase tracking-wider px-1 mb-2">{t('order_again')}</p>
      <div className="flex gap-3 overflow-x-auto scrollbar-hide -mx-1 px-1 pb-1">
        {recents.map((it) => (
          <button
            key={it.id}
            onClick={() => {
              addItem({ id: it.id, name: it.name, price: it.price, image_url: it.image_url });
              toast.success(t('added_to_order'), { description: it.name, duration: 1400 });
              if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(8); } catch { /* gesture-gated */ } }
            }}
            className="relative shrink-0 w-28 text-left tap-sm"
            aria-label={`${t('add_to_order')} ${it.name}`}
          >
            <div className="card-lux card-lux-hover overflow-hidden">
              <SmartImage src={it.image_url} id={it.id} alt={it.name} width={112} height={80} wrapperClassName="w-full h-20" fallbackText={it.name} />
              <div className="p-2">
                <p className="text-xs font-serif font-semibold text-foreground line-clamp-1">{it.name}</p>
                <p className="text-[11px] font-sans font-bold text-primary mt-0.5 tabular-nums">{it.price.toFixed(2)} KM</p>
              </div>
            </div>
            <span className="absolute top-1.5 right-1.5 w-7 h-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-md">
              <Plus className="w-3.5 h-3.5" />
            </span>
          </button>
        ))}
      </div>
    </div>
  );
};

export default RecentOrdersRow;
