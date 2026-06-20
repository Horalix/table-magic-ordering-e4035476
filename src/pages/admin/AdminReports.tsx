import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Download, Printer, CalendarDays, DollarSign, ShoppingBag, CreditCard, Banknote, Coins, TrendingUp } from 'lucide-react';
import { useCountUp } from '@/lib/motion';

interface DayOrder {
  id: string;
  total: number;
  tip_amount: number | null;
  payment_method: string | null;
  payment_status: string | null;
  status: string;
  created_at: string;
}

const todayISO = () => new Date().toISOString().slice(0, 10);
const km = (n: number) => `${n.toFixed(2)} KM`;

const Stat = ({ icon: Icon, label, value, sub, color = 'text-primary' }: { icon: React.ElementType; label: string; value: string; sub?: string; color?: string }) => (
  <Card className="border-border card-lux-hover">
    <CardContent className="p-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-sans text-muted-foreground">{label}</p>
          <p className="text-2xl font-serif font-bold text-foreground mt-1 tabular-nums">{value}</p>
          {sub && <p className="text-xs font-sans text-muted-foreground mt-0.5">{sub}</p>}
        </div>
        <div className={`w-10 h-10 rounded-lg bg-muted flex items-center justify-center ${color}`}><Icon className="w-5 h-5" /></div>
      </div>
    </CardContent>
  </Card>
);

const AdminReports = () => {
  const [date, setDate] = useState(todayISO());
  const [orders, setOrders] = useState<DayOrder[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const start = `${date}T00:00:00`;
    const end = `${date}T23:59:59.999`;
    const { data } = await supabase
      .from('orders')
      .select('id, total, tip_amount, payment_method, payment_status, status, created_at')
      .gte('created_at', start).lte('created_at', end)
      .order('created_at', { ascending: true });
    setOrders(((data ?? []) as DayOrder[]).filter((o) => o.status !== 'cancelled'));
    setLoading(false);
  }, [date]);
  useEffect(() => { void load(); }, [load]);

  const s = useMemo(() => {
    const gross = orders.reduce((a, o) => a + Number(o.total), 0);
    const tips = orders.reduce((a, o) => a + Number(o.tip_amount ?? 0), 0);
    const card = orders.filter((o) => o.payment_method === 'card');
    const cash = orders.filter((o) => o.payment_method === 'cash' || !o.payment_method);
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
      peakHour: peak.h, peakSum: peak.v, byHour,
    };
  }, [orders]);

  const grossAnim = useCountUp(s.gross);

  const exportCsv = () => {
    const rows = [
      ['La Soul daily report', date],
      [],
      ['Metric', 'Value'],
      ['Orders', String(s.count)],
      ['Gross sales (KM)', s.gross.toFixed(2)],
      ['Tips (KM)', s.tips.toFixed(2)],
      ['Average order (KM)', s.avg.toFixed(2)],
      ['Card orders', String(s.cardCount)],
      ['Card total (KM)', s.cardSum.toFixed(2)],
      ['Card paid online (KM)', s.cardPaidSum.toFixed(2)],
      ['Cash orders', String(s.cashCount)],
      ['Cash total (KM)', s.cashSum.toFixed(2)],
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
    a.href = url; a.download = `la-soul-report-${date}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  };

  const maxHour = Math.max(...s.byHour, 1);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h1 className="font-serif text-3xl font-bold text-foreground">Daily Report</h1>
        <div className="flex items-center gap-2 flex-wrap">
          {date !== todayISO() && <Button variant="outline" size="sm" onClick={() => setDate(todayISO())} className="gap-1.5"><CalendarDays className="w-4 h-4" /> Today</Button>}
          <Input type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} className="h-9 w-[150px]" />
          <Button variant="outline" size="sm" onClick={exportCsv} className="gap-1.5"><Download className="w-4 h-4" /> CSV</Button>
          <Button variant="outline" size="sm" onClick={() => window.print()} className="gap-1.5 no-print"><Printer className="w-4 h-4" /> Print</Button>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[92px] rounded-xl" />)}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <Stat icon={DollarSign} label="Gross sales" value={km(grossAnim)} sub={`${s.count} orders`} />
            <Stat icon={Coins} label="Tips" value={km(s.tips)} color="text-accent" />
            <Stat icon={TrendingUp} label="Average order" value={km(s.avg)} color="text-accent" />
            <Stat icon={ShoppingBag} label="Orders" value={String(s.count)} sub={s.peakHour >= 0 ? `Busiest: ${s.peakHour}:00` : undefined} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
            <Card className="border-border"><CardContent className="p-5">
              <div className="flex items-center gap-2 mb-1"><CreditCard className="w-4 h-4 text-primary" /><p className="font-sans font-semibold text-foreground">Card</p></div>
              <p className="text-2xl font-serif font-bold tabular-nums">{km(s.cardSum)}</p>
              <p className="text-xs text-muted-foreground font-sans mt-1">{s.cardCount} orders · {km(s.cardPaidSum)} paid online</p>
            </CardContent></Card>
            <Card className="border-border"><CardContent className="p-5">
              <div className="flex items-center gap-2 mb-1"><Banknote className="w-4 h-4 text-muted-foreground" /><p className="font-sans font-semibold text-foreground">Cash / at table</p></div>
              <p className="text-2xl font-serif font-bold tabular-nums">{km(s.cashSum)}</p>
              <p className="text-xs text-muted-foreground font-sans mt-1">{s.cashCount} orders</p>
            </CardContent></Card>
          </div>

          <Card className="border-border">
            <CardHeader><CardTitle className="font-serif text-lg">Sales by hour</CardTitle></CardHeader>
            <CardContent>
              {s.count === 0 ? (
                <p className="text-sm text-muted-foreground font-sans py-6 text-center">No orders on this day.</p>
              ) : (
                <div className="flex items-end gap-1 h-32">
                  {s.byHour.map((v, h) => (
                    <div key={h} className="flex-1 flex flex-col items-center justify-end gap-1" title={`${h}:00 — ${km(v)}`}>
                      <div className="w-full rounded-t bg-primary/70" style={{ height: `${(v / maxHour) * 100}%`, minHeight: v > 0 ? 2 : 0 }} />
                      {h % 3 === 0 && <span className="text-[9px] text-muted-foreground tabular-nums">{h}</span>}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
};

export default AdminReports;
