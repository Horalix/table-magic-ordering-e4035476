import React, { useEffect, useState } from 'react';
import { AlertTriangle, TrendingDown, TrendingUp } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  CHANGE_TERM_LABELS, describeSalesChange, signedPct, type SalesDecomposition,
} from '@/lib/reporting';

/**
 * "Why did sales change?" — one sentence, then the parts.
 *
 * The last seven complete trading days against the seven before, and against
 * the same weekdays of the four weeks before that (scaled to one week). The
 * factors come from `sales_decomposition()` and multiply exactly to net
 * sales, so the sentence never has to wave at an unexplained remainder.
 */

const DAYPART_LABEL: Record<string, string> = {
  morning: 'Morning', lunch: 'Lunch', afternoon: 'Afternoon', evening: 'Evening', late: 'Late',
};

async function decompose(args: Record<string, string> = {}): Promise<SalesDecomposition> {
  const { data, error } = await supabase.rpc('sales_decomposition' as never, args as never);
  if (error) throw new Error(error.message);
  if (!data) throw new Error('The server returned nothing.');
  return data as unknown as SalesDecomposition;
}

const shift = (day: string, delta: number) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
};

const range = (from: string, to: string) => {
  const f = (s: string) => new Date(`${s}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return `${f(from)} – ${f(to)}`;
};

const SalesChangeCard = () => {
  const [week, setWeek] = useState<SalesDecomposition | null>(null);
  const [month, setMonth] = useState<SalesDecomposition | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const w = await decompose();
        if (cancelled) return;
        setWeek(w);
        const m = await decompose({
          _from: w.from, _to: w.to, _cmp_from: shift(w.from, -28), _cmp_to: shift(w.from, -1),
        });
        if (!cancelled) setMonth(m);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (error) {
    return (
      <Card className="rounded-2xl border-destructive/30 mb-6">
        <CardContent className="p-4 flex items-start gap-2">
          <AlertTriangle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
          <p className="text-sm font-sans text-muted-foreground break-words">Could not work out why sales changed: {error}</p>
        </CardContent>
      </Card>
    );
  }

  if (!week) return <Skeleton className="h-36 rounded-2xl mb-6" />;

  const change = week.total.comparable ? Math.exp(Number(week.total.dlog ?? 0)) - 1 : null;
  const Icon = change !== null && change < 0 ? TrendingDown : TrendingUp;

  return (
    <Card className="rounded-2xl border-border mb-6" aria-label="Why sales changed">
      <CardContent className="p-4 sm:p-6 space-y-4">
        <div className="flex items-start gap-3">
          <div className={`w-10 h-10 rounded-xl grid place-items-center shrink-0 ${change !== null && change < 0 ? 'bg-destructive/10 text-destructive' : 'bg-primary/10 text-primary'}`}>
            <Icon className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-sans text-muted-foreground">
              Last 7 complete trading days · {range(week.from, week.to)}
            </p>
            <p className="font-sans text-base sm:text-lg font-semibold text-foreground leading-snug mt-0.5">
              {describeSalesChange(week, 'last week')}
            </p>
            {month && (
              <p className="text-sm font-sans text-muted-foreground mt-1 leading-snug">
                {describeSalesChange(month, 'the same days of the 4 weeks before')}
              </p>
            )}
          </div>
        </div>

        {week.total.comparable && (
          <div className="flex flex-wrap gap-2">
            {week.total.terms.map((t) => (
              <span key={t.key} className="inline-flex items-baseline gap-1.5 rounded-full border border-border px-3 py-1 text-xs font-sans">
                <span className="text-muted-foreground">{CHANGE_TERM_LABELS[t.key] ?? t.key}</span>
                <span className={`tabular-nums font-semibold ${Number(t.dlog) < 0 ? 'text-destructive' : 'text-foreground'}`}>
                  {signedPct(Math.exp(Number(t.dlog)) - 1)}
                </span>
              </span>
            ))}
          </div>
        )}

        {week.dayparts.length > 0 && (
          <div className="overflow-x-auto -mx-2 px-2">
            <table className="w-full text-xs font-sans min-w-[320px]">
              <thead>
                <tr className="text-left uppercase tracking-wide text-muted-foreground border-b border-border">
                  <th className="pb-1.5 font-medium">When</th>
                  <th className="pb-1.5 font-medium text-right">Tables</th>
                  <th className="pb-1.5 font-medium text-right">Last week</th>
                  <th className="pb-1.5 font-medium text-right">Net sales</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {week.dayparts.map((p) => (
                  <tr key={p.daypart}>
                    <td className="py-1.5">{DAYPART_LABEL[p.daypart] ?? p.daypart}</td>
                    <td className="py-1.5 text-right tabular-nums">{p.visits}</td>
                    <td className="py-1.5 text-right tabular-nums text-muted-foreground">{Math.round(Number(p.compare_visits))}</td>
                    <td className="py-1.5 text-right tabular-nums">
                      {p.change_pct === null || p.change_pct === undefined ? '—' : signedPct(Number(p.change_pct) / 100)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-[11px] font-sans text-muted-foreground">
          Net sales = tables × {week.basis === 'covers' ? 'guests per table × items per guest' : 'items per table'} × net
          per item; the parts multiply back to the total exactly.
          {week.basis === 'visits' && ' Head counts are used once staff record them on at least 70% of tables.'}
        </p>
      </CardContent>
    </Card>
  );
};

export default SalesChangeCard;
