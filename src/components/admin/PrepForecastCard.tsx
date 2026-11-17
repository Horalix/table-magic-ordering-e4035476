import React, { useEffect, useState } from 'react';
import { AlertTriangle, ChefHat } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { AdminCard, AdminCardContent, AdminCardHeader, EmptyState } from '@/components/admin/AdminCard';
import { Skeleton } from '@/components/ui/skeleton';
import { prepForecast, type PrepForecast, type PrepHistory } from '@/lib/prep-forecast';

/**
 * Tomorrow's prep list, shown only when it has earned it.
 *
 * The forecast runs in src/lib/prep-forecast.ts over `prep_history()`. It is
 * backtested on the last six same weekdays against "same as last week"; if it
 * does not beat that, the list is withheld and the card says why, because a
 * wrong prep list is worse than none — it gets followed.
 */

const DAYPART_SHORT: Record<string, string> = {
  morning: 'Morning', lunch: 'Lunch', afternoon: 'Afternoon', evening: 'Evening', late: 'Late',
};

const PrepForecastCard = () => {
  const [forecast, setForecast] = useState<PrepForecast | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [all, setAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error: e } = await supabase.rpc('prep_history' as never);
      if (cancelled) return;
      if (e) { setError(e.message); return; }
      if (!data) { setError('The server returned no history.'); return; }
      setForecast(prepForecast(data as unknown as PrepHistory));
    })();
    return () => { cancelled = true; };
  }, []);

  const rows = forecast ? (all ? forecast.rows : forecast.rows.slice(0, 12)) : [];

  return (
    <AdminCard className="print:shadow-none" aria-label="Tomorrow's prep">
      <AdminCardHeader
        icon={ChefHat}
        title={forecast ? `Prep for ${forecast.weekday}` : "Tomorrow's prep"}
        description={forecast?.show ? 'Portions to have ready, by when they sell.' : 'Portions to have ready, once the forecast has proved itself.'}
      />
      <AdminCardContent>
        {error ? (
          <div className="flex items-start gap-2 text-sm font-sans">
            <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
            <p className="text-muted-foreground break-words">Could not build the prep forecast: {error}</p>
          </div>
        ) : !forecast ? (
          <div className="space-y-3" aria-busy="true" aria-label="Loading the prep forecast">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-10 rounded-lg" />)}</div>
        ) : !forecast.show ? (
          <EmptyState
            icon={ChefHat}
            title="No prep list for now."
            hint={forecast.mase === null || forecast.points < 20
              ? `Not shown yet: it needs several weeks of ${forecast.weekday}s to check itself against.`
              : `Not shown: on the last six ${forecast.weekday}s this forecast was no better than simply repeating the week before (error ratio ${forecast.mase.toFixed(2)}). It will reappear once it is.`}
            className="py-8"
          />
        ) : (
          <>
            <p className="mb-4 max-w-3xl text-xs font-sans leading-relaxed text-muted-foreground">
              Forecast from the last four {forecast.weekday}s; prep covers
              demand up to the point where running out would cost more than throwing away. On the last six{' '}
              {forecast.weekday}s it beat &ldquo;same as last week&rdquo; (error ratio {forecast.mase?.toFixed(2)}).
            </p>
            <div className="flex items-baseline justify-between gap-3 border-b border-border/70 pb-2 text-[11px] font-sans font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              <span>Dish</span>
              <span>Prep <span className="font-normal normal-case tracking-normal">· expected to sell</span></span>
            </div>
            <ul className="sm:grid sm:grid-cols-2 sm:gap-x-8">
              {rows.map((r) => (
                <li key={r.item_id} className="border-b border-border/70 py-2.5 text-sm font-sans">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate font-medium text-foreground">{r.name}</span>
                    <span className="shrink-0 tabular-nums">
                      <strong className="text-base font-semibold text-foreground">{r.prep}</strong>
                      <span className="text-xs text-muted-foreground"> · expect {r.forecast}</span>
                    </span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-x-2.5 text-xs text-muted-foreground tabular-nums">
                    {r.dayparts.map((d) => <span key={d.daypart}>{DAYPART_SHORT[d.daypart]} {d.prep}</span>)}
                    {r.method === 'subcategory' && <span>· slow dish, from its section</span>}
                    {r.cost_estimated && <span>· estimated cost</span>}
                  </div>
                </li>
              ))}
            </ul>
            {forecast.rows.length > 12 && (
              <button type="button" onClick={() => setAll((a) => !a)} className="no-print mt-2 min-h-[44px] text-sm font-sans font-semibold text-primary hover:underline underline-offset-4">
                {all ? 'Show fewer' : `Show all ${forecast.rows.length}`}
              </button>
            )}
          </>
        )}
      </AdminCardContent>
    </AdminCard>
  );
};

export default PrepForecastCard;
