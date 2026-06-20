import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CreditCard, Hand, Loader2, ChevronRight } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { fade, sheetUp } from '@/lib/motion';
import { Input } from '@/components/ui/input';
import { TIP_PRESETS, computeTip } from '@/lib/tip';

export type PayMethod = 'card' | 'cash';

interface Props {
  open: boolean;
  total: number;
  submitting: PayMethod | null;
  onChoose: (method: PayMethod, tip: number) => void;
  onClose: () => void;
}

/** Checkout choice — optional tip, then Pay now (card) or Call a waiter. */
const CheckoutSheet = ({ open, total, submitting, onChoose, onClose }: Props) => {
  const t = useT();
  const [preset, setPreset] = useState<number | 'custom'>(0);
  const [custom, setCustom] = useState('');

  const tip = computeTip(total, preset, parseFloat(custom) || 0);
  const grand = total + tip;

  return (
    <AnimatePresence>
      {open && (
        <motion.div variants={fade} initial="hidden" animate="show" exit="exit" className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-foreground/40 backdrop-blur-sm" onClick={submitting ? undefined : onClose} />
          <motion.div variants={sheetUp} initial="hidden" animate="show" exit="exit" className="relative w-full max-w-lg bg-card rounded-t-3xl sm:rounded-3xl p-6 shadow-lux-lg">
            <div className="w-10 h-1.5 rounded-full bg-foreground/15 mx-auto mb-4 sm:hidden" />
            <h2 className="font-serif text-xl font-bold text-foreground text-center">{t('choose_how_to_pay')}</h2>

            {/* Tip */}
            <div className="mt-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground font-sans mb-2 text-center">{t('add_a_tip')}</p>
              <div className="flex flex-wrap gap-2 justify-center">
                {TIP_PRESETS.map((p) => (
                  <button
                    key={p}
                    onClick={() => setPreset(p)}
                    className={`px-3.5 py-2 rounded-full text-sm font-sans font-medium transition-all tap-sm ${preset === p ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground hover:bg-muted/70'}`}
                  >
                    {p === 0 ? t('no_tip') : `${p}%`}
                  </button>
                ))}
                <button
                  onClick={() => setPreset('custom')}
                  className={`px-3.5 py-2 rounded-full text-sm font-sans font-medium transition-all tap-sm ${preset === 'custom' ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground hover:bg-muted/70'}`}
                >
                  {t('custom')}
                </button>
              </div>
              {preset === 'custom' && (
                <div className="mt-2 flex items-center justify-center gap-2">
                  <Input type="number" inputMode="decimal" min="0" step="0.5" value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="0.00" className="h-9 w-28 text-center" />
                  <span className="text-sm text-muted-foreground font-sans">KM</span>
                </div>
              )}
            </div>

            {/* Totals */}
            <div className="mt-4 text-center">
              {tip > 0 && (
                <p className="text-xs text-muted-foreground font-sans tabular-nums">
                  {total.toFixed(2)} + {tip.toFixed(2)} {t('tip').toLowerCase()}
                </p>
              )}
              <p className="text-3xl font-serif font-bold text-primary mt-0.5 tabular-nums">{grand.toFixed(2)} KM</p>
              <p className="text-[11px] text-muted-foreground font-sans mt-1.5">{t('no_refund_short')}</p>
            </div>

            <div className="mt-5 space-y-3">
              <button
                onClick={() => onChoose('card', tip)}
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

              <button
                onClick={() => onChoose('cash', tip)}
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
