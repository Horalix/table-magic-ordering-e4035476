import { useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import { duration, easeEnter, springSuccess } from '@/lib/motion';
import { useVenue } from '@/hooks/useVenue';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useT } from '@/lib/i18n';
import BrandEmblem from '@/components/BrandEmblem';

interface Props {
  /** May be async; the button stays disabled until it settles. */
  onSubmit: (name: string) => void | Promise<void>;
  /** The table the guest scanned, said back to them: "Casa Demo · Table 5". */
  table?: string;
}

const GuestNameModal = ({ onSubmit, table }: Props) => {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  // A double tap on Continue used to start two table sessions.
  const [busy, setBusy] = useState(false);
  const t = useT();
  const venue = useVenue();
  const reduced = useReducedMotion();

  const handleSubmit = async () => {
    if (busy) return;
    const trimmed = name.trim();
    if (!trimmed || trimmed.length < 1) {
      setError(t('name_required'));
      return;
    }
    if (trimmed.length > 50) {
      setError(t('name_too_long'));
      return;
    }
    setBusy(true);
    try {
      await onSubmit(trimmed);
    } finally {
      setBusy(false);
    }
  };

  const ready = name.trim().length > 0;
  const rise = (step: number) => ({
    initial: reduced ? false : { opacity: 0, y: 10 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: duration.slow, ease: easeEnter, delay: 0.12 + step * 0.06 },
  });

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 pb-[12vh]">
      <div className="w-full max-w-sm text-center">
        <motion.div
          initial={reduced ? false : { scale: 0.7, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={springSuccess}
          className="mx-auto mb-7 w-20 h-20 rounded-[1.4rem] bg-card grid place-items-center shadow-[0_1px_2px_rgba(0,0,0,0.05),0_18px_40px_-18px_rgba(0,0,0,0.3)] ring-1 ring-border/50"
        >
          {/* Brand dark on the light dialog: the old white artwork vanished here. */}
          <BrandEmblem className="w-14 h-14" />
        </motion.div>

        <motion.p {...rise(0)} className="text-[11px] font-sans font-semibold uppercase tracking-[0.22em] rtl:tracking-normal text-muted-foreground">
          {venue.name}{table ? ` · ${t('table_n', { n: table })}` : ''}
        </motion.p>
        <motion.h2 {...rise(1)} className="mt-3 font-serif text-[2rem] leading-tight tracking-tight font-bold text-foreground">{t('welcome')}</motion.h2>
        <motion.p {...rise(2)} className="text-muted-foreground font-sans text-[15px] mt-1.5">{t('enter_your_name')}</motion.p>

        <motion.div {...rise(3)} className="mt-8 space-y-3">
          <Input
            aria-label={t('enter_your_name')}
            placeholder={t('name_placeholder')}
            value={name}
            onChange={(e) => { setName(e.target.value); setError(''); }}
            onKeyDown={(e) => { if (e.key === 'Enter') void handleSubmit(); }}
            className="text-center text-lg h-14 rounded-2xl bg-card border-border/80 shadow-sm focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-0"
            maxLength={50}
            autoFocus
            autoComplete="given-name"
            enterKeyHint="go"
          />
          {error && <p className="text-xs text-destructive font-sans" role="alert">{error}</p>}
          <Button
            onClick={handleSubmit}
            aria-disabled={!ready || busy}
            className={`w-full h-14 rounded-2xl bg-primary text-primary-foreground font-sans font-semibold text-base gap-2 transition-all duration-200 hover:bg-sage-dark active:scale-[0.98] ${ready ? 'shadow-[0_12px_28px_-14px_hsl(var(--primary)/0.8)]' : 'opacity-60'}`}
          >
            {t('continue')}
            <ArrowRight className={`w-4 h-4 rtl:rotate-180 transition-transform duration-200 ${ready ? 'translate-x-0' : '-translate-x-0.5'}`} aria-hidden />
          </Button>
        </motion.div>
      </div>
    </div>
  );
};

export default GuestNameModal;
