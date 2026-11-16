import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Scale } from 'lucide-react';
import { toast } from 'sonner';
import { AdminCard, AdminCardContent, AdminCardHeader } from '@/components/admin/AdminCard';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import {
  attachRows, getProfitCheck, keepMeasuring, setAutoHoldout, summariseProfitCheck, type ProfitCheck,
} from '@/lib/reco-profit';

/**
 * Are the suggestions earning? Margin per week, measured against tables kept
 * without suggestions, from the cautious end of the interval; "not enough
 * tables yet" until there is an answer. Plus drink, dessert and coffee attach
 * per daypart, with and without suggestions.
 *
 * Opening it as a manager also makes sure the always-on check is running
 * (the scheduler does the same every 15 minutes where pg_cron exists).
 */

const pct = (n: number | null) => (n === null ? '—' : `${Math.round(n * 100)}%`);

const RecoProfitCard = ({ days = 28 }: { days?: number }) => {
  const [data, setData] = useState<ProfitCheck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      await keepMeasuring().catch(() => undefined);
      setData(await getProfitCheck(days));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [days]);

  useEffect(() => { void load(); }, [load]);

  const s = useMemo(() => summariseProfitCheck(data), [data]);
  const rows = useMemo(() => attachRows(data?.attach ?? []), [data]);
  const held = data?.experiment && !data.experiment.ended_at ? data.experiment.holdout_pct : 0;
  const hasHoldout = rows.some((r) => r.drink[1] !== null || r.dessert[1] !== null);

  const toggle = async (next: number) => {
    setBusy(true);
    try {
      await setAutoHoldout(next);
      toast.success(next > 0 ? `Measuring: ${next}% of tables will see no suggestions` : 'Measuring paused: every table sees suggestions');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminCard id="reco-profit">
      <AdminCardHeader
        icon={Scale}
        title="Are suggestions earning?"
        description={<>
          Extra margin from suggestions, measured against tables that see none — so it is the difference they make, not
          sales that would have happened anyway. Last {days} days.
        </>}
      />
      <AdminCardContent className="space-y-5">
        {error ? (
          <div className="flex items-start gap-2 text-sm font-sans">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
            <p className="break-words text-muted-foreground">Could not load the check: {error}</p>
          </div>
        ) : !data ? (
          <Skeleton className="h-40 rounded-2xl" />
        ) : (
          <>
            <div>
              <p
                className={cn(
                  'font-sans text-[22px] font-semibold leading-tight tracking-tight tabular-nums sm:text-[28px]',
                  s.tone === 'good' && 'text-emerald-700 dark:text-emerald-400',
                  s.tone === 'bad' && 'text-red-700 dark:text-red-400',
                  s.tone === 'neutral' && 'text-foreground',
                )}
                data-testid="reco-profit-headline"
              >
                {s.headline}
              </p>
              <p className="mt-1.5 max-w-prose text-sm font-sans leading-relaxed text-muted-foreground">{s.detail}</p>
              {data.cost_estimated_share !== null && data.cost_estimated_share !== undefined && data.cost_estimated_share > 0.2 && (
                <p className="mt-1.5 text-xs font-sans text-muted-foreground">
                  {Math.round(data.cost_estimated_share * 100)}% of these sales are dishes with no food cost entered; their
                  margin uses a typical cost for the kind of dish. Enter food costs in Dishes for an exact figure.
                </p>
              )}
            </div>

            {rows.length > 0 && (
              <div className="-mx-2 overflow-x-auto px-2">
                <table className="w-full min-w-[440px] text-xs font-sans">
                  <caption className="sr-only">Share of tables that added a drink, a dessert or a coffee, by time of day</caption>
                  <thead>
                    <tr className="border-b border-border text-left uppercase tracking-wide text-muted-foreground">
                      <th className="pb-1.5 font-medium">When</th>
                      <th className="pb-1.5 text-right font-medium">Drink with food</th>
                      <th className="pb-1.5 text-right font-medium">Dessert after a main</th>
                      <th className="pb-1.5 text-right font-medium">Coffee after a main</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {rows.map((r) => (
                      <tr key={r.daypart}>
                        <td className="py-1.5">{r.label}</td>
                        {([r.drink, r.dessert, r.coffee] as const).map((pair, i) => (
                          <td key={i} className="py-1.5 text-right tabular-nums">
                            <span className="text-foreground">{pct(pair[0])}</span>
                            {hasHoldout && <span className="text-muted-foreground"> vs {pct(pair[1])}</span>}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {hasHoldout && (
                  <p className="mt-1.5 text-xs font-sans text-muted-foreground">With suggestions vs without.</p>
                )}
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
              <p className="text-xs font-sans text-muted-foreground">
                {held > 0
                  ? <>{held}% of tables see no suggestions{data.experiment?.auto ? ' (always-on check)' : ''}.</>
                  : data.auto_holdout_pct > 0 ? <>Measuring starts with the next table.</> : <>Every table sees suggestions; nothing is measured.</>}
              </p>
              {held > 0 && !data.experiment?.auto ? (
                <span className="text-xs font-sans text-muted-foreground">A manager&apos;s test is running; stop it on What the app earned.</span>
              ) : data.auto_holdout_pct > 0 || held > 0 ? (
                <Button variant="outline" className="h-11 rounded-xl px-4" disabled={busy} onClick={() => toggle(0)}>
                  Pause measuring
                </Button>
              ) : (
                <Button className="h-11 rounded-xl px-4" disabled={busy} onClick={() => toggle(10)}>
                  Measure with 1 table in 10
                </Button>
              )}
            </div>
          </>
        )}
      </AdminCardContent>
    </AdminCard>
  );
};

export default RecoProfitCard;
