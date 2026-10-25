import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Filter } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  FUNNEL_STAGES, getRecoFunnel, placementLabel, summariseFunnel,
  type HoldoutComparison, type RecoFunnelRow,
} from '@/lib/menu-intelligence';

/**
 * One chain from "the engine was asked" to "money came in", per placement.
 *
 * Every stage is a subset of the one before (a paid suggestion counts as seen
 * and tapped even if the phone's event was lost), and "paid" is exactly the
 * conversions ledger on completed orders. What the chain cannot say is how
 * much of that money would have come anyway: that is the holdout's job, and
 * its answer — or "not measured" — sits at the bottom.
 */

const km = (n: number | null | undefined) => `${Number(n ?? 0).toFixed(2)} KM`;

function incremental(h: HoldoutComparison | null | undefined): { text: string; measured: boolean } {
  if (!h) return { text: 'Incremental effect: not measured.', measured: false };
  switch (h.status) {
    case 'positive':
    case 'negative':
      return {
        measured: true,
        text: `Incremental effect, from the holdout: ${km(h.difference)} per visit (${km(h.ci_low)} to ${km(h.ci_high)}).`,
      };
    case 'no_measurable_effect':
      return {
        measured: true,
        text: `Incremental effect, from the holdout: none distinguishable from zero (${km(h.ci_low)} to ${km(h.ci_high)} per visit).`,
      };
    case 'too_early':
      return { measured: false, text: 'Incremental effect: not measured yet — the holdout needs more visits on each side.' };
    case 'invalid_srm':
      return { measured: false, text: 'Incremental effect: not measured — the holdout split is unsound.' };
    default:
      return { measured: false, text: 'Incremental effect: not measured — no holdout is running, so the money above is an upper bound.' };
  }
}

const RecoFunnelCard = ({ days = 28, holdout }: { days?: number; holdout?: HoldoutComparison | null }) => {
  const [rows, setRows] = useState<RecoFunnelRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getRecoFunnel(days)
      .then((r) => { if (!cancelled) { setRows(r ?? []); setError(null); } })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, [days]);

  const totals = useMemo(() => summariseFunnel(rows ?? []), [rows]);
  const weeks = useMemo(() => [...new Set((rows ?? []).map((r) => r.week_start))].sort().reverse(), [rows]);
  const inc = incremental(holdout);

  return (
    <Card id="funnel" className="rounded-2xl border-border">
      <CardHeader className="pb-3">
        <CardTitle className="font-serif text-lg flex items-center gap-2">
          <Filter className="w-5 h-5 text-primary shrink-0" /> From suggestion to sale
        </CardTitle>
        <p className="text-xs font-sans text-muted-foreground">
          Every suggestion the engine made in the last {days} trading days, and how far it got. Paid means a line on
          an order that became a sale.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        {error ? (
          <div className="flex items-start gap-2 text-sm font-sans">
            <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
            <p className="text-muted-foreground break-words">Could not load the funnel: {error}</p>
          </div>
        ) : !rows ? (
          <Skeleton className="h-48 rounded-2xl" />
        ) : totals.length === 0 ? (
          <p className="text-sm font-sans text-muted-foreground py-4 text-center">No suggestions were made in this window.</p>
        ) : (
          <>
            {totals.map((t) => {
              const top = Math.max(t.decisions, 1);
              return (
                <section key={t.placement} aria-label={placementLabel(t.placement)}>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 mb-2">
                    <h4 className="font-sans font-semibold text-foreground">{placementLabel(t.placement)}</h4>
                    <span className="text-sm font-sans tabular-nums text-muted-foreground">
                      <strong className="text-foreground">{km(t.paid_km)}</strong>
                      {t.km_per_1000_seen !== null && <> · {km(t.km_per_1000_seen)} per 1,000 seen</>}
                    </span>
                  </div>
                  <ol className="space-y-1.5">
                    {FUNNEL_STAGES.map((s, i) => {
                      const value = t[s.key];
                      const prev = i > 0 ? t[FUNNEL_STAGES[i - 1].key] : null;
                      return (
                        <li key={s.key}>
                          <div className="flex items-baseline justify-between gap-2 text-xs font-sans">
                            <span className="text-muted-foreground">{s.label}</span>
                            <span className="tabular-nums text-foreground">
                              {value.toLocaleString('en')}
                              {prev ? <span className="text-muted-foreground"> · {Math.round((100 * value) / prev)}%</span> : null}
                            </span>
                          </div>
                          <div className="mt-0.5 h-1.5 rounded-full bg-muted overflow-hidden">
                            <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(value > 0 ? 1 : 0, (100 * value) / top)}%` }} />
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                </section>
              );
            })}

            {weeks.length > 1 && (
              <div className="overflow-x-auto -mx-2 px-2">
                <table className="w-full text-xs font-sans min-w-[420px]">
                  <thead>
                    <tr className="text-left uppercase tracking-wide text-muted-foreground border-b border-border">
                      <th className="pb-1.5 font-medium">Week of</th>
                      <th className="pb-1.5 font-medium">Where</th>
                      <th className="pb-1.5 font-medium text-right">Seen</th>
                      <th className="pb-1.5 font-medium text-right">Paid</th>
                      <th className="pb-1.5 font-medium text-right">KM</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {weeks.flatMap((w) => (rows ?? []).filter((r) => r.week_start === w).map((r) => (
                      <tr key={`${w}:${r.placement}`}>
                        <td className="py-1.5 tabular-nums">{new Date(`${w}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</td>
                        <td className="py-1.5 text-muted-foreground">{placementLabel(r.placement)}</td>
                        <td className="py-1.5 text-right tabular-nums">{Number(r.seen)}</td>
                        <td className="py-1.5 text-right tabular-nums">{Number(r.paid)}</td>
                        <td className="py-1.5 text-right tabular-nums">{Number(r.paid_km).toFixed(2)}</td>
                      </tr>
                    )))}
                  </tbody>
                </table>
              </div>
            )}

            <p className={`text-sm font-sans ${inc.measured ? 'text-foreground' : 'text-muted-foreground'}`}>{inc.text}</p>
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default RecoFunnelCard;
