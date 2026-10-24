import React, { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertTriangle, Award, Loader2, Star } from 'lucide-react';

/**
 * Staff performance.
 *
 * Every figure comes from `staff_performance(from, to)`. The previous version
 * fetched orders, ratings and sessions into the browser and added them up
 * there, which:
 *
 *   - credited abandoned card checkouts (awaiting_payment, payment_failed) to
 *     the waiter as revenue;
 *   - hit PostgREST's 1000-row cap on a busy month and summed whatever slice
 *     came back, without saying so;
 *   - defaulted to UTC days, so "today" began at 01:00 or 02:00 local.
 *
 * Now a sale is a completed order, money is net sales with tips beside it, and
 * the days are Sarajevo trading days chosen by the server — the first load
 * asks for the default range and fills the date inputs from the answer.
 */

interface WaiterRow {
  waiter_id: string;
  name: string;
  is_active: boolean;
  orders: number;
  net_sales: number;
  tips: number;
  tables: number;
  ratings: number;
  avg_rating: number | null;
  avg_confirm_minutes: number | null;
  avg_served_minutes: number | null;
  avg_turn_minutes: number | null;
}

interface LowRating {
  waiter_id: string | null;
  waiter_name: string | null;
  rating: number;
  comment: string | null;
  created_at: string;
}

interface Performance {
  from: string;
  to: string;
  today: string;
  waiters: WaiterRow[];
  unassigned: { orders: number; net_sales: number };
  low_ratings: LowRating[];
}

interface Range { from: string; to: string }

const km = (n: number | null | undefined) => `${Number(n ?? 0).toFixed(2)} KM`;
const minutes = (n: number | null | undefined) => (n == null ? '—' : `${Number(n).toFixed(1)} min`);
const DEBOUNCE_MS = 450;

const AdminPerformance = () => {
  const [range, setRange] = useState<Range | null>(null);
  const [draft, setDraft] = useState<Range>({ from: '', to: '' });
  const [data, setData] = useState<Performance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const requestId = useRef(0);
  const lastAsked = useRef<string | null>(null);

  const load = useCallback(async (wanted: Range | null) => {
    const id = ++requestId.current;
    setLoading(true);
    const { data: result, error: rpcError } = await supabase.rpc(
      'staff_performance' as never,
      (wanted ? { _from: wanted.from, _to: wanted.to } : {}) as never,
    );
    if (id !== requestId.current) return;
    if (rpcError) {
      setError(rpcError.message);
    } else {
      const perf = result as unknown as Performance;
      setError(null);
      setData(perf);
      if (!wanted) {
        const served = { from: perf.from, to: perf.to };
        lastAsked.current = `${served.from}|${served.to}`;
        setRange(served);
        setDraft(served);
      }
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    const key = range ? `${range.from}|${range.to}` : 'default';
    if (key === lastAsked.current) return;
    lastAsked.current = key;
    void load(range);
  }, [range, load]);

  // Wait for the manager to stop changing the dates before asking the server.
  useEffect(() => {
    if (!draft.from || !draft.to || draft.from > draft.to) return;
    if (range && draft.from === range.from && draft.to === range.to) return;
    const timer = setTimeout(() => setRange({ ...draft }), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [draft, range]);

  const waiters = data?.waiters ?? [];
  const topNet = waiters[0]?.net_sales ?? 0;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-6">
        <h1 className="font-serif text-3xl font-bold text-foreground">Staff performance</h1>
        {loading && data && <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" aria-label="Loading" />}
      </div>

      <Card className="mb-6">
        <CardContent className="p-4 flex flex-wrap gap-3 items-center">
          <label className="text-sm font-sans text-muted-foreground" htmlFor="perf-from">From</label>
          <Input
            id="perf-from" type="date" value={draft.from} max={draft.to || undefined}
            onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))}
            className="w-[160px]"
          />
          <label className="text-sm font-sans text-muted-foreground" htmlFor="perf-to">To</label>
          <Input
            id="perf-to" type="date" value={draft.to} min={draft.from || undefined} max={data?.today}
            onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))}
            className="w-[160px]"
          />
          <p className="basis-full text-xs font-sans text-muted-foreground">
            Sarajevo trading days. Completed orders only; net sales are items after refunds, with tips shown
            separately.
          </p>
        </CardContent>
      </Card>

      {error && (
        <Card className="border-destructive/30 mb-6">
          <CardContent className="p-4 flex items-start gap-2">
            <AlertTriangle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
            <div className="text-sm font-sans min-w-0">
              <p className="font-semibold text-foreground">Could not load staff performance.</p>
              <p className="text-muted-foreground mt-0.5 break-words">{error}</p>
              {data && <p className="text-muted-foreground mt-0.5">Showing the last range that loaded.</p>}
            </div>
          </CardContent>
        </Card>
      )}

      {loading && !data ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-48 rounded-xl" />)}
        </div>
      ) : data && (
        <div className={`transition-opacity ${loading ? 'opacity-60' : ''}`} aria-busy={loading}>
          {waiters.length === 0 ? (
            <Card className="mb-6">
              <CardContent className="p-6 text-sm font-sans text-muted-foreground text-center">
                No waiters on the rota, and nobody served a table in this range.
              </CardContent>
            </Card>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
              {waiters.map((w, idx) => (
                <Card key={w.waiter_id} className="border-border">
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="min-w-0">
                        <p className="font-serif text-lg font-bold truncate">{w.name}</p>
                        {idx === 0 && topNet > 0 && (
                          <span className="inline-flex items-center gap-1 text-xs text-accent">
                            <Award className="w-3 h-3" /> Most sold
                          </span>
                        )}
                        {!w.is_active && <span className="block text-xs text-muted-foreground">No longer active</span>}
                      </div>
                      <div className="text-right shrink-0">
                        <div className="flex items-center justify-end gap-1">
                          <Star className="w-4 h-4 fill-accent text-accent" />
                          <span className="font-serif text-lg font-bold">
                            {w.avg_rating == null ? '—' : Number(w.avg_rating).toFixed(1)}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground">{w.ratings} rating{w.ratings !== 1 ? 's' : ''}</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-sm font-sans">
                      <Stat label="Net sales" value={km(w.net_sales)} />
                      <Stat label="Tips" value={km(w.tips)} />
                      <Stat label="Orders" value={w.orders} />
                      <Stat label="Tables served" value={w.tables} />
                      <Stat label="To confirm" value={minutes(w.avg_confirm_minutes)} />
                      <Stat label="To served" value={minutes(w.avg_served_minutes)} />
                      <Stat label="Average sitting" value={minutes(w.avg_turn_minutes)} />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {data.unassigned.orders > 0 && (
            <p className="text-xs font-sans text-muted-foreground mb-6">
              {data.unassigned.orders} order{data.unassigned.orders === 1 ? '' : 's'} ({km(data.unassigned.net_sales)})
              had no waiter assigned, so the figures above do not add up to the day&apos;s total.
              Times are measured from when the order reached the kitchen.
            </p>
          )}

          {data.low_ratings.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="font-serif text-lg">Recent low ratings</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {data.low_ratings.map((rating, index) => (
                    <div
                      key={`${rating.created_at}-${index}`}
                      className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 p-3 rounded border border-destructive/20 bg-destructive/5"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-sans font-medium">
                          {rating.waiter_name ?? 'No waiter recorded'} — {rating.rating} star{rating.rating !== 1 ? 's' : ''}
                        </p>
                        {rating.comment && <p className="text-xs text-muted-foreground mt-1 break-words">"{rating.comment}"</p>}
                      </div>
                      <span className="text-xs text-muted-foreground shrink-0">{new Date(rating.created_at).toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
};

const Stat = ({ label, value }: { label: string; value: string | number }) => (
  <div>
    <p className="text-xs text-muted-foreground">{label}</p>
    <p className="font-medium text-foreground tabular-nums">{value}</p>
  </div>
);

export default AdminPerformance;
