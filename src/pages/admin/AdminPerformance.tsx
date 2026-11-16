import React, { useCallback, useEffect, useRef, useState } from 'react';
import { formatStamp } from '@/lib/timing';
import { supabase } from '@/integrations/supabase/client';
import { AdminCard, AdminCardContent, AdminCardHeader, EmptyState, Stagger } from '@/components/admin/AdminCard';
import { AdminPageHeader, AdminToolbar } from '@/components/admin/AdminPage';
import { money, whole } from '@/components/admin/admin-format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertTriangle, Award, Star, Users } from 'lucide-react';

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

const km = (n: number | null | undefined) => `${money(Number(n ?? 0))} KM`;
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
  const dateInput = 'h-11 w-[9.75rem] rounded-xl px-3 text-base sm:w-[11.5rem] sm:text-sm';

  return (
    <div>
      <AdminPageHeader
        title="Staff performance"
        description="How each waiter did over the days you pick: sales, tips, speed and what guests said."
        loading={loading && !!data}
      >
        <AdminToolbar className="gap-x-3 gap-y-2">
          <div className="flex items-center gap-2">
            <label className="text-sm font-sans text-muted-foreground" htmlFor="perf-from">From</label>
            <Input
              id="perf-from" type="date" value={draft.from} max={draft.to || undefined}
              onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))}
              className={dateInput}
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm font-sans text-muted-foreground" htmlFor="perf-to">To</label>
            <Input
              id="perf-to" type="date" value={draft.to} min={draft.from || undefined} max={data?.today}
              onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))}
              className={dateInput}
            />
          </div>
          <p className="basis-full text-xs font-sans leading-relaxed text-muted-foreground">
            Sarajevo trading days. Completed orders only; net sales are items after refunds, with tips shown
            separately.
          </p>
        </AdminToolbar>
      </AdminPageHeader>

      {error && (
        <AdminCard className="mb-6 border-destructive/30" role="alert">
          <AdminCardContent className="flex items-start gap-2 pt-5">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden />
            <div className="min-w-0 text-sm font-sans">
              <p className="font-semibold text-foreground">Could not load staff performance.</p>
              <p className="mt-0.5 break-words text-muted-foreground">{error}</p>
              {data && <p className="mt-0.5 text-muted-foreground">Showing the last range that loaded.</p>}
              <Button variant="outline" className="mt-3 h-11" onClick={() => void load(range)}>Try again</Button>
            </div>
          </AdminCardContent>
        </AdminCard>
      )}

      {loading && !data ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label="Loading">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-60 rounded-2xl" />)}
        </div>
      ) : data && (
        <div className={`transition-opacity ${loading ? 'opacity-60' : ''}`} aria-busy={loading}>
          {waiters.length === 0 ? (
            <AdminCard className="mb-6">
              <EmptyState
                icon={Users}
                title="No waiters on the rota, and nobody served a table in this range."
                hint="Pick a wider range, or add waiters under Waiters."
              />
            </AdminCard>
          ) : (
            <Stagger className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {waiters.map((w, idx) => (
                <AdminCard key={w.waiter_id} className="h-full">
                  <AdminCardContent className="pt-5 sm:pt-6">
                    <div className="mb-4 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-serif text-lg font-bold leading-snug text-foreground">{w.name}</p>
                        {idx === 0 && topNet > 0 && (
                          <span className="mt-0.5 inline-flex items-center gap-1 text-xs font-medium text-accent">
                            <Award className="h-3 w-3" aria-hidden /> Most sold
                          </span>
                        )}
                        {!w.is_active && <span className="block text-xs text-muted-foreground">No longer active</span>}
                      </div>
                      <div className="shrink-0 text-end">
                        <div className="flex items-center justify-end gap-1">
                          <Star className="h-4 w-4 fill-accent text-accent" aria-hidden />
                          <span className="font-sans text-lg font-semibold tabular-nums">
                            {w.avg_rating == null ? '—' : Number(w.avg_rating).toFixed(1)}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {w.ratings} rating{w.ratings !== 1 ? 's' : ''}{w.ratings > 0 && w.ratings < 5 ? ' · too few to judge' : ''}
                        </p>
                      </div>
                    </div>
                    <div className="mb-4 grid grid-cols-2 gap-3">
                      <div className="rounded-xl bg-muted/40 p-3">
                        <p className="text-xs text-muted-foreground">Net sales</p>
                        <p className="mt-1 font-sans text-lg font-semibold leading-none tabular-nums text-foreground">
                          {money(w.net_sales)}<span className="ms-1 text-xs font-medium text-muted-foreground">KM</span>
                        </p>
                      </div>
                      <div className="rounded-xl bg-muted/40 p-3">
                        <p className="text-xs text-muted-foreground">Tips</p>
                        <p className="mt-1 font-sans text-lg font-semibold leading-none tabular-nums text-foreground">
                          {money(w.tips)}<span className="ms-1 text-xs font-medium text-muted-foreground">KM</span>
                        </p>
                      </div>
                    </div>
                    <dl className="divide-y divide-border/60 text-sm font-sans">
                      <Row label="Orders" value={whole(w.orders)} />
                      <Row label="Tables served" value={whole(w.tables)} />
                      <Row label="To confirm" value={minutes(w.avg_confirm_minutes)} />
                      <Row label="To served" value={minutes(w.avg_served_minutes)} />
                      <Row label="Average sitting" value={minutes(w.avg_turn_minutes)} />
                    </dl>
                  </AdminCardContent>
                </AdminCard>
              ))}
            </Stagger>
          )}

          {data.unassigned.orders > 0 && (
            <p className="mb-6 max-w-3xl text-xs font-sans leading-relaxed text-muted-foreground">
              {data.unassigned.orders} order{data.unassigned.orders === 1 ? '' : 's'} ({km(data.unassigned.net_sales)})
              had no waiter assigned, so the figures above do not add up to the day&apos;s total.
              Times are measured from when the order reached the kitchen.
            </p>
          )}

          {data.low_ratings.length > 0 && (
            <AdminCard>
              <AdminCardHeader icon={Star} tone="destructive" title="Recent low ratings" description="Guests who gave a low score, newest first." />
              <AdminCardContent>
                <ul className="divide-y divide-border/60">
                  {data.low_ratings.map((rating, index) => (
                    <li
                      key={`${rating.created_at}-${index}`}
                      className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 py-3 first:pt-0 last:pb-0"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-sans font-medium text-foreground">
                          {rating.waiter_name ?? 'No waiter recorded'} — {rating.rating} star{rating.rating !== 1 ? 's' : ''}
                        </p>
                        {rating.comment && <p className="mt-1 break-words text-[13px] text-muted-foreground">&ldquo;{rating.comment}&rdquo;</p>}
                      </div>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{formatStamp(rating.created_at)}</span>
                    </li>
                  ))}
                </ul>
              </AdminCardContent>
            </AdminCard>
          )}
        </div>
      )}
    </div>
  );
};

const Row = ({ label, value }: { label: string; value: string | number }) => (
  <div className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
    <dt className="text-muted-foreground">{label}</dt>
    <dd className="font-medium tabular-nums text-foreground">{value}</dd>
  </div>
);

export default AdminPerformance;
