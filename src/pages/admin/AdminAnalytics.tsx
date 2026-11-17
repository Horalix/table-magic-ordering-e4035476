import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  CalendarDays, AlertTriangle, Loader2, BarChart3, PieChart as PieChartIcon, Clock, Award, Filter, Smartphone, Armchair,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import SalesChangeCard from '@/components/admin/SalesChangeCard';
import { AdminCard, AdminCardContent, AdminCardHeader, EmptyState, KpiCard, Stagger } from '@/components/admin/AdminCard';
import AdminBarChart from '@/components/admin/AdminBarChart';
import RankedBars from '@/components/admin/RankedBars';
import { compact, money, moneyKM, whole } from '@/components/admin/admin-format';

/**
 * Sales analytics.
 *
 * Every figure comes from server-side RPCs rather than client-side
 * aggregation. The first version pulled the entire order history into the
 * browser, which PostgREST silently truncates at 1000 rows, and counted
 * abandoned card checkouts as revenue.
 *
 * Days are the restaurant's trading days in Sarajevo, decided by the server.
 * The page never works out "today" from the device clock: a manager's laptop
 * in another timezone, or a service that runs past midnight, would otherwise
 * ask for a different day than the one the restaurant worked. The first load
 * asks for the default range and the server says which days that was.
 *
 * Money is NET SALES — items, after refunds — with tips beside it. A tip is
 * the guest's, passed through to staff; folding it into "revenue" made a
 * generous Saturday look like a better-selling one.
 */

interface Analytics {
  from: string;
  to: string;
  /** The current trading day, according to the server. */
  today?: string;
  totals: {
    net_sales?: number;
    revenue: number;
    tips: number;
    refunded?: number;
    orders: number;
    average_order: number;
    items_per_order: number;
  };
  by_day: { day: string; net_sales?: number; revenue: number; orders: number }[];
  by_hour: { hour: number; orders: number; net_sales?: number; revenue: number }[];
  by_category: { name: string; revenue: number; units: number }[];
  top_items: { item_id: string; name: string; units: number; revenue: number }[];
  table_turnover: { table_number: number; sittings: number; avg_minutes: number }[];
}

interface Funnel {
  from: string;
  to: string;
  visits: number;
  steps: { step: string; visits: number }[];
}

interface Range { from: string; to: string }

const km = (n: number | null | undefined) => `${Number(n ?? 0).toFixed(2)} KM`;
const DEBOUNCE_MS = 450;
/** "Most ordered" shows this many until asked for the rest, so it sits level with the chart beside it. */
const TOP_SHOWN = 8;

const STEP_LABELS: Record<string, string> = {
  menu_viewed: 'Opened the menu',
  category_viewed: 'Opened a category',
  item_viewed: 'Looked at a dish',
  item_added: 'Added to the order',
  cart_viewed: 'Viewed the order',
  checkout_opened: 'Started checkout',
  order_placed: 'Placed the order',
};

/** `YYYY-MM-DD` plus or minus whole days, without touching any timezone. */
function shiftDay(day: string, delta: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const date = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

/** Whole days from `a` to `b`, both `YYYY-MM-DD`. */
function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** Label a trading day. Parsed at noon so no timezone can move it to the day before. */
const dayLabel = (day: string) =>
  new Date(`${day}T12:00:00`).toLocaleDateString('en', { weekday: 'short', day: 'numeric' });
/** "Sat 14 Nov", for a tooltip. */
const longDay = (day: string) =>
  new Date(`${day}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
/** "14 Nov". */
const shortDay = (day: string) =>
  new Date(`${day}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

const Empty = ({ children = 'No sales in this range.' }: { children?: React.ReactNode }) => (
  <EmptyState
    icon={BarChart3}
    title={children}
    hint="Pick a longer range, or look again after the next service."
    className="h-[260px] py-0"
  />
);

const AdminAnalytics = () => {
  // Null until the server has said which days the default range covers.
  const [range, setRange] = useState<Range | null>(null);
  const [draft, setDraft] = useState<Range>({ from: '', to: '' });
  const [today, setToday] = useState<string | null>(null);

  const [data, setData] = useState<Analytics | null>(null);
  const [funnel, setFunnel] = useState<Funnel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [funnelError, setFunnelError] = useState<string | null>(null);
  const reduceMotion = useReducedMotion();
  const [allTop, setAllTop] = useState(false);

  // Only the newest request may write to state; a slow old one must not
  // overwrite the range the manager has since chosen.
  const requestId = useRef(0);
  // The range last asked for, so adopting the server's default range does not
  // immediately fetch the same thing a second time.
  const lastAsked = useRef<string | null>(null);

  const load = useCallback(async (wanted: Range | null) => {
    const id = ++requestId.current;
    setLoading(true);
    const args = wanted ? { _from: wanted.from, _to: wanted.to } : {};
    const [sales, steps] = await Promise.allSettled([
      supabase.rpc('sales_analytics' as never, args as never),
      supabase.rpc('funnel_summary' as never, args as never),
    ]);
    if (id !== requestId.current) return;

    if (sales.status === 'rejected' || sales.value.error) {
      // A blank page reads as "a quiet week". Say what actually happened.
      setError(sales.status === 'rejected' ? String(sales.reason) : sales.value.error?.message ?? 'Unknown error');
    } else if (!(sales as { value?: { data?: unknown } }).value?.data) {
      // An empty answer is not a quiet week either, and reading fields off it
      // used to throw inside this loader and leave the skeleton up for good.
      setError('The server returned no analytics for this range.');
    } else {
      const result = sales.value.data as unknown as Analytics;
      setError(null);
      setData(result);
      if (result.today) setToday(result.today);
      if (!wanted) {
        const served = { from: result.from, to: result.to };
        lastAsked.current = `${served.from}|${served.to}`;
        setRange(served);
        setDraft(served);
      }
    }

    if (steps.status === 'rejected' || steps.value.error) {
      setFunnelError(steps.status === 'rejected' ? String(steps.reason) : steps.value.error?.message ?? 'Unknown error');
    } else if (!(steps as { value?: { data?: unknown } }).value?.data) {
      setFunnelError('The server returned no funnel for this range.');
    } else {
      setFunnelError(null);
      setFunnel(steps.value.data as unknown as Funnel);
    }
    setLoading(false);
  }, []);

  // First load: the server's default range. After that, whatever was chosen.
  useEffect(() => {
    const key = range ? `${range.from}|${range.to}` : 'default';
    if (key === lastAsked.current) return;
    lastAsked.current = key;
    void load(range);
  }, [range, load]);

  // Typing a date fires a change per keystroke and per arrow press; wait for
  // the manager to stop before asking the server.
  useEffect(() => {
    if (!draft.from || !draft.to || draft.from > draft.to) return;
    if (range && draft.from === range.from && draft.to === range.to) return;
    const timer = setTimeout(() => setRange({ ...draft }), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [draft, range]);

  const anchor = today ?? range?.to ?? null;
  const preset = (days: number) => {
    if (!anchor) return;
    const next = { from: shiftDay(anchor, -(days - 1)), to: anchor };
    setDraft(next);
    setRange(next);
  };
  const activePreset = range && anchor && range.to === anchor ? daysBetween(range.from, range.to) + 1 : null;

  const totals = data?.totals;
  const netSales = totals ? Number(totals.net_sales ?? totals.revenue) : 0;
  const hasSales = (totals?.orders ?? 0) > 0;

  const dayChart = useMemo(() => (data?.by_day ?? []).map((d) => ({
    label: dayLabel(d.day),
    long: longDay(d.day),
    value: Number(d.net_sales ?? d.revenue),
  })), [data]);

  // Trim the dead hours at each end so the busy part of the day fills the
  // chart. Hours are Sarajevo wall-clock, from the server.
  const hourChart = useMemo(() => {
    const hours = data?.by_hour ?? [];
    const firstBusy = hours.findIndex((h) => h.orders > 0);
    const lastBusy = hours.length - 1 - [...hours].reverse().findIndex((h) => h.orders > 0);
    return (firstBusy === -1 ? hours : hours.slice(Math.max(0, firstBusy - 1), lastBusy + 2))
      .map((h) => ({ label: `${String(h.hour).padStart(2, '0')}:00`, orders: h.orders }));
  }, [data]);
  /** The hour the chart is about: most orders, the first one on a tie. */
  const busiestHour = hourChart.reduce((best, h, i) => (h.orders > 0 && (best === -1 || h.orders > hourChart[best].orders) ? i : best), -1);

  if (loading && !data && !error) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64 rounded-xl" />
        <Skeleton className="h-40 rounded-2xl" />
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-[118px] rounded-2xl" />)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-80 rounded-2xl" />)}
        </div>
      </div>
    );
  }

  const funnelTop = funnel ? Math.max(funnel.visits, ...funnel.steps.map((s) => s.visits), 1) : 1;
  const categoryTotal = (data?.by_category ?? []).reduce((sum, c) => sum + Number(c.revenue), 0);
  const rangeLabel = range ? `${shortDay(range.from)} – ${shortDay(range.to)}` : '';

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
        <div className="min-w-0">
          <h1 className="font-serif text-3xl font-bold text-foreground flex items-center gap-2">
            Analytics
            {loading && <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" aria-label="Loading" />}
          </h1>
          <p className="text-sm text-muted-foreground font-sans mt-1">
            Completed sales only, by Sarajevo trading day — abandoned and cancelled orders are excluded.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant={activePreset === 7 ? 'default' : 'outline'}
            size="sm"
            onClick={() => preset(7)}
            className="gap-1.5"
            aria-pressed={activePreset === 7}
          >
            <CalendarDays className="w-4 h-4" /> 7 days
          </Button>
          <Button
            variant={activePreset === 30 ? 'default' : 'outline'}
            size="sm"
            onClick={() => preset(30)}
            aria-pressed={activePreset === 30}
          >
            30 days
          </Button>
          <Input
            type="date" value={draft.from} max={draft.to || undefined}
            onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))}
            className="h-9 w-[150px]" aria-label="From date"
          />
          <Input
            type="date" value={draft.to} max={today ?? undefined} min={draft.from || undefined}
            onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))}
            className="h-9 w-[150px]" aria-label="To date"
          />
        </div>
      </div>

      {/* Why it moved, before what it was: the sentence a manager acts on. */}
      <SalesChangeCard />

      {error && (
        <AdminCard className="border-destructive/30 mb-6">
          <div className="p-5 flex items-start gap-2">
            <AlertTriangle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
            <div className="text-sm font-sans min-w-0">
              <p className="font-semibold text-foreground">Could not load analytics.</p>
              <p className="text-muted-foreground mt-0.5 break-words">{error}</p>
              {data && <p className="text-muted-foreground mt-0.5">Showing the last range that loaded.</p>}
            </div>
          </div>
        </AdminCard>
      )}

      {/* Old figures stay on screen while the new range loads, dimmed, so the
          page does not jump — and so nobody mistakes them for the new range. */}
      <div className={`transition-opacity ${loading ? 'opacity-60' : ''}`} aria-busy={loading}>
        {totals && (
          <Stagger className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4 mb-6">
            <KpiCard label="Net sales" value={netSales} format={money} unit="KM" hint="items, after refunds" />
            <KpiCard label="Orders" value={Number(totals.orders)} format={whole} hint={rangeLabel || undefined} />
            <KpiCard label="Average order" value={Number(totals.average_order)} format={money} unit="KM" hint="net, per order" />
            <KpiCard label="Items per order" value={Number(totals.items_per_order)} format={(n) => n.toFixed(2)} hint="on average" />
            <KpiCard label="Tips" value={Number(totals.tips)} format={money} unit="KM" hint="on top of net sales" />
          </Stagger>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <AdminCard>
            <AdminCardHeader icon={BarChart3} title="Net sales by day" description="KM per trading day, items after refunds." />
            <AdminCardContent>
              {!hasSales ? <Empty /> : (
                <AdminBarChart
                  data={dayChart}
                  name="net sales"
                  format={moneyKM}
                  axisFormat={compact}
                  summary={`Net sales by day, ${rangeLabel}.`}
                />
              )}
            </AdminCardContent>
          </AdminCard>

          <AdminCard>
            <AdminCardHeader icon={PieChartIcon} title="Item sales by category" description="Net item sales per menu category, largest first." />
            <AdminCardContent>
              {(data?.by_category.length ?? 0) === 0 ? <Empty /> : (
                <RankedBars
                  label="Item sales by category"
                  rows={[...(data?.by_category ?? [])]
                    .sort((a, b) => Number(b.revenue) - Number(a.revenue))
                    .map((c) => ({
                      key: c.name,
                      label: c.name,
                      value: Number(c.revenue),
                      display: moneyKM(Number(c.revenue)),
                      aside: categoryTotal > 0 ? `${Math.round((100 * Number(c.revenue)) / categoryTotal)}%` : undefined,
                    }))}
                />
              )}
            </AdminCardContent>
          </AdminCard>

          <AdminCard>
            <AdminCardHeader
              icon={Clock}
              title="Orders by hour"
              description={busiestHour >= 0
                ? `Sarajevo time, all days in the range. Busiest ${hourChart[busiestHour].label}.`
                : 'Sarajevo time, all days in the range.'}
            />
            <AdminCardContent>
              {!hasSales ? <Empty /> : (
                <AdminBarChart
                  data={hourChart.map((h) => ({ label: h.label, value: h.orders }))}
                  name="orders"
                  format={whole}
                  highlight={busiestHour}
                  allowDecimals={false}
                  summary={`Orders by hour of the day, ${rangeLabel}.`}
                />
              )}
            </AdminCardContent>
          </AdminCard>

          <AdminCard>
            <AdminCardHeader icon={Award} title="Most ordered" description="Portions sold in the range." />
            <AdminCardContent>
              {(data?.top_items.length ?? 0) === 0 ? <Empty /> : (
                <>
                  <RankedBars
                    label="Most ordered"
                    max={Math.max(...(data?.top_items ?? []).map((t) => Number(t.units)), 1)}
                    rows={(data?.top_items ?? []).slice(0, allTop ? undefined : TOP_SHOWN).map((t) => ({
                      key: t.item_id,
                      label: t.name,
                      value: Number(t.units),
                      display: whole(Number(t.units)),
                      aside: 'sold',
                    }))}
                  />
                  {(data?.top_items.length ?? 0) > TOP_SHOWN && (
                    <button
                      type="button"
                      onClick={() => setAllTop((v) => !v)}
                      className="mt-4 text-xs font-sans font-semibold text-primary min-h-[32px]"
                    >
                      {allTop ? 'Show fewer' : `Show all ${data?.top_items.length}`}
                    </button>
                  )}
                </>
              )}
            </AdminCardContent>
          </AdminCard>
        </div>

        {/* ---- The ordering funnel ---- */}
        <AdminCard className="mt-6">
          <AdminCardHeader
            icon={Filter}
            title="From menu to order"
            description="Guest visits that reached each step in this range. A visit is one phone at one table; each counts once per step."
          />
          <AdminCardContent>
            {funnelError ? (
              <div className="flex items-start gap-2 text-sm font-sans">
                <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                <p className="text-muted-foreground break-words">Could not load the funnel: {funnelError}</p>
              </div>
            ) : !funnel || funnel.visits === 0 ? (
              <EmptyState icon={Smartphone} title="No guest visits in this range." hint="Each step fills in as guests open the menu on their phones." />
            ) : (
              <ol className="space-y-3.5">
                {funnel.steps.map((s, i) => {
                  const previous = i > 0 ? funnel.steps[i - 1].visits : null;
                  const laterSteps = funnel.steps.slice(i + 1).some((later) => later.visits > 0);
                  // A zero followed by a non-zero is a step the app did not
                  // record, not a step every guest skipped.
                  const notRecorded = s.visits === 0 && laterSteps;
                  const width = `${Math.max(notRecorded ? 0 : 1, (100 * s.visits) / funnelTop)}%`;
                  return (
                    <li key={s.step}>
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm font-sans">
                        <span className="text-foreground">{STEP_LABELS[s.step] ?? s.step}</span>
                        <span className="tabular-nums text-muted-foreground">
                          {notRecorded ? 'not recorded' : (
                            <>
                              <strong className="font-semibold text-foreground">{s.visits}</strong>
                              {previous != null && previous > 0 && (
                                <> · {Math.round((100 * s.visits) / previous)}% of previous</>
                              )}
                            </>
                          )}
                        </span>
                      </div>
                      <div className="mt-1.5 h-1.5 rounded-full bg-primary/10 overflow-hidden">
                        <motion.div
                          className="h-full rounded-full bg-primary"
                          initial={reduceMotion ? false : { width: 0 }}
                          animate={{ width }}
                          transition={{ duration: 0.75, delay: reduceMotion ? 0 : i * 0.05, ease: [0.16, 1, 0.3, 1] }}
                          style={reduceMotion ? { width } : undefined}
                        />
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
            {funnel && funnel.visits > 0 && (
              <p className="text-xs font-sans text-muted-foreground mt-5">
                {funnel.visits} visits in total. A guest who browses and then orders through a waiter is not a lost
                sale — treat drop-off as something to look into, not as money missed.
              </p>
            )}
          </AdminCardContent>
        </AdminCard>

        <AdminCard className="mt-6">
          <AdminCardHeader icon={Armchair} title="Table turnover" description="How often each table was sat, and for how long." />
          <AdminCardContent>
            {(data?.table_turnover.length ?? 0) === 0 ? (
              <EmptyState icon={Armchair} title="No sittings in this range." hint="Tables appear here once guests have been seated and the table closed." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm font-sans">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground border-b border-border/70">
                      <th className="pb-2 font-medium">Table</th>
                      <th className="pb-2 font-medium text-right">Sittings</th>
                      <th className="pb-2 font-medium text-right">Average sitting</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {data?.table_turnover.map((t) => (
                      <tr key={t.table_number}>
                        <td className="py-2.5">Table {t.table_number}</td>
                        <td className="py-2.5 text-right tabular-nums">{t.sittings}</td>
                        {/* A bare session count used to be labelled "turnover"
                            and said nothing about how long a table was held. */}
                        <td className="py-2.5 text-right tabular-nums text-muted-foreground">
                          {t.avg_minutes ? `${t.avg_minutes} min` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </AdminCardContent>
        </AdminCard>

        {totals && (
          <p className="text-xs font-sans text-muted-foreground mt-4">
            Gross taken including tips: {km(totals.revenue)}
            {Number(totals.refunded ?? 0) > 0 && <> · refunded {km(totals.refunded)}</>}. That is the figure the
            Daily Report calls gross; net sales above leave the tips out.
          </p>
        )}
      </div>
    </div>
  );
};

export default AdminAnalytics;
