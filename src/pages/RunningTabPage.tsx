import React, { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, Clock, CheckCircle, ChefHat, Utensils, Receipt, CreditCard, Loader2, Users } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useCartStore } from '@/lib/cart-store';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { useT, useLanguageStore, getLocalizedName, useI18n } from '@/lib/i18n';
import ReviewPrompt from '@/components/guest/ReviewPrompt';
import { useSessionHeartbeat } from '@/hooks/useSessionHeartbeat';
import { staggerContainer, fadeUp, useCountUp } from '@/lib/motion';
import { getGuestTab, requestBill as requestGuestBill } from '@/lib/guest-api';
import SplitBillSheet from '@/components/guest/SplitBillSheet';
import OrderStatusTimeline from '@/components/guest/OrderStatusTimeline';
import OrderEta from '@/components/guest/OrderEta';
import CartSuggestion from '@/components/guest/CartSuggestion';
import { track } from '@/lib/analytics';
import { parseComponents } from '@/lib/order-components';
import { menuHome } from '@/lib/venues';

const RunningTabPage = () => {
  const navigate = useNavigate();
  useSessionHeartbeat();
  const [searchParams] = useSearchParams();
  const { sessionId, sessionToken, guestName } = useCartStore();
  const [requestingBill, setRequestingBill] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [splitOpen, setSplitOpen] = useState(false);
  const billRequestRef = useRef(false);
  const t = useT();
  const { price, plural, list } = useI18n();
  const locale = useLanguageStore((s) => s.locale);

  const table = searchParams.get('table');
  const token = searchParams.get('token');

  const statusConfig: Record<string, { icon: React.ReactNode; label: string; color: string }> = {
    pending: { icon: <Clock className="w-3.5 h-3.5" />, label: t('status_pending'), color: 'bg-accent/10 text-accent' },
    confirmed: { icon: <CheckCircle className="w-3.5 h-3.5" />, label: t('status_confirmed'), color: 'bg-primary/10 text-primary' },
    preparing: { icon: <ChefHat className="w-3.5 h-3.5" />, label: t('status_preparing'), color: 'bg-accent/10 text-accent' },
    ready: { icon: <CheckCircle className="w-3.5 h-3.5" />, label: t('status_ready'), color: 'bg-primary/10 text-primary' },
    served: { icon: <Utensils className="w-3.5 h-3.5" />, label: t('status_served'), color: 'bg-muted text-muted-foreground' },
    cancelled: { icon: <Clock className="w-3.5 h-3.5" />, label: t('status_cancelled'), color: 'bg-destructive/10 text-destructive' },
  };

  const { data: tab, isLoading, refetch } = useQuery({
    queryKey: ['guest-tab', sessionId, sessionToken],
    queryFn: async () => {
      if (!sessionId || !sessionToken) throw new Error('Missing session');
      return getGuestTab(sessionId, sessionToken);
    },
    enabled: !!sessionId && !!sessionToken,
    // Polling, not realtime: guests are anonymous and RLS gives anon no read
    // access to orders, so postgres_changes would never deliver to them. Fast
    // while something is still on its way (a stage change shows within ~5 s),
    // slow once everything has been served.
    refetchInterval: (query) => {
      const live = (query.state.data?.orders ?? []).some(
        (o) => !['served', 'cancelled', 'awaiting_payment', 'payment_failed'].includes(o.status),
      );
      return live ? 5_000 : 20_000;
    },
  });

  const orders = tab?.orders ?? [];
  const existingBillRequest = tab?.bill_request ?? null;
  const members = tab?.members ?? [];

  // What the table actually owes. guest_get_tab returns cancelled orders (so
  // the guest can see what happened to them) and abandoned card attempts;
  // adding those in overcharged the running total and both ways of splitting.
  const billable = orders.filter((o) => !['cancelled', 'awaiting_payment', 'payment_failed'].includes(o.status));
  const grandTotal = billable.reduce((sum, o) => sum + Number(o.total), 0);
  const displayGrandTotal = useCountUp(grandTotal);

  // Most-recent still-in-progress order, for the live status tracker.
  const activeOrder = [...orders]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .find((o) => o.status !== 'served' && o.status !== 'cancelled');

  const goBack = () => {
    const params = new URLSearchParams();
    if (table) params.set('table', table);
    if (token) params.set('token', token);
    navigate(menuHome(params));
  };

  // Restaurant time, 24-hour: "01:45 AM" read as a foreign app in Sarajevo.
  const formatTime = (dateStr: string) =>
    new Date(dateStr).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Europe/Sarajevo' });
  const panel = 'rounded-3xl bg-card border border-border/70 shadow-[0_1px_2px_rgba(20,30,25,0.04)]';

  const getWaitTime = (createdAt: string, status: string) => {
    if (status === 'served' || status === 'cancelled') return null;
    const mins = Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000);
    if (mins < 1) return t('just_now');
    if (mins < 60) return plural('minutes_count', mins);
    return t('hours_minutes', { h: Math.floor(mins / 60), m: mins % 60 });
  };

  const requestBill = async () => {
    if (!sessionId || !sessionToken || billRequestRef.current || existingBillRequest) return;
    billRequestRef.current = true;
    setRequestingBill(true);
    try {
      await requestGuestBill(sessionId, sessionToken);
      track('bill_requested', { orders: orders.length });
      await refetch();
      setShowReview(true);
    } catch {
      toast.error(t('bill_request_failed'));
    } finally {
      billRequestRef.current = false;
      setRequestingBill(false);
    }
  };

  const billRequested = !!existingBillRequest;
  /** At least one order has actually reached the table. */
  const hasServedFood = orders.some((o) => o.status === 'served' || o.status === 'ready');

  /*
   * When the after-meal prompt is actually welcome.
   *
   * `hasServedFood` fired the instant anything reached the table, which could
   * mean offering dessert alongside the starters. The server knows whether a
   * MAIN was served and how long ago, and the interval is a setting a manager
   * can tune — too soon reads as rushing the table out.
   */
  const { data: afterMeal = false } = useQuery({
    queryKey: ['after-meal-moment', sessionId],
    queryFn: async () => {
      if (!sessionId) return false;
      const { data, error } = await supabase.rpc('after_meal_moment' as never, { _session_id: sessionId } as never);
      return error ? false : Boolean(data);
    },
    enabled: !!sessionId && hasServedFood,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  // Once per visit to the tab, after it has loaded: firing on every change of
  // the order count counted an empty tab and then the real one.
  const tabTracked = React.useRef(false);
  React.useEffect(() => {
    if (isLoading || tabTracked.current) return;
    tabTracked.current = true;
    track('tab_viewed', { orders: orders.length });
  }, [isLoading, orders.length]);

  return (
    <div className="min-h-screen bg-background pb-36">
      <div className="sticky top-0 z-30 glass">
        <div className="flex items-center gap-1 ps-2 pe-4 h-14">
          <button onClick={goBack} aria-label={t('back_to_menu')} className="w-11 h-11 rounded-full hover:bg-muted transition-colors flex items-center justify-center">
            <ArrowLeft className="w-5 h-5 text-foreground rtl:rotate-180" aria-hidden />
          </button>
          <h1 className="flex-1 font-serif text-[22px] font-semibold text-foreground tracking-tight ps-1">{t('your_tab')}</h1>
          {table && (
            <span className="text-xs font-sans px-3 py-1.5 rounded-full bg-primary/10 text-primary font-semibold">
              {t('table_n', { n: table })}
            </span>
          )}
        </div>
        <div className="h-px bg-border/70" />
      </div>

      {!sessionId || !sessionToken ? (
        <div className="flex flex-col items-center justify-center py-20 px-6">
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
            <Receipt className="w-7 h-7 text-muted-foreground" aria-hidden />
          </div>
          <p className="text-foreground font-serif text-lg font-semibold">{t('no_active_session')}</p>
          <p className="text-muted-foreground font-sans text-sm mt-1 text-center">{t('scan_qr_tab')}</p>
        </div>
      ) : isLoading ? (
        <div className="px-4 pt-4 space-y-4">
          <Skeleton className="h-28 w-full rounded-3xl" />
          <Skeleton className="h-40 w-full rounded-3xl" />
        </div>
      ) : orders.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 px-6">
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
            <Receipt className="w-7 h-7 text-muted-foreground" aria-hidden />
          </div>
          <p className="text-foreground font-serif text-lg font-semibold">{t('no_orders_yet')}</p>
          <p className="text-muted-foreground font-sans text-sm mt-1 text-center">{t('browse_menu_start')}</p>
          <Button onClick={goBack} className="mt-6 rounded-full px-6 min-h-[48px] font-sans">{t('back_to_menu')}</Button>
        </div>
      ) : (
        <>
          {/* What the table owes, first and largest: it is the question the
              tab exists to answer. */}
          <motion.section variants={fadeUp} initial="hidden" animate="show" className={`${panel} mx-4 mt-4 p-5`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-sans text-muted-foreground">{billRequested ? t('bill_requested') : t('to_pay')}</p>
                <p className="font-sans text-[34px] leading-tight font-semibold text-foreground tabular-nums">{price(displayGrandTotal)}</p>
                <p className="text-sm font-sans text-muted-foreground mt-0.5">
                  {plural('orders_count', billable.length)}
                  {members.length > 0 && <> · {list(members)}</>}
                </p>
              </div>
              <button
                onClick={() => setSplitOpen(true)}
                className="shrink-0 inline-flex items-center gap-1.5 px-3.5 min-h-[44px] rounded-full border border-border text-sm font-sans font-medium text-foreground hover:bg-muted transition-colors"
              >
                <Users className="w-4 h-4" aria-hidden /> {t('split_bill')}
              </button>
            </div>
            {billRequested && (
              <p className="mt-3 flex items-center gap-2 text-sm font-sans text-primary">
                <CheckCircle className="w-4 h-4" aria-hidden /> {t('server_notified')}
              </p>
            )}
          </motion.section>

          {activeOrder && (
            <motion.section variants={fadeUp} initial="hidden" animate="show" className={`${panel} mx-4 mt-3 p-4`}>
              <div className="flex items-baseline justify-between gap-3 mb-3 flex-wrap">
                <p className="text-sm font-sans font-semibold text-foreground">
                  {t('order_progress')}
                </p>
                {/* Renders nothing at all when the kitchen has no basis for
                    an estimate — silence beats a number nobody can stand behind. */}
                <OrderEta orderId={activeOrder.id} active={activeOrder.status !== 'served'} />
              </div>
              {activeOrder.held && (
                <p className="text-sm font-sans text-accent mb-2 flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5" aria-hidden /> {t('waiting_for_waiter_confirm')}
                </p>
              )}
              {/* "Received" began when the order was placed; later stages have no
                  server timestamp in guest_get_tab, so the timeline times them
                  from when this screen saw them change. */}
              <OrderStatusTimeline
                status={activeOrder.status}
                changedAt={['pending', 'confirmed'].includes(activeOrder.status) ? activeOrder.created_at : null}
                held={activeOrder.held === true}
              />
            </motion.section>
          )}

          {/* Post-meal suggestion. Only once food has actually been served and
              only while the guest has not asked for the bill — offering coffee
              to someone who is trying to leave is the definition of pushy. */}
          {afterMeal && !billRequested && <CartSuggestion placement="after_meal" />}
          {/* While the food is coming: a drink for a table that ordered none.
              The server shows nothing once the table has a drink. */}
          {!afterMeal && !billRequested && <CartSuggestion placement="tab" />}

          {/* Every order, newest first, as one receipt. */}
          <motion.section
            variants={staggerContainer(0.05)}
            initial="hidden"
            animate="show"
            className={`${panel} mx-4 mt-3 divide-y divide-border/70 overflow-hidden`}
            aria-label={t('your_tab')}
          >
            {orders.map((order) => {
              // A held order is `pending` too, but "Pending" would suggest the
              // kitchen has it. It is waiting for the waiter, and says so.
              const status = order.held
                ? { icon: <Clock className="w-3.5 h-3.5" aria-hidden />, label: t('waiting_for_waiter_confirm'), color: 'bg-accent/10 text-accent' }
                : statusConfig[order.status] || statusConfig.pending;
              const items = order.order_items || [];
              const waitTime = getWaitTime(order.created_at, order.status);
              const cancelled = order.status === 'cancelled';

              return (
                <motion.div key={order.id} variants={fadeUp} className={`px-4 py-4 ${cancelled ? 'opacity-60' : ''}`}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 flex-wrap min-w-0">
                      <span className="text-sm font-sans font-semibold text-foreground tabular-nums">{formatTime(order.created_at)}</span>
                      <span className={`inline-flex items-center gap-1 text-xs font-sans font-semibold px-2.5 py-1 rounded-full ${status.color}`}>
                        {status.icon}
                        {status.label}
                      </span>
                      {waitTime && <span className="text-xs font-sans text-muted-foreground">{waitTime}</span>}
                      {order.payment_method === 'card_online' && (
                        <span className={`inline-flex items-center gap-1 text-xs font-sans font-semibold px-2 py-0.5 rounded-full ${order.payment_status === 'paid' ? 'bg-primary/10 text-primary' : 'bg-accent/10 text-accent'}`}>
                          <CreditCard className="w-3 h-3" aria-hidden />
                          {order.payment_status === 'paid' ? t('paid') : t('card_pending')}
                        </span>
                      )}
                    </div>
                    <span className={`text-[15px] font-sans font-semibold text-foreground tabular-nums shrink-0 ${cancelled ? 'line-through' : ''}`}>{price(Number(order.total))}</span>
                  </div>
                  <ul className="mt-2.5 space-y-1.5">
                    {items.map((oi) => (
                      <li key={oi.id} className="flex justify-between items-baseline gap-3">
                        <span className="text-[15px] font-sans text-foreground">
                          <span className="text-muted-foreground tabular-nums me-1.5">{oi.quantity}×</span>
                          {oi.menu_items ? getLocalizedName(oi.menu_items, locale) : t('menu_item_fallback')}
                          {/* What a combo contained (20261026100100 adds it to the tab). */}
                          {parseComponents(oi.components).length > 0 && (
                            <span className="block text-[13px] text-muted-foreground leading-snug">
                              {list(parseComponents(oi.components).map((c) => getLocalizedName(c, locale)))}
                            </span>
                          )}
                        </span>
                        <span className="text-sm font-sans text-muted-foreground tabular-nums shrink-0">{(oi.quantity * Number(oi.unit_price)).toFixed(2)}</span>
                      </li>
                    ))}
                  </ul>
                </motion.div>
              );
            })}
          </motion.section>

          {/* The two things a seated guest does from here, where a thumb is. */}
          <div className="fixed bottom-0 inset-x-0 z-40 px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] bg-background/85 backdrop-blur-xl border-t border-border/60">
            <div className="flex gap-2 max-w-lg mx-auto">
              <Button onClick={goBack} variant="outline" className="flex-1 h-14 rounded-2xl font-sans font-semibold text-base gap-2 bg-card">
                <Utensils className="w-4 h-4" aria-hidden /> {t('order_more')}
              </Button>
              {billRequested ? (
                <div className="flex-1 h-14 rounded-2xl bg-primary/10 text-primary font-sans font-semibold flex items-center justify-center gap-2">
                  <CheckCircle className="w-4 h-4" aria-hidden /> {t('bill_requested')}
                </div>
              ) : (
                <Button onClick={requestBill} disabled={requestingBill} className="flex-1 h-14 rounded-2xl font-sans font-semibold text-base gap-2 bg-primary hover:bg-sage-dark">
                  {requestingBill ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <Receipt className="w-4 h-4" aria-hidden />}
                  {requestingBill ? t('requesting') : t('request_bill')}
                </Button>
              )}
            </div>
          </div>
        </>
      )}


      {sessionId && sessionToken && (
        <ReviewPrompt
          open={showReview}
          onClose={() => {
            setShowReview(false);
            toast.success(t('server_notified'));
          }}
          sessionId={sessionId}
          sessionToken={sessionToken}
        />
      )}

      <SplitBillSheet
        open={splitOpen}
        total={grandTotal}
        orders={billable.map((o) => ({ guest_name: o.guest_name, total: Number(o.total) }))}
        members={members}
        myName={guestName}
        billRequested={billRequested}
        requesting={requestingBill}
        onSettle={() => { setSplitOpen(false); void requestBill(); }}
        onClose={() => setSplitOpen(false)}
      />
    </div>
  );
};

export default RunningTabPage;
