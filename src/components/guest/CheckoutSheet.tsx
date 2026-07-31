import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CreditCard, Banknote, Loader2, ChevronRight, ShieldCheck, Smartphone } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useT } from '@/lib/i18n';
import { fade, sheetUp } from '@/lib/motion';
import { Input } from '@/components/ui/input';
import { TIP_PRESETS, computeTip } from '@/lib/tip';
import type { PaymentMethod } from '@/lib/guest-api';

interface Props {
  open: boolean;
  total: number;
  submitting: PaymentMethod | null;
  /** Server-side truth about what the restaurant can accept right now. */
  onlineCardEnabled: boolean;
  payAtTableEnabled: boolean;
  onChoose: (method: PaymentMethod, tip: number) => void;
  onClose: () => void;
}

interface OptionProps {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  primary?: boolean;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
}

const PayOption = ({ icon, title, subtitle, primary, busy, disabled, onClick }: OptionProps) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className={`w-full flex items-center gap-3 px-5 py-4 rounded-2xl text-start min-h-[64px] transition-colors disabled:opacity-60 tap ${
      primary
        ? 'bg-primary text-primary-foreground hover:bg-sage-dark'
        : 'border border-border bg-card text-foreground hover:bg-muted/60'
    }`}
  >
    <span className={`w-10 h-10 rounded-full grid place-items-center shrink-0 ${primary ? 'bg-white/15' : 'bg-accent/10'}`}>
      {icon}
    </span>
    <span className="flex-1 min-w-0">
      <span className="block font-sans font-semibold">{title}</span>
      <span className={`block text-xs ${primary ? 'text-primary-foreground/75' : 'text-muted-foreground'}`}>{subtitle}</span>
    </span>
    {busy
      ? <Loader2 className="w-5 h-5 animate-spin" aria-hidden />
      : <ChevronRight className={`w-5 h-5 rtl:rotate-180 ${primary ? 'opacity-70' : 'text-muted-foreground'}`} aria-hidden />}
  </button>
);

/**
 * Checkout: choose a tip, then choose how to pay.
 *
 * The three options are deliberately distinct. "Card at the table" is not the
 * same as "card online" — it tells the waiter to bring the terminal, and it
 * reconciles against the POS batch rather than the online gateway.
 *
 * No tip is preselected.
 */
const CheckoutSheet = ({ open, total, submitting, onlineCardEnabled, payAtTableEnabled, onChoose, onClose }: Props) => {
  const t = useT();
  const [preset, setPreset] = useState<number | 'custom'>(0);
  const [custom, setCustom] = useState('');
  const panelRef = useRef<HTMLDivElement>(null);

  const tip = computeTip(total, preset, parseFloat(custom) || 0);
  const grand = total + tip;
  const busy = submitting !== null;

  // Close on Escape and move focus into the sheet when it opens.
  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div variants={fade} initial="hidden" animate="show" exit="exit" className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-foreground/40 backdrop-blur-sm" onClick={busy ? undefined : onClose} />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={t('choose_how_to_pay')}
            tabIndex={-1}
            variants={sheetUp}
            initial="hidden"
            animate="show"
            exit="exit"
            className="relative w-full max-w-lg bg-card rounded-t-3xl sm:rounded-3xl p-6 pb-safe sm:pb-6 shadow-lux-lg outline-none max-h-[92vh] overflow-y-auto"
          >
            <div className="w-10 h-1.5 rounded-full bg-foreground/15 mx-auto mb-4 sm:hidden" />
            <h2 className="font-serif text-xl font-bold text-foreground text-center">{t('choose_how_to_pay')}</h2>

            {/* Tip — nothing preselected, skipping is one tap. */}
            <div className="mt-4">
              <p id="tip-label" className="text-xs uppercase tracking-wide text-muted-foreground font-sans mb-2 text-center">{t('add_a_tip')}</p>
              <div className="flex flex-wrap gap-2 justify-center" role="group" aria-labelledby="tip-label">
                {TIP_PRESETS.map((p) => (
                  <button
                    key={p}
                    onClick={() => setPreset(p)}
                    aria-pressed={preset === p}
                    className={`px-3.5 py-2 rounded-full text-sm font-sans font-medium transition-all tap-sm ${preset === p ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground hover:bg-muted/70'}`}
                  >
                    {p === 0 ? t('no_tip') : `${p}%`}
                  </button>
                ))}
                <button
                  onClick={() => setPreset('custom')}
                  aria-pressed={preset === 'custom'}
                  className={`px-3.5 py-2 rounded-full text-sm font-sans font-medium transition-all tap-sm ${preset === 'custom' ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground hover:bg-muted/70'}`}
                >
                  {t('custom')}
                </button>
              </div>
              {preset === 'custom' && (
                <div className="mt-2 flex items-center justify-center gap-2">
                  <Input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.5"
                    value={custom}
                    onChange={(e) => setCustom(e.target.value)}
                    placeholder="0.00"
                    aria-label={t('custom')}
                    className="h-9 w-28 text-center"
                  />
                  <span className="text-sm text-muted-foreground font-sans">KM</span>
                </div>
              )}
            </div>

            {/* Totals — itemised so nothing is a surprise. */}
            <div className="mt-4 rounded-2xl bg-muted/50 p-3.5 space-y-1.5" aria-live="polite">
              <div className="flex justify-between text-sm font-sans text-muted-foreground tabular-nums">
                <span>{t('total')}</span><span>{total.toFixed(2)} KM</span>
              </div>
              {tip > 0 && (
                <div className="flex justify-between text-sm font-sans text-muted-foreground tabular-nums">
                  <span>{t('tip')}</span><span>{tip.toFixed(2)} KM</span>
                </div>
              )}
              <div className="flex justify-between items-baseline pt-1.5 border-t border-border/60">
                <span className="font-sans font-semibold text-foreground">{t('total')}</span>
                <span className="text-2xl font-serif font-bold text-primary tabular-nums">{grand.toFixed(2)} KM</span>
              </div>
            </div>

            <div className="mt-5 space-y-3">
              {onlineCardEnabled && (
                <PayOption
                  primary
                  icon={<CreditCard className="w-5 h-5" />}
                  title={t('pay_now_card')}
                  subtitle={t('pay_online_sub')}
                  busy={submitting === 'card_online'}
                  disabled={busy}
                  onClick={() => onChoose('card_online', tip)}
                />
              )}

              {payAtTableEnabled && (
                <>
                  <PayOption
                    primary={!onlineCardEnabled}
                    icon={<Banknote className={`w-5 h-5 ${onlineCardEnabled ? 'text-accent' : ''}`} />}
                    title={t('pay_cash')}
                    subtitle={t('pay_cash_sub')}
                    busy={submitting === 'cash'}
                    disabled={busy}
                    onClick={() => onChoose('cash', tip)}
                  />
                  <PayOption
                    icon={<Smartphone className="w-5 h-5 text-accent" />}
                    title={t('pay_pos')}
                    subtitle={t('pay_pos_sub')}
                    busy={submitting === 'pos_terminal'}
                    disabled={busy}
                    onClick={() => onChoose('pos_terminal', tip)}
                  />
                </>
              )}
            </div>

            {onlineCardEnabled && (
              <p className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground font-sans mt-4">
                <ShieldCheck className="w-3.5 h-3.5" aria-hidden /> {t('secure_payment_monri')}
              </p>
            )}

            <p className="text-[11px] text-muted-foreground/80 font-sans mt-3 text-center leading-relaxed">
              {t('terms_accept')}{' '}
              <Link to="/privacy" className="underline hover:text-primary">{t('terms_link')}</Link>.
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default CheckoutSheet;
