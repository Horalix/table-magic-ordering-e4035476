import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CreditCard, Hand, Loader2, ChevronRight } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { fade, sheetUp } from '@/lib/motion';

export type PayMethod = 'card' | 'cash';

interface Props {
  open: boolean;
  total: number;
  submitting: PayMethod | null;
  onChoose: (method: PayMethod) => void;
  onClose: () => void;
}

/** Checkout choice — Pay now (card) or Call a waiter. Both send the order. */
const CheckoutSheet = ({ open, total, submitting, onChoose, onClose }: Props) => {
  const t = useT();
  return (
    <AnimatePresence>
      {open && (
        <motion.div variants={fade} initial="hidden" animate="show" exit="exit" className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-foreground/40 backdrop-blur-sm" onClick={submitting ? undefined : onClose} />
          <motion.div
            variants={sheetUp}
            initial="hidden"
            animate="show"
            exit="exit"
            className="relative w-full max-w-lg bg-card rounded-t-3xl sm:rounded-3xl p-6 shadow-lux-lg"
          >
            <div className="w-10 h-1.5 rounded-full bg-foreground/15 mx-auto mb-4 sm:hidden" />
            <h2 className="font-serif text-xl font-bold text-foreground text-center">{t('choose_how_to_pay')}</h2>
            <p className="text-center text-3xl font-serif font-bold text-primary mt-2 tabular-nums">{total.toFixed(2)} KM</p>
            <p className="text-center text-xs text-muted-foreground font-sans mt-1.5">{t('no_refund_short')}</p>

            <div className="mt-6 space-y-3">
              {/* Pay now — card (primary) */}
              <button
                onClick={() => onChoose('card')}
                disabled={!!submitting}
                className="w-full flex items-center gap-3 px-5 py-4 rounded-2xl bg-primary text-primary-foreground text-left min-h-[64px] hover:bg-sage-dark transition-colors disabled:opacity-60 tap"
              >
                <CreditCard className="w-6 h-6 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="font-sans font-semibold">{t('pay_now_card')}</p>
                  <p className="text-xs text-primary-foreground/70">{t('pay_now_card_sub')}</p>
                </div>
                {submitting === 'card' ? <Loader2 className="w-5 h-5 animate-spin" /> : <ChevronRight className="w-5 h-5 opacity-70" />}
              </button>

              {/* Call a waiter (secondary) */}
              <button
                onClick={() => onChoose('cash')}
                disabled={!!submitting}
                className="w-full flex items-center gap-3 px-5 py-4 rounded-2xl border border-border bg-card text-foreground text-left min-h-[64px] hover:bg-muted/60 transition-colors disabled:opacity-60 tap"
              >
                <span className="w-10 h-10 rounded-full bg-accent/10 grid place-items-center shrink-0">
                  <Hand className="w-5 h-5 text-accent" />
                </span>
                <div className="flex-1 min-w-0">
                  <p className="font-sans font-semibold">{t('call_waiter_to_pay')}</p>
                  <p className="text-xs text-muted-foreground">{t('call_waiter_to_pay_sub')}</p>
                </div>
                {submitting === 'cash' ? <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /> : <ChevronRight className="w-5 h-5 text-muted-foreground" />}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default CheckoutSheet;
