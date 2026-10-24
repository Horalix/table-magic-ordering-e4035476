import React, { useState } from 'react';
import { motion, useDragControls } from 'framer-motion';
import { X, Plus, Minus, QrCode, UtensilsCrossed, AlertTriangle, Clock } from 'lucide-react';
import { useCartStore } from '@/lib/cart-store';
import { useDialog } from '@/lib/use-dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import SmartImage from '@/components/ui/SmartImage';
import CartSuggestion from '@/components/guest/CartSuggestion';
import { useT, useLanguageStore, getLocalizedName, getLocalizedDescription } from '@/lib/i18n';
import { sheetUp, fade } from '@/lib/motion';
import { track } from '@/lib/analytics';

/** The server keeps the first 500 characters of a note; say so up front. */
const NOTE_MAX = 500;

interface Props {
  item: {
    id: string;
    name: string;
    name_ar?: string | null;
    name_bs?: string | null;
    description?: string;
    description_ar?: string;
    description_bs?: string;
    price: number;
    image_url?: string;
    /** Free-text portion or size note, e.g. "330 ml" or "serves two". */
    portion_note?: string | null;
    /** Allergen keys. Shown verbatim — this is a safety field, not marketing. */
    allergens?: string[] | null;
    prep_minutes?: number | null;
  };
  onClose: () => void;
  canOrder?: boolean;
  /**
   * Why this item cannot be ordered right now ("Sold out", "From 07:00"), or
   * null when it can. The sheet used to offer Add regardless, and the whole
   * order then bounced at checkout with an English server message.
   */
  unavailableLabel?: string | null;
}

const MenuItemDetail = ({ item, onClose, canOrder = true, unavailableLabel = null }: Props) => {
  // role=dialog, focus trap, Escape, scroll lock, focus restore.
  const { dialogProps } = useDialog({ onClose, labelledBy: 'item-detail-title' });
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState('');
  const { addItem } = useCartStore();
  const t = useT();
  const locale = useLanguageStore((s) => s.locale);
  // Dragging the whole sheet fought the notes field and the scroll; only the
  // handle drags now, the way the other sheets work.
  const dragControls = useDragControls();

  const localizedName = getLocalizedName(item, locale);
  const localizedDesc = getLocalizedDescription(item, locale);
  const orderable = canOrder && !unavailableLabel;

  const handleAdd = () => {
    if (!orderable) return;
    for (let i = 0; i < quantity; i++) {
      addItem({
        id: item.id,
        name: item.name,
        name_bs: item.name_bs ?? null,
        name_ar: item.name_ar ?? null,
        price: item.price,
        image_url: item.image_url,
        notes: notes.trim() || undefined,
      });
    }
    // Only ids and counts — the note itself is never sent to analytics.
    track('item_added', { item_id: item.id, quantity, source: 'detail', has_note: notes.trim().length > 0 });
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
        dragListener={false}
        dragControls={dragControls}
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={0.2}
        onDragEnd={(_, info) => {
          if (info.offset.y > 120 || info.velocity.y > 600) onClose();
        }}
        className="relative w-full max-w-lg bg-card rounded-t-3xl sm:rounded-3xl overflow-hidden focus:outline-none max-h-[92dvh] flex flex-col"
        {...dialogProps}
      >
        {/* Drag handle — signals the sheet can be flicked away. */}
        <div
          onPointerDown={(e) => dragControls.start(e)}
          className="absolute top-0 inset-x-0 h-8 z-10 touch-none cursor-grab sm:hidden"
          aria-hidden
        >
          <div className="mx-auto mt-2.5 h-1.5 w-10 rounded-full bg-white/80 shadow" />
        </div>

        <button
          onClick={onClose}
          className="absolute top-3 end-3 z-20 w-11 h-11 rounded-full bg-card/85 backdrop-blur flex items-center justify-center shadow-sm"
          aria-label={t('close')}
        >
          <X className="w-5 h-5 text-foreground" aria-hidden />
        </button>

        <div className="flex-1 overflow-y-auto overscroll-contain">
          {item.image_url ? (
            <SmartImage
              src={item.image_url}
              id={item.id}
              layoutId={`item-img-${item.id}`}
              alt={localizedName}
              width={800}
              height={520}
              // Full width of the sheet: the default assumes a half-width
              // card, which fetched a 384px photo for a 375px slot on a 2x
              // phone and made the dish look out of focus.
              sizes="(max-width: 512px) 100vw, 512px"
              priority
              wrapperClassName={`w-full h-56 ${unavailableLabel ? 'opacity-60 saturate-50' : ''}`}
            />
          ) : (
            <div className="w-full h-40 bg-primary/5 flex items-center justify-center">
              <UtensilsCrossed className="w-10 h-10 text-primary/20" aria-hidden />
            </div>
          )}

          <div className="p-6 pb-4">
            <h2 id="item-detail-title" className="font-serif text-2xl font-bold text-foreground">{localizedName}</h2>
            <p className="text-lg font-sans font-semibold text-foreground mt-1.5 tabular-nums">{item.price.toFixed(2)} KM</p>
            {localizedDesc && (
              <p className="text-[15px] text-muted-foreground font-sans mt-3 leading-relaxed">{localizedDesc}</p>
            )}

            {/* Portion and prep time answer "how big is it?" and "how long?" —
                the two questions a guest otherwise has to ask a waiter. */}
            {(item.portion_note || item.prep_minutes) && (
              <p className="text-sm text-muted-foreground font-sans mt-2 flex items-center gap-1.5">
                {item.prep_minutes ? <Clock className="w-3.5 h-3.5" aria-hidden /> : null}
                {[item.portion_note, item.prep_minutes ? `~${item.prep_minutes} ${t('minutes_short')}` : null]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            )}

            {unavailableLabel && (
              <p className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted text-sm font-sans font-semibold text-foreground">
                <Clock className="w-4 h-4" aria-hidden /> {unavailableLabel}
              </p>
            )}

            {/* Allergens are a safety field: always shown in full, never
                abbreviated, never behind a tap. */}
            {item.allergens && item.allergens.length > 0 && (
              <div className="mt-4 rounded-xl border border-accent/25 bg-accent/5 p-3">
                <p className="text-xs uppercase tracking-wide font-sans font-semibold text-accent flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5" aria-hidden /> {t('allergens')}
                </p>
                <p className="text-sm font-sans text-foreground mt-1">{item.allergens.join(', ')}</p>
                <p className="text-xs font-sans text-muted-foreground mt-1">{t('allergens_ask_staff')}</p>
              </div>
            )}

            {orderable && (
              <>
                <div className="mt-5">
                  <label htmlFor="item-notes" className="text-sm font-sans font-medium text-foreground">{t('special_requests')}</label>
                  <Textarea
                    id="item-notes"
                    placeholder={t('special_requests_placeholder')}
                    value={notes}
                    maxLength={NOTE_MAX}
                    onChange={(e) => setNotes(e.target.value)}
                    className="mt-1.5 bg-muted border-border text-base"
                    rows={2}
                  />
                </div>

                {/*
                  "Goes well with this."

                  The best moment to suggest a side or a drink: the guest is
                  already interested in one dish and has not yet committed to a
                  total, so an add-on reads as help rather than as an upsell.
                */}
                <div className="mt-5">
                  <CartSuggestion placement="item" forItemIds={[item.id]} />
                </div>
              </>
            )}

            {!canOrder && (
              <div className="mt-6 flex items-center gap-3 px-4 py-3.5 rounded-xl bg-accent/10 border border-accent/20">
                <QrCode className="w-5 h-5 text-accent flex-shrink-0" aria-hidden />
                <p className="text-sm font-sans text-foreground">{t('scan_qr_to_order')}</p>
              </div>
            )}
          </div>
        </div>

        {/* Quantity and Add stay on screen while the body scrolls, including
            when the keyboard is open for a note. */}
        {orderable && (
          <div className="shrink-0 border-t border-border/60 bg-card px-6 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] flex items-center gap-3">
            <div className="flex items-center gap-1 bg-muted rounded-full p-0.5" role="group" aria-label={localizedName}>
              <button
                onClick={() => setQuantity(Math.max(1, quantity - 1))}
                aria-label={`${t('decrease')} ${localizedName}`}
                disabled={quantity <= 1}
                className="w-11 h-11 rounded-full flex items-center justify-center hover:bg-card transition-colors tap-sm disabled:opacity-40"
              >
                <Minus className="w-4 h-4" aria-hidden />
              </button>
              <span className="text-base font-sans font-semibold w-6 text-center tabular-nums" aria-live="polite">{quantity}</span>
              <button
                onClick={() => setQuantity(Math.min(10, quantity + 1))}
                aria-label={`${t('increase')} ${localizedName}`}
                className="w-11 h-11 rounded-full flex items-center justify-center hover:bg-card transition-colors tap-sm disabled:opacity-40"
                disabled={quantity >= 10}
              >
                <Plus className="w-4 h-4" aria-hidden />
              </button>
            </div>

            <Button
              onClick={handleAdd}
              className="flex-1 h-12 rounded-full bg-primary text-primary-foreground font-sans font-semibold text-base hover:bg-sage-dark hover:shadow-lg hover:shadow-primary/30 transition-all duration-200 tap tabular-nums"
            >
              {t('add_to_order')} · {(item.price * quantity).toFixed(2)} KM
            </Button>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
};

export default MenuItemDetail;
