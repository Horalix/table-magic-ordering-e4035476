import React, { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

const COLORS = ['hsl(135,14%,55%)', 'hsl(38,60%,55%)', 'hsl(150,10%,45%)', 'hsl(38,50%,75%)', 'hsl(135,14%,85%)'];

const AdminAnalytics = () => {
  const [topItems, setTopItems] = useState<any[]>([]);
  const [dailyRevenue, setDailyRevenue] = useState<any[]>([]);
  const [categoryBreakdown, setCategoryBreakdown] = useState<any[]>([]);

  useEffect(() => {
    const fetchAnalytics = async () => {
      // Top ordered items
      const { data: orderItems } = await supabase
        .from('order_items')
        .select('quantity, menu_items(name)');

      const itemCounts: Record<string, number> = {};
      orderItems?.forEach((oi: any) => {
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

      const { data: allOrders } = await supabase
        .from('orders')
        .select('total, created_at')
        .neq('status', 'cancelled')
        .gte('created_at', days[0]);

      const revenueByDay: Record<string, number> = {};
      days.forEach(d => revenueByDay[d] = 0);
      allOrders?.forEach((o: any) => {
        const day = o.created_at.split('T')[0];
        if (revenueByDay[day] !== undefined) {
          revenueByDay[day] += Number(o.total);
        }
      });
      setDailyRevenue(Object.entries(revenueByDay).map(([date, revenue]) => ({
        date: new Date(date).toLocaleDateString('en', { weekday: 'short' }),
        revenue,
      })));

      // Category breakdown
      const { data: catItems } = await supabase
        .from('order_items')
        .select('quantity, menu_items(subcategories(categories(name)))');

      const catCounts: Record<string, number> = {};
      catItems?.forEach((oi: any) => {
        const name = oi.menu_items?.subcategories?.categories?.name || 'Other';
        catCounts[name] = (catCounts[name] || 0) + oi.quantity;
      });
      setCategoryBreakdown(Object.entries(catCounts).map(([name, value]) => ({ name, value })));
    };

    fetchAnalytics();
  }, []);

  return (
    <div>
      <h1 className="font-serif text-3xl font-bold text-foreground mb-6">Analytics</h1>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Daily Revenue */}
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
                <Tooltip />
                <Bar dataKey="revenue" fill="hsl(135,14%,55%)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Category breakdown */}
        <Card className="border-border">
          <CardHeader>
            <CardTitle className="font-serif text-lg">Orders by Category</CardTitle>
          </CardHeader>
          <CardContent>
            {categoryBreakdown.length > 0 ? (
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie data={categoryBreakdown} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                    {categoryBreakdown.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-muted-foreground font-sans text-sm text-center py-10">No data yet</p>
            )}
          </CardContent>
        </Card>

        {/* Top items */}
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
