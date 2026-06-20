import React, { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, Minus, Plus, Trash2, CreditCard, CheckCircle, ShoppingBag, UtensilsCrossed, Hand } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useCartStore } from '@/lib/cart-store';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { useT, useLanguageStore } from '@/lib/i18n';
import { useSessionHeartbeat } from '@/hooks/useSessionHeartbeat';
import SmartImage from '@/components/ui/SmartImage';
import { staggerContainer, fadeUp, useCountUp } from '@/lib/motion';
import CheckoutSheet, { type PayMethod } from '@/components/guest/CheckoutSheet';
import MonriCardForm from '@/components/guest/MonriCardForm';
import { startCardPayment, cardPaymentEnabled } from '@/lib/payments';
import { callWaiter, placeGuestOrder, touchSession } from '@/lib/guest-api';

const LARGE_ORDER_THRESHOLD = 20;

const OrderSuccess = ({ table, cardComingSoon, cardPaid, waiterCalled, onCallWaiter, onContinue }: {
  table: string | null;
  cardComingSoon: boolean;
  cardPaid: boolean;
  waiterCalled: boolean;
  onCallWaiter: () => void;
  onContinue: () => void;
}) => {
  const t = useT();
  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-6">
      <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="text-center max-w-sm">
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', damping: 12, stiffness: 200, delay: 0.2 }}
          className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-6"
        >
          <CheckCircle className="w-10 h-10 text-primary" />
        </motion.div>
        <h2 className="font-serif text-2xl font-bold text-foreground">{t('order_confirmed')}</h2>
        <p className="text-muted-foreground font-sans mt-2 text-sm">{t('order_in_kitchen')}</p>
        {table && <p className="text-sm text-primary font-sans mt-1 font-medium">{t('table')} {table}</p>}

        {cardPaid ? (
          <p className="mt-4 text-sm font-sans font-semibold text-primary flex items-center justify-center gap-2"><CheckCircle className="w-4 h-4" /> {t('payment_received')}</p>
        ) : cardComingSoon ? (
          <div className="mt-6 p-4 rounded-2xl border border-accent/20 bg-accent/5 text-left">
            <p className="font-sans font-semibold text-foreground text-sm flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-accent" /> {t('card_coming_soon_title')}
            </p>
            <p className="text-xs text-muted-foreground font-sans mt-1.5 leading-relaxed">{t('card_coming_soon_body')}</p>
            {waiterCalled ? (
              <p className="mt-3 text-sm font-sans font-medium text-primary flex items-center gap-2"><CheckCircle className="w-4 h-4" /> {t('waiter_on_the_way')}</p>
            ) : (
              <Button onClick={onCallWaiter} className="mt-3 w-full rounded-full bg-primary text-primary-foreground hover:bg-sage-dark font-sans gap-2">
                <Hand className="w-4 h-4" /> {t('call_waiter_to_pay')}
              </Button>
            )}
          </div>
        ) : (
          <p className="mt-4 text-sm font-sans font-medium text-primary flex items-center justify-center gap-2"><Hand className="w-4 h-4" /> {t('waiter_on_the_way')}</p>
        )}

        <Button
          onClick={onContinue}
          variant={cardComingSoon ? 'outline' : 'default'}
          className={`mt-6 rounded-full px-8 h-12 font-sans font-semibold ${cardComingSoon ? '' : 'bg-primary text-primary-foreground hover:bg-sage-dark'}`}
        >
          {t('order_more')}
        </Button>
      </motion.div>
    </div>
  );
};

const CartPage = () => {
  const navigate = useNavigate();
  useSessionHeartbeat();
  const [searchParams] = useSearchParams();
  const { items, total, updateQuantity, removeItem, clearCart, sessionId, sessionToken, guestName, setLastOrderTime, itemCount } = useCartStore();
  const [submitting, setSubmitting] = useState<PayMethod | null>(null);
  const [orderPlaced, setOrderPlaced] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [cardComingSoon, setCardComingSoon] = useState(false);
  const [cardPaid, setCardPaid] = useState(false);
  const [waiterCalled, setWaiterCalled] = useState(false);
  const [cardSession, setCardSession] = useState<{ clientSecret: string; authenticityToken: string; environment: 'test' | 'production'; total: number } | null>(null);
  const submittingRef = useRef(false);
  const t = useT();
  const locale = useLanguageStore((s) => s.locale);
  const displayTotal = useCountUp(total());

  const table = searchParams.get('table');
  const token = searchParams.get('token');

  const buildMenuUrl = () => {
    const params = new URLSearchParams();
    if (table) params.set('table', table);
    if (token) params.set('token', token);
    return `/menu?${params.toString()}`;
  };

  const isLargeOrder = itemCount() > LARGE_ORDER_THRESHOLD;

  const handleCheckoutClick = () => {
    setCheckoutOpen(true);
  };

  // Signal a waiter to the table (best-effort — the anti-spam trigger may
  // reject if one is already pending, which is fine: a waiter is coming).
  const pingWaiter = async () => {
    if (!sessionId || !sessionToken) return;
    await callWaiter(sessionId, sessionToken, 'pay').catch((err) => {
      console.warn('Waiter call was not inserted, likely already pending', err);
    });
    setWaiterCalled(true);
  };

  const placeOrder = async (method: PayMethod, tip = 0) => {
    if (submittingRef.current) return;
    if (!sessionId || !sessionToken) {
      toast.error(t('scan_qr_again'));
      return;
    }
    if (items.length === 0) return;

    submittingRef.current = true;
    setSubmitting(method);
    try {
      // Refresh the heartbeat first so an active table isn't rejected by the
      // server's 2-minute staleness guard on the orders trigger.
      const isActive = await touchSession(sessionId, sessionToken);
      if (!isActive) {
        toast.error(t('session_expired'));
        return;
      }

      const order = await placeGuestOrder(
        sessionId,
        sessionToken,
        guestName,
        method,
        items.map((item) => ({
          menu_item_id: item.menuItemId ?? item.id,
          quantity: item.quantity,
          notes: item.notes || null,
        })),
        tip,
      );

      setLastOrderTime();
      setCardComingSoon(false);
      setWaiterCalled(false);

      if (method === 'cash') {
        // Signal a waiter to come to the table (resilient + ignores the
        // anti-spam trigger if a call is already pending — one is coming).
        await pingWaiter();
      } else {
        const res = await startCardPayment({
          id: order.order_id,
          total: Number(order.total),
          sessionId,
          sessionToken,
        });
        if (res.status === 'redirect') { window.location.href = res.url; return; }
        if (res.status === 'error') throw new Error(res.message);
        if (res.status === 'monri_components' && cardPaymentEnabled) {
          // Order is placed (payment pending). Collect the card in the secure
          // Monri form; the webhook confirms 'paid' server-side.
          clearCart();
          setCheckoutOpen(false);
          setCardSession({
            clientSecret: res.clientSecret,
            authenticityToken: res.authenticityToken,
            environment: res.environment,
            total: Number(order.total),
          });
          return;
        }
        // Monri disabled / not ready → graceful placeholder.
        setCardComingSoon(true);
      }

      setCheckoutOpen(false);
      setOrderPlaced(true);
      clearCart();
      toast.success(t('order_confirmed'));
    } catch (err: unknown) {
      console.error('Order error:', err);
      // Surface the actual reason (e.g. server rate-limit / session guard)
      // instead of a generic message, so failures are actionable.
      toast.error(err instanceof Error ? err.message : 'Failed to place order. Please try again.');
    } finally {
      submittingRef.current = false;
      setSubmitting(null);
    }
  };

  if (orderPlaced) {
    return (
      <OrderSuccess
        table={table}
        cardComingSoon={cardComingSoon}
        cardPaid={cardPaid}
        waiterCalled={waiterCalled}
        onCallWaiter={pingWaiter}
        onContinue={() => {
          setOrderPlaced(false);
          setCardPaid(false);
          setCardComingSoon(false);
          navigate(buildMenuUrl());
        }}
      />
    );
  }

  return (
    <div className="min-h-screen bg-background pb-32">
      <div className="sticky top-0 z-30 glass">
        <div className="flex items-center gap-3 px-4 py-4">
          <button onClick={() => navigate(-1)} aria-label={t('back_to_menu')} className="p-2.5 -ml-2 rounded-full hover:bg-muted transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center">
            <ArrowLeft className={`w-5 h-5 text-foreground ${locale === 'ar' ? 'rotate-180' : ''}`} />
          </button>
          <h1 className="font-serif text-xl font-semibold text-foreground">{t('your_order')}</h1>
          {table && (
            <span className="ml-auto text-xs font-sans px-3 py-1 rounded-full bg-primary/10 text-primary font-medium">
              {t('table')} {table}
            </span>
          )}
        </div>
        <div className="h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent" />
      </div>

      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 px-6">
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
            <ShoppingBag className="w-7 h-7 text-muted-foreground" />
          </div>
          <p className="text-foreground font-serif text-lg font-semibold">{t('order_empty')}</p>
          <p className="text-muted-foreground font-sans text-sm mt-1 text-center">{t('browse_menu_to_add')}</p>
          <Button onClick={() => navigate(-1)} variant="outline" className="mt-6 rounded-full px-6 font-sans">
            {t('back_to_menu')}
          </Button>
        </div>
      ) : (
        <>
          <motion.div
            variants={staggerContainer(0.04)}
            initial="hidden"
            animate="show"
            className="px-4 pt-4 space-y-3"
          >
            {items.map((item) => (
              <motion.div
                key={item.id}
                variants={fadeUp}
                className="flex gap-4 p-4 card-lux"
              >
                {item.image_url && (
                  <SmartImage
                    src={item.image_url}
                    id={item.id}
                    alt={item.name}
                    width={64}
                    height={64}
                    wrapperClassName="w-16 h-16 rounded-lg flex-shrink-0"
                  />
                )}
                <div className="flex-1 min-w-0">
                  <h3 className="font-serif text-base font-semibold text-foreground">{item.name}</h3>
                  {item.notes && (
                    <p className="text-xs text-muted-foreground mt-0.5 italic">"{item.notes}"</p>
                  )}
                  <p className="text-sm font-sans font-bold text-primary mt-1 tabular-nums">
                    {(item.price * item.quantity).toFixed(2)} KM
                  </p>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <button
                    onClick={() => removeItem(item.id)}
                    className="text-muted-foreground hover:text-destructive transition-colors p-1.5 min-w-[44px] min-h-[44px] flex items-center justify-center"
                    aria-label={`Remove ${item.name}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                  <div className="flex items-center gap-2 bg-muted rounded-full px-1.5 py-0.5">
                    <button
                      onClick={() => updateQuantity(item.id, item.quantity - 1)}
                      aria-label={`Decrease ${item.name} quantity`}
                      className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-card transition-colors tap-sm"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <span className="text-sm font-sans font-semibold w-5 text-center tabular-nums">{item.quantity}</span>
                    <button
                      onClick={() => updateQuantity(item.id, item.quantity + 1)}
                      aria-label={`Increase ${item.name} quantity`}
                      className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-card transition-colors tap-sm"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </motion.div>
            ))}
          </motion.div>

          <div className="px-4 mt-6 space-y-3">
            {isLargeOrder && (
              <div className="p-3 rounded-xl border border-accent/20 bg-accent/5 flex items-center gap-3">
                <UtensilsCrossed className="w-4 h-4 text-accent flex-shrink-0" />
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

          <div className="fixed bottom-0 left-0 right-0 z-40 p-4 pb-safe bg-background/80 backdrop-blur-xl border-t border-border/50">
            <Button
              onClick={handleCheckoutClick}
              disabled={!sessionId || !sessionToken}
              className="w-full h-14 rounded-2xl bg-primary text-primary-foreground font-sans font-semibold text-base hover:bg-sage-dark hover:shadow-lg hover:shadow-primary/30 disabled:opacity-50 transition-all duration-200 tap"
            >
              <span className="flex items-center gap-2">
                <CreditCard className="w-4 h-4" />
                {t('checkout')} · {displayTotal.toFixed(2)} KM
              </span>
            </Button>
            {(!sessionId || !sessionToken) && (
              <p className="text-xs text-destructive text-center mt-2 font-sans">{t('scan_qr_again')}</p>
            )}
          </div>

          {/* Checkout — Pay now / Call waiter */}
          <CheckoutSheet
            open={checkoutOpen}
            total={total()}
            submitting={submitting}
            onChoose={placeOrder}
            onClose={() => setCheckoutOpen(false)}
          />
        </>
      )}

      {/* Secure card form (Monri) — overlays even after the cart is cleared */}
      {cardSession && (
        <MonriCardForm
          open
          clientSecret={cardSession.clientSecret}
          authenticityToken={cardSession.authenticityToken}
          environment={cardSession.environment}
          amountLabel={`${cardSession.total.toFixed(2)} KM`}
          onSuccess={() => {
            setCardSession(null);
            setCardPaid(true);
            setCardComingSoon(false);
            setWaiterCalled(false);
            setOrderPlaced(true);
          }}
          onCancel={() => {
            // Order is placed but unpaid — show the pay-at-table fallback.
            setCardSession(null);
            setCardComingSoon(true);
            setOrderPlaced(true);
          }}
        />
      )}
    </div>
  );
};

export default CartPage;
