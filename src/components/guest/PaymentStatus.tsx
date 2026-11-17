import React, { useEffect } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Clock, AlertTriangle, Loader2, Hand, CreditCard, UtensilsCrossed } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n';
import { duration, easeEnter, springSuccess } from '@/lib/motion';
import { haptic } from '@/lib/haptics';
import OrderEta from '@/components/guest/OrderEta';

export type PaymentPhase =
  /** Card form is open / SDK is working. */
  | 'collecting'
  /** SDK finished; we are waiting for our own server to confirm. */
  | 'confirming'
  /** Server confirmed the money arrived. */
  | 'received'
  /** Server says the payment did not go through. */
  | 'failed'
  /** No answer within the window — never shown as success or failure. */
  | 'delayed';

interface Props {
  phase: PaymentPhase;
  orderCode: string | null;
  amountLabel: string;
  /** Present once the order is with the kitchen. */
  released?: boolean;
  /**
   * The order was sent to be paid at the table (cash or terminal), so nothing
   * has been paid yet. Saying "Payment received" here told guests they had
   * paid when they had not, and some left without paying.
   */
  payLater?: boolean;
  /**
   * A pay-at-table order that waits for the waiter before it prints. Said as
   * a normal step, never as a suspicion: nearly every one is a real guest.
   */
  held?: boolean;
  /** The order, for its ETA once it is with the kitchen. */
  orderId?: string | null;
  /** Where the food is going: "We'll bring it to table 7." */
  tableNumber?: string | null;
  onRetryCard?: () => void;
  onPayAtTable?: () => void;
  onContinue?: () => void;
  onTrackOrder?: () => void;
  busy?: boolean;
}

const OrderCode = ({ code }: { code: string | null }) => {
  const t = useT();
  if (!code) return null;
  return (
    <p className="mt-3 inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-muted text-foreground font-sans text-sm">
      <span className="text-muted-foreground">{t('order_number')}</span>
      <span dir="ltr" className="font-semibold tabular-nums tracking-wider">{code}</span>
    </p>
  );
};

/** Where the sparks of the success mark fly to: eight, evenly round, alternating near and far. */
const SPARKS = Array.from({ length: 8 }, (_, i) => {
  const angle = (i / 8) * Math.PI * 2 - Math.PI / 2;
  const reach = i % 2 ? 50 : 60;
  return { x: Math.cos(angle) * reach, y: Math.sin(angle) * reach, accent: i % 2 === 1 };
});

/**
 * The "order sent" moment: the circle springs in (0.6 → 1, the one bounce the
 * app allows itself), two rings ripple out of it once, a few sparks fly off,
 * and the check draws itself. Reduced motion: the circle and check simply
 * appear.
 */
const SuccessMark = () => {
  const reduced = useReducedMotion();
  return (
    <div className="relative w-20 h-20 mx-auto">
      {!reduced && (
        <>
          {[0, 0.18].map((delay) => (
            <motion.span
              key={delay}
              aria-hidden
              className="absolute inset-0 rounded-full border-2 border-primary/40"
              initial={{ scale: 0.8, opacity: 0.9 }}
              animate={{ scale: 2, opacity: 0 }}
              transition={{ duration: 1.1, delay: 0.12 + delay, ease: easeEnter }}
            />
          ))}
          {SPARKS.map((spark, i) => (
            <motion.span
              key={i}
              aria-hidden
              className={`absolute left-1/2 top-1/2 -ml-1 -mt-1 h-2 w-2 rounded-full ${spark.accent ? 'bg-accent' : 'bg-primary/70'}`}
              initial={{ x: 0, y: 0, scale: 0, opacity: 1 }}
              animate={{ x: spark.x, y: spark.y, scale: [0, 1, 0.4], opacity: [1, 1, 0] }}
              transition={{ duration: 0.75, delay: 0.16, ease: easeEnter }}
            />
          ))}
        </>
      )}
      <motion.div
        initial={reduced ? false : { scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={springSuccess}
        className="relative w-20 h-20 rounded-full bg-primary grid place-items-center shadow-[0_14px_34px_-12px_hsl(var(--primary)/0.65)]"
      >
        <svg viewBox="0 0 24 24" className="w-10 h-10 text-primary-foreground" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <motion.path
            d="M5.5 12.5l4.25 4.25L18.5 7.75"
            initial={reduced ? false : { pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: duration.draw, ease: easeEnter, delay: duration.fast }}
          />
        </svg>
      </motion.div>
    </div>
  );
};

/** The lines under the success mark arrive one after another, once the mark has landed. */
const Rise = ({ children, step, className }: { children: React.ReactNode; step: number; className?: string }) => {
  const reduced = useReducedMotion();
  return (
    <motion.div
      initial={reduced ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: duration.slow, ease: easeEnter, delay: 0.28 + step * 0.07 }}
      className={className}
    >
      {children}
    </motion.div>
  );
};

/**
 * The guest-facing payment result.
 *
 * The one rule this component exists to keep: it renders "received" only when
 * the caller passes a phase derived from server state. A card terminal saying
 * "approved" in the browser is not enough, and a slow confirmation is shown as
 * "still confirming — do not pay again", never as failure.
 */
const PaymentStatus = ({
  phase, orderCode, amountLabel, released, payLater, held, orderId, tableNumber, onRetryCard, onPayAtTable, onContinue, onTrackOrder, busy,
}: Props) => {
  const t = useT();
  const reduced = useReducedMotion();

  // Felt, not just seen: the order arrived, or the card did not go through.
  useEffect(() => {
    if (phase === 'received') haptic('success');
    else if (phase === 'failed') haptic('error');
  }, [phase]);

  const shell = (children: React.ReactNode) => (
    <div className="min-h-screen bg-background flex items-center justify-center px-6">
      <motion.div
        initial={reduced ? false : { opacity: 0, y: 8 }}
        animate={reduced ? undefined : { opacity: 1, y: 0 }}
        transition={{ duration: duration.base, ease: easeEnter }}
        className="text-center max-w-sm w-full"
        role="status"
        aria-live="polite"
      >
        {children}
      </motion.div>
    </div>
  );

  if (phase === 'confirming' || phase === 'collecting') {
    return shell(
      <>
        <div className="w-16 h-16 mx-auto rounded-full bg-primary/10 grid place-items-center">
          <Loader2 className="w-7 h-7 text-primary animate-spin" aria-hidden />
        </div>
        <h2 className="font-serif text-2xl font-bold text-foreground mt-5">{t('payment_confirming_title')}</h2>
        <p className="text-muted-foreground font-sans mt-2 text-sm leading-relaxed">{t('payment_confirming_body')}</p>
        <p className="text-xl font-sans font-semibold text-foreground mt-3 tabular-nums">{amountLabel}</p>
        <OrderCode code={orderCode} />
      </>,
    );
  }

  if (phase === 'delayed') {
    return shell(
      <>
        <div className="w-16 h-16 mx-auto rounded-full bg-accent/10 grid place-items-center">
          <Clock className="w-7 h-7 text-accent" aria-hidden />
        </div>
        <h2 className="font-serif text-2xl font-bold text-foreground mt-5">{t('payment_delayed_title')}</h2>
        <p className="text-muted-foreground font-sans mt-2 text-sm leading-relaxed">{t('payment_delayed_body')}</p>
        <OrderCode code={orderCode} />
        <div className="mt-6 space-y-2">
          {onTrackOrder && (
            <Button onClick={onTrackOrder} className="w-full h-12 rounded-2xl bg-primary text-primary-foreground hover:bg-sage-dark font-sans font-semibold">
              {t('track_order')}
            </Button>
          )}
        </div>
      </>,
    );
  }

  if (phase === 'failed') {
    return shell(
      <>
        <div className="w-16 h-16 mx-auto rounded-full bg-destructive/10 grid place-items-center">
          <AlertTriangle className="w-7 h-7 text-destructive" aria-hidden />
        </div>
        <h2 className="font-serif text-2xl font-bold text-foreground mt-5">{t('payment_declined_title')}</h2>
        <p className="text-muted-foreground font-sans mt-2 text-sm leading-relaxed">{t('payment_declined_body')}</p>
        <p className="text-xs font-sans text-muted-foreground mt-3 inline-flex items-center gap-1.5">
          <UtensilsCrossed className="w-3.5 h-3.5" aria-hidden /> {t('order_not_sent_yet')}
        </p>
        <OrderCode code={orderCode} />
        <div className="mt-6 space-y-2.5">
          {onRetryCard && (
            <Button onClick={onRetryCard} disabled={busy} className="w-full h-12 rounded-2xl bg-primary text-primary-foreground hover:bg-sage-dark font-sans font-semibold gap-2">
              <CreditCard className="w-4 h-4" aria-hidden /> {t('try_card_again')}
            </Button>
          )}
          {onPayAtTable && (
            <Button onClick={onPayAtTable} disabled={busy} variant="outline" className="w-full h-12 rounded-2xl font-sans font-semibold gap-2">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <Hand className="w-4 h-4" aria-hidden />}
              {t('switch_to_pay_at_table')}
            </Button>
          )}
        </div>
      </>,
    );
  }

  // received (including held: it reached the restaurant, the waiter confirms it)
  return shell(
    <>
      <SuccessMark />
      <Rise step={0}>
        <h2 className="font-serif text-[1.75rem] leading-tight tracking-tight font-bold text-foreground mt-7">
          {payLater && held ? t('order_received_title') : payLater ? t('order_sent_title') : t('payment_received_title')}
        </h2>
        <p className="text-muted-foreground font-sans mt-2 text-[15px] leading-relaxed">
          {payLater && held ? t('order_waiter_will_confirm')
            : payLater ? t('pay_waiter_when_ready') : released ? t('order_in_kitchen_now') : t('order_sent_kitchen')}
        </p>
      </Rise>
      {/* The order as a receipt: what it costs, its number, where it is going. */}
      <Rise step={1} className="mt-6 rounded-3xl bg-card text-start shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_32px_-18px_rgba(0,0,0,0.18)] ring-1 ring-border/60">
        <div className="flex items-baseline justify-between gap-4 px-5 pt-4 pb-3.5">
          <span className="text-sm font-sans text-muted-foreground">{payLater ? t('to_pay') : t('total')}</span>
          <span className="text-2xl font-sans font-semibold text-foreground tabular-nums">{amountLabel}</span>
        </div>
        {(orderCode || tableNumber) && (
          <dl className="flex items-start justify-between gap-4 border-t border-dashed border-border px-5 py-3.5 font-sans">
            {orderCode ? (
              <div>
                <dt className="text-xs text-muted-foreground">{t('order_number')}</dt>
                <dd dir="ltr" className="mt-0.5 text-base font-semibold text-foreground tabular-nums tracking-wider">{orderCode}</dd>
              </div>
            ) : <span />}
            {tableNumber && (
              <div className="text-end">
                <dt className="text-xs text-muted-foreground">{t('table')}</dt>
                <dd className="mt-0.5 text-base font-semibold text-foreground tabular-nums">{tableNumber}</dd>
              </div>
            )}
          </dl>
        )}
      </Rise>
      {/* Silent when the kitchen has no basis for an estimate. */}
      {orderId && !held && (
        <Rise step={2} className="mt-4 flex justify-center">
          <OrderEta orderId={orderId} />
        </Rise>
      )}
      <Rise step={3} className="mt-7 space-y-2.5">
        {onTrackOrder && (
          <Button onClick={onTrackOrder} className="w-full h-12 rounded-2xl bg-primary text-primary-foreground hover:bg-sage-dark font-sans font-semibold">
            {t('track_order')}
          </Button>
        )}
        {onContinue && (
          <Button onClick={onContinue} variant="outline" className="w-full h-12 rounded-2xl font-sans font-semibold bg-transparent hover:bg-muted hover:text-foreground">
            {t('order_more')}
          </Button>
        )}
      </Rise>
    </>,
  );
};

export default PaymentStatus;
