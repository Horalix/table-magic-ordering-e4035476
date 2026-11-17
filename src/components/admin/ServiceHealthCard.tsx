import React, { useCallback, useEffect, useState } from 'react';
import { Activity, AlertTriangle, CheckCircle2, TrendingDown, TrendingUp } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { AdminCard, AdminCardContent, AdminCardHeader, DeltaChip } from '@/components/admin/AdminCard';
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
    <AdminCard className="mb-6" aria-label="Is today normal">
      <AdminCardHeader
        icon={Activity}
        title="Is today normal?"
        description="Today against the same weekday, and the kitchen and bar against their own usual."
        action={pace && pace.pace !== null && pace.status !== 'learning' && pace.status !== 'too_early' && (
          <DeltaChip change={Number(pace.pace) - 1} label={`${Math.round(Number(pace.pace) * 100)}% of usual`} className="text-xs px-2 py-1" />
        )}
      />
      <AdminCardContent className="space-y-2.5">
        {!anomalies && !stations && !error ? (
          <Skeleton className="h-20 rounded-xl" />
        ) : (
          <>
            {pace && (
              <p className={`text-sm font-sans leading-relaxed ${pace.alert ? 'text-destructive font-medium' : 'text-foreground'}`}>
                {describePace(pace)}
              </p>
            )}

            {/* An unusual day either way is worth a look; the arrow says which way it went. */}
            {flaggedDays.map((d) => {
              const below = d.net < Number(d.median);
              const Dir = below ? TrendingDown : TrendingUp;
              return (
                <div key={d.day} className="flex items-start gap-2.5 rounded-xl bg-muted/45 px-3.5 py-2.5">
                  <Dir className={`w-4 h-4 shrink-0 mt-0.5 ${below ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`} aria-hidden />
                  <p className="text-sm font-sans text-foreground">{describeAnomaly(d)}</p>
                </div>
              );
            })}

            {(stations?.now ?? []).map((s) => (
              <div
                key={s.station}
                className={`flex items-start gap-2.5 rounded-xl px-3.5 py-2.5 ${s.alert ? 'border border-destructive/25 bg-destructive/5' : 'bg-muted/45'}`}
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
      </AdminCardContent>
    </AdminCard>
  );
};

export default ServiceHealthCard;
