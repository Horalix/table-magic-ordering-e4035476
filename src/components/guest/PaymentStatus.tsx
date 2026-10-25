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

/**
 * The "order sent" moment: the circle springs in (0.6 → 1, the one bounce the
 * app allows itself) and the check draws itself. Reduced motion: both simply
 * appear.
 */
const SuccessMark = () => {
  const reduced = useReducedMotion();
  return (
    <motion.div
      initial={reduced ? false : { scale: 0.6, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={springSuccess}
      className="w-16 h-16 mx-auto rounded-full bg-primary/10 grid place-items-center"
    >
      <svg viewBox="0 0 24 24" className="w-8 h-8 text-primary" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <motion.path
          d="M5.5 12.5l4.25 4.25L18.5 7.75"
          initial={reduced ? false : { pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: duration.draw, ease: easeEnter, delay: duration.fast }}
        />
      </svg>
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
      <h2 className="font-serif text-2xl font-bold text-foreground mt-5">
        {payLater && held ? t('order_received_title') : payLater ? t('order_sent_title') : t('payment_received_title')}
      </h2>
      <p className="text-muted-foreground font-sans mt-2 text-sm leading-relaxed">
        {payLater && held ? t('order_waiter_will_confirm')
          : payLater ? t('pay_waiter_when_ready') : released ? t('order_in_kitchen_now') : t('order_sent_kitchen')}
      </p>
      <p className="text-xl font-sans font-semibold text-foreground mt-3 tabular-nums">
        {payLater && <span className="text-sm font-sans font-normal text-muted-foreground me-2">{t('to_pay')}</span>}
        {amountLabel}
      </p>
      <OrderCode code={orderCode} />
      {(tableNumber || (orderId && !held)) && (
        <div className="mt-4 flex flex-col items-center gap-1">
          {/* Silent when the kitchen has no basis for an estimate. */}
          {orderId && !held && <OrderEta orderId={orderId} />}
          {tableNumber && <p className="text-sm font-sans text-muted-foreground">{t('bring_to_table_n', { n: tableNumber })}</p>}
        </div>
      )}
      <div className="mt-6 space-y-2.5">
        {onTrackOrder && (
          <Button onClick={onTrackOrder} className="w-full h-12 rounded-2xl bg-primary text-primary-foreground hover:bg-sage-dark font-sans font-semibold">
            {t('track_order')}
          </Button>
        )}
        {onContinue && (
          <Button onClick={onContinue} variant="outline" className="w-full h-12 rounded-2xl font-sans font-semibold">
            {t('order_more')}
          </Button>
        )}
      </div>
    </>,
  );
};

export default PaymentStatus;
