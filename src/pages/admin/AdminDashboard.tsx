import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { DollarSign, ShoppingBag, Clock, TrendingUp, Timer, CreditCard, Hand, Users } from 'lucide-react';
import { staggerContainer, fadeUp, useCountUp } from '@/lib/motion';

interface WaitTimeStats {
  pending: { avg: number; count: number };
  confirmed: { avg: number; count: number };
  preparing: { avg: number; count: number };
  ready: { avg: number; count: number };
  served: { avg: number; count: number };
}

/** Single stat tile — count-up animation + consistent elevation. */
const StatCard = ({
  label, value, format, icon: Icon, color,
}: {
  label: string;
  value: number;
  format: (n: number) => string;
  icon: React.ElementType;
  color: string;
}) => {
  const n = useCountUp(value);
  return (
    <motion.div variants={fadeUp}>
      <Card className="border-border card-lux-hover">
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-sans text-muted-foreground">{label}</p>
              <p className="text-2xl font-serif font-bold text-foreground mt-1 tabular-nums">{format(n)}</p>
            </div>
            <div className={`w-10 h-10 rounded-lg bg-muted flex items-center justify-center ${color}`}>
              <Icon className="w-5 h-5" />
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
};

const AdminDashboard = () => {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    todayRevenue: 0,
    totalOrders: 0,
    activeTables: 0,
    avgOrderValue: 0,
    billRequests: 0,
    waiterCalls: 0,
    guestCount: 0,
  });
  const [recentOrders, setRecentOrders] = useState<any[]>([]);
  const [waitTimeStats, setWaitTimeStats] = useState<WaitTimeStats>({
    pending: { avg: 0, count: 0 },
    confirmed: { avg: 0, count: 0 },
    preparing: { avg: 0, count: 0 },
    ready: { avg: 0, count: 0 },
    served: { avg: 0, count: 0 },
  });

  useEffect(() => {
    const fetchStats = async () => {
      const today = new Date().toISOString().split('T')[0];

      const { data: orders } = await supabase
        .from('orders')
        .select('total, created_at, status, updated_at, guest_name')
        .gte('created_at', today)
        .neq('status', 'cancelled');

      const revenue = orders?.reduce((sum, o) => sum + Number(o.total), 0) || 0;
      const count = orders?.length || 0;

      const { count: activeSessions } = await supabase
        .from('table_sessions')
        .select('*', { count: 'exact', head: true })
        .eq('is_active', true);

      const { count: billReqCount } = await supabase
        .from('bill_requests')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending');

      const { count: waiterCallCount } = await supabase
        .from('waiter_calls')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending');

      const { count: guestCount } = await supabase
        .from('table_sessions')
        .select('*', { count: 'exact', head: true })
        .gte('opened_at', today);

      setStats({
        todayRevenue: revenue,
        totalOrders: count,
        activeTables: activeSessions || 0,
        avgOrderValue: count > 0 ? revenue / count : 0,
        billRequests: billReqCount || 0,
        waiterCalls: waiterCallCount || 0,
        guestCount: guestCount || 0,
      });

      if (orders && orders.length > 0) {
        const grouped: Record<string, number[]> = {};
        for (const o of orders) {
          const mins = Math.floor((Date.now() - new Date(o.created_at).getTime()) / 60000);
          if (!grouped[o.status]) grouped[o.status] = [];
          grouped[o.status].push(mins);
        }
        const compute = (status: string) => {
          const arr = grouped[status] || [];
          return { avg: arr.length > 0 ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0, count: arr.length };
        };
        setWaitTimeStats({
          pending: compute('pending'),
          confirmed: compute('confirmed'),
          preparing: compute('preparing'),
          ready: compute('ready'),
          served: compute('served'),
        });
      }

      const { data: recent } = await supabase
        .from('orders')
        .select(`*, table_sessions!inner(tables!inner(table_number))`)
        .order('created_at', { ascending: false })
        .limit(10);

      setRecentOrders(recent || []);
      setLoading(false);
    };

    fetchStats();

    const channel = supabase
      .channel('admin-dashboard')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, fetchStats)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bill_requests' }, fetchStats)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'waiter_calls' }, fetchStats)
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  const money = (n: number) => `${n.toFixed(2)} KM`;
  const whole = (n: number) => Math.round(n).toString();

  const statCards = [
    { label: "Today's Revenue", value: stats.todayRevenue, format: money, icon: DollarSign, color: 'text-primary' },
    { label: 'Total Orders', value: stats.totalOrders, format: whole, icon: ShoppingBag, color: 'text-accent' },
    { label: 'Active Tables', value: stats.activeTables, format: whole, icon: Clock, color: 'text-primary' },
    { label: 'Avg Order', value: stats.avgOrderValue, format: money, icon: TrendingUp, color: 'text-accent' },
    { label: 'Bill Requests', value: stats.billRequests, format: whole, icon: CreditCard, color: 'text-primary' },
    { label: 'Waiter Calls', value: stats.waiterCalls, format: whole, icon: Hand, color: 'text-accent' },
    { label: 'Guests Today', value: stats.guestCount, format: whole, icon: Users, color: 'text-primary' },
  ];

  const waitTimeRows = [
    { status: 'pending', label: 'Pending', color: 'bg-destructive/10 text-destructive' },
    { status: 'confirmed', label: 'Confirmed', color: 'bg-accent/10 text-accent' },
    { status: 'preparing', label: 'Preparing', color: 'bg-accent/15 text-accent' },
    { status: 'ready', label: 'Ready', color: 'bg-primary/10 text-primary' },
    { status: 'served', label: 'Served', color: 'bg-muted text-muted-foreground' },
  ] as const;

  return (
    <div>
      <motion.h1
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
        className="font-serif text-3xl font-bold text-foreground mb-6"
      >
        Dashboard
      </motion.h1>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={i} className="h-[92px] rounded-xl" />
          ))}
        </div>
      ) : (
        <motion.div
          variants={staggerContainer(0.05)}
          initial="hidden"
          animate="show"
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8"
        >
          {statCards.map((stat) => (
            <StatCard key={stat.label} {...stat} />
          ))}
        </motion.div>
      )}

      <Card className="border-border mb-8">
        <CardHeader>
          <CardTitle className="font-serif text-lg flex items-center gap-2">
            <Timer className="w-5 h-5 text-primary" />
            Today's Average Wait Times
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {waitTimeRows.map((row) => {
              const data = waitTimeStats[row.status as keyof WaitTimeStats];
              return (
                <div key={row.status} className="rounded-xl border border-border p-4 text-center">
                  <span className={`text-xs font-sans font-medium px-2 py-0.5 rounded-full ${row.color}`}>{row.label}</span>
                  <p className="font-serif text-2xl font-bold text-foreground mt-2 tabular-nums">
                    {data.avg}<span className="text-sm font-sans text-muted-foreground ml-1">min</span>
                  </p>
                  <p className="text-xs font-sans text-muted-foreground mt-1">{data.count} order{data.count !== 1 ? 's' : ''}</p>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card className="border-border">
        <CardHeader>
          <CardTitle className="font-serif text-lg">Recent Orders</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center justify-between py-2">
                  <div className="space-y-1.5">
                    <Skeleton className="h-4 w-32 rounded" />
                    <Skeleton className="h-3 w-20 rounded" />
                  </div>
                  <Skeleton className="h-4 w-16 rounded" />
                </div>
              ))}
            </div>
          ) : recentOrders.length === 0 ? (
            <p className="text-muted-foreground font-sans text-sm py-4">No orders yet</p>
          ) : (
            <div className="space-y-3">
              {recentOrders.map((order: any) => (
                <div key={order.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                  <div>
                    <p className="text-sm font-sans font-medium text-foreground">
                      Table {order.table_sessions?.tables?.table_number}
                      {order.guest_name && <span className="text-muted-foreground ml-2">— {order.guest_name}</span>}
                    </p>
                    <p className="text-xs text-muted-foreground">{new Date(order.created_at).toLocaleTimeString()}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-sans font-semibold text-foreground tabular-nums">{Number(order.total).toFixed(2)} KM</p>
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
