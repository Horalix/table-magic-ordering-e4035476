import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CreditCard, Loader2, ShieldCheck, Hand } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useT, useLanguageStore } from '@/lib/i18n';
import { fade, sheetUp } from '@/lib/motion';

/**
 * Minimal typings for Monri's browser Components SDK (no official types).
 * Loaded from components.js; card data is entered in Monri-hosted fields, so
 * it never touches our code/backend (PCI-friendly). See
 * docs/monri-payments-architecture.md.
 */
interface MonriCard { mount(selector: string): void; unmount?(): void }
interface MonriComponents { create(type: string, options?: Record<string, unknown>): MonriCard }
interface MonriConfirmResult {
  error?: { message?: string } | null;
  result?: { status?: string; 'response-message'?: string } | null;
  status?: string;
}
interface MonriInstance {
  components(opts: { clientSecret: string }): MonriComponents;
  confirmPayment(card: MonriCard, data?: Record<string, unknown>): Promise<MonriConfirmResult>;
}
type MonriFactory = (authenticityToken: string, options?: Record<string, unknown>) => MonriInstance;
declare global { interface Window { Monri?: MonriFactory } }

const sdkUrl = (env: 'test' | 'production') =>
  env === 'production' ? 'https://ipg.monri.com/dist/components.js' : 'https://ipgtest.monri.com/dist/components.js';

function loadMonriSdk(env: 'test' | 'production'): Promise<MonriFactory> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') return reject(new Error('No window'));
    if (window.Monri) return resolve(window.Monri);
    const src = sdkUrl(env);
    const done = () => (window.Monri ? resolve(window.Monri) : reject(new Error('Monri SDK unavailable')));
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
    if (existing) {
      existing.addEventListener('load', done, { once: true });
      existing.addEventListener('error', () => reject(new Error('Failed to load Monri SDK')), { once: true });
      if (window.Monri) done();
      return;
    }
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = done;
    s.onerror = () => reject(new Error('Failed to load Monri SDK'));
    document.head.appendChild(s);
  });
}

const CARD_ELEMENT_ID = 'monri-card-element';

export interface MonriCardFormProps {
  open: boolean;
  clientSecret: string;
  authenticityToken: string;
  environment: 'test' | 'production';
  amountLabel: string;
  onSuccess: () => void;
  /** Give up on card payment (close) — caller should offer the call-waiter fallback. */
  onCancel: () => void;
}

/**
 * Renders Monri's hosted card field and confirms the payment. The order is
 * already created (payment pending); the webhook is the source of truth that
 * flips it to 'paid'. On approval we optimistically show success.
 */
const MonriCardForm = ({ open, clientSecret, authenticityToken, environment, amountLabel, onSuccess, onCancel }: MonriCardFormProps) => {
  const t = useT();
  const locale = useLanguageStore((s) => s.locale);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'submitting'>('loading');
  const [error, setError] = useState<string | null>(null);
  const monriRef = useRef<MonriInstance | null>(null);
  const cardRef = useRef<MonriCard | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setPhase('loading');
    setError(null);
    (async () => {
      try {
        const Monri = await loadMonriSdk(environment);
        if (cancelled) return;
        const monri = Monri(authenticityToken, { locale: locale === 'ar' ? 'en' : locale });
        const components = monri.components({ clientSecret });
        const card = components.create('card', {});
        // Mount on next frame so the element exists in the DOM.
        requestAnimationFrame(() => {
          if (cancelled) return;
          try {
            card.mount(`#${CARD_ELEMENT_ID}`);
            monriRef.current = monri;
            cardRef.current = card;
            setPhase('ready');
          } catch (e) {
            setError(e instanceof Error ? e.message : t('payment_failed'));
            setPhase('ready');
          }
        });
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : t('payment_failed'));
          setPhase('ready');
        }
      }
    })();
    return () => {
      cancelled = true;
      try { cardRef.current?.unmount?.(); } catch { /* no-op */ }
      cardRef.current = null;
      monriRef.current = null;
    };
  }, [open, environment, authenticityToken, clientSecret, locale, t]);

  const pay = async () => {
    if (!monriRef.current || !cardRef.current) return;
    setError(null);
    setPhase('submitting');
    try {
      const res = await monriRef.current.confirmPayment(cardRef.current, {});
      const status = (res.result?.status || res.status || '').toLowerCase();
      if (res.error) {
        setError(res.error.message || t('payment_failed'));
        setPhase('ready');
        return;
      }
      if (status === 'approved') {
        onSuccess();
        return;
      }
      // declined / authentication failed / anything else
      setError(res.result?.['response-message'] || t('payment_declined'));
      setPhase('ready');
    } catch (e) {
      setError(e instanceof Error ? e.message : t('payment_failed'));
      setPhase('ready');
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div variants={fade} initial="hidden" animate="show" exit="exit" className="fixed inset-0 z-[55] flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-foreground/40 backdrop-blur-sm" onClick={phase === 'submitting' ? undefined : onCancel} />
          <motion.div variants={sheetUp} initial="hidden" animate="show" exit="exit" className="relative w-full max-w-lg bg-card rounded-t-3xl sm:rounded-3xl p-6 shadow-lux-lg">
            <div className="w-10 h-1.5 rounded-full bg-foreground/15 mx-auto mb-4 sm:hidden" />
            <div className="flex items-center justify-center gap-2 text-foreground">
              <CreditCard className="w-5 h-5 text-primary" />
              <h2 className="font-serif text-xl font-bold">{t('pay_by_card')}</h2>
            </div>
            <p className="text-center text-2xl font-serif font-bold text-primary mt-2 tabular-nums">{amountLabel}</p>

            <div className="mt-5 rounded-xl border border-border bg-background p-3 min-h-[52px] relative">
              {phase === 'loading' && (
                <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
                  <Loader2 className="w-5 h-5 animate-spin" />
                </div>
              )}
              {/* Monri mounts the hosted card field here */}
              <div id={CARD_ELEMENT_ID} />
            </div>

            {error && <p className="text-sm text-destructive font-sans mt-3 text-center">{error}</p>}

            <p className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground font-sans mt-4">
              <ShieldCheck className="w-3.5 h-3.5" /> {t('secure_payment_monri')}
            </p>

            <Button
              onClick={pay}
              disabled={phase !== 'ready'}
              className="mt-4 w-full h-12 rounded-2xl bg-primary text-primary-foreground hover:bg-sage-dark font-sans font-semibold tap"
            >
              {phase === 'submitting'
                ? <span className="flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> {t('paying')}</span>
                : `${t('pay_now_card')} · ${amountLabel}`}
            </Button>
            <Button onClick={onCancel} variant="ghost" disabled={phase === 'submitting'} className="mt-2 w-full rounded-2xl font-sans text-muted-foreground gap-2">
              <Hand className="w-4 h-4" /> {t('call_waiter_to_pay')}
            </Button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default MonriCardForm;
