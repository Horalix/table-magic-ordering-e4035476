import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { X, Plus, Minus, QrCode, UtensilsCrossed } from 'lucide-react';
import { useCartStore } from '@/lib/cart-store';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import SmartImage from '@/components/ui/SmartImage';
import { useT, useLanguageStore, getLocalizedName, getLocalizedDescription } from '@/lib/i18n';
import { sheetUp, fade } from '@/lib/motion';

interface Props {
  item: {
    id: string;
    name: string;
    name_ar?: string;
    name_bs?: string;
    description?: string;
    description_ar?: string;
    description_bs?: string;
    price: number;
    image_url?: string;
  };
  onClose: () => void;
  canOrder?: boolean;
}

const MenuItemDetail = ({ item, onClose, canOrder = true }: Props) => {
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState('');
  const { addItem } = useCartStore();
  const t = useT();
  const locale = useLanguageStore((s) => s.locale);

  const localizedName = getLocalizedName(item, locale);
  const localizedDesc = getLocalizedDescription(item, locale);

  const handleAdd = () => {
    if (!canOrder) return;
    for (let i = 0; i < quantity; i++) {
      addItem({
        id: item.id,
        name: item.name,
        price: item.price,
        image_url: item.image_url,
        notes: notes.trim() || undefined,
      });
    }
    onClose();
  };

  return (
    <motion.div
      variants={fade}
      initial="hidden"
      animate="show"
      exit="exit"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
    >
      <div className="absolute inset-0 bg-foreground/40 backdrop-blur-sm" onClick={onClose} />

      <motion.div
        variants={sheetUp}
        initial="hidden"
        animate="show"
        exit="exit"
        drag="y"
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={0.2}
        onDragEnd={(_, info) => {
          if (info.offset.y > 120 || info.velocity.y > 600) onClose();
        }}
        className="relative w-full max-w-lg bg-card rounded-t-3xl sm:rounded-3xl overflow-hidden"
      >
        {/* Drag handle — signals the sheet can be flicked away. */}
        <div className="absolute top-2.5 left-1/2 -translate-x-1/2 z-10 h-1.5 w-10 rounded-full bg-white/70 sm:hidden" />

        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-10 w-10 h-10 rounded-full bg-card/80 backdrop-blur flex items-center justify-center min-w-[44px] min-h-[44px]"
          aria-label="Close"
        >
          <X className="w-4 h-4 text-foreground" />
        </button>

        {item.image_url ? (
          <SmartImage
            src={item.image_url}
            id={item.id}
            layoutId={`item-img-${item.id}`}
            alt={localizedName}
            width={800}
            height={520}
            priority
            wrapperClassName="w-full h-52"
          />
        ) : (
          <div className="w-full h-52 bg-primary/5 flex items-center justify-center">
            <UtensilsCrossed className="w-10 h-10 text-primary/20" />
          </div>
        )}

        <div className="p-6">
          <h2 className="font-serif text-2xl font-bold text-foreground">{localizedName}</h2>
          {localizedDesc && (
            <p className="text-sm text-muted-foreground font-sans mt-2 leading-relaxed">{localizedDesc}</p>
          )}
          <p className="text-lg font-sans font-bold text-primary mt-3">{item.price.toFixed(2)} KM</p>

          {canOrder ? (
            <>
              <div className="mt-5">
                <label className="text-sm font-sans font-medium text-foreground">{t('special_requests')}</label>
                <Textarea
                  placeholder={t('special_requests_placeholder')}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="mt-1.5 bg-muted border-border text-sm"
                  rows={2}
                />
              </div>

              <div className="flex items-center gap-4 mt-6">
                <div className="flex items-center gap-3 bg-muted rounded-full px-2 py-1">
                  <button
                    onClick={() => setQuantity(Math.max(1, quantity - 1))}
                    aria-label={`Decrease ${localizedName} quantity`}
                    className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-card transition-colors min-w-[44px] min-h-[44px] tap-sm"
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                  <span className="text-base font-sans font-semibold w-6 text-center tabular-nums">{quantity}</span>
                  <button
                    onClick={() => setQuantity(Math.min(10, quantity + 1))}
                    aria-label={`Increase ${localizedName} quantity`}
                    className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-card transition-colors min-w-[44px] min-h-[44px] tap-sm"
                    disabled={quantity >= 10}
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>

                <Button
                  onClick={handleAdd}
                  className="flex-1 h-12 rounded-full bg-primary text-primary-foreground font-sans font-semibold text-base hover:bg-sage-dark hover:shadow-lg hover:shadow-primary/30 transition-all duration-200 tap tabular-nums"
                >
                  {t('add_to_order')} · {(item.price * quantity).toFixed(2)} KM
                </Button>
              </div>
            </>
          ) : (
            <div className="mt-6 flex items-center gap-3 px-4 py-3.5 rounded-xl bg-accent/8 border border-accent/15">
              <QrCode className="w-4 h-4 text-accent flex-shrink-0" />
              <p className="text-xs font-sans text-accent">{t('scan_qr_to_order')}</p>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
};

export default MenuItemDetail;
