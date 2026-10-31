import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, Minus, Plus, Trash2, Send, ShoppingBag, UtensilsCrossed, Undo2, AlertTriangle, Loader2 } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useCartStore, type CartItem } from '@/lib/cart-store';
import { PriceTag, SaleBadge } from '@/components/guest/PriceTag';
import { useCartLivePrices } from '@/lib/promotions-api';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { useT, useLanguageStore, getLocalizedName, useI18n } from '@/lib/i18n';
import { useSessionHeartbeat } from '@/hooks/useSessionHeartbeat';
import SmartImage from '@/components/ui/SmartImage';
import { fadeUpCapped, useCountUp } from '@/lib/motion';
import { haptic } from '@/lib/haptics';
import RollingNumber from '@/components/guest/RollingNumber';
import CheckoutSheet from '@/components/guest/CheckoutSheet';
import MonriCardForm from '@/components/guest/MonriCardForm';
import PaymentStatus, { type PaymentPhase } from '@/components/guest/PaymentStatus';
import CartSuggestion from '@/components/guest/CartSuggestion';
import { startCardPayment, waitForPaymentConfirmation, classifyPayment, cardPaymentEnabledInBuild } from '@/lib/payments';
import { menuHome } from '@/lib/venues';
import {
  placeGuestOrder, touchSession, getServiceStatus, getOrderPayment, switchToPayAtTable,
  unavailableItemIds, orderErrorKey, priceChanges, type PaymentMethod,
} from '@/lib/guest-api';
import { addRecentItems } from '@/lib/recent-items';
import { track, flushNow } from '@/lib/analytics';

const LARGE_ORDER_THRESHOLD = 20;

const CartPage = () => {
  const navigate = useNavigate();
  useSessionHeartbeat();
  const [searchParams] = useSearchParams();
  const {
    items, total, updateQuantity, removeItem, addItem, clearCart,
    sessionId, sessionToken, guestName, setLastOrderTime, itemCount, tableNumber,
    pendingPayment, setPendingPayment,
    beginCheckout, finishCheckout, unavailableIds, setUnavailable, applyServerPrices,
  } = useCartStore();

  const [submitting, setSubmitting] = useState<PaymentMethod | null>(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [phase, setPhase] = useState<PaymentPhase | null>(null);
  /**
   * The order the status screen is talking about.
   *
   * Kept separately from `pendingPayment` because that is cleared the moment
   * the money resolves — reading the amount from it (or from the now-empty
   * cart) is how a confirmation ends up proudly displaying "0.00 KM".
   */
  const [resolvedOrder, setResolvedOrder] = useState<{
    code: string; total: number; payLater: boolean;
    /** For the ETA on the confirmation. */
    orderId?: string;
    /** Waiting for the waiter to confirm before it prints. */
    held?: boolean;
  } | null>(null);
  const [recovering, setRecovering] = useState(false);
  const [cardSession, setCardSession] = useState<{ clientSecret: string; authenticityToken: string; environment: 'test' | 'production' } | null>(null);
  const [lastRemoved, setLastRemoved] = useState<CartItem | null>(null);

  const submittingRef = useRef(false);
  const undoTimer = useRef<ReturnType<typeof setTimeout>>();
  const t = useT();
  const { price } = useI18n();
  const locale = useLanguageStore((s) => s.locale);
  const displayTotal = useCountUp(total());

  const table = searchParams.get('table');
  const token = searchParams.get('token');

  const { data: service } = useQuery({
    queryKey: ['service-status'],
    queryFn: getServiceStatus,
    staleTime: 60_000,
    retry: 1,
  });

  const onlineCardEnabled = cardPaymentEnabledInBuild && service?.online_card_enabled === true;
  const payAtTableEnabled = service?.pay_at_table_enabled !== false;
  const orderingPaused = service?.ordering_enabled === false;
  // Card disabled AND pay-at-table switched off leaves the checkout with no
  // buttons at all; say so here instead of opening an empty sheet.
  const noWayToPay = !!service && !onlineCardEnabled && !payAtTableEnabled;
  /**
   * With no online card payment there is nothing to choose before the meal:
   * "Send order" sends it, to be paid at the table, in one tap. The waiter
   * records cash or terminal when the guest actually pays. ('cash' is the
   * pay-at-table method the server already knows.) Until the service status
   * has loaded, a build that can take cards still opens the sheet.
   */
  const oneTapSend = service ? !onlineCardEnabled && payAtTableEnabled : !cardPaymentEnabledInBuild;

  // Prices are frozen when a line is added and the cart is persisted, so a
  // guest whose visit spans a menu update would see one total and be charged
  // another. The live menu is re-read on arrival and the cart re-priced —
  // including at the moment a sale in it starts or ends — and anything that
  // sold out or is out of hours is marked. See useCartLivePrices.
  useCartLivePrices();
  const isBlocked = (i: CartItem) => unavailableIds.includes(i.menuItemId ?? i.id) || unavailableIds.includes(i.id);
  const blockedLines = items.filter(isBlocked);

  // Completes the funnel: menu_viewed → item_viewed → item_added → cart_viewed
  // → checkout_opened → order_placed. Without this step the drop-off between
  // adding and checking out is unattributable.
  const cartSize = itemCount();
  useEffect(() => {
    if (cartSize > 0) track('cart_viewed', { item_count: cartSize });
    // Once per visit to the cart, not per quantity change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const buildMenuUrl = useCallback(() => {
    const params = new URLSearchParams();
    if (table) params.set('table', table);
    if (token) params.set('token', token);
    const query = params.toString();
    return menuHome(query);
  }, [table, token]);

  // ---------------------------------------------------------------------
  // Recovery. A held order survives reloads, closed tabs and 3-D Secure
  // round-trips: on mount we ask the server what actually happened rather
  // than trusting anything the browser remembers.
  // ---------------------------------------------------------------------
  useEffect(() => {
    if (!pendingPayment || !sessionId || !sessionToken) return;
    let cancelled = false;

    (async () => {
      setPhase('confirming');
      const result = await waitForPaymentConfirmation(
        { id: pendingPayment.orderId, sessionId, sessionToken },
        { timeoutMs: 12_000 },
      );
      if (cancelled) return;

      setResolvedOrder({ code: pendingPayment.orderCode, total: pendingPayment.total, payLater: false, orderId: pendingPayment.orderId });

      if (result.outcome === 'received') {
        clearCart();
        setPendingPayment(null);
        setPhase('received');
      } else {
        setPhase(result.outcome === 'failed' ? 'failed' : 'delayed');
      }
    })();

    return () => { cancelled = true; };
    // Intentionally keyed on the order id only: re-running on every store
    // change would restart the poll.
  }, [pendingPayment?.orderId, sessionId, sessionToken]); // eslint-disable-line react-hooks/exhaustive-deps

  const removeWithUndo = (item: CartItem) => {
    removeItem(item.id, 'cart_trash');
    setLastRemoved(item);
    clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setLastRemoved(null), 6000);
  };

  const undoRemove = () => {
    if (!lastRemoved) return;
    for (let i = 0; i < lastRemoved.quantity; i += 1) {
      addItem({
        id: lastRemoved.menuItemId ?? lastRemoved.id,
        menuItemId: lastRemoved.menuItemId,
        name: lastRemoved.name,
        name_bs: lastRemoved.name_bs,
        name_ar: lastRemoved.name_ar,
        price: lastRemoved.price,
        regularPrice: lastRemoved.regularPrice,
        saleLabel: lastRemoved.saleLabel,
        combo: lastRemoved.combo,
        notes: lastRemoved.notes,
        image_url: lastRemoved.image_url,
      });
    }
    setLastRemoved(null);
  };

  const openCardForm = useCallback(async (orderId: string) => {
    if (!sessionId || !sessionToken) return;
    const res = await startCardPayment({ id: orderId, sessionId, sessionToken });

    if (res.status === 'monri_components') {
      setCardSession({
        clientSecret: res.clientSecret,
        authenticityToken: res.authenticityToken,
        environment: res.environment,
      });
      setPhase('collecting');
      return;
    }

    // Card cannot be taken. The order is held, not lost — offer pay-at-table.
    toast.error(t('card_unavailable_now'));
    setPhase('failed');
  }, [sessionId, sessionToken, t]);

  const placeOrder = async (method: PaymentMethod, tip = 0) => {
    if (submittingRef.current) return;
    if (!sessionId || !sessionToken) { toast.error(t('scan_qr_again')); return; }
    if (items.length === 0) return;
    if (blockedLines.length > 0) { toast.error(t('some_items_unavailable')); return; }

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      toast.error(t('connection_lost_body'));
      return;
    }

    submittingRef.current = true;
    setSubmitting(method);
    track('checkout_submitted', { method, item_count: itemCount(), tip_selected: tip > 0 });
    // Same key for every retry of this checkout; see cart-store.
    const clientOrderId = beginCheckout();
    // The lines as sent, so a 'Prices changed' answer can be matched back.
    const sentLineIds = items.map((item) => item.id);

    try {
      const isActive = await touchSession(sessionId, sessionToken);
      if (!isActive) { toast.error(t('session_expired')); return; }

      const order = await placeGuestOrder(
        sessionId, sessionToken, guestName, method,
        items.map((item) => ({
          menu_item_id: item.menuItemId ?? item.id,
          quantity: item.quantity,
          notes: item.notes || null,
          ...(item.combo ? { choices: item.combo.components.map((c) => ({ slot_id: c.slot_id, item_id: c.item_id })) } : {}),
          // What this screen showed. The server charges it or refuses; never something else.
          unit_price_seen: item.price,
          // Priced server-side regardless; this only records what earned what.
          from_suggestion: item.fromSuggestion
            ? {
              source_item_id: item.fromSuggestion.sourceItemId,
              placement: item.fromSuggestion.placement,
              // Joins the sale back to the decision that produced it.
              decision_id: item.fromSuggestion.decisionId ?? null,
            }
            : null,
        })),
        tip,
        clientOrderId,
      );

      finishCheckout();
      setLastOrderTime();
      // A combo needs its choices, which "order again" cannot ask for.
      addRecentItems(items.filter((it) => !it.combo).map((it) => ({ id: it.menuItemId ?? it.id, name: it.name, price: it.price, image_url: it.image_url })));
      setCheckoutOpen(false);
      setResolvedOrder({
        code: order.order_code, total: Number(order.total), payLater: !order.awaiting_payment, held: order.held === true,
        orderId: order.order_id,
      });

      if (order.awaiting_payment) {
        // The order exists but is NOT in the kitchen. Remember it so a reload
        // recovers here, and keep the cart until the money resolves.
        setPendingPayment({
          orderId: order.order_id,
          orderCode: order.order_code,
          total: Number(order.total),
          createdAt: Date.now(),
        });
        track('payment_started', { method });
        // Before handing over to the card provider, which may navigate away.
        flushNow();
        await openCardForm(order.order_id);
        return;
      }

      // Pay at the table: the order is with the kitchen, so the cart is done.
      // No automatic "come and take payment" call: on a running tab that
      // summoned the waiter after every round. The waiter sees what each table
      // owes on their own screen, and the guest asks for the bill when ready.
      clearCart();
      setPendingPayment(null);
      setPhase('received');
      track('order_placed', { method, total: Number(order.total) });
      // The step every funnel ends on; send it now rather than in eight
      // seconds, by which time the phone is often back in a pocket.
      flushNow();
    } catch (err: unknown) {
      const changed = priceChanges(err);
      if (changed.length > 0) {
        // Nothing was placed. Show the prices the restaurant will charge and
        // let the guest send again; never charge what they did not see.
        applyServerPrices(changed, sentLineIds);
        track('order_failed', { method, reason: 'prices_changed' });
        toast.info(t('prices_changed_check'));
        return;
      }
      const blocked = unavailableItemIds(err);
      if (blocked.length > 0) setUnavailable(blocked);
      const key = orderErrorKey(err);
      track('order_failed', { method, reason: key });
      toast.error(t(key));
    } finally {
      submittingRef.current = false;
      setSubmitting(null);
    }
  };

  /** The card form finished. Ask the server what really happened. */
  const confirmAfterCardForm = async () => {
    if (!pendingPayment || !sessionId || !sessionToken) return;
    setCardSession(null);
    setPhase('confirming');

    const result = await waitForPaymentConfirmation(
      { id: pendingPayment.orderId, sessionId, sessionToken },
      { timeoutMs: 25_000 },
    );

    if (result.outcome === 'received') {
      clearCart();
      setPendingPayment(null);
      setPhase('received');
      track('payment_confirmed', { method: 'card_online' });
      // The funnel's last step. Card orders only reach it once the money has.
      track('order_placed', { method: 'card_online', total: pendingPayment.total });
      flushNow();
    } else {
      setPhase(result.outcome === 'failed' ? 'failed' : 'delayed');
      track(result.outcome === 'failed' ? 'payment_failed' : 'payment_delayed', { method: 'card_online' });
    }
  };

  const payAtTableInstead = async () => {
    if (!pendingPayment || !sessionId || !sessionToken) return;
    setRecovering(true);
    try {
      const res = await switchToPayAtTable(sessionId, sessionToken, pendingPayment.orderId, 'cash');
      if (res.status === 'released') {
        clearCart();
        setPendingPayment(null);
        setResolvedOrder({ code: pendingPayment.orderCode, total: pendingPayment.total, payLater: true, orderId: pendingPayment.orderId });
        setPhase('received');
        track('payment_switched_to_table', { method: 'cash' });
        return;
      }
      if (res.status === 'payment_in_flight') {
        // Something is still moving at the provider — never let the guest
        // trigger a second payment path on top of it.
        setPhase('delayed');
        return;
      }
      // Already resolved one way or another; re-read the truth.
      const payment = await getOrderPayment(sessionId, sessionToken, pendingPayment.orderId);
      const verdict = classifyPayment(payment);
      if (verdict === 'received') {
        clearCart();
        setPendingPayment(null);
        setPhase('received');
      } else {
        setPhase('delayed');
      }
    } catch (err) {
      toast.error(t('something_wrong'));
    } finally {
      setRecovering(false);
    }
  };

  const isLargeOrder = itemCount() > LARGE_ORDER_THRESHOLD;
  const amountLabel = `${price((resolvedOrder?.total ?? pendingPayment?.total ?? total()))}`;

  // ---------------------------------------------------------------------

  if (phase && phase !== 'collecting') {
    return (
      <PaymentStatus
        phase={phase}
        orderCode={resolvedOrder?.code ?? pendingPayment?.orderCode ?? null}
        amountLabel={amountLabel}
        released={phase === 'received'}
        payLater={phase === 'received' && resolvedOrder?.payLater === true}
        held={resolvedOrder?.held === true}
        orderId={resolvedOrder?.orderId ?? pendingPayment?.orderId ?? null}
        tableNumber={table ?? (tableNumber ? String(tableNumber) : null)}
        busy={recovering}
        onRetryCard={phase === 'failed' && onlineCardEnabled && pendingPayment
          ? () => openCardForm(pendingPayment.orderId)
          : undefined}
        onPayAtTable={phase === 'failed' && pendingPayment ? payAtTableInstead : undefined}
        onTrackOrder={() => navigate('/tab')}
        onContinue={phase === 'received' ? () => { setPhase(null); setResolvedOrder(null); navigate(buildMenuUrl()); } : undefined}
      />
    );
  }

  return (
    <div className="min-h-screen bg-background pb-32">
      <div className="sticky top-0 z-30 glass">
        <div className="flex items-center gap-3 px-4 py-4">
          <button
            onClick={() => navigate(-1)}
            aria-label={t('back_to_menu')}
            className="p-2.5 -ms-2 rounded-full hover:bg-muted transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
          >
            <ArrowLeft className={`w-5 h-5 text-foreground ${locale === 'ar' ? 'rotate-180' : ''}`} aria-hidden />
          </button>
          <h1 className="font-serif text-[22px] font-semibold text-foreground tracking-tight">{t('your_order')}</h1>
          {table && (
            <span className="ms-auto text-xs font-sans px-3 py-1 rounded-full bg-primary/10 text-primary font-medium">
              {t('table_n', { n: table })}
            </span>
          )}
        </div>
        <div className="h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent" />
      </div>

      {orderingPaused && (
        <div className="mx-4 mt-4 p-4 rounded-2xl border border-accent/30 bg-accent/5" role="status">
          <p className="font-sans font-semibold text-foreground text-sm flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-accent" aria-hidden /> {t('ordering_paused_title')}
          </p>
          <p className="text-xs text-muted-foreground font-sans mt-1.5">
            {service?.paused_message || t('ordering_paused_body')}
          </p>
        </div>
      )}

      {!orderingPaused && (service?.kitchen_delay_minutes ?? 0) > 0 && (
        <div className="mx-4 mt-4 p-3 rounded-xl border border-border bg-muted/40" role="status">
          <p className="text-xs font-sans text-muted-foreground">{t('kitchen_busy_notice')}</p>
        </div>
      )}

      {/* Undo sits outside the empty/non-empty branch on purpose: removing the
          last line is exactly when a guest most needs to be able to undo it. */}
      {lastRemoved && (
        <div className="px-4 pt-4">
          <button
            onClick={undoRemove}
            className="w-full flex items-center justify-center gap-2 p-3 rounded-xl border border-dashed border-border text-sm font-sans text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors min-h-[44px]"
          >
            <Undo2 className="w-4 h-4 rtl:-scale-x-100" aria-hidden /> {t('undo_removed', { name: getLocalizedName(lastRemoved, locale) })}
          </button>
        </div>
      )}

      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 px-6">
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
            <ShoppingBag className="w-7 h-7 text-muted-foreground" aria-hidden />
          </div>
          <p className="text-foreground font-serif text-lg font-semibold">{t('order_empty')}</p>
          <p className="text-muted-foreground font-sans text-sm mt-1 text-center">{t('browse_menu_to_add')}</p>
          <Button onClick={() => navigate(buildMenuUrl())} variant="outline" className="mt-6 rounded-full px-6 font-sans">
            {t('back_to_menu')}
          </Button>
        </div>
      ) : (
        <>
          {blockedLines.length > 0 && (
            <div className="mx-4 mt-4 p-3.5 rounded-xl border border-destructive/30 bg-destructive/5 flex items-start gap-2.5" role="alert">
              <AlertTriangle className="w-4 h-4 text-destructive mt-0.5 shrink-0" aria-hidden />
              <p className="text-sm font-sans text-foreground">{t('some_items_unavailable')}</p>
            </div>
          )}
          {/* One panel, one row per dish: the order reads like a receipt, not
              a stack of separate cards. */}
          <motion.div
            initial="hidden"
            animate="show"
            className="mx-4 mt-4 rounded-3xl bg-card border border-border/70 shadow-[0_1px_2px_rgba(20,30,25,0.04)] divide-y divide-border/70 overflow-hidden"
          >
            {items.map((item, index) => {
              const blocked = isBlocked(item);
              const name = getLocalizedName(item, locale);
              const onSale = item.regularPrice != null && Math.round(item.regularPrice * 100) > Math.round(item.price * 100);
              return (
              <motion.div key={item.id} variants={fadeUpCapped} custom={index} className={`flex items-center gap-3.5 px-4 py-3.5 ${blocked ? 'bg-destructive/5' : ''}`}>
                {item.image_url ? (
                  <SmartImage
                    src={item.image_url}
                    id={item.menuItemId ?? item.id}
                    alt=""
                    width={60}
                    height={60}
                    square
                    sizes="60px"
                    wrapperClassName={`w-[60px] h-[60px] rounded-xl flex-shrink-0 ${blocked ? 'opacity-50 saturate-50' : ''}`}
                  />
                ) : (
                  <div className="w-[60px] h-[60px] rounded-xl bg-muted flex-shrink-0" aria-hidden />
                )}
                <div className="flex-1 min-w-0">
                  <h3 className="font-serif text-base font-semibold text-foreground leading-snug">{name}</h3>
                  {item.combo && item.combo.components.length > 0 && (
                    // What is in it, as the kitchen will read it.
                    <ul className="mt-0.5 text-[13px] font-sans text-muted-foreground leading-snug" data-combo-parts>
                      {item.combo.components.map((c) => (
                        <li key={c.slot_id}>
                          {t('combo_part', {
                            slot: (locale === 'bs' && c.slot_label_bs) || (locale === 'ar' && c.slot_label_ar) || c.slot_label,
                            name: getLocalizedName(c, locale),
                          })}
                          {c.surcharge > 0 && <span className="ms-1 tabular-nums">(<span dir="ltr">{t('plus_amount', { amount: price(c.surcharge) })}</span>)</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                  {item.notes && <p className="text-[13px] text-muted-foreground mt-0.5 line-clamp-2">{t('quoted', { text: item.notes })}</p>}
                  {blocked
                    ? <p className="text-[13px] font-sans font-medium text-destructive mt-0.5">{t('item_unavailable_now')}</p>
                    : (
                      <div className="flex items-center flex-wrap gap-x-1.5 gap-y-1 mt-1">
                        {onSale && <SaleBadge label={item.saleLabel} percentOff={Math.round((1 - item.price / item.regularPrice!) * 100)} />}
                        <p className="text-sm font-sans font-semibold text-foreground">
                          <PriceTag
                            price={Math.round(item.price * 100) * item.quantity / 100}
                            regular={onSale ? Math.round(item.regularPrice! * 100) * item.quantity / 100 : null}
                            bare={false}
                          />
                          {item.quantity > 1 && <span className="ms-1.5 text-xs font-normal text-muted-foreground tabular-nums">{item.quantity} × {item.price.toFixed(2)}</span>}
                        </p>
                      </div>
                    )}
                </div>
                {/* At one, the minus becomes a bin: removing is the same gesture
                    as lowering, and Undo is right there if it was a slip. */}
                <div className="flex items-center h-11 rounded-full border border-border bg-background shrink-0">
                  <button
                    onClick={() => { haptic('tick'); if (item.quantity <= 1) removeWithUndo(item); else updateQuantity(item.id, item.quantity - 1); }}
                    aria-label={item.quantity <= 1 ? t('remove_item', { name }) : t('decrease_item', { name })}
                    className="w-11 h-11 rounded-full flex items-center justify-center text-foreground tap-sm"
                  >
                    {item.quantity <= 1 ? <Trash2 className="w-4 h-4 text-muted-foreground" aria-hidden /> : <Minus className="w-4 h-4" aria-hidden />}
                  </button>
                  <span className="min-w-[16px] text-[15px] font-sans font-semibold text-center tabular-nums" aria-live="polite"><RollingNumber value={item.quantity} /></span>
                  <button
                    onClick={() => { haptic('tick'); updateQuantity(item.id, item.quantity + 1); }}
                    disabled={item.quantity >= 10 || blocked}
                    aria-label={t('increase_item', { name })}
                    className="w-11 h-11 rounded-full flex items-center justify-center text-primary tap-sm disabled:opacity-40"
                  >
                    <Plus className="w-4 h-4" strokeWidth={2.5} aria-hidden />
                  </button>
                </div>
              </motion.div>
              );
            })}
            <button
              onClick={() => navigate(buildMenuUrl())}
              className="w-full flex items-center gap-2 px-4 py-3.5 text-sm font-sans font-semibold text-primary hover:bg-muted/50 transition-colors"
            >
              <Plus className="w-4 h-4" strokeWidth={2.5} aria-hidden /> {t('add_more_items')}
            </button>
          </motion.div>

          {isLargeOrder && (
            <div className="mx-4 mt-3 p-3 rounded-xl border border-accent/20 bg-accent/5 flex items-center gap-3">
              <UtensilsCrossed className="w-4 h-4 text-accent flex-shrink-0" aria-hidden />
              <p className="text-xs font-sans text-accent">{t('large_order_suggestion')}</p>
            </div>
          )}

          {sessionId && sessionToken && <CartSuggestion placement="cart" />}

          <div className="mx-4 mt-5 px-1 flex justify-between items-baseline">
            <span className="font-sans text-[15px] text-muted-foreground">{t('total')}</span>
            <span className="font-sans text-2xl font-semibold text-foreground tabular-nums">{price(displayTotal)}</span>
          </div>

          <div className="fixed bottom-0 left-0 right-0 z-40 p-4 pb-safe bg-background/80 backdrop-blur-xl border-t border-border/50">
            {noWayToPay && !orderingPaused && (
              <p className="text-sm text-muted-foreground text-center mb-2 font-sans">{t('no_payment_options')}</p>
            )}
            <Button
              onClick={() => {
                track('checkout_opened', { item_count: itemCount(), one_tap: oneTapSend });
                if (oneTapSend) void placeOrder('cash', 0);
                else setCheckoutOpen(true);
              }}
              disabled={!sessionId || !sessionToken || orderingPaused || noWayToPay || blockedLines.length > 0 || submitting !== null}
              aria-busy={submitting !== null}
              className="w-full h-14 rounded-2xl bg-primary text-primary-foreground font-sans font-semibold text-base hover:bg-sage-dark hover:shadow-lg hover:shadow-primary/30 disabled:opacity-50 transition-all duration-200 tap"
            >
              <span className="flex items-center gap-2">
                {submitting !== null && oneTapSend
                  ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
                  : <Send className="w-4 h-4 rtl:-scale-x-100" aria-hidden />}
                {t('send_order')} · {price(displayTotal)}
              </span>
            </Button>
            {oneTapSend && !noWayToPay && (
              <p className="text-xs text-muted-foreground text-center mt-2 font-sans">{t('pay_waiter_when_ready')}</p>
            )}
            {(!sessionId || !sessionToken) && (
              <p className="text-xs text-destructive text-center mt-2 font-sans">{t('scan_qr_again')}</p>
            )}
          </div>

          <CheckoutSheet
            open={checkoutOpen}
            total={total()}
            submitting={submitting}
            onlineCardEnabled={onlineCardEnabled}
            payAtTableEnabled={payAtTableEnabled}
            onChoose={placeOrder}
            onClose={() => setCheckoutOpen(false)}
          />
        </>
      )}

      {cardSession && pendingPayment && (
        <MonriCardForm
          open
          clientSecret={cardSession.clientSecret}
          authenticityToken={cardSession.authenticityToken}
          environment={cardSession.environment}
          amountLabel={amountLabel}
          orderCode={pendingPayment.orderCode}
          // Both paths hand off to the server; the SDK result is only a signal
          // that the form is done, never a verdict on the money.
          onFinished={confirmAfterCardForm}
          onGiveUp={() => { setCardSession(null); setPhase('failed'); }}
        />
      )}
    </div>
  );
};

export default CartPage;
