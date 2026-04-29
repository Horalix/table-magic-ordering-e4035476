import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { LogOut, ChefHat, Hand, CreditCard, Clock, PowerOff, Check } from 'lucide-react';
import { toast } from 'sonner';
import { useElapsed, formatDuration, waitBg } from '@/lib/timing';

interface WaiterInfo { id: string; display_name: string; }

const WaiterDashboard = () => {
  const navigate = useNavigate();
  const [waiter, setWaiter] = useState<WaiterInfo | null>(null);
  const [tables, setTables] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [waiterCalls, setWaiterCalls] = useState<any[]>([]);
  const [billRequests, setBillRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async (waiterId: string) => {
    // active sessions assigned to waiter
    const { data: sessions } = await supabase
      .from('table_sessions')
      .select('id, opened_at, guest_name, table_id, tables!inner(table_number, section_id)')
      .eq('is_active', true)
      .eq('assigned_waiter_id', waiterId);

    // orders for these sessions
    const sessionIds = (sessions || []).map((s: any) => s.id);
    const { data: ord } = sessionIds.length > 0
      ? await supabase
          .from('orders')
          .select(`*, table_sessions!inner(tables!inner(table_number)), order_items(quantity, status, menu_items(name))`)
          .in('table_session_id', sessionIds)
          .neq('status', 'served')
          .neq('status', 'cancelled')
          .order('created_at', { ascending: true })
      : { data: [] };

    const { data: calls } = sessionIds.length > 0
      ? await supabase.from('waiter_calls').select('*, table_sessions!inner(tables!inner(table_number))').in('table_session_id', sessionIds).eq('status', 'pending')
      : { data: [] };

    const { data: bills } = sessionIds.length > 0
      ? await supabase.from('bill_requests').select('*, table_sessions!inner(tables!inner(table_number))').in('table_session_id', sessionIds).eq('status', 'pending')
      : { data: [] };

    setTables(sessions || []);
    setOrders(ord || []);
    setWaiterCalls(calls || []);
    setBillRequests(bills || []);
  }, []);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { navigate('/admin/login'); return; }
      const { data: w } = await supabase.from('waiters').select('id, display_name').eq('user_id', session.user.id).maybeSingle();
      if (!w) {
        toast.error('No waiter profile linked to this account');
        navigate('/admin');
        return;
      }
      setWaiter(w);
      await fetchAll(w.id);
      setLoading(false);

      const ch = supabase
        .channel('waiter-' + w.id)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => fetchAll(w.id))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'waiter_calls' }, () => fetchAll(w.id))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'bill_requests' }, () => fetchAll(w.id))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'table_sessions' }, () => fetchAll(w.id))
        .subscribe();
      return () => { supabase.removeChannel(ch); };
    })();
  }, [fetchAll, navigate]);

  const updateOrderStatus = async (id: string, status: string) => {
    const { error } = await supabase.from('orders').update({ status: status as any }).eq('id', id);
    if (error) toast.error(error.message); else toast.success('Updated');
  };

  const resolveCall = async (id: string) => {
    await supabase.from('waiter_calls').update({ status: 'resolved', resolved_at: new Date().toISOString() }).eq('id', id);
  };
  const resolveBill = async (id: string) => {
    await supabase.from('bill_requests').update({ status: 'resolved', resolved_at: new Date().toISOString() }).eq('id', id);
  };
  const closeSession = async (id: string) => {
    await supabase.from('table_sessions').update({ is_active: false, closed_at: new Date().toISOString() }).eq('id', id);
    toast.success('Table freed');
  };
  const logout = async () => { await supabase.auth.signOut(); navigate('/admin/login'); };

  if (loading) return <div className="min-h-screen flex items-center justify-center">Loading…</div>;

  return (
    <div className="min-h-screen bg-background p-4 sm:p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-serif text-2xl font-bold">Hi, {waiter?.display_name}</h1>
          <p className="text-sm text-muted-foreground">My section · {tables.length} active table{tables.length !== 1 ? 's' : ''}</p>
        </div>
        <Button variant="outline" size="sm" onClick={logout}><LogOut className="w-4 h-4 mr-1" /> Sign out</Button>
      </div>

      {(waiterCalls.length > 0 || billRequests.length > 0) && (
        <div className="grid sm:grid-cols-2 gap-3 mb-6">
          {waiterCalls.map((c: any) => (
            <Card key={c.id} className="border-accent/40 bg-accent/5">
              <CardContent className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Hand className="w-5 h-5 text-accent" />
                  <div>
                    <p className="font-sans font-semibold">Table {c.table_sessions.tables.table_number} needs you</p>
                    <p className="text-xs text-muted-foreground"><Elapsed since={c.created_at} /> ago</p>
                  </div>
                </div>
                <Button size="sm" onClick={() => resolveCall(c.id)}><Check className="w-4 h-4 mr-1" /> Done</Button>
              </CardContent>
            </Card>
          ))}
          {billRequests.map((b: any) => (
            <Card key={b.id} className="border-primary/40 bg-primary/5">
              <CardContent className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CreditCard className="w-5 h-5 text-primary" />
                  <div>
                    <p className="font-sans font-semibold">Table {b.table_sessions.tables.table_number} wants the bill</p>
                    <p className="text-xs text-muted-foreground"><Elapsed since={b.created_at} /> ago</p>
                  </div>
                </div>
                <Button size="sm" onClick={() => resolveBill(b.id)}><Check className="w-4 h-4 mr-1" /> Done</Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <h2 className="font-serif text-lg font-bold mb-3">Active Tables</h2>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
        {tables.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active tables in your section.</p>
        ) : tables.map((s: any) => (
          <Card key={s.id}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="font-serif text-xl font-bold">Table {s.tables.table_number}</p>
                <Badge variant="outline" className="text-xs"><Clock className="w-3 h-3 mr-1" /><Elapsed since={s.opened_at} /></Badge>
              </div>
              {s.guest_name && <p className="text-sm text-muted-foreground mb-2">{s.guest_name}</p>}
              <Button size="sm" variant="outline" className="w-full" onClick={() => closeSession(s.id)}>
                <PowerOff className="w-3.5 h-3.5 mr-1 text-destructive" /> Close & free table
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <h2 className="font-serif text-lg font-bold mb-3 flex items-center gap-2"><ChefHat className="w-5 h-5" /> Live Orders</h2>
      <div className="grid sm:grid-cols-2 gap-3">
        {orders.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active orders.</p>
        ) : orders.map((o: any) => (
          <OrderCard key={o.id} order={o} onUpdate={updateOrderStatus} />
        ))}
      </div>
    </div>
  );
};

const Elapsed = ({ since }: { since: string }) => {
  const ms = useElapsed(since);
  return <>{formatDuration(ms)}</>;
};

const OrderCard = ({ order, onUpdate }: { order: any; onUpdate: (id: string, s: string) => void }) => {
  const ms = useElapsed(order.created_at);
  const next: Record<string, string> = { pending: 'confirmed', confirmed: 'preparing', preparing: 'ready', ready: 'served' };
  const nextStatus = next[order.status];
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <p className="font-serif text-base font-bold">Table {order.table_sessions.tables.table_number}</p>
            <Badge variant="outline" className="text-xs capitalize">{order.status}</Badge>
          </div>
          <span className={`text-xs px-2 py-0.5 rounded-full border ${waitBg(ms)}`}>{formatDuration(ms)}</span>
        </div>
        <ul className="text-sm font-sans space-y-0.5 mb-3">
          {(order.order_items || []).map((it: any, i: number) => (
            <li key={i}>{it.quantity}× {it.menu_items?.name}</li>
          ))}
        </ul>
        {nextStatus && (
          <Button size="sm" className="w-full" onClick={() => onUpdate(order.id, nextStatus)}>
            Mark as {nextStatus}
          </Button>
        )}
      </CardContent>
    </Card>
  );
};

export default WaiterDashboard;
