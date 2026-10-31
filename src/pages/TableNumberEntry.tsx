import React, { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, AlertTriangle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n';
import { useCartStore } from '@/lib/cart-store';
import { checkVenueToken, type VenueTokenCheck } from '@/lib/guest-api';
import { prefersReducedMotion, duration, easeEnter } from '@/lib/motion';
import { VENUES, menuPath } from '@/lib/venues';
import { useVenue } from '@/hooks/useVenue';

/**
 * Single-QR entry.
 *
 * La Soul prints one code for the room. The guest tells us which table they are
 * sitting at, every visit — they will not be in the same seat next time, and a
 * remembered table number is a wrong kitchen ticket waiting to happen.
 *
 * The token is validated before we ask anything, so a guest who scanned an old
 * printed code is told immediately instead of typing a number and then failing.
 */
const TableNumberEntry = () => {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const t = useT();
  // An installed app (start_url /menu) or a reload has no query string, so
  // "Change table" from there carries no token. The one this device scanned
  // last is still the venue's code; fall back to it instead of declaring the
  // QR expired.
  const storedToken = useCartStore((s) => s.qrToken);
  const token = params.get('token') ?? storedToken;
  const storedTable = useCartStore((s) => s.tableNumber);
  const leaveTable = useCartStore((s) => s.leaveTable);

  const [value, setValue] = useState('');
  const [check, setCheck] = useState<VenueTokenCheck | null>(null);
  const [phase, setPhase] = useState<'checking' | 'ready' | 'invalid'>('checking');
  const reduced = prefersReducedMotion();

  useEffect(() => {
    if (!token) { setPhase('invalid'); return; }
    let cancelled = false;
    checkVenueToken(token)
      .then((result) => {
        if (cancelled) return;
        setCheck(result);
        setPhase(result.valid ? 'ready' : 'invalid');
      })
      .catch(() => { if (!cancelled) setPhase('invalid'); });
    return () => { cancelled = true; };
  }, [token]);

  const max = check?.max_table_number ?? null;
  // The room code names its restaurant: browsing goes to that menu.
  const browse = () => navigate(menuPath(check?.venue && VENUES[check.venue] ? check.venue : undefined));
  // And it wears that restaurant's colours: La Soul's sage, Vera Italia's walnut evening.
  const pageVenue = useVenue();
  const brand = (check?.venue && VENUES[check.venue]) || pageVenue;
  const vera = brand.slug === 'veraitalia';
  const bg = { backgroundColor: vera ? 'hsl(24, 24%, 11%)' : 'hsl(140, 12%, 53%)' };
  const onLight = vera ? 'text-[hsl(24,24%,11%)]' : 'text-primary';
  const parsed = Number.parseInt(value, 10);
  const outOfRange = Number.isInteger(parsed) && max !== null && (parsed < 1 || parsed > max);
  const canSubmit = Number.isInteger(parsed) && parsed > 0 && !outOfRange;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || !token) return;
    // A different table is a new visit. The same table (a guest rescanning
    // mid-meal) keeps the session, so an unsent cart is not wiped.
    if (storedTable !== parsed) leaveTable();
    navigate(`/table/${parsed}?${new URLSearchParams({ token }).toString()}`);
  };

  if (phase === 'checking') {
    return (
      <div className="min-h-screen flex items-center justify-center" style={bg}>
        <Loader2 className="w-7 h-7 animate-spin text-white/80" aria-hidden />
        <span className="sr-only">{t('setting_up_table')}</span>
      </div>
    );
  }

  if (phase === 'invalid') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6" style={bg}>
        <div className="w-full max-w-sm text-center">
          <div className="w-16 h-16 rounded-full bg-white/15 grid place-items-center mx-auto mb-5">
            <AlertTriangle className="w-8 h-8 text-white" aria-hidden />
          </div>
          <h1 className="font-serif text-2xl font-bold text-white">{t('qr_expired')}</h1>
          <Button
            onClick={browse}
            className={`mt-6 w-full h-12 rounded-2xl bg-white ${onLight} hover:bg-white/90 font-sans font-semibold`}
          >
            {t('browse_menu')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6" style={bg}>
      <motion.div
        initial={reduced ? false : { opacity: 0, y: 12 }}
        animate={reduced ? undefined : { opacity: 1, y: 0 }}
        transition={{ duration: duration.emphasis, ease: easeEnter }}
        className="w-full max-w-sm text-center"
      >
        {vera
          ? <img src="/brand/vera/lockup-cream.webp" alt="Vera Italia" width={1158} height={806} className="w-60 max-w-[70vw] h-auto mx-auto mb-9" />
          : <img src="/brand/lockup-white.webp" alt="La Soul" width={645} height={960} className="h-40 w-auto mx-auto mb-7" />}
        <h1 className="font-serif text-2xl font-bold text-white">{t('which_table')}</h1>
        <p className="text-white/70 font-sans text-sm mt-2 leading-relaxed">{t('which_table_sub')}</p>

        {check && !check.ordering_enabled && (
          <div className="mt-5 rounded-2xl bg-white/10 border border-white/20 p-3.5" role="status">
            <p className="text-sm font-sans text-white">
              {check.paused_message || t('ordering_paused_body')}
            </p>
          </div>
        )}

        <form onSubmit={submit} className="mt-8 space-y-3">
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={max ?? undefined}
            value={value}
            autoFocus
            onChange={(e) => setValue(e.target.value)}
            placeholder={t('table_number_placeholder')}
            aria-label={t('table_number_placeholder')}
            aria-invalid={outOfRange}
            aria-describedby={outOfRange ? 'table-range-error' : undefined}
            className="w-full h-16 text-center text-3xl font-sans font-semibold rounded-2xl bg-white/95 text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-4 focus:ring-white/30 tabular-nums"
          />
          {outOfRange && (
            <p id="table-range-error" className="text-sm font-sans text-white/90" role="alert">
              {t('table_number_range').replace('{max}', String(max))}
            </p>
          )}
          <Button
            type="submit"
            disabled={!canSubmit}
            className={`w-full h-14 rounded-2xl bg-white ${onLight} hover:bg-white/90 disabled:opacity-50 font-sans font-semibold text-base gap-2`}
          >
            {t('continue')} <ArrowRight className="w-4 h-4 rtl:rotate-180" aria-hidden />
          </Button>
        </form>

        <button onClick={browse} className="mt-4 px-4 min-h-[44px] text-sm text-white/80 underline underline-offset-4 font-sans">
          {t('browse_menu')}
        </button>
      </motion.div>
    </div>
  );
};

export default TableNumberEntry;
