import React, { useCallback, useEffect, useState } from 'react';
import { Activity, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  describeAnomaly, describePace, describeStation,
  type DailyAnomalies, type StationTimings,
} from '@/lib/reporting';

/**
 * "Is today normal?" — pace against the same weekday, the last week's
 * unusual days, and kitchen/bar ticket times against their own usual.
 *
 * Each alert is built to stay quiet on ordinary variation (robust z against
 * the same weekday, percentile ticket times, minimum counts); see
 * 20261025124000_service_alerts.sql. A quiet card is the normal state.
 */

const REFRESH_MS = 5 * 60_000;

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn as never, args as never);
  if (error) throw new Error(error.message);
  return data as T;
}

const ServiceHealthCard = () => {
  const [anomalies, setAnomalies] = useState<DailyAnomalies | null>(null);
  const [stations, setStations] = useState<StationTimings | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [a, s] = await Promise.allSettled([
      rpc<DailyAnomalies>('daily_anomalies'),
      rpc<StationTimings>('station_timings', { _days: 28 }),
    ]);
    if (a.status === 'fulfilled' && a.value) setAnomalies(a.value);
    if (s.status === 'fulfilled' && s.value) setStations(s.value);
    const failed = [a, s].find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined;
    setError(failed ? (failed.reason instanceof Error ? failed.reason.message : String(failed.reason)) : null);
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => { void load(); }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  const flaggedDays = (anomalies?.days ?? []).filter((d) => d.alert).slice(0, 3);
  const slow = (stations?.now ?? []).filter((s) => s.alert);
  const pace = anomalies?.today;
  const allQuiet = !!anomalies && !!stations && flaggedDays.length === 0 && slow.length === 0 && !pace?.alert;

  return (
    <Card className="rounded-2xl border-border mb-8" aria-label="Is today normal">
      <CardHeader className="pb-3">
        <CardTitle className="font-serif text-lg flex items-center gap-2">
          <Activity className="w-5 h-5 text-primary shrink-0" /> Is today normal?
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {!anomalies && !stations && !error ? (
          <Skeleton className="h-20 rounded-xl" />
        ) : (
          <>
            {pace && (
              <p className={`text-sm font-sans leading-relaxed ${pace.alert ? 'text-destructive font-medium' : 'text-foreground'}`}>
                {describePace(pace)}
              </p>
            )}

            {flaggedDays.map((d) => (
              <div key={d.day} className="flex items-start gap-2 rounded-xl border border-destructive/25 bg-destructive/5 px-3 py-2">
                <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                <p className="text-sm font-sans text-foreground">{describeAnomaly(d)}</p>
              </div>
            ))}

            {(stations?.now ?? []).map((s) => (
              <div
                key={s.station}
                className={`flex items-start gap-2 rounded-xl px-3 py-2 ${s.alert ? 'border border-destructive/25 bg-destructive/5' : 'bg-muted/40'}`}
              >
                {s.alert
                  ? <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                  : <CheckCircle2 className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />}
                <p className={`text-sm font-sans ${s.alert ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>{describeStation(s)}</p>
              </div>
            ))}

            {allQuiet && (
              <p className="text-xs font-sans text-muted-foreground">
                Nothing unusual: sales and ticket times are within what ordinary weeks look like.
              </p>
            )}
            {error && (
              <p className="text-xs font-sans text-muted-foreground break-words">Part of this check could not load: {error}</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default ServiceHealthCard;
