import React, { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Database } from '@/integrations/supabase/types';

type OrderSummary = Pick<Database['public']['Tables']['orders']['Row'], 'id' | 'total' | 'created_at' | 'status'>;
type ItemOrderRow = {
  quantity: number;
  order_id: string;
  menu_items: { name: string } | null;
};
type CategoryOrderRow = {
  quantity: number;
  unit_price: number;
  order_id: string;
  menu_items: {
    subcategories: {
      categories: { name: string } | null;
    } | null;
  } | null;
};
type SessionTurnoverRow = {
  table_id: string;
  is_active: boolean;
  tables: { table_number: number } | null;
};
type TopItemDatum = { name: string; orders: number };
type DailyRevenueDatum = { date: string; revenue: number };
type CategoryBreakdownDatum = { name: string; value: number };
type PeakHourDatum = { hour: string; orders: number };
type TableTurnoverDatum = { table: string; sessions: number };

const COLORS = ['hsl(135,14%,55%)', 'hsl(38,60%,55%)', 'hsl(150,10%,45%)', 'hsl(38,50%,75%)', 'hsl(135,14%,85%)'];

const AdminAnalytics = () => {
  const [topItems, setTopItems] = useState<TopItemDatum[]>([]);
  const [dailyRevenue, setDailyRevenue] = useState<DailyRevenueDatum[]>([]);
  const [categoryBreakdown, setCategoryBreakdown] = useState<CategoryBreakdownDatum[]>([]);
  const [peakHours, setPeakHours] = useState<PeakHourDatum[]>([]);
  const [tableTurnover, setTableTurnover] = useState<TableTurnoverDatum[]>([]);

  useEffect(() => {
    const fetchAnalytics = async () => {
      const { data: validOrdersRaw, error: validOrdersError } = await supabase
        .from('orders')
        .select('id, total, created_at, status')
        .neq('status', 'cancelled');

      if (validOrdersError) return;

      const validOrders = (validOrdersRaw ?? []) as OrderSummary[];
      const validOrderIds = new Set(validOrders.map((order) => order.id));

      const { data: orderItemsRaw } = await supabase
        .from('order_items')
        .select('quantity, order_id, menu_items(name)');

      const orderItems = (orderItemsRaw ?? []) as ItemOrderRow[];
      const itemCounts: Record<string, number> = {};
      orderItems.forEach((orderItem) => {
        if (!validOrderIds.has(orderItem.order_id)) return;
        const name = orderItem.menu_items?.name ?? 'Unknown';
        itemCounts[name] = (itemCounts[name] ?? 0) + orderItem.quantity;
      });
      setTopItems(
        Object.entries(itemCounts)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 10)
          .map(([name, count]) => ({ name, orders: count })),
      );

      const days: string[] = [];
      for (let i = 6; i >= 0; i -= 1) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        days.push(date.toISOString().split('T')[0]);
      }

      const revenueByDay: Record<string, number> = {};
      days.forEach((day) => {
        revenueByDay[day] = 0;
      });
      validOrders.forEach((order) => {
        const day = order.created_at.split('T')[0];
        if (revenueByDay[day] !== undefined) {
          revenueByDay[day] += Number(order.total);
        }
      });
      setDailyRevenue(
        Object.entries(revenueByDay).map(([date, revenue]) => ({
          date: new Date(date).toLocaleDateString('en', { weekday: 'short' }),
          revenue: Math.round(revenue * 100) / 100,
        })),
      );

      const { data: catItemsRaw } = await supabase
        .from('order_items')
        .select('quantity, unit_price, order_id, menu_items(subcategories(categories(name)))');

      const catItems = (catItemsRaw ?? []) as CategoryOrderRow[];
      const catRevenue: Record<string, number> = {};
      catItems.forEach((orderItem) => {
        if (!validOrderIds.has(orderItem.order_id)) return;
        const name = orderItem.menu_items?.subcategories?.categories?.name ?? 'Other';
        catRevenue[name] = (catRevenue[name] ?? 0) + (orderItem.quantity * Number(orderItem.unit_price));
      });
      setCategoryBreakdown(
        Object.entries(catRevenue).map(([name, value]) => ({
          name,
          value: Math.round(value * 100) / 100,
        })),
      );

      const today = new Date().toISOString().split('T')[0];
      const todayOrders = validOrders.filter((order) => order.created_at.startsWith(today));
      const hourCounts: Record<number, number> = {};
      for (let h = 8; h <= 23; h += 1) hourCounts[h] = 0;
      todayOrders.forEach((order) => {
        const hour = new Date(order.created_at).getHours();
        if (hour >= 8 && hour <= 23) hourCounts[hour] += 1;
      });
      setPeakHours(
        Object.entries(hourCounts).map(([hour, count]) => ({
          hour: `${Number.parseInt(hour, 10).toString().padStart(2, '0')}:00`,
          orders: count,
        })),
      );

      const { data: sessionsRaw } = await supabase
        .from('table_sessions')
        .select('table_id, is_active, tables(table_number)')
        .gte('opened_at', today);

      const sessions = (sessionsRaw ?? []) as SessionTurnoverRow[];
      const turnover: Record<number, number> = {};
      sessions.forEach((session) => {
        const num = session.tables?.table_number ?? 0;
        turnover[num] = (turnover[num] ?? 0) + 1;
      });
      setTableTurnover(
        Object.entries(turnover)
          .sort(([a], [b]) => Number.parseInt(a, 10) - Number.parseInt(b, 10))
          .map(([table, sessionsCount]) => ({ table: `T${table}`, sessions: sessionsCount })),
      );
    };

    void fetchAnalytics();
  }, []);

  return (
    <div>
      <h1 className="font-serif text-3xl font-bold text-foreground mb-6">Analytics</h1>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="border-border">
          <CardHeader>
            <CardTitle className="font-serif text-lg">Revenue (Last 7 Days)</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={dailyRevenue}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip formatter={(v: number) => `${v.toFixed(2)} KM`} />
                <Bar dataKey="revenue" fill="hsl(135,14%,55%)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardHeader>
            <CardTitle className="font-serif text-lg">Revenue by Category</CardTitle>
          </CardHeader>
          <CardContent>
            {categoryBreakdown.length > 0 ? (
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie data={categoryBreakdown} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, value }) => `${name}: ${value} KM`}>
                    {categoryBreakdown.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number) => `${v.toFixed(2)} KM`} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-muted-foreground font-sans text-sm text-center py-10">No data yet</p>
            )}
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardHeader>
            <CardTitle className="font-serif text-lg">Peak Hours (Today)</CardTitle>
          </CardHeader>
          <CardContent>
            {peakHours.some((hour) => hour.orders > 0) ? (
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={peakHours}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="hour" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="orders" fill="hsl(38,60%,55%)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-muted-foreground font-sans text-sm text-center py-10">No orders today</p>
            )}
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardHeader>
            <CardTitle className="font-serif text-lg">Table Turnover (Today)</CardTitle>
          </CardHeader>
          <CardContent>
            {tableTurnover.length > 0 ? (
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={tableTurnover}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="table" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="sessions" fill="hsl(150,10%,45%)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-muted-foreground font-sans text-sm text-center py-10">No sessions today</p>
            )}
          </CardContent>
        </Card>

        <Card className="border-border lg:col-span-2">
          <CardHeader>
            <CardTitle className="font-serif text-lg">Most Ordered Items</CardTitle>
          </CardHeader>
          <CardContent>
            {topItems.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={topItems} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis type="number" tick={{ fontSize: 12 }} />
                  <YAxis dataKey="name" type="category" width={150} tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Bar dataKey="orders" fill="hsl(38,60%,55%)" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-muted-foreground font-sans text-sm text-center py-10">No orders yet</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default AdminAnalytics;
