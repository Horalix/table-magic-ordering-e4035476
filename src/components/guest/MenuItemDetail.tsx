import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, useDragControls, useReducedMotion, useIsPresent, MotionConfig, type Variants } from 'framer-motion';
import { X, Plus, Minus, QrCode, UtensilsCrossed, AlertTriangle, Clock, Check, Tag } from 'lucide-react';
import { useCartStore, type CartComboComponent } from '@/lib/cart-store';
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
import { PriceTag, SaleBadge, NewBadge, ComboBadge } from '@/components/guest/PriceTag';
import { useComboMap } from '@/lib/promotions-api';
import { unorderableReason } from '@/lib/availability';
import { useVenue } from '@/hooks/useVenue';
import {
  comboRegularPrice, comboSaving, comboUnitPrice, fixedChoices, isFixedSlot, isNew, missingSlots,
  saleEndsPhrase, saleView, type ComboChoices, type ComboDef, type ComboSlot, type NewFields, type SaleFields,
} from '@/lib/promotions';
import type { Locale } from '@/lib/i18n';

/** The server keeps the first 500 characters of a note; say so up front. */
const NOTE_MAX = 500;

/** Reduced motion: no slide, no shared photo, just a short fade. */
const reducedFade: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: duration.fast, ease: easeEnter } },
  exit: { opacity: 0, transition: { ...exitTransition, duration: duration.fast } },
};

/** A combo part's name in the guest's language. */
const slotLabel = (slot: ComboSlot, locale: Locale) =>
  (locale === 'bs' && slot.label_bs) || (locale === 'ar' && slot.label_ar) || slot.label;

interface Props {
  item: Partial<Omit<SaleFields, 'price'>> & NewFields & {
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
  // Vera Italia photographs every dish from above, the whole plate in a
  // square: a wide band would cut the plate, so its sheet shows the square.
  const vera = useVenue().slug === 'veraitalia';
  const localizedDesc = getLocalizedDescription(item, locale);
  const orderable = canOrder && !unavailableLabel;

  // ---- Sale, new, combo ------------------------------------------------
  // Read once when the sheet opens: a sale ending under an open sheet is
  // caught by the cart, which re-prices at that moment, and by the server.
  const [openedAt] = useState(() => Date.now());
  const sale = saleView(item, openedAt);
  const fresh = isNew(item, openedAt);
  const combo: ComboDef | undefined = useComboMap().get(item.id);
  const [choices, setChoices] = useState<ComboChoices>({});
  // Single-dish parts are filled in for the guest as soon as the combo is known.
  useEffect(() => { if (combo) setChoices((c) => ({ ...fixedChoices(combo), ...c })); }, [combo]);
  const [attempted, setAttempted] = useState(false);
  const slotRefs = useRef<Record<string, HTMLElement | null>>({});
  const missing = combo ? missingSlots(combo, choices) : [];
  const unit = combo ? comboUnitPrice(item, combo, choices, openedAt) : sale ? sale.price : item.price;
  const regular = combo
    ? (sale ? comboRegularPrice(item, combo, choices) : null)
    : (sale ? sale.regular : null);
  const saving = combo && missing.length === 0 ? comboSaving(item, combo, choices, openedAt) : null;
  const endsPhrase = sale ? saleEndsPhrase(sale.endsAt, openedAt) : null;

  const components = useMemo((): CartComboComponent[] => (combo
    ? combo.slots.map((slot) => {
      const opt = slot.options.find((o) => o.item_id === choices[slot.id]);
      const part: CartComboComponent | null = opt ? {
        slot_id: slot.id, slot_label: slot.label, slot_label_bs: slot.label_bs ?? null, slot_label_ar: slot.label_ar ?? null,
        item_id: opt.item_id, name: opt.name, name_bs: opt.name_bs ?? null, name_ar: opt.name_ar ?? null,
        surcharge: Number(opt.surcharge),
      } : null;
      return part;
    }).filter((c): c is CartComboComponent => c !== null)
    : []), [combo, choices]);

  const choose = (slot: ComboSlot, itemId: string) => {
    haptic('tick');
    setChoices((c) => ({ ...c, [slot.id]: itemId }));
  };

  const handleAdd = () => {
    if (!orderable) return;
    if (combo && missing.length > 0) {
      // Show what is missing instead of a disabled button that says nothing.
      setAttempted(true);
      haptic('tick');
      slotRefs.current[missing[0].id]?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
      return;
    }
    for (let i = 0; i < quantity; i++) {
      addItem({
        id: item.id,
        name: item.name,
        name_bs: item.name_bs ?? null,
        name_ar: item.name_ar ?? null,
        price: unit,
        regularPrice: regular ?? undefined,
        saleLabel: sale ? (item.sale_label ?? '') : undefined,
        image_url: item.image_url,
        notes: notes.trim() || undefined,
        ...(combo ? { combo: { components } } : {}),
      });
    }
    // Only ids and counts — the note itself is never sent to analytics.
    track('item_added', {
      item_id: item.id, quantity, source: 'detail', has_note: notes.trim().length > 0,
      ...(combo ? { combo: true } : {}), ...(sale ? { on_sale: true } : {}),
    });
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
              height={vera ? 800 : 520}
              // Full width of the sheet: the default assumes a half-width
              // card, which fetched a 384px photo for a 375px slot on a 2x
              // phone and made the dish look out of focus.
              sizes="(max-width: 512px) 100vw, 512px"
              priority
              wrapperClassName={`w-full ${vera ? 'aspect-square max-h-[50dvh]' : 'h-56'} ${unavailableLabel ? 'opacity-60 saturate-50' : ''}`}
            />
            </MotionConfig>
          ) : (
            <div className="w-full h-40 bg-primary/5 flex items-center justify-center">
              <UtensilsCrossed className="w-10 h-10 text-primary/20" aria-hidden />
            </div>
          )}

          <div className="p-6 pb-4">
            {(sale || fresh || combo) && (
              <div className="flex flex-wrap items-center gap-1.5 mb-2">
                {sale && <SaleBadge label={item.sale_label} percentOff={sale.percentOff} />}
                {combo && <ComboBadge />}
                {fresh && <NewBadge />}
              </div>
            )}
            <h2 id="item-detail-title" className={`font-serif text-foreground ${vera ? 'text-[30px] font-medium leading-tight' : 'text-2xl font-bold'}`}>{localizedName}</h2>
            <p className="text-lg font-sans font-semibold text-foreground mt-1.5">
              <PriceTag price={unit} regular={regular} bare={false} />
            </p>
            {endsPhrase && (
              <p className="mt-1 text-sm font-sans font-medium text-sale flex items-center gap-1.5">
                <Tag className="w-3.5 h-3.5" aria-hidden /> {t(endsPhrase.key, endsPhrase.vars)}
              </p>
            )}
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

            {combo && (
              <div className="mt-5 space-y-5" aria-label={t('combo_choose_for', { name: localizedName })} role="group">
                {combo.slots.map((slot) => {
                  const label = slotLabel(slot, locale);
                  const fixed = isFixedSlot(slot);
                  const flagged = attempted && !fixed && !choices[slot.id];
                  return (
                    <section
                      key={slot.id}
                      ref={(el) => { slotRefs.current[slot.id] = el; }}
                      aria-labelledby={`slot-${slot.id}`}
                      data-combo-slot={slot.label}
                      className={`rounded-2xl transition-colors ${flagged ? 'ring-2 ring-destructive/60 ring-offset-4 ring-offset-card' : ''}`}
                    >
                      <div className="flex items-baseline justify-between gap-3">
                        <h3 id={`slot-${slot.id}`} className="font-serif text-lg font-semibold text-foreground">{label}</h3>
                        {fixed ? (
                          <span className="text-xs font-sans font-medium text-muted-foreground">{t('combo_included')}</span>
                        ) : (
                          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-sans font-semibold ${
                            choices[slot.id] ? 'bg-primary/10 text-primary'
                              : flagged ? 'bg-destructive text-destructive-foreground' : 'bg-muted text-foreground'}`}
                          >
                            {choices[slot.id] ? <Check className="inline w-3 h-3 -mt-0.5" aria-label={t('combo_required')} /> : t('combo_required')}
                          </span>
                        )}
                      </div>
                      {!fixed && <p className="text-[13px] font-sans text-muted-foreground mt-0.5">{t('combo_choose_one')}</p>}
                      <div role={fixed ? undefined : 'radiogroup'} aria-labelledby={`slot-${slot.id}`} className="mt-2 grid gap-2">
                        {slot.options.map((opt) => {
                          const name = getLocalizedName(opt, locale);
                          const gone = unorderableReason(opt) !== null;
                          const selected = choices[slot.id] === opt.item_id;
                          const extra = Number(opt.surcharge);
                          const body = (
                            <>
                              <SmartImage
                                src={opt.image_url || undefined}
                                id={opt.item_id}
                                alt=""
                                width={44}
                                height={44}
                                square
                                sizes="44px"
                                fallbackText={name}
                                wrapperClassName={`w-11 h-11 rounded-xl shrink-0 ${gone ? 'opacity-50 saturate-50' : ''}`}
                              />
                              <span className={`flex-1 min-w-0 text-start text-[15px] font-sans font-medium leading-snug ${gone ? 'text-muted-foreground' : 'text-foreground'}`}>
                                {name}
                                {gone && <span className="block text-xs font-normal">{t('sold_out')}</span>}
                              </span>
                              {extra > 0 && (
                                // Isolated left-to-right, or Arabic reads it as "KM 1.00+".
                                <span dir="ltr" className="shrink-0 text-sm font-sans font-semibold text-foreground tabular-nums">{t('plus_amount', { amount: price(extra) })}</span>
                              )}
                            </>
                          );
                          if (fixed) {
                            return (
                              <div key={opt.item_id} className="flex items-center gap-3 p-2 rounded-xl bg-muted/50">
                                {body}
                                <Check className="w-5 h-5 text-primary shrink-0" aria-hidden />
                              </div>
                            );
                          }
                          return (
                            <button
                              key={opt.item_id}
                              type="button"
                              role="radio"
                              aria-checked={selected}
                              disabled={gone}
                              onClick={() => choose(slot, opt.item_id)}
                              className={`flex items-center gap-3 p-2 min-h-[56px] rounded-xl border text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed ${
                                selected ? 'border-primary bg-primary/5' : 'border-border bg-card hover:bg-muted/50'}`}
                            >
                              {body}
                              <span
                                aria-hidden
                                className={`w-5 h-5 shrink-0 rounded-full border-2 flex items-center justify-center ${selected ? 'border-primary bg-primary' : 'border-muted-foreground/40'}`}
                              >
                                {selected && <span className="w-2 h-2 rounded-full bg-primary-foreground" />}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </section>
                  );
                })}
                {saving !== null && (
                  <p className="flex items-center gap-2 rounded-xl bg-primary/10 px-3 py-2.5 text-sm font-sans font-semibold text-primary" role="status">
                    <Tag className="w-4 h-4 shrink-0" aria-hidden /> {t('combo_you_save', { amount: price(saving) })}
                  </p>
                )}
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
                {/* A combo already comes with its drink and its side. */}
                {!combo && (
                  <div className="mt-5">
                    <CartSuggestion placement="item" forItemIds={[item.id]} />
                  </div>
                )}
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
              // min-w-0 + wrapping: in Bosnian or Arabic "Add to order · 24.00 KM" is wider than the
              // bar on a phone. It used to push past the screen edge; cutting it short would hide the
              // price. Instead the price drops to a second line.
              className="flex-1 min-w-0 px-4 h-12 rounded-full bg-primary text-primary-foreground font-sans font-semibold text-base hover:bg-sage-dark hover:shadow-lg hover:shadow-primary/30 transition-all duration-200 tap tabular-nums"
            >
              {combo && missing.length > 0 ? (
                <span className="truncate min-w-0">{t('combo_choose_slot', { slot: slotLabel(missing[0], locale) })}</span>
              ) : (
                <>
                  <span className="sr-only">{`${t('add_to_order')} · ${price(Math.round(unit * 100) * quantity / 100)}`}</span>
                  <span aria-hidden className="flex flex-wrap items-baseline justify-center gap-x-1.5 whitespace-normal leading-tight text-center">
                    <span>{t('add_to_order')}</span>
                    <span>·</span>
                    <span className="whitespace-nowrap">{price(Math.round(unit * 100) * quantity / 100)}</span>
                  </span>
                </>
              )}
            </Button>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
};

export default MenuItemDetail;
