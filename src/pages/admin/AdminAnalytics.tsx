import React, { useCallback, useEffect, useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { CalendarDays, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { localDayISO } from '@/lib/reporting';

/**
 * Sales analytics.
 *
 * Every figure comes from one `sales_analytics(from, to)` RPC rather than from
 * client-side aggregation. The previous version pulled the entire order and
 * order_items history into the browser with no date bound and no ordering,
 * which PostgREST silently truncates at 1000 rows — the charts kept drawing,
 * from an arbitrary slice, and got less true the busier the restaurant got. It
 * also counted abandoned card checkouts as revenue, so it disagreed with the
 * Daily Report about the same day.
 */

interface Analytics {
  from: string;
  to: string;
  totals: { revenue: number; tips: number; orders: number; average_order: number; items_per_order: number };
  by_day: { day: string; revenue: number; orders: number }[];
  by_hour: { hour: number; orders: number; revenue: number }[];
  by_category: { name: string; revenue: number; units: number }[];
  top_items: { item_id: string; name: string; units: number; revenue: number }[];
  table_turnover: { table_number: number; sittings: number; avg_minutes: number }[];
}

const PIE_COLORS = ['hsl(140 12% 53%)', 'hsl(38 60% 55%)', 'hsl(140 14% 42%)', 'hsl(38 50% 72%)', 'hsl(150 10% 45%)'];
const km = (n: number) => `${Number(n ?? 0).toFixed(2)} KM`;

const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return localDayISO(d);
};

const AdminAnalytics = () => {
  const [from, setFrom] = useState(daysAgo(6));
  const [to, setTo] = useState(localDayISO());
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data: result, error: rpcError } = await supabase.rpc('sales_analytics' as never, {
      _from: from, _to: to,
    } as never);
    if (rpcError) {
      // A blank page reads as "a quiet week". Say what actually happened.
      setError(rpcError.message);
      toast.error(rpcError.message);
    } else {
      setData(result as unknown as Analytics);
    }
    setLoading(false);
  }, [from, to]);

  useEffect(() => { void load(); }, [load]);

  const preset = (days: number) => { setFrom(daysAgo(days - 1)); setTo(localDayISO()); };

  if (loading && !data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64 rounded-xl" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-72 rounded-xl" />)}
        </div>
      </div>
    );
  }

  const totals = data?.totals;
  const dayChart = (data?.by_day ?? []).map((d) => ({
    label: new Date(d.day).toLocaleDateString('en', { weekday: 'short', day: 'numeric' }),
    revenue: d.revenue,
  }));

  // Trim the dead hours at each end so the busy part of the day fills the
  // chart. The old version hardcoded 08:00–23:00, which lost both best hours
  // for a bar that closes at 01:00.
  const hours = data?.by_hour ?? [];
  const firstBusy = hours.findIndex((h) => h.orders > 0);
  const lastBusy = hours.length - 1 - [...hours].reverse().findIndex((h) => h.orders > 0);
  const hourChart = (firstBusy === -1 ? hours : hours.slice(Math.max(0, firstBusy - 1), lastBusy + 2))
    .map((h) => ({ label: `${String(h.hour).padStart(2, '0')}:00`, orders: h.orders }));

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="font-serif text-3xl font-bold text-foreground">Analytics</h1>
          <p className="text-sm text-muted-foreground font-sans mt-1">
            Completed sales only — abandoned and cancelled orders are excluded, so these agree with the Daily Report.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={() => preset(7)} className="gap-1.5">
            <CalendarDays className="w-4 h-4" /> 7 days
          </Button>
          <Button variant="outline" size="sm" onClick={() => preset(30)}>30 days</Button>
          <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="h-9 w-[150px]" aria-label="From date" />
          <Input type="date" value={to} max={localDayISO()} onChange={(e) => setTo(e.target.value)} className="h-9 w-[150px]" aria-label="To date" />
        </div>
      </div>

      {error && (
        <Card className="border-destructive/30 mb-6">
          <CardContent className="p-4 flex items-start gap-2">
            <AlertTriangle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
            <div className="text-sm font-sans">
              <p className="font-semibold text-foreground">Could not load analytics.</p>
              <p className="text-muted-foreground mt-0.5">{error}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {totals && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
          {[
            ['Revenue', km(totals.revenue)],
            ['Orders', String(totals.orders)],
            ['Average order', km(totals.average_order)],
            ['Items per order', String(totals.items_per_order)],
            ['Tips', km(totals.tips)],
          ].map(([label, value]) => (
            <Card key={label} className="border-border">
              <CardContent className="p-4">
                <p className="text-xs font-sans text-muted-foreground">{label}</p>
                <p className="font-serif text-xl font-bold text-foreground mt-1 tabular-nums">{value}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="border-border">
          <CardHeader><CardTitle className="font-serif text-lg">Revenue by day</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={dayChart}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
                <Tooltip formatter={(v: number) => km(v)} />
                <Bar dataKey="revenue" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardHeader><CardTitle className="font-serif text-lg">Revenue by category</CardTitle></CardHeader>
          <CardContent>
            {(data?.by_category.length ?? 0) === 0 ? (
              <p className="text-sm text-muted-foreground font-sans py-16 text-center">No sales in this range.</p>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie data={data?.by_category} dataKey="revenue" nameKey="name" cx="50%" cy="50%" outerRadius={88}>
                    {(data?.by_category ?? []).map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number) => km(v)} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardHeader><CardTitle className="font-serif text-lg">Orders by hour</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={hourChart}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="orders" fill="hsl(var(--accent))" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardHeader><CardTitle className="font-serif text-lg">Most ordered</CardTitle></CardHeader>
          <CardContent>
            {(data?.top_items.length ?? 0) === 0 ? (
              <p className="text-sm text-muted-foreground font-sans py-16 text-center">No sales in this range.</p>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={data?.top_items} layout="vertical" margin={{ left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={12} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" width={130} stroke="hsl(var(--muted-foreground))" fontSize={11} />
                  <Tooltip />
                  <Bar dataKey="units" fill="hsl(var(--primary))" radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="border-border mt-6">
        <CardHeader><CardTitle className="font-serif text-lg">Table turnover</CardTitle></CardHeader>
        <CardContent>
          {(data?.table_turnover.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground font-sans py-6 text-center">No sittings in this range.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm font-sans min-w-[420px]">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground border-b border-border">
                    <th className="pb-2 font-medium">Table</th>
                    <th className="pb-2 font-medium text-right">Sittings</th>
                    <th className="pb-2 font-medium text-right">Average sitting</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data?.table_turnover.map((t) => (
                    <tr key={t.table_number}>
                      <td className="py-2">Table {t.table_number}</td>
                      <td className="py-2 text-right tabular-nums">{t.sittings}</td>
                      {/* A bare session count used to be labelled "turnover"
                          and said nothing about how long a table was held. */}
                      <td className="py-2 text-right tabular-nums text-muted-foreground">
                        {t.avg_minutes ? `${t.avg_minutes} min` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default AdminAnalytics;
