import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Award, Star } from 'lucide-react';
import { formatMinutes } from '@/lib/timing';
import type { Database } from '@/integrations/supabase/types';

type OrderStatus = Database['public']['Enums']['order_status'];

interface Waiter {
  id: string;
  display_name: string;
}

interface OrderRow {
  id: string;
  assigned_waiter_id: string | null;
  total: number;
  created_at: string;
  confirmed_at: string | null;
  served_at: string | null;
  status: OrderStatus;
  table_session_id: string;
}

interface RatingRow {
  rating: number;
  waiter_id: string | null;
  comment: string | null;
  created_at: string;
}

interface SessionRow {
  id: string;
  assigned_waiter_id: string | null;
  opened_at: string;
  closed_at: string | null;
}

const todayMinusDays = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split('T')[0];
};

const average = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

const AdminPerformance = () => {
  const [from, setFrom] = useState(todayMinusDays(7));
  const [to, setTo] = useState(new Date().toISOString().split('T')[0]);
  const [waiters, setWaiters] = useState<Waiter[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [ratings, setRatings] = useState<RatingRow[]>([]);
  const [sessions, setSessions] = useState<SessionRow[]>([]);

  useEffect(() => {
    const fetchPerformance = async () => {
      const fromIso = new Date(`${from}T00:00:00`).toISOString();
      const toIso = new Date(`${to}T23:59:59`).toISOString();
      const [w, o, r, s] = await Promise.all([
        supabase.from('waiters').select('id, display_name'),
        supabase
          .from('orders')
          .select('id, assigned_waiter_id, total, created_at, confirmed_at, served_at, status, table_session_id')
          .gte('created_at', fromIso)
          .lte('created_at', toIso),
        supabase
          .from('server_ratings')
          .select('rating, waiter_id, comment, created_at')
          .gte('created_at', fromIso)
          .lte('created_at', toIso),
        supabase
          .from('table_sessions')
          .select('id, assigned_waiter_id, opened_at, closed_at')
          .gte('opened_at', fromIso)
          .lte('opened_at', toIso),
      ]);

      setWaiters(w.data ?? []);
      setOrders((o.data ?? []) as OrderRow[]);
      setRatings((r.data ?? []) as RatingRow[]);
      setSessions((s.data ?? []) as SessionRow[]);
    };

    void fetchPerformance();
  }, [from, to]);

  const stats = useMemo(() => {
    return waiters
      .map((waiter) => {
        const ord = orders.filter((order) => order.assigned_waiter_id === waiter.id && order.status !== 'cancelled');
        const rts = ratings.filter((rating) => rating.waiter_id === waiter.id);
        const sess = sessions.filter((session) => session.assigned_waiter_id === waiter.id);
        const revenue = ord.reduce((sum, order) => sum + Number(order.total), 0);
        const avgRating = rts.length ? rts.reduce((sum, rating) => sum + rating.rating, 0) / rts.length : 0;
        const confirmTimes = ord
          .filter((order) => order.confirmed_at)
          .map((order) => new Date(order.confirmed_at as string).getTime() - new Date(order.created_at).getTime());
        const servedTimes = ord
          .filter((order) => order.served_at)
          .map((order) => new Date(order.served_at as string).getTime() - new Date(order.created_at).getTime());
        const turnTimes = sess
          .filter((session) => session.closed_at)
          .map((session) => new Date(session.closed_at as string).getTime() - new Date(session.opened_at).getTime());

        return {
          waiter,
          orders: ord.length,
          revenue,
          ratings: rts.length,
          avgRating,
          avgConfirm: average(confirmTimes),
          avgServed: average(servedTimes),
          avgTurn: average(turnTimes),
          tables: sess.length,
        };
      })
      .sort((a, b) => b.revenue - a.revenue);
  }, [waiters, orders, ratings, sessions]);

  const lowRatings = ratings.filter((rating) => rating.rating <= 2).slice(0, 10);

  return (
    <div>
      <h1 className="font-serif text-3xl font-bold text-foreground mb-6">Staff Performance</h1>

      <Card className="mb-6">
        <CardContent className="p-4 flex flex-wrap gap-3 items-center">
          <label className="text-sm font-sans text-muted-foreground">From</label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="max-w-[180px]" />
          <label className="text-sm font-sans text-muted-foreground">To</label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="max-w-[180px]" />
        </CardContent>
      </Card>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        {stats.map((stat, idx) => (
          <Card key={stat.waiter.id} className="border-border">
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="font-serif text-lg font-bold">{stat.waiter.display_name}</p>
                  {idx === 0 && stat.revenue > 0 && (
                    <span className="inline-flex items-center gap-1 text-xs text-accent"><Award className="w-3 h-3" /> Top performer</span>
                  )}
                </div>
                <div className="text-right">
                  <div className="flex items-center gap-1">
                    <Star className="w-4 h-4 fill-accent text-accent" />
                    <span className="font-serif text-lg font-bold">{stat.avgRating.toFixed(1)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{stat.ratings} rating{stat.ratings !== 1 ? 's' : ''}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm font-sans">
                <Stat label="Revenue" value={`${stat.revenue.toFixed(2)} KM`} />
                <Stat label="Orders" value={stat.orders} />
                <Stat label="Tables served" value={stat.tables} />
                <Stat label="Avg confirm" value={formatMinutes(stat.avgConfirm)} />
                <Stat label="Avg served" value={formatMinutes(stat.avgServed)} />
                <Stat label="Avg turn" value={formatMinutes(stat.avgTurn)} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {lowRatings.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="font-serif text-lg">Recent Low Ratings</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {lowRatings.map((rating, index) => {
                const waiter = waiters.find((candidate) => candidate.id === rating.waiter_id);
                return (
                  <div key={`${rating.created_at}-${index}`} className="flex items-start justify-between p-3 rounded border border-destructive/20 bg-destructive/5">
                    <div>
                      <p className="text-sm font-sans font-medium">
                        {waiter?.display_name ?? 'Unknown waiter'} - {rating.rating} star{rating.rating !== 1 ? 's' : ''}
                      </p>
                      {rating.comment && <p className="text-xs text-muted-foreground mt-1">"{rating.comment}"</p>}
                    </div>
                    <span className="text-xs text-muted-foreground">{new Date(rating.created_at).toLocaleString()}</span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

const Stat = ({ label, value }: { label: string; value: string | number }) => (
  <div>
    <p className="text-xs text-muted-foreground">{label}</p>
    <p className="font-medium text-foreground">{value}</p>
  </div>
);

export default AdminPerformance;
