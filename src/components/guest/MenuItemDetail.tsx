import React, { useEffect, useRef, useState } from 'react';
import { motion, useDragControls, useReducedMotion, useIsPresent, MotionConfig, type Variants } from 'framer-motion';
import { X, Plus, Minus, QrCode, UtensilsCrossed, AlertTriangle, Clock } from 'lucide-react';
import { useCartStore } from '@/lib/cart-store';
import { useDialog } from '@/lib/use-dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import SmartImage from '@/components/ui/SmartImage';
import CartSuggestion from '@/components/guest/CartSuggestion';
import { useT, useLanguageStore, getLocalizedName, getLocalizedDescription, useI18n } from '@/lib/i18n';
import { sheetUp, fade, duration, easeEnter, exitTransition, springSheet, shouldDismissSheet } from '@/lib/motion';
import { track } from '@/lib/analytics';
import { haptic } from '@/lib/haptics';
import { emitAdd } from '@/lib/cart-fx';
import RollingNumber from '@/components/guest/RollingNumber';

/** The server keeps the first 500 characters of a note; say so up front. */
const NOTE_MAX = 500;

/** Reduced motion: no slide, no shared photo, just a short fade. */
const reducedFade: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: duration.fast, ease: easeEnter } },
  exit: { opacity: 0, transition: { ...exitTransition, duration: duration.fast } },
};

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
  /** Called just before onClose when the sheet closes because of Add. */
  onAdded?: () => void;
  canOrder?: boolean;
  /**
   * Why this item cannot be ordered right now ("Sold out", "From 07:00"), or
   * null when it can. The sheet used to offer Add regardless, and the whole
   * order then bounced at checkout with an English server message.
   */
  unavailableLabel?: string | null;
}

const MenuItemDetail = ({ item, onClose, onAdded, canOrder = true, unavailableLabel = null }: Props) => {
  // role=dialog, focus trap, Escape, scroll lock, focus restore, Back closes.
  // Released as soon as the sheet starts leaving, not when its exit animation
  // ends: the history entry, scroll lock and focus go back right away.
  const isPresent = useIsPresent();
  const { dialogProps, panelRef } = useDialog({ open: isPresent, onClose, labelledBy: 'item-detail-title' });
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState('');
  // Most dishes are ordered as they come, so the note field waits behind a link.
  const [notesOpen, setNotesOpen] = useState(false);
  const notesRef = useRef<HTMLTextAreaElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const reduced = useReducedMotion();
  useEffect(() => { if (notesOpen) notesRef.current?.focus(); }, [notesOpen]);
  const { addItem } = useCartStore();
  const t = useT();
  const { price, list } = useI18n();
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
    haptic('add');
    // The sheet gets out of the way first (200 ms on the exit curve), then
    // the photo flies from the Add button into the bag.
    const from = addRef.current?.getBoundingClientRect() ?? null;
    onAdded?.();
    onClose();
    emitAdd({ id: item.id, imageUrl: item.image_url, from, name: localizedName, delayMs: duration.exit * 1000 });
  };

  return (
    <motion.div
      variants={reduced ? reducedFade : fade}
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
          // A quarter of the sheet, or a flick.
          if (shouldDismissSheet(info.offset.y, info.velocity.y, panelRef.current?.offsetHeight ?? 0)) onClose();
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
            // Grows out of the list photo (CategoryPage's OpeningPhoto) on the sheet spring.
            <MotionConfig transition={springSheet}>
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
            </MotionConfig>
          ) : (
            <div className="w-full h-40 bg-primary/5 flex items-center justify-center">
              <UtensilsCrossed className="w-10 h-10 text-primary/20" aria-hidden />
            </div>
          )}

          <div className="p-6 pb-4">
            <h2 id="item-detail-title" className="font-serif text-2xl font-bold text-foreground">{localizedName}</h2>
            <p className="text-lg font-sans font-semibold text-foreground mt-1.5 tabular-nums">{price(item.price)}</p>
            {localizedDesc && (
              <p className="text-[15px] text-muted-foreground font-sans mt-3 leading-relaxed">{localizedDesc}</p>
            )}

            {/* Portion and prep time answer "how big is it?" and "how long?" —
                the two questions a guest otherwise has to ask a waiter. */}
            {(item.portion_note || item.prep_minutes) && (
              <p className="text-sm text-muted-foreground font-sans mt-2 flex items-center gap-1.5">
                {item.prep_minutes ? <Clock className="w-3.5 h-3.5" aria-hidden /> : null}
                {[item.portion_note, item.prep_minutes ? t('prep_about', { n: item.prep_minutes }) : null]
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
                <p className="text-xs uppercase tracking-wide rtl:tracking-normal font-sans font-semibold text-accent flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5" aria-hidden /> {t('allergens')}
                </p>
                <p className="text-sm font-sans text-foreground mt-1">{list(item.allergens.map((a) => t(`allergen_${a}`) === `allergen_${a}` ? a : t(`allergen_${a}`)))}</p>
                <p className="text-xs font-sans text-muted-foreground mt-1">{t('allergens_ask_staff')}</p>
              </div>
            )}

            {orderable && (
              <>
                <div className="mt-4">
                  {notesOpen || notes ? (
                    <>
                      <label htmlFor="item-notes" className="text-sm font-sans font-medium text-foreground">{t('special_requests')}</label>
                      <Textarea
                        id="item-notes"
                        ref={notesRef}
                        placeholder={t('special_requests_placeholder')}
                        value={notes}
                        maxLength={NOTE_MAX}
                        onChange={(e) => setNotes(e.target.value)}
                        className="mt-1.5 bg-muted border-border text-base"
                        rows={2}
                      />
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setNotesOpen(true)}
                      className="min-h-[44px] -ms-1 px-1 text-sm font-sans font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                    >
                      {t('add_a_note')}
                    </button>
                  )}
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
                onClick={() => { haptic('tick'); setQuantity(Math.max(1, quantity - 1)); }}
                aria-label={t('decrease_item', { name: localizedName })}
                disabled={quantity <= 1}
                className="w-11 h-11 rounded-full flex items-center justify-center hover:bg-card transition-colors tap-sm disabled:opacity-40"
              >
                <Minus className="w-4 h-4" aria-hidden />
              </button>
              <span className="text-base font-sans font-semibold w-6 text-center tabular-nums" aria-live="polite"><RollingNumber value={quantity} /></span>
              <button
                onClick={() => { haptic('tick'); setQuantity(Math.min(10, quantity + 1)); }}
                aria-label={t('increase_item', { name: localizedName })}
                className="w-11 h-11 rounded-full flex items-center justify-center hover:bg-card transition-colors tap-sm disabled:opacity-40"
                disabled={quantity >= 10}
              >
                <Plus className="w-4 h-4" aria-hidden />
              </button>
            </div>

            <Button
              ref={addRef}
              onClick={handleAdd}
              className="flex-1 h-12 rounded-full bg-primary text-primary-foreground font-sans font-semibold text-base hover:bg-sage-dark hover:shadow-lg hover:shadow-primary/30 transition-all duration-200 tap tabular-nums"
            >
              {t('add_to_order')} · {price((item.price * quantity))}
            </Button>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
};

export default MenuItemDetail;
