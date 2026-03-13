import React, { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

const COLORS = ['hsl(135,14%,55%)', 'hsl(38,60%,55%)', 'hsl(150,10%,45%)', 'hsl(38,50%,75%)', 'hsl(135,14%,85%)'];

const AdminAnalytics = () => {
  const [topItems, setTopItems] = useState<any[]>([]);
  const [dailyRevenue, setDailyRevenue] = useState<any[]>([]);
  const [categoryBreakdown, setCategoryBreakdown] = useState<any[]>([]);
  const [peakHours, setPeakHours] = useState<any[]>([]);
  const [tableTurnover, setTableTurnover] = useState<any[]>([]);

  useEffect(() => {
    const fetchAnalytics = async () => {
      // Get all non-cancelled order IDs first
      const { data: validOrders } = await supabase
        .from('orders')
        .select('id, total, created_at, status')
        .neq('status', 'cancelled');

      const validOrderIds = new Set((validOrders || []).map(o => o.id));

      // Top ordered items — only from non-cancelled orders
      const { data: orderItems } = await supabase
        .from('order_items')
        .select('quantity, order_id, menu_items(name)');

      const itemCounts: Record<string, number> = {};
      orderItems?.forEach((oi: any) => {
        if (!validOrderIds.has(oi.order_id)) return;
        const name = oi.menu_items?.name || 'Unknown';
        itemCounts[name] = (itemCounts[name] || 0) + oi.quantity;
      });
      const sorted = Object.entries(itemCounts)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 10)
        .map(([name, count]) => ({ name, orders: count }));
      setTopItems(sorted);

      // Daily revenue (last 7 days)
      const days = [];
      for (let i = 6; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        days.push(date.toISOString().split('T')[0]);
      }

      const revenueByDay: Record<string, number> = {};
      days.forEach(d => revenueByDay[d] = 0);
      validOrders?.forEach((o: any) => {
        const day = o.created_at.split('T')[0];
        if (revenueByDay[day] !== undefined) {
          revenueByDay[day] += Number(o.total);
        }
      });
      setDailyRevenue(Object.entries(revenueByDay).map(([date, revenue]) => ({
        date: new Date(date).toLocaleDateString('en', { weekday: 'short' }),
        revenue: Math.round(revenue * 100) / 100,
      })));

      // Category breakdown — only from non-cancelled orders
      const { data: catItems } = await supabase
        .from('order_items')
        .select('quantity, unit_price, order_id, menu_items(subcategories(categories(name)))');

      const catRevenue: Record<string, number> = {};
      catItems?.forEach((oi: any) => {
        if (!validOrderIds.has(oi.order_id)) return;
        const name = oi.menu_items?.subcategories?.categories?.name || 'Other';
        catRevenue[name] = (catRevenue[name] || 0) + (oi.quantity * Number(oi.unit_price));
      });
      setCategoryBreakdown(Object.entries(catRevenue).map(([name, value]) => ({ name, value: Math.round(value * 100) / 100 })));

      // Peak hours (today) — simple 8-23 range
      const today = new Date().toISOString().split('T')[0];
      const todayOrders = validOrders?.filter(o => o.created_at.startsWith(today)) || [];

      const hourCounts: Record<number, number> = {};
      for (let h = 8; h <= 23; h++) hourCounts[h] = 0;
      todayOrders.forEach((o: any) => {
        const hour = new Date(o.created_at).getHours();
        if (hour >= 8 && hour <= 23) hourCounts[hour]++;
      });
      setPeakHours(
        Object.entries(hourCounts).map(([hour, count]) => ({
          hour: `${parseInt(hour).toString().padStart(2, '0')}:00`,
          orders: count,
        }))
      );

      // Table turnover
      const { data: sessions } = await supabase
        .from('table_sessions')
        .select('table_id, is_active, tables(table_number)')
        .gte('opened_at', today);

      const turnover: Record<number, number> = {};
      sessions?.forEach((s: any) => {
        const num = s.tables?.table_number || 0;
        turnover[num] = (turnover[num] || 0) + 1;
      });
      setTableTurnover(
        Object.entries(turnover)
          .sort(([a], [b]) => parseInt(a) - parseInt(b))
          .map(([table, sessions]) => ({ table: `T${table}`, sessions }))
      );
    };

    fetchAnalytics();
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
            {peakHours.some(h => h.orders > 0) ? (
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
