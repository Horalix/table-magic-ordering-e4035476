import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Minus, Plus, Users, Loader2, ReceiptText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n';
import { fade, sheetUp } from '@/lib/motion';

interface Props {
  open: boolean;
  total: number;
  orders: { guest_name: string | null; total: number }[];
  members: string[];
  myName: string | null;
  billRequested: boolean;
  requesting: boolean;
  onSettle: () => void;
  onClose: () => void;
}

const km = (n: number) => `${n.toFixed(2)} KM`;

const SplitBillSheet = ({ open, total, orders, members, myName, billRequested, requesting, onSettle, onClose }: Props) => {
  const t = useT();
  const [mode, setMode] = useState<'even' | 'person'>('even');
  const [n, setN] = useState(Math.max(1, members.length || 1));

  // Per-person subtotals from who placed each order.
  const perPerson = useMemo(() => {
    const map = new Map<string, number>();
    for (const o of orders) {
      const key = o.guest_name?.trim() || t('new_guest');
      map.set(key, (map.get(key) ?? 0) + Number(o.total));
    }
    return [...map.entries()].map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount);
  }, [orders, t]);

  const evenShare = total / Math.max(1, n);
  const myShare = myName ? perPerson.find((p) => p.name === myName)?.amount ?? 0 : 0;

  return (
    <AnimatePresence>
      {open && (
        <motion.div variants={fade} initial="hidden" animate="show" exit="exit" className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-foreground/40 backdrop-blur-sm" onClick={onClose} />
          <motion.div variants={sheetUp} initial="hidden" animate="show" exit="exit" className="relative w-full max-w-lg bg-card rounded-t-3xl sm:rounded-3xl p-6 pb-safe sm:pb-6 shadow-lux-lg max-h-[88vh] overflow-y-auto">
            <div className="w-10 h-1.5 rounded-full bg-foreground/15 mx-auto mb-4 sm:hidden" />
            <h2 className="font-serif text-xl font-bold text-foreground text-center flex items-center justify-center gap-2">
              <ReceiptText className="w-5 h-5 text-primary" /> {t('split_bill')}
            </h2>
            <p className="text-center text-2xl font-serif font-bold text-primary mt-1 tabular-nums">{km(total)}</p>

            {/* Mode toggle */}
            <div className="mt-4 grid grid-cols-2 gap-2 p-1 rounded-full bg-muted">
              {(['even', 'person'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`py-2 rounded-full text-sm font-sans font-medium transition-colors ${mode === m ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'}`}
                >
                  {m === 'even' ? t('split_evenly') : t('split_by_person')}
                </button>
              ))}
            </div>

            {mode === 'even' ? (
              <div className="mt-5 text-center">
                <div className="flex items-center justify-center gap-4">
                  <button onClick={() => setN((v) => Math.max(1, v - 1))} className="w-11 h-11 rounded-full bg-muted grid place-items-center tap-sm" aria-label="Fewer people"><Minus className="w-5 h-5" /></button>
                  <div>
                    <p className="font-serif text-2xl font-bold text-foreground tabular-nums">{n}</p>
                    <p className="text-[11px] text-muted-foreground font-sans flex items-center gap-1 justify-center"><Users className="w-3 h-3" />{t('people')}</p>
                  </div>
                  <button onClick={() => setN((v) => Math.min(20, v + 1))} className="w-11 h-11 rounded-full bg-muted grid place-items-center tap-sm" aria-label="More people"><Plus className="w-5 h-5" /></button>
                </div>
                <div className="mt-5 rounded-2xl bg-primary/5 border border-primary/15 py-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground font-sans">{t('each_pays')}</p>
                  <p className="font-serif text-3xl font-bold text-primary tabular-nums mt-0.5">{km(evenShare)}</p>
                </div>
              </div>
            ) : (
              <div className="mt-5 space-y-2">
                {perPerson.map((p) => {
                  const mine = !!myName && p.name === myName;
                  return (
                    <div key={p.name} className={`flex items-center justify-between px-4 py-3 rounded-xl border ${mine ? 'border-primary/40 bg-primary/5' : 'border-border'}`}>
                      <span className="font-sans text-sm font-medium text-foreground truncate">
                        {p.name}{mine && <span className="text-primary"> · {t('your_share')}</span>}
                      </span>
                      <span className="font-serif font-bold text-foreground tabular-nums">{km(p.amount)}</span>
                    </div>
                  );
                })}
                {myName && myShare > 0 && (
                  <p className="text-center text-xs text-muted-foreground font-sans pt-1">{t('your_share')}: <span className="font-semibold text-primary">{km(myShare)}</span></p>
                )}
              </div>
            )}

            <p className="text-center text-xs text-muted-foreground font-sans mt-5">{t('split_hint')}</p>

            {!billRequested && (
              <Button onClick={onSettle} disabled={requesting} className="mt-3 w-full h-12 rounded-2xl bg-primary text-primary-foreground hover:bg-sage-dark font-sans font-semibold tap">
                {requesting ? <Loader2 className="w-4 h-4 animate-spin" /> : t('settle_with_waiter')}
              </Button>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default SplitBillSheet;
