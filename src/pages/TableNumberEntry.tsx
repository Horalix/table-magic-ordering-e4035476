import React, { useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n';

/**
 * Single-QR entry: the venue prints one QR pointing here; the guest picks the
 * table they're sitting at, then we hand off to the existing /table/:n flow.
 */
const TableNumberEntry = () => {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const t = useT();
  const token = params.get('token');
  const [value, setValue] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const n = Number.parseInt(value, 10);
    if (!Number.isInteger(n) || n <= 0) return;
    const qp = new URLSearchParams();
    if (token) qp.set('token', token);
    navigate(`/table/${n}?${qp.toString()}`);
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6" style={{ backgroundColor: 'hsl(140, 12%, 53%)' }}>
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }} className="w-full max-w-sm text-center">
        <img src="/lasoul-logo.svg" alt="La Soul" className="w-24 h-24 object-contain brightness-0 invert mx-auto mb-6" />
        <h1 className="font-serif text-2xl font-bold text-white">{t('which_table')}</h1>
        <p className="text-white/70 font-sans text-sm mt-2 leading-relaxed">{t('which_table_sub')}</p>

        <form onSubmit={submit} className="mt-8 space-y-3">
          <input
            type="number"
            inputMode="numeric"
            min={1}
            value={value}
            autoFocus
            onChange={(e) => setValue(e.target.value)}
            placeholder={t('table_number_placeholder')}
            aria-label={t('table_number_placeholder')}
            className="w-full h-16 text-center text-3xl font-serif font-bold rounded-2xl bg-white/95 text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-4 focus:ring-white/30 tabular-nums"
          />
          <Button type="submit" disabled={!value} className="w-full h-14 rounded-2xl bg-white text-primary hover:bg-white/90 disabled:opacity-50 font-sans font-semibold text-base gap-2">
            {t('continue')} <ArrowRight className="w-4 h-4" />
          </Button>
        </form>

        <button onClick={() => navigate('/menu')} className="mt-6 text-xs text-white/60 underline underline-offset-4 font-sans">{t('browse_menu')}</button>
      </motion.div>
    </div>
  );
};

export default TableNumberEntry;
