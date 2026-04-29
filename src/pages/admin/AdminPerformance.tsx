import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Star, Award } from 'lucide-react';
import { formatMinutes } from '@/lib/timing';

interface Waiter { id: string; display_name: string; }
interface OrderRow {
  id: string;
  assigned_waiter_id: string | null;
  total: number;
  created_at: string;
  confirmed_at: string | null;
  served_at: string | null;
  status: string;
  table_session_id: string;
}
interface RatingRow { rating: number; waiter_id: string | null; comment: string | null; created_at: string; }
interface SessionRow { id: string; assigned_waiter_id: string | null; opened_at: string; closed_at: string | null; }

const todayMinusDays = (n: number) => {
  const d = new Date(); d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
};

const AdminPerformance = () => {
  const [from, setFrom] = useState(todayMinusDays(7));
  const [to, setTo] = useState(new Date().toISOString().split('T')[0]);
  const [waiters, setWaiters] = useState<Waiter[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [ratings, setRatings] = useState<RatingRow[]>([]);
  const [sessions, setSessions] = useState<SessionRow[]>([]);

  useEffect(() => {
    (async () => {
      const fromIso = new Date(from + 'T00:00:00').toISOString();
      const toIso = new Date(to + 'T23:59:59').toISOString();
      const [w, o, r, s] = await Promise.all([
        supabase.from('waiters').select('id, display_name'),
        supabase.from('orders').select('id, assigned_waiter_id, total, created_at, confirmed_at, served_at, status, table_session_id').gte('created_at', fromIso).lte('created_at', toIso),
        supabase.from('server_ratings').select('rating, waiter_id, comment, created_at').gte('created_at', fromIso).lte('created_at', toIso),
        supabase.from('table_sessions').select('id, assigned_waiter_id, opened_at, closed_at').gte('opened_at', fromIso).lte('opened_at', toIso),
      ]);
      setWaiters(w.data || []);
      setOrders((o.data as any) || []);
      setRatings((r.data as any) || []);
      setSessions((s.data as any) || []);
    })();
  }, [from, to]);

  const stats = useMemo(() => {
    return waiters.map(w => {
      const ord = orders.filter(o => o.assigned_waiter_id === w.id && o.status !== 'cancelled');
      const rts = ratings.filter(r => r.waiter_id === w.id);
      const sess = sessions.filter(s => s.assigned_waiter_id === w.id);
      const revenue = ord.reduce((sum, o) => sum + Number(o.total), 0);
      const avgRating = rts.length ? rts.reduce((a, r) => a + r.rating, 0) / rts.length : 0;
      const confirmTimes = ord.filter(o => o.confirmed_at).map(o => new Date(o.confirmed_at!).getTime() - new Date(o.created_at).getTime());
      const servedTimes = ord.filter(o => o.served_at).map(o => new Date(o.served_at!).getTime() - new Date(o.created_at).getTime());
      const turnTimes = sess.filter(s => s.closed_at).map(s => new Date(s.closed_at!).getTime() - new Date(s.opened_at).getTime());
      const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
      return {
        waiter: w,
        orders: ord.length,
        revenue,
        ratings: rts.length,
        avgRating,
        avgConfirm: avg(confirmTimes),
        avgServed: avg(servedTimes),
        avgTurn: avg(turnTimes),
        tables: sess.length,
      };
    }).sort((a, b) => b.revenue - a.revenue);
  }, [waiters, orders, ratings, sessions]);

  const lowRatings = ratings.filter(r => r.rating <= 2).slice(0, 10);

  return (
    <div>
      <h1 className="font-serif text-3xl font-bold text-foreground mb-6">Staff Performance</h1>

      <Card className="mb-6">
        <CardContent className="p-4 flex flex-wrap gap-3 items-center">
          <label className="text-sm font-sans text-muted-foreground">From</label>
          <Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="max-w-[180px]" />
          <label className="text-sm font-sans text-muted-foreground">To</label>
          <Input type="date" value={to} onChange={e => setTo(e.target.value)} className="max-w-[180px]" />
        </CardContent>
      </Card>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        {stats.map((s, idx) => (
          <Card key={s.waiter.id} className="border-border">
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="font-serif text-lg font-bold">{s.waiter.display_name}</p>
                  {idx === 0 && s.revenue > 0 && (
                    <span className="inline-flex items-center gap-1 text-xs text-accent"><Award className="w-3 h-3" /> Top performer</span>
                  )}
                </div>
                <div className="text-right">
                  <div className="flex items-center gap-1">
                    <Star className="w-4 h-4 fill-accent text-accent" />
                    <span className="font-serif text-lg font-bold">{s.avgRating.toFixed(1)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{s.ratings} rating{s.ratings !== 1 ? 's' : ''}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm font-sans">
                <Stat label="Revenue" value={`${s.revenue.toFixed(2)} KM`} />
                <Stat label="Orders" value={s.orders} />
                <Stat label="Tables served" value={s.tables} />
                <Stat label="Avg confirm" value={formatMinutes(s.avgConfirm)} />
                <Stat label="Avg served" value={formatMinutes(s.avgServed)} />
                <Stat label="Avg turn" value={formatMinutes(s.avgTurn)} />
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
              {lowRatings.map((r, i) => {
                const w = waiters.find(ww => ww.id === r.waiter_id);
                return (
                  <div key={i} className="flex items-start justify-between p-3 rounded border border-destructive/20 bg-destructive/5">
                    <div>
                      <p className="text-sm font-sans font-medium">{w?.display_name || 'Unknown waiter'} — {r.rating}★</p>
                      {r.comment && <p className="text-xs text-muted-foreground mt-1">"{r.comment}"</p>}
                    </div>
                    <span className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString()}</span>
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
