import React, { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DollarSign, ShoppingBag, Clock, TrendingUp } from 'lucide-react';

const AdminDashboard = () => {
  const [stats, setStats] = useState({
    todayRevenue: 0,
    totalOrders: 0,
    activeTables: 0,
    avgOrderValue: 0,
  });
  const [recentOrders, setRecentOrders] = useState<any[]>([]);

  useEffect(() => {
    const fetchStats = async () => {
      const today = new Date().toISOString().split('T')[0];

      // Today's orders
      const { data: orders } = await supabase
        .from('orders')
        .select('total, created_at, status')
        .gte('created_at', today)
        .neq('status', 'cancelled');

      const revenue = orders?.reduce((sum, o) => sum + Number(o.total), 0) || 0;
      const count = orders?.length || 0;

      // Active sessions
      const { count: activeSessions } = await supabase
        .from('table_sessions')
        .select('*', { count: 'exact', head: true })
        .eq('is_active', true);

      setStats({
        todayRevenue: revenue,
        totalOrders: count,
        activeTables: activeSessions || 0,
        avgOrderValue: count > 0 ? revenue / count : 0,
      });

      // Recent orders
      const { data: recent } = await supabase
        .from('orders')
        .select(`
          *,
          table_sessions!inner(tables!inner(table_number))
        `)
        .order('created_at', { ascending: false })
        .limit(10);

      setRecentOrders(recent || []);
    };

    fetchStats();

    const channel = supabase
      .channel('admin-dashboard')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, fetchStats)
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  const statCards = [
    { label: "Today's Revenue", value: `${stats.todayRevenue.toFixed(2)} KM`, icon: DollarSign, color: 'text-primary' },
    { label: 'Total Orders', value: stats.totalOrders.toString(), icon: ShoppingBag, color: 'text-accent' },
    { label: 'Active Tables', value: stats.activeTables.toString(), icon: Clock, color: 'text-sage' },
    { label: 'Avg Order', value: `${stats.avgOrderValue.toFixed(2)} KM`, icon: TrendingUp, color: 'text-gold' },
  ];

  return (
    <div>
      <h1 className="font-serif text-3xl font-bold text-foreground mb-6">Dashboard</h1>

      {/* Stats grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {statCards.map((stat) => (
          <Card key={stat.label} className="border-border">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-sans text-muted-foreground">{stat.label}</p>
                  <p className="text-2xl font-serif font-bold text-foreground mt-1">{stat.value}</p>
                </div>
                <div className={`w-10 h-10 rounded-lg bg-muted flex items-center justify-center ${stat.color}`}>
                  <stat.icon className="w-5 h-5" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Recent orders */}
      <Card className="border-border">
        <CardHeader>
          <CardTitle className="font-serif text-lg">Recent Orders</CardTitle>
        </CardHeader>
        <CardContent>
          {recentOrders.length === 0 ? (
            <p className="text-muted-foreground font-sans text-sm py-4">No orders yet</p>
          ) : (
            <div className="space-y-3">
              {recentOrders.map((order: any) => (
                <div key={order.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                  <div>
                    <p className="text-sm font-sans font-medium text-foreground">
                      Table {order.table_sessions?.tables?.table_number}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(order.created_at).toLocaleTimeString()}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-sans font-semibold text-foreground">{Number(order.total).toFixed(2)} KM</p>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      order.status === 'pending' ? 'bg-destructive/10 text-destructive' :
                      order.status === 'served' ? 'bg-primary/10 text-primary' :
                      'bg-accent/10 text-accent'
                    }`}>
                      {order.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default AdminDashboard;
