import React from 'react';
import { motion } from 'framer-motion';
import { CheckCircle2, Clock, AlertTriangle, Loader2, Hand, CreditCard, UtensilsCrossed } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n';
import { prefersReducedMotion } from '@/lib/motion';

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
      <span className="font-semibold tabular-nums tracking-wider">{code}</span>
    </p>
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
  phase, orderCode, amountLabel, released, onRetryCard, onPayAtTable, onContinue, onTrackOrder, busy,
}: Props) => {
  const t = useT();
  const reduced = prefersReducedMotion();

  const shell = (children: React.ReactNode) => (
    <div className="min-h-screen bg-background flex items-center justify-center px-6">
      <motion.div
        initial={reduced ? false : { opacity: 0, y: 8 }}
        animate={reduced ? undefined : { opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
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
        <p className="text-lg font-serif font-semibold text-foreground mt-3 tabular-nums">{amountLabel}</p>
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

  // received
  return shell(
    <>
      <div className="w-16 h-16 mx-auto rounded-full bg-primary/10 grid place-items-center">
        <CheckCircle2 className="w-8 h-8 text-primary" aria-hidden />
      </div>
      <h2 className="font-serif text-2xl font-bold text-foreground mt-5">{t('payment_received_title')}</h2>
      <p className="text-muted-foreground font-sans mt-2 text-sm">
        {released ? t('order_in_kitchen_now') : t('order_sent_kitchen')}
      </p>
      <p className="text-lg font-serif font-semibold text-foreground mt-3 tabular-nums">{amountLabel}</p>
      <OrderCode code={orderCode} />
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
