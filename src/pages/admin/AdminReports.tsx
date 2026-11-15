import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Download, Printer, CalendarDays, Wallet, ShoppingBag, CreditCard, Banknote, Smartphone, Coins, TrendingUp, AlertTriangle, Check, Clock, BarChart3 } from 'lucide-react';
import { dayReconciliation, type DayReconciliation } from '@/lib/staff-api';
import ShiftClosePanel from '@/components/admin/ShiftClosePanel';
import PrepForecastCard from '@/components/admin/PrepForecastCard';
import { businessDayISO, businessDayRange } from '@/lib/reporting';
import { useOutletContext } from 'react-router-dom';
import type { AdminOutletContext } from '@/components/admin/AdminLayout';
import { AdminCard, AdminCardContent, AdminCardHeader, EmptyState, KpiCard, Stagger } from '@/components/admin/AdminCard';
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
const km = (n: number) => `${n.toFixed(2)} KM`;

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

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
        <div className="min-w-0">
          <h1 className="font-serif text-3xl font-bold text-foreground">Daily Report</h1>
          <p className="text-sm text-muted-foreground font-sans mt-1">
            {dayName} · trading day 05:00 to 05:00, completed sales only.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {date !== todayISO() && <Button variant="outline" size="sm" onClick={() => setDate(todayISO())} className="gap-1.5"><CalendarDays className="w-4 h-4" /> Today</Button>}
          <Input type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} className="h-9 w-[150px]" />
          <Button variant="outline" size="sm" onClick={exportCsv} className="gap-1.5"><Download className="w-4 h-4" /> CSV</Button>
          <Button variant="outline" size="sm" onClick={() => window.print()} className="gap-1.5 no-print"><Printer className="w-4 h-4" /> Print</Button>
        </div>
      </div>

      {loading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[118px] rounded-2xl" />)}
          </div>
          <Skeleton className="h-[300px] rounded-2xl" />
        </div>
      ) : (
        <>
          {s.count > 0 && (
            s.unfiscalized > 0 ? (
              <div className="mb-5 flex items-center gap-2.5 rounded-2xl border border-amber-500/25 bg-amber-500/[0.07] px-4 py-3 text-sm font-sans text-amber-800 dark:text-amber-400">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                {s.unfiscalized} order{s.unfiscalized === 1 ? '' : 's'} not yet marked fiscalized — ring them into the POS, then mark them under Orders.
              </div>
            ) : (
              <div className="mb-5 flex items-center gap-2.5 rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm font-sans text-primary">
                <Check className="w-4 h-4 shrink-0" /> All orders fiscalized.
              </div>
            )
          )}
          <Stagger className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-3 sm:mb-4">
            <KpiCard icon={Wallet} label="Gross sales" value={s.gross} format={money} unit="KM" hint={`${s.count} orders`} />
            <KpiCard icon={Coins} label="Tips" value={s.tips} format={money} unit="KM" hint="for the staff, on top of sales" />
            <KpiCard icon={TrendingUp} label="Average order" value={s.avg} format={money} unit="KM" hint="gross, per order" />
            <KpiCard icon={ShoppingBag} label="Orders" value={s.count} format={whole} hint={s.peakHour >= 0 ? `Busiest: ${s.peakHour}:00` : undefined} />
          </Stagger>

          {/* Three settlement channels, never merged: they reconcile against
              the online gateway, the cash drawer and the POS terminal batch. */}
          <Stagger className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 mb-6">
            <KpiCard size="sm" icon={CreditCard} tone="muted" label="Card online" value={recon?.paid_online ?? s.cardPaidSum} format={money} unit="KM" hint={`confirmed paid · ${s.cardCount} chose card`} />
            <KpiCard size="sm" icon={Banknote} tone="muted" label="Cash" value={recon?.paid_cash ?? 0} format={money} unit="KM" hint="recorded by staff · match the drawer" />
            <KpiCard size="sm" icon={Smartphone} tone="muted" label="POS terminal" value={recon?.paid_pos_terminal ?? 0} format={money} unit="KM" hint="match the terminal batch" />
          </Stagger>

          <AdminCard className="mb-6">
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

          {recon && (recon.outstanding > 0 || recon.stuck_payments > 0 || recon.callback_problems > 0 || recon.refunded > 0) && (
            <AdminCard className="mb-6">
              <AdminCardHeader icon={AlertTriangle} tone="accent" title="Needs attention before close" />
              <AdminCardContent className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm font-sans">
                {recon.outstanding > 0 && (
                  <div className="flex items-start gap-2.5 rounded-xl bg-muted/50 px-3.5 py-3">
                    <Clock className="w-4 h-4 text-accent mt-0.5 shrink-0" />
                    <span><strong className="tabular-nums">{km(recon.outstanding)}</strong> still owed across {recon.outstanding_orders} order{recon.outstanding_orders === 1 ? '' : 's'} — collect or write off.</span>
                  </div>
                )}
                {recon.stuck_payments > 0 && (
                  <div className="flex items-start gap-2.5 rounded-xl bg-destructive/5 px-3.5 py-3">
                    <AlertTriangle className="w-4 h-4 text-destructive mt-0.5 shrink-0" />
                    <span><strong>{recon.stuck_payments}</strong> card payment{recon.stuck_payments === 1 ? '' : 's'} started and never resolved ({km(recon.stuck_amount)}). Those orders never reached the kitchen.</span>
                  </div>
                )}
                {recon.callback_problems > 0 && (
                  <div className="flex items-start gap-2.5 rounded-xl bg-destructive/5 px-3.5 py-3">
                    <AlertTriangle className="w-4 h-4 text-destructive mt-0.5 shrink-0" />
                    <span><strong>{recon.callback_problems}</strong> provider callback{recon.callback_problems === 1 ? '' : 's'} rejected for a wrong amount, wrong currency, or unknown order. Raise with Monri.</span>
                  </div>
                )}
                {recon.refunded > 0 && (
                  <div className="flex items-start gap-2.5 rounded-xl bg-muted/50 px-3.5 py-3">
                    <Coins className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                    <span><strong className="tabular-nums">{km(recon.refunded)}</strong> refunded today.</span>
                  </div>
                )}
              </AdminCardContent>
            </AdminCard>
          )}

          <ShiftClosePanel day={date} recon={recon} />

          {/* Tomorrow's prep, withheld unless it beats "same as last week". */}
          <PrepForecastCard />
        </>
      )}
    </div>
  );
};

export default AdminReports;
