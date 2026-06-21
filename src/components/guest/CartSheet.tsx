import React from 'react';
import { motion, useDragControls } from 'framer-motion';
import { X, Minus, Plus, CreditCard, ShoppingBag } from 'lucide-react';
import { useCartStore } from '@/lib/cart-store';
import { Button } from '@/components/ui/button';
import SmartImage from '@/components/ui/SmartImage';
import UpsellRow from '@/components/guest/UpsellRow';
import { useT } from '@/lib/i18n';
import { sheetUp, fade, useCountUp } from '@/lib/motion';

interface Props {
  onClose: () => void;
  onCheckout: () => void;
}

/** Quick-view cart — slides up from the cart bar so guests can review and
 * tweak quantities without leaving the menu. Checkout routes to the full flow. */
const CartSheet = ({ onClose, onCheckout }: Props) => {
  const { items, updateQuantity, total, itemCount, sessionId, sessionToken } = useCartStore();
  const t = useT();
  const displayTotal = useCountUp(total());
  const count = itemCount();
  const dragControls = useDragControls();

  return (
    <motion.div variants={fade} initial="hidden" animate="show" exit="exit" className="fixed inset-0 z-50 flex items-end justify-center pointer-events-auto">
      <div className="absolute inset-0 bg-foreground/40 backdrop-blur-sm" onClick={onClose} />

      <motion.div
        variants={sheetUp}
        initial="hidden"
        animate="show"
        exit="exit"
        drag="y"
        dragListener={false}
        dragControls={dragControls}
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={0.2}
        onDragEnd={(_, info) => { if (info.offset.y > 120 || info.velocity.y > 600) onClose(); }}
        className="relative w-full max-w-lg bg-card rounded-t-3xl max-h-[85vh] flex flex-col overflow-hidden"
      >
        {/* Drag-to-dismiss only from the handle/header so list scrolling is unaffected. */}
        <div onPointerDown={(e) => dragControls.start(e)} className="shrink-0 touch-none cursor-grab active:cursor-grabbing">
        <div className="absolute top-2.5 left-1/2 -translate-x-1/2 z-10 h-1.5 w-10 rounded-full bg-muted-foreground/30" />

        <div className="flex items-center justify-between px-5 pt-6 pb-3 border-b border-border/60">
          <h2 className="font-serif text-lg font-bold text-foreground flex items-center gap-2">
            <ShoppingBag className="w-5 h-5 text-primary" /> {t('your_order')}
            <span className="text-sm font-sans font-medium text-muted-foreground">· {count}</span>
          </h2>
          <button onClick={onClose} className="w-9 h-9 rounded-full hover:bg-muted flex items-center justify-center" aria-label="Close"><X className="w-4 h-4" /></button>
        </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-3">
          {items.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground font-sans py-10">{t('order_empty')}</p>
          ) : items.map((item) => (
            <div key={item.id} className="flex gap-3 items-center">
              {item.image_url && <SmartImage src={item.image_url} id={item.id} alt={item.name} width={56} height={56} wrapperClassName="w-14 h-14 rounded-lg flex-shrink-0" />}
              <div className="flex-1 min-w-0">
                <p className="font-serif text-sm font-semibold text-foreground line-clamp-1">{item.name}</p>
                {item.notes && <p className="text-[11px] text-muted-foreground italic line-clamp-1">"{item.notes}"</p>}
                <p className="text-xs font-sans font-bold text-primary mt-0.5 tabular-nums">{(item.price * item.quantity).toFixed(2)} KM</p>
              </div>
              <div className="flex items-center gap-1.5 bg-muted rounded-full px-1 py-0.5">
                <button onClick={() => updateQuantity(item.id, item.quantity - 1)} className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-card tap-sm" aria-label={`Decrease ${item.name}`}><Minus className="w-3.5 h-3.5" /></button>
                <span className="text-sm font-sans font-semibold w-5 text-center tabular-nums">{item.quantity}</span>
                <button onClick={() => updateQuantity(item.id, item.quantity + 1)} className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-card tap-sm" aria-label={`Increase ${item.name}`}><Plus className="w-3.5 h-3.5" /></button>
              </div>
            </div>
          ))}
          {items.length > 0 && sessionId && sessionToken && <UpsellRow />}
        </div>

        {items.length > 0 && (
          <div className="px-5 py-4 border-t border-border/60 bg-card pb-safe">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-muted-foreground font-sans">{t('total')}</span>
              <span className="font-serif text-xl font-bold text-foreground tabular-nums">{displayTotal.toFixed(2)} KM</span>
            </div>
            <Button onClick={onCheckout} className="w-full h-14 rounded-2xl bg-primary text-primary-foreground font-sans font-semibold text-base hover:bg-sage-dark tap">
              <span className="flex items-center gap-2"><CreditCard className="w-4 h-4" /> {t('checkout')} · {displayTotal.toFixed(2)} KM</span>
            </Button>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
};

export default CartSheet;
