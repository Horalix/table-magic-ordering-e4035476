import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, Minus, Plus, Trash2, CreditCard, ShoppingBag, UtensilsCrossed, Undo2, AlertTriangle } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useCartStore, type CartItem } from '@/lib/cart-store';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { useT, useLanguageStore } from '@/lib/i18n';
import { useSessionHeartbeat } from '@/hooks/useSessionHeartbeat';
import SmartImage from '@/components/ui/SmartImage';
import { staggerContainer, fadeUp, useCountUp } from '@/lib/motion';
import CheckoutSheet from '@/components/guest/CheckoutSheet';
import MonriCardForm from '@/components/guest/MonriCardForm';
import PaymentStatus, { type PaymentPhase } from '@/components/guest/PaymentStatus';
import CartSuggestion from '@/components/guest/CartSuggestion';
import { startCardPayment, waitForPaymentConfirmation, classifyPayment, cardPaymentEnabledInBuild } from '@/lib/payments';
import {
  callWaiter, placeGuestOrder, touchSession, getServiceStatus, getOrderPayment, switchToPayAtTable,
  type PaymentMethod,
} from '@/lib/guest-api';
import { addRecentItems } from '@/lib/recent-items';
import { track } from '@/lib/analytics';

const LARGE_ORDER_THRESHOLD = 20;

const CartPage = () => {
  const navigate = useNavigate();
  useSessionHeartbeat();
  const [searchParams] = useSearchParams();
  const {
    items, total, updateQuantity, removeItem, addItem, clearCart,
    sessionId, sessionToken, guestName, setLastOrderTime, itemCount,
    pendingPayment, setPendingPayment,
  } = useCartStore();

  const [submitting, setSubmitting] = useState<PaymentMethod | null>(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [phase, setPhase] = useState<PaymentPhase | null>(null);
  const [recovering, setRecovering] = useState(false);
  const [cardSession, setCardSession] = useState<{ clientSecret: string; authenticityToken: string; environment: 'test' | 'production' } | null>(null);
  const [lastRemoved, setLastRemoved] = useState<CartItem | null>(null);

  const submittingRef = useRef(false);
  const undoTimer = useRef<ReturnType<typeof setTimeout>>();
  const t = useT();
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

  const buildMenuUrl = useCallback(() => {
    const params = new URLSearchParams();
    if (table) params.set('table', table);
    if (token) params.set('token', token);
    const query = params.toString();
    return query ? `/menu?${query}` : '/menu';
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
    removeItem(item.id);
    setLastRemoved(item);
    track('cart_item_removed', { item_id: item.menuItemId ?? item.id, quantity: item.quantity });
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
        price: lastRemoved.price,
        notes: lastRemoved.notes,
        image_url: lastRemoved.image_url,
      });
    }
    setLastRemoved(null);
  };

  /** Best-effort waiter signal; a pending call already covers us. */
  const pingWaiter = async (reason: 'assist' | 'pay' = 'pay') => {
    if (!sessionId || !sessionToken) return;
    await callWaiter(sessionId, sessionToken, reason).catch(() => { /* one is already on the way */ });
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

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      toast.error(t('connection_lost_body'));
      return;
    }

    submittingRef.current = true;
    setSubmitting(method);
    track('checkout_submitted', { method, item_count: itemCount(), tip_selected: tip > 0 });

    try {
      const isActive = await touchSession(sessionId, sessionToken);
      if (!isActive) { toast.error(t('session_expired')); return; }

      const order = await placeGuestOrder(
        sessionId, sessionToken, guestName, method,
        items.map((item) => ({
          menu_item_id: item.menuItemId ?? item.id,
          quantity: item.quantity,
          notes: item.notes || null,
        })),
        tip,
      );

      setLastOrderTime();
      addRecentItems(items.map((it) => ({ id: it.menuItemId ?? it.id, name: it.name, price: it.price, image_url: it.image_url })));
      setCheckoutOpen(false);

      if (order.awaiting_payment) {
        // The order exists but is NOT in the kitchen. Remember it so a reload
        // recovers here, and keep the cart until the money resolves.
        setPendingPayment({
          orderId: order.order_id,
          orderCode: order.order_code,
          total: Number(order.total),
          createdAt: Date.now(),
        });
        track('payment_started', { order_code: order.order_code });
        await openCardForm(order.order_id);
        return;
      }

      // Pay at the table: the order is with the kitchen, so the cart is done.
      clearCart();
      setPendingPayment({
        orderId: order.order_id,
        orderCode: order.order_code,
        total: Number(order.total),
        createdAt: Date.now(),
      });
      setPhase('received');
      setPendingPayment(null);
      track('order_placed', { method, order_code: order.order_code, total: Number(order.total) });
      await pingWaiter('pay');
      toast.success(t('order_confirmed'));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to place order. Please try again.';
      track('order_failed', { method, reason: message.slice(0, 80) });
      toast.error(message);
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
      track('payment_confirmed', { order_code: pendingPayment.orderCode });
    } else {
      setPhase(result.outcome === 'failed' ? 'failed' : 'delayed');
      track(result.outcome === 'failed' ? 'payment_failed' : 'payment_delayed', { order_code: pendingPayment.orderCode });
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
        setPhase('received');
        track('payment_switched_to_table', { order_code: pendingPayment.orderCode });
        await pingWaiter('pay');
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
      toast.error(err instanceof Error ? err.message : t('something_wrong'));
    } finally {
      setRecovering(false);
    }
  };

  const isLargeOrder = itemCount() > LARGE_ORDER_THRESHOLD;
  const amountLabel = `${(pendingPayment?.total ?? total()).toFixed(2)} KM`;

  // ---------------------------------------------------------------------

  if (phase && phase !== 'collecting') {
    return (
      <PaymentStatus
        phase={phase}
        orderCode={pendingPayment?.orderCode ?? null}
        amountLabel={amountLabel}
        released={phase === 'received'}
        busy={recovering}
        onRetryCard={phase === 'failed' && onlineCardEnabled && pendingPayment
          ? () => openCardForm(pendingPayment.orderId)
          : undefined}
        onPayAtTable={phase === 'failed' && pendingPayment ? payAtTableInstead : undefined}
        onTrackOrder={() => navigate('/tab')}
        onContinue={phase === 'received' ? () => { setPhase(null); navigate(buildMenuUrl()); } : undefined}
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
          <h1 className="font-serif text-xl font-semibold text-foreground">{t('your_order')}</h1>
          {table && (
            <span className="ms-auto text-xs font-sans px-3 py-1 rounded-full bg-primary/10 text-primary font-medium">
              {t('table')} {table}
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
          <motion.div variants={staggerContainer(0.04)} initial="hidden" animate="show" className="px-4 pt-4 space-y-3">
            {items.map((item) => (
              <motion.div key={item.id} variants={fadeUp} className="flex gap-4 p-4 card-lux">
                {item.image_url && (
                  <SmartImage
                    src={item.image_url}
                    id={item.menuItemId ?? item.id}
                    alt=""
                    width={64}
                    height={64}
                    wrapperClassName="w-16 h-16 rounded-lg flex-shrink-0"
                  />
                )}
                <div className="flex-1 min-w-0">
                  <h3 className="font-serif text-base font-semibold text-foreground">{item.name}</h3>
                  {item.notes && <p className="text-xs text-muted-foreground mt-0.5 italic">“{item.notes}”</p>}
                  <p className="text-sm font-sans font-bold text-primary mt-1 tabular-nums">
                    {(item.price * item.quantity).toFixed(2)} KM
                  </p>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <button
                    onClick={() => removeWithUndo(item)}
                    className="text-muted-foreground hover:text-destructive transition-colors p-1.5 min-w-[44px] min-h-[44px] flex items-center justify-center"
                    aria-label={`${t('remove')} ${item.name}`}
                  >
                    <Trash2 className="w-4 h-4" aria-hidden />
                  </button>
                  <div className="flex items-center gap-2 bg-muted rounded-full px-1.5 py-0.5">
                    <button
                      onClick={() => updateQuantity(item.id, item.quantity - 1)}
                      aria-label={`${t('decrease')} ${item.name}`}
                      className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-card transition-colors tap-sm"
                    >
                      <Minus className="w-3.5 h-3.5" aria-hidden />
                    </button>
                    <span className="text-sm font-sans font-semibold w-5 text-center tabular-nums" aria-live="polite">{item.quantity}</span>
                    <button
                      onClick={() => updateQuantity(item.id, item.quantity + 1)}
                      aria-label={`${t('increase')} ${item.name}`}
                      className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-card transition-colors tap-sm"
                    >
                      <Plus className="w-3.5 h-3.5" aria-hidden />
                    </button>
                  </div>
                </div>
              </motion.div>
            ))}
          </motion.div>

          {lastRemoved && (
            <div className="px-4 mt-3">
              <button
                onClick={undoRemove}
                className="w-full flex items-center justify-center gap-2 p-3 rounded-xl border border-dashed border-border text-sm font-sans text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors"
              >
                <Undo2 className="w-4 h-4" aria-hidden /> {t('undo_remove')} — {lastRemoved.name}
              </button>
            </div>
          )}

          <div className="px-4 mt-6 space-y-3">
            {isLargeOrder && (
              <div className="p-3 rounded-xl border border-accent/20 bg-accent/5 flex items-center gap-3">
                <UtensilsCrossed className="w-4 h-4 text-accent flex-shrink-0" aria-hidden />
                <p className="text-xs font-sans text-accent">{t('large_order_suggestion')}</p>
              </div>
            )}
            <div className="p-4 card-lux">
              <div className="flex justify-between items-center">
                <span className="font-sans text-sm text-muted-foreground">{t('total')}</span>
                <span className="font-serif text-xl font-bold text-foreground tabular-nums">{displayTotal.toFixed(2)} KM</span>
              </div>
            </div>
          </div>

          {sessionId && sessionToken && <CartSuggestion placement="cart" />}

          <div className="fixed bottom-0 left-0 right-0 z-40 p-4 pb-safe bg-background/80 backdrop-blur-xl border-t border-border/50">
            <Button
              onClick={() => { setCheckoutOpen(true); track('checkout_opened', { item_count: itemCount() }); }}
              disabled={!sessionId || !sessionToken || orderingPaused}
              className="w-full h-14 rounded-2xl bg-primary text-primary-foreground font-sans font-semibold text-base hover:bg-sage-dark hover:shadow-lg hover:shadow-primary/30 disabled:opacity-50 transition-all duration-200 tap"
            >
              <span className="flex items-center gap-2">
                <CreditCard className="w-4 h-4" aria-hidden />
                {t('checkout')} · {displayTotal.toFixed(2)} KM
              </span>
            </Button>
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
