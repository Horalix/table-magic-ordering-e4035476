import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Download, Printer, CalendarDays, Wallet, ShoppingBag, CreditCard, Banknote, Smartphone, Coins, TrendingUp, AlertTriangle, Check, Clock, BarChart3 } from 'lucide-react';
import { Link, useOutletContext } from 'react-router-dom';
import { cn } from '@/lib/utils';
import CountUp from '@/components/admin/CountUp';
import { AdminPageHeader, AdminSection } from '@/components/admin/AdminPage';
import { dayReconciliation, type DayReconciliation } from '@/lib/staff-api';
import ShiftClosePanel from '@/components/admin/ShiftClosePanel';
import PrepForecastCard from '@/components/admin/PrepForecastCard';
import { businessDayISO, businessDayRange } from '@/lib/reporting';
import type { AdminOutletContext } from '@/components/admin/AdminLayout';
import { AdminCard, AdminCardContent, AdminCardHeader, EmptyState, Stagger } from '@/components/admin/AdminCard';
import AdminBarChart from '@/components/admin/AdminBarChart';
import { compact, moneyKM, money, whole } from '@/components/admin/admin-format';
import { salesByHour, trimQuietHours } from '@/components/admin/sales-by-hour';

interface DayOrder {
  id: string;
  total: number;
  tip_amount: number | null;
  payment_method: string | null;
  payment_status: string | null;
  status: string;
  created_at: string;
  fiscalized: boolean | null;
  fiscalization_status: string | null;
}

/** Orders that never became a sale must never be counted as one. */
const NON_SALE_STATUSES = ['awaiting_payment', 'payment_failed', 'cancelled'];

/**
 * Today's TRADING day, not today's UTC date.
 *
 * `toISOString()` is UTC, so between local midnight and 01:00/02:00 this page
 * opened on yesterday, and its order window ran 02:00 to 02:00 local while the
 * reconciliation beside it ran on Sarajevo days. Both now use the business day
 * (05:00 to 05:00 local), the same one `day_reconciliation()` and
 * `close_shift()` use, so the hourly chart and the money figures describe one
 * night.
 */
const todayISO = () => businessDayISO();

const AdminReports = () => {
  // This restaurant's name on the export, not always La Soul's.
  const outlet = useOutletContext<AdminOutletContext | null>();
  const venueName = outlet?.venueName ?? 'La Soul';
  const fileSlug = outlet?.venueSlug ?? 'lasoul';
  const [date, setDate] = useState(todayISO());
  const [orders, setOrders] = useState<DayOrder[]>([]);
  const [recon, setRecon] = useState<DayReconciliation | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    // Half-open: the day ends exactly where the next one starts.
    const { start, end } = businessDayRange(date);
    const { data } = await supabase
      .from('orders')
      .select('id, total, tip_amount, payment_method, payment_status, status, created_at, fiscalized, fiscalization_status')
      .gte('created_at', start).lt('created_at', end)
      .order('created_at', { ascending: true });
    // The hourly chart uses real sales only; the money figures come from the
    // server so the dashboard and the reconciliation cannot disagree.
    setOrders(((data ?? []) as DayOrder[]).filter((o) => !NON_SALE_STATUSES.includes(o.status)));
    setRecon(await dayReconciliation(date).catch(() => null));
    setLoading(false);
  }, [date]);
  useEffect(() => { void load(); }, [load]);

  const s = useMemo(() => {
    const gross = orders.reduce((a, o) => a + Number(o.total), 0);
    const tips = orders.reduce((a, o) => a + Number(o.tip_amount ?? 0), 0);
    const card = orders.filter((o) => o.payment_method === 'card_online' || o.payment_method === 'card');
    const cash = orders.filter((o) => o.payment_method === 'cash' || !o.payment_method);
    const pos = orders.filter((o) => o.payment_method === 'pos_terminal');
    const cardPaid = card.filter((o) => o.payment_status === 'paid');
    const byHour = new Array(24).fill(0) as number[];
    orders.forEach((o) => { byHour[new Date(o.created_at).getHours()] += Number(o.total); });
    const peak = byHour.reduce((best, v, h) => (v > best.v ? { h, v } : best), { h: -1, v: 0 });
    return {
      gross, tips, count: orders.length,
      avg: orders.length ? gross / orders.length : 0,
      cardSum: card.reduce((a, o) => a + Number(o.total), 0), cardCount: card.length,
      cardPaidSum: cardPaid.reduce((a, o) => a + Number(o.total), 0),
      cashSum: cash.reduce((a, o) => a + Number(o.total), 0), cashCount: cash.length,
      posSum: pos.reduce((a, o) => a + Number(o.total), 0), posCount: pos.length,
      peakHour: peak.h, peakSum: peak.v, byHour,
      unfiscalized: orders.filter((o) => (o.fiscalization_status ?? (o.fiscalized ? 'fiscalized' : 'not_fiscalized')) !== 'fiscalized').length,
    };
  }, [orders]);

  // The chart's hours run as the trading day did (05:00 first), trimmed to
  // the service; its highlighted bar is the hour the Orders card names.
  const hourly = useMemo(() => trimQuietHours(salesByHour(orders)), [orders]);
  const busiest = hourly.findIndex((h) => h.hour === s.peakHour);
  const dayName = new Date(`${date}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

  const exportCsv = () => {
    const rows = [
      [`${venueName} daily report`, date],
      [],
      ['Metric', 'Value'],
      ['Orders', String(s.count)],
      ['Gross sales (KM)', s.gross.toFixed(2)],
      ['Tips (KM)', s.tips.toFixed(2)],
      ['Average order (KM)', s.avg.toFixed(2)],
      ['Card online orders', String(s.cardCount)],
      ['Card online total (KM)', s.cardSum.toFixed(2)],
      ['Card online confirmed paid (KM)', s.cardPaidSum.toFixed(2)],
      ['Cash orders', String(s.cashCount)],
      ['Cash total (KM)', s.cashSum.toFixed(2)],
      ['POS terminal orders', String(s.posCount)],
      ['POS terminal total (KM)', s.posSum.toFixed(2)],
      ['Still owed (KM)', (recon?.outstanding ?? 0).toFixed(2)],
      ['Refunded (KM)', (recon?.refunded ?? 0).toFixed(2)],
      ['Cancelled orders', String(recon?.cancelled_orders ?? 0)],
      ['Payments started but unresolved', String(recon?.stuck_payments ?? 0)],
      ['Provider callback problems', String(recon?.callback_problems ?? 0)],
      ['Not fiscalized (KM)', (recon?.unfiscalized ?? 0).toFixed(2)],
      [],
      ['Order id', 'Time', 'Payment', 'Status', 'Tip (KM)', 'Total (KM)'],
      ...orders.map((o) => [
        o.id, new Date(o.created_at).toLocaleTimeString(), o.payment_method ?? 'cash',
        o.payment_status ?? '', Number(o.tip_amount ?? 0).toFixed(2), Number(o.total).toFixed(2),
      ]),
    ];
    const csv = rows.map((r) => r.map((c) => /[",\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : c).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${fileSlug}-report-${date}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  };

  // What to settle before signing off, in the order a manager deals with it.
  const attention: { key: string; icon: React.ElementType; tone: 'warn' | 'danger' | 'quiet'; text: React.ReactNode }[] = [];
  if (s.unfiscalized > 0) attention.push({
    key: 'fiscal', icon: AlertTriangle, tone: 'warn',
    text: <><strong className="font-semibold tabular-nums">{s.unfiscalized}</strong> order{s.unfiscalized === 1 ? '' : 's'} not yet marked fiscalized. Ring them into the POS, then mark them under <Link to="/admin/orders" className="font-medium underline underline-offset-2 hover:text-foreground print:no-underline">Orders</Link>.</>,
  });
  if (recon) {
    if (recon.outstanding > 0) attention.push({
      key: 'owed', icon: Clock, tone: 'warn',
      text: <><strong className="font-semibold tabular-nums">{moneyKM(recon.outstanding)}</strong> still owed across {recon.outstanding_orders} order{recon.outstanding_orders === 1 ? '' : 's'}. Collect or write off.</>,
    });
    if (recon.stuck_payments > 0) attention.push({
      key: 'stuck', icon: AlertTriangle, tone: 'danger',
      text: <><strong className="font-semibold tabular-nums">{recon.stuck_payments}</strong> card payment{recon.stuck_payments === 1 ? '' : 's'} started and never resolved ({moneyKM(recon.stuck_amount)}). Those orders never reached the kitchen.</>,
    });
    if (recon.callback_problems > 0) attention.push({
      key: 'callback', icon: AlertTriangle, tone: 'danger',
      text: <><strong className="font-semibold tabular-nums">{recon.callback_problems}</strong> provider callback{recon.callback_problems === 1 ? '' : 's'} rejected for a wrong amount, wrong currency, or unknown order. Raise with Monri.</>,
    });
    if (recon.refunded > 0) attention.push({
      key: 'refunded', icon: Coins, tone: 'quiet',
      text: <><strong className="font-semibold tabular-nums">{moneyKM(recon.refunded)}</strong> refunded on this day.</>,
    });
  }
  const showAttention = attention.length > 0 || s.count > 0;
  const isToday = date === todayISO();

  return (
    // The global print sheet hides everything but QR stickers; this page
    // opts back in so Print gives a clean A4 of the day's figures.
    <div className="print:visible print:text-black print:[&_*]:visible">
      <AdminPageHeader
        className="print:!block print:mb-4"
        eyebrow={isToday ? `Today · ${dayName}` : dayName}
        title="Daily report"
        description="Close the trading day: what was sold, how it was paid, and what to settle before you sign off. Trading day 05:00 to 05:00, completed sales only."
        actions={(
          <div className="no-print flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <label className="sr-only" htmlFor="report-day">Day</label>
            <Input
              id="report-day" type="date" value={date} max={todayISO()}
              onChange={(e) => { if (e.target.value) setDate(e.target.value); }}
              className="h-11 min-w-0 flex-1 text-base sm:h-10 sm:w-[160px] sm:flex-none sm:text-sm"
            />
            {!isToday && (
              <Button variant="outline" onClick={() => setDate(todayISO())} className="h-11 gap-1.5 sm:h-10">
                <CalendarDays className="h-4 w-4" aria-hidden /> Today
              </Button>
            )}
            <Button variant="outline" onClick={exportCsv} className="h-11 gap-1.5 sm:h-10">
              <Download className="h-4 w-4" aria-hidden /> CSV
            </Button>
            <Button variant="outline" onClick={() => window.print()} className="h-11 gap-1.5 sm:h-10">
              <Printer className="h-4 w-4" aria-hidden /> Print
            </Button>
          </div>
        )}
      />

      {loading ? (
        <div className="space-y-8" aria-busy="true" aria-label="Loading the report">
          <Skeleton className="h-[230px] rounded-2xl lg:h-[200px]" />
          <Skeleton className="h-[290px] rounded-2xl sm:h-[150px]" />
          <Skeleton className="h-[120px] rounded-2xl" />
          <Skeleton className="h-[360px] rounded-2xl" />
        </div>
      ) : (
        <Stagger className="space-y-8">
          {/* ---- The day's totals: the figure the manager came for ---- */}
          <section aria-label="The day's totals">
            <AdminCard className="overflow-hidden print:shadow-none">
              <div className="grid lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
                <div className="p-5 sm:p-7">
                  <p className="flex items-center gap-2 text-[13px] font-sans font-medium text-muted-foreground">
                    <Wallet className="h-4 w-4" aria-hidden /> Gross sales
                  </p>
                  <p className="mt-3 font-sans text-[2.75rem] font-semibold leading-none tracking-tight text-foreground tabular-nums sm:text-6xl">
                    <CountUp value={s.gross} format={money} />
                    <span className="ms-2 text-lg font-medium tracking-normal text-muted-foreground sm:text-xl">KM</span>
                  </p>
                  <p className="mt-4 text-sm font-sans leading-relaxed text-muted-foreground">
                    {s.count === 0
                      ? 'No completed sales on this day.'
                      : <>From {whole(s.count)} completed order{s.count === 1 ? '' : 's'}{s.peakHour >= 0 && <>, busiest at {String(s.peakHour).padStart(2, '0')}:00</>}.</>}
                  </p>
                </div>
                <dl className="grid grid-cols-3 divide-x divide-border/70 border-t border-border/70 lg:grid-cols-1 lg:divide-x-0 lg:divide-y lg:border-s lg:border-t-0">
                  <TotalStat icon={ShoppingBag} label="Orders" value={whole(s.count)} hint="completed" />
                  <TotalStat icon={TrendingUp} label="Average order" value={money(s.avg)} unit="KM" hint="gross, per order" />
                  <TotalStat icon={Coins} label="Tips" value={money(s.tips)} unit="KM" hint="for the staff, on top" />
                </dl>
              </div>
            </AdminCard>
          </section>

          {/* ---- Three settlement channels, never merged: they reconcile
              against the online gateway, the cash drawer and the POS
              terminal batch. ---- */}
          <AdminSection title="How it was paid" titleId="report-paid" description="Check each against its own source before you close.">
            <AdminCard className="overflow-hidden print:shadow-none">
              <dl className="grid grid-cols-1 divide-y divide-border/70 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
                <Channel icon={CreditCard} label="Card online" value={recon?.paid_online ?? s.cardPaidSum} hint={`Confirmed paid · ${s.cardCount} chose card`} />
                <Channel icon={Banknote} label="Cash" value={recon?.paid_cash ?? 0} hint="Recorded by staff · match the drawer" />
                <Channel icon={Smartphone} label="POS terminal" value={recon?.paid_pos_terminal ?? 0} hint="Match the terminal batch" />
              </dl>
            </AdminCard>
          </AdminSection>

          {/* ---- What to settle before signing off ---- */}
          {showAttention && (
            <AdminSection
              title="Needs attention before close"
              titleId="report-attention"
              description={attention.length > 0
                ? `${attention.length} thing${attention.length === 1 ? '' : 's'} to look at. None of them stops you closing.`
                : undefined}
            >
              <AdminCard className="print:shadow-none">
                {attention.length > 0 && (
                  <ul className="divide-y divide-border/70">
                    {attention.map((a) => (
                      <li key={a.key} className="flex items-start gap-3 px-5 py-4 text-sm font-sans leading-relaxed text-foreground sm:px-6">
                        <span
                          className={cn(
                            'grid h-7 w-7 shrink-0 place-items-center rounded-full',
                            a.tone === 'danger' && 'bg-destructive/10 text-destructive',
                            a.tone === 'warn' && 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
                            a.tone === 'quiet' && 'bg-muted text-muted-foreground',
                          )}
                          aria-hidden
                        >
                          <a.icon className="h-3.5 w-3.5" />
                        </span>
                        <span className="min-w-0 pt-[3px]">{a.text}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {s.count > 0 && s.unfiscalized === 0 && (
                  <p className={cn('flex items-center gap-3 px-5 py-4 text-sm font-sans text-muted-foreground sm:px-6', attention.length > 0 && 'border-t border-border/70')}>
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary/10 text-primary" aria-hidden>
                      <Check className="h-3.5 w-3.5" />
                    </span>
                    <span>All orders fiscalized.{attention.length === 0 && ' Nothing owed, nothing stuck.'}</span>
                  </p>
                )}
              </AdminCard>
            </AdminSection>
          )}

          {/* ---- Sign off ---- */}
          <ShiftClosePanel day={date} recon={recon} />

          {/* ---- The day in detail ---- */}
          <AdminCard className="print:break-inside-avoid print:shadow-none">
            <AdminCardHeader
              icon={BarChart3}
              title="Sales by hour"
              description={busiest >= 0
                ? <>Gross sales in each hour of the day. Busiest {hourly[busiest].label}: {moneyKM(hourly[busiest].sales)} from {hourly[busiest].orders} order{hourly[busiest].orders === 1 ? '' : 's'}.</>
                : 'Gross sales in each hour of the day.'}
            />
            <AdminCardContent>
              {s.count === 0 ? (
                <EmptyState
                  icon={Clock}
                  title="No orders on this day."
                  hint="Each hour's sales appear here as orders come in."
                  className="h-[240px] py-0"
                />
              ) : (
                <AdminBarChart
                  data={hourly.map((h) => ({ label: h.label, value: h.sales, long: `${h.label} · ${h.orders} order${h.orders === 1 ? '' : 's'}` }))}
                  name="gross"
                  format={moneyKM}
                  axisFormat={compact}
                  highlight={busiest}
                  height={240}
                  summary={`Gross sales by hour on ${dayName}.`}
                />
              )}
            </AdminCardContent>
          </AdminCard>

          {/* Tomorrow's prep, withheld unless it beats "same as last week". */}
          <PrepForecastCard />
        </Stagger>
      )}
    </div>
  );
};

/** One of the three smaller totals beside gross sales. */
const TotalStat = ({ icon: Icon, label, value, unit, hint }: {
  icon: React.ElementType; label: string; value: string; unit?: string; hint: string;
}) => (
  <div className="min-w-0 px-3 py-4 sm:px-5 lg:flex lg:items-center lg:justify-between lg:gap-4 lg:px-6 lg:py-0">
    <dt className="flex min-w-0 items-center gap-1.5 text-xs font-sans font-medium text-muted-foreground sm:text-[13px]">
      <Icon className="hidden h-3.5 w-3.5 shrink-0 sm:block" aria-hidden />
      <span className="truncate">{label}</span>
    </dt>
    <dd className="mt-1.5 lg:mt-0 lg:text-end">
      <span className="block whitespace-nowrap font-sans text-base font-semibold leading-tight text-foreground tabular-nums sm:text-xl">
        {value}{unit && <span className="ms-1 text-xs font-medium text-muted-foreground sm:text-sm">{unit}</span>}
      </span>
      <span className="mt-0.5 hidden text-xs font-sans text-muted-foreground sm:block">{hint}</span>
    </dd>
  </div>
);

/** A settlement channel: what the system recorded, and what to check it against. */
const Channel = ({ icon: Icon, label, value, hint }: { icon: React.ElementType; label: string; value: number; hint: string }) => (
  <div className="flex items-center gap-4 px-5 py-4 sm:block sm:px-6 sm:py-5">
    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground sm:mb-3 sm:h-8 sm:w-8" aria-hidden>
      <Icon className="h-4 w-4" />
    </span>
    <div className="min-w-0 flex-1">
      <dt className="text-[13px] font-sans font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-1">
        <span className="block font-sans text-xl font-semibold leading-tight tracking-tight text-foreground tabular-nums sm:text-[26px]">
          {money(value)}<span className="ms-1 text-sm font-medium tracking-normal text-muted-foreground">KM</span>
        </span>
        <span className="mt-1 block text-xs font-sans leading-snug text-muted-foreground">{hint}</span>
      </dd>
    </div>
  </div>
);

export default AdminReports;
