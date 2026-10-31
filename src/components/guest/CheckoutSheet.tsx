import React, { useCallback, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CreditCard, Banknote, Loader2, ChevronRight, ShieldCheck, Smartphone } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useT, useI18n } from '@/lib/i18n';
import { fade, sheetUp } from '@/lib/motion';
import { useDialog } from '@/lib/use-dialog';
import { TIP_CHOICES, computeTip, type TipChoice } from '@/lib/tip';
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
 * Checkout: how to pay, and — only for online card payment — a tip.
 *
 * The three options are deliberately distinct. "Card at the table" is not the
 * same as "card online" — it tells the waiter to bring the terminal, and it
 * reconciles against the POS batch rather than the online gateway.
 *
 * No tip before service: the tip row belongs to the card option alone. Cash
 * and the terminal are paid after the meal, in person, and send no tip.
 * "No tip" is the neutral default; no percentage is ever preselected.
 *
 * When online card payment is off, CartPage sends the order in one tap and
 * this sheet never opens.
 */
const CheckoutSheet = ({ open, total, submitting, onlineCardEnabled, payAtTableEnabled, onChoose, onClose }: Props) => {
  const t = useT();
  const { price } = useI18n();
  const [choice, setChoice] = useState<TipChoice>(0);
  const busy = submitting !== null;
  // Nothing closes the sheet while an order is on its way to the server.
  const safeClose = useCallback(() => { if (!busy) onClose(); }, [busy, onClose]);
  // role=dialog, focus trap, Escape, scroll lock, focus restore, Back closes.
  const { dialogProps } = useDialog({ open, onClose: safeClose, label: t('choose_how_to_pay') });

  const tip = onlineCardEnabled ? computeTip(total, choice, 0) : 0;
  const grand = total + tip;

  const tipLabel = (c: (typeof TIP_CHOICES)[number]) =>
    c === 0 ? t('no_tip') : c === 'round' ? t('tip_round_up') : t('percent_n', { n: c });

  return (
    <AnimatePresence>
      {open && (
        <motion.div variants={fade} initial="hidden" animate="show" exit="exit" className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-foreground/40 backdrop-blur-sm" onClick={safeClose} />
          <motion.div
            variants={sheetUp}
            initial="hidden"
            animate="show"
            exit="exit"
            className="relative w-full max-w-lg bg-card rounded-t-3xl sm:rounded-3xl p-6 pb-safe sm:pb-6 shadow-lux-lg outline-none max-h-[92vh] overflow-y-auto"
            {...dialogProps}
          >
            <div className="w-10 h-1.5 rounded-full bg-foreground/15 mx-auto mb-4 sm:hidden" />
            <h2 className="font-serif text-[22px] font-semibold text-foreground">{t('choose_how_to_pay')}</h2>

            {onlineCardEnabled && (
              <div className="mt-4">
                {/* Tip — card only, nothing preselected, skipping is one tap. */}
                <p id="tip-label" className="text-sm text-muted-foreground font-sans mb-2">{t('tip_for_card')}</p>
                {/* "No tip" gets the widest slot: in Bosnian it is the longest label. */}
                <div className="grid grid-cols-[1.5fr_1.4fr_1fr_1fr] gap-1.5" role="group" aria-labelledby="tip-label">
                  {TIP_CHOICES.map((c) => (
                    <button
                      key={String(c)}
                      onClick={() => setChoice(c)}
                      aria-pressed={choice === c}
                      className={`min-h-[44px] px-1 leading-tight rounded-xl text-[13px] font-sans font-semibold transition-colors tap-sm ${choice === c ? 'bg-foreground text-background' : 'bg-muted text-foreground hover:bg-muted/70'}`}
                    >
                      {tipLabel(c)}
                    </button>
                  ))}
                </div>

                {/* Totals — itemised so nothing is a surprise. */}
                <div className="mt-4 rounded-2xl bg-muted/50 p-3.5 space-y-1.5" aria-live="polite">
                  <div className="flex justify-between text-sm font-sans text-muted-foreground tabular-nums">
                    <span>{t('subtotal')}</span><span>{price(total)}</span>
                  </div>
                  {tip > 0 && (
                    <div className="flex justify-between text-sm font-sans text-muted-foreground tabular-nums">
                      <span>{t('tip')}</span><span>{price(tip)}</span>
                    </div>
                  )}
                  <div className="flex justify-between items-baseline pt-1.5 border-t border-border/60">
                    <span className="font-sans font-semibold text-foreground">{t('total')}</span>
                    <span className="text-2xl font-sans font-semibold text-foreground tabular-nums">{price(grand)}</span>
                  </div>
                </div>

                <div className="mt-4">
                  <PayOption
                    primary
                    icon={<CreditCard className="w-5 h-5" />}
                    title={t('pay_now_card')}
                    subtitle={t('pay_online_sub')}
                    busy={submitting === 'card_online'}
                    disabled={busy}
                    onClick={() => onChoose('card_online', tip)}
                  />
                </div>
                <p className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground font-sans mt-3">
                  <ShieldCheck className="w-3.5 h-3.5" aria-hidden /> {t('secure_payment_monri')}
                </p>
              </div>
            )}

            {payAtTableEnabled && (
              <div className="mt-5">
                {onlineCardEnabled ? (
                  <p className="text-sm text-muted-foreground font-sans mb-2">{t('or_pay_at_table')}</p>
                ) : (
                  <div className="mb-4 rounded-2xl bg-muted/50 p-3.5 flex justify-between items-baseline">
                    <span className="font-sans font-semibold text-foreground">{t('total')}</span>
                    <span className="text-2xl font-sans font-semibold text-foreground tabular-nums">{price(total)}</span>
                  </div>
                )}
                <div className="space-y-3">
                  {/* Paid in person after the meal: no tip here. */}
                  <PayOption
                    primary={!onlineCardEnabled}
                    icon={<Banknote className={`w-5 h-5 ${onlineCardEnabled ? 'text-accent' : ''}`} />}
                    title={t('pay_cash')}
                    subtitle={t('pay_cash_sub')}
                    busy={submitting === 'cash'}
                    disabled={busy}
                    onClick={() => onChoose('cash', 0)}
                  />
                  <PayOption
                    icon={<Smartphone className="w-5 h-5 text-accent" />}
                    title={t('pay_pos')}
                    subtitle={t('pay_pos_sub')}
                    busy={submitting === 'pos_terminal'}
                    disabled={busy}
                    onClick={() => onChoose('pos_terminal', 0)}
                  />
                </div>
              </div>
            )}

            <p className="text-[11px] text-muted-foreground/80 font-sans mt-3 text-center leading-relaxed">
              {t('terms_accept')}{' '}
              <Link to="/privacy/" className="underline hover:text-primary">{t('terms_link')}</Link>.
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default CheckoutSheet;
