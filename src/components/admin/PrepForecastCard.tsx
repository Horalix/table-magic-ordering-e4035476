import React, { useEffect, useState } from 'react';
import { AlertTriangle, ChefHat } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
    <Card className="rounded-2xl border-border mt-6" aria-label="Tomorrow's prep">
      <CardHeader className="pb-3">
        <CardTitle className="font-serif text-lg flex items-center gap-2">
          <ChefHat className="w-5 h-5 text-primary shrink-0" />
          {forecast ? `Prep for ${forecast.weekday}` : "Tomorrow's prep"}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {error ? (
          <div className="flex items-start gap-2 text-sm font-sans">
            <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
            <p className="text-muted-foreground break-words">Could not build the prep forecast: {error}</p>
          </div>
        ) : !forecast ? (
          <Skeleton className="h-32 rounded-xl" />
        ) : !forecast.show ? (
          <p className="text-sm font-sans text-muted-foreground leading-relaxed">
            {forecast.mase === null || forecast.points < 20
              ? `Not shown yet: it needs several weeks of ${forecast.weekday}s to check itself against.`
              : `Not shown: on the last six ${forecast.weekday}s this forecast was no better than simply repeating the week before (error ratio ${forecast.mase.toFixed(2)}). It will reappear once it is.`}
          </p>
        ) : (
          <>
            <p className="text-xs font-sans text-muted-foreground mb-3 leading-relaxed">
              Portions to have ready, by when they sell. Forecast from the last four {forecast.weekday}s; prep covers
              demand up to the point where running out would cost more than throwing away. On the last six{' '}
              {forecast.weekday}s it beat &ldquo;same as last week&rdquo; (error ratio {forecast.mase?.toFixed(2)}).
            </p>
            <ul className="divide-y divide-border">
              {rows.map((r) => (
                <li key={r.item_id} className="py-2 text-sm font-sans">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-foreground min-w-0 truncate">{r.name}</span>
                    <span className="shrink-0 tabular-nums">
                      <strong className="text-foreground">{r.prep}</strong>
                      <span className="text-muted-foreground text-xs"> · expect {r.forecast}</span>
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-x-2 text-[11px] text-muted-foreground tabular-nums">
                    {r.dayparts.map((d) => <span key={d.daypart}>{DAYPART_SHORT[d.daypart]} {d.prep}</span>)}
                    {r.method === 'subcategory' && <span>· slow dish, from its section</span>}
                    {r.cost_estimated && <span>· estimated cost</span>}
                  </div>
                </li>
              ))}
            </ul>
            {forecast.rows.length > 12 && (
              <button type="button" onClick={() => setAll((a) => !a)} className="mt-2 text-xs font-sans font-semibold text-primary min-h-[32px]">
                {all ? 'Show fewer' : `Show all ${forecast.rows.length}`}
              </button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default PrepForecastCard;
