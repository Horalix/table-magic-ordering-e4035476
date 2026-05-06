import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  LogOut, ChefHat, Hand, CreditCard, Clock, PowerOff, Check,
  Sparkles, Users, Flame, Bell, Utensils, CheckCircle2, Volume2, VolumeX,
} from 'lucide-react';
import { toast } from 'sonner';
import { useElapsed, formatDuration, waitBg } from '@/lib/timing';

const SOUND_KEY = 'waiter-sound-on';
const playBeep = () => {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.frequency.value = 880; o.type = 'sine';
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.45);
    o.start(); o.stop(ctx.currentTime + 0.5);
  } catch {}
};

interface WaiterInfo { id: string; display_name: string; }

const WaiterDashboard = () => {
  const navigate = useNavigate();
  const [waiter, setWaiter] = useState<WaiterInfo | null>(null);
  const [tables, setTables] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [waiterCalls, setWaiterCalls] = useState<any[]>([]);
  const [billRequests, setBillRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [soundOn, setSoundOn] = useState<boolean>(() => localStorage.getItem(SOUND_KEY) !== 'false');
  const prevAlertIds = useRef<Set<string>>(new Set());

  const fetchAll = useCallback(async (waiterId: string) => {
    const { data: sessions } = await supabase
      .from('table_sessions')
      .select('id, opened_at, guest_name, table_id, tables!inner(table_number, section_id)')
      .eq('is_active', true)
      .eq('assigned_waiter_id', waiterId);

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
      if (!session) { navigate('/waiter/login'); return; }
      const { data: w } = await supabase.from('waiters').select('id, display_name').eq('user_id', session.user.id).maybeSingle();
      if (!w) {
        toast.error('No waiter profile linked to this account');
        navigate('/waiter/login');
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
  const logout = async () => { await supabase.auth.signOut(); navigate('/waiter/login'); };

  const ordersByTable = useMemo(() => {
    const map: Record<string, number> = {};
    orders.forEach((o: any) => {
      const tn = o.table_sessions?.tables?.table_number;
      if (tn != null) map[tn] = (map[tn] || 0) + 1;
    });
    return map;
  }, [orders]);

  const initials = (waiter?.display_name || '?').split(' ').map(s => s[0]).join('').slice(0, 2).toUpperCase();
  const attentionCount = waiterCalls.length + billRequests.length;
  const ordersWaiting = orders.filter((o: any) => o.status !== 'served' && o.status !== 'cancelled').length;
  const oldestOrderMs = orders.reduce((max: number, o: any) => {
    const ms = Date.now() - new Date(o.created_at).getTime();
    return ms > max ? ms : max;
  }, 0);

  // Sound on new alerts
  useEffect(() => {
    const ids = new Set<string>([
      ...waiterCalls.map((c: any) => 'c:' + c.id),
      ...billRequests.map((b: any) => 'b:' + b.id),
    ]);
    if (prevAlertIds.current.size > 0) {
      let isNew = false;
      ids.forEach(id => { if (!prevAlertIds.current.has(id)) isNew = true; });
      if (isNew && soundOn) playBeep();
    }
    prevAlertIds.current = ids;
  }, [waiterCalls, billRequests, soundOn]);

  const toggleSound = () => {
    const next = !soundOn;
    setSoundOn(next);
    localStorage.setItem(SOUND_KEY, String(next));
    if (next) playBeep();
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background p-4 sm:p-6">
        <Skeleton className="h-14 w-full mb-6" />
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-32" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-[env(safe-area-inset-bottom)]">
      {/* Sticky header */}
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary to-accent text-primary-foreground grid place-items-center font-serif font-bold text-sm">
              {initials}
            </div>
            <div>
              <h1 className="font-serif text-lg sm:text-xl font-bold leading-tight">{waiter?.display_name}</h1>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="relative flex w-2 h-2">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75 animate-ping" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                </span>
                On shift · {tables.length} table{tables.length !== 1 ? 's' : ''}
              </div>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={logout} className="tap-sm">
            <LogOut className="w-4 h-4 sm:mr-1" /><span className="hidden sm:inline">Sign out</span>
          </Button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-5 space-y-7">
        {/* Attention */}
        <section>
          <SectionTitle icon={<Bell className="w-4 h-4" />} title="Attention needed" count={attentionCount} />
          {attentionCount === 0 ? (
            <div className="rounded-xl border border-dashed border-border/60 bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
              <Sparkles className="w-4 h-4" /> All caught up
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <AnimatePresence mode="popLayout">
                {waiterCalls.map((c: any) => (
                  <AlertPill
                    key={c.id}
                    color="amber"
                    icon={<Hand className="w-4 h-4" />}
                    title={`Table ${c.table_sessions.tables.table_number}`}
                    label="Needs you"
                    since={c.created_at}
                    onDone={() => resolveCall(c.id)}
                  />
                ))}
                {billRequests.map((b: any) => (
                  <AlertPill
                    key={b.id}
                    color="primary"
                    icon={<CreditCard className="w-4 h-4" />}
                    title={`Table ${b.table_sessions.tables.table_number}`}
                    label="Wants the bill"
                    since={b.created_at}
                    onDone={() => resolveBill(b.id)}
                  />
                ))}
              </AnimatePresence>
            </div>
          )}
        </section>

        {/* Tables */}
        <section>
          <SectionTitle icon={<Users className="w-4 h-4" />} title="My tables" count={tables.length} />
          {tables.length === 0 ? (
            <EmptyState icon={<Users className="w-5 h-5" />} text="No active tables in your section yet." />
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {tables.map((s: any, i: number) => (
                <motion.div
                  key={s.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04, duration: 0.2 }}
                >
                  <TableCard
                    session={s}
                    activeOrders={ordersByTable[s.tables.table_number] || 0}
                    onClose={() => closeSession(s.id)}
                  />
                </motion.div>
              ))}
            </div>
          )}
        </section>

        {/* Live orders */}
        <section>
          <SectionTitle icon={<ChefHat className="w-4 h-4" />} title="Live orders" count={orders.length} />
          {orders.length === 0 ? (
            <EmptyState icon={<Utensils className="w-5 h-5" />} text="No active orders right now." />
          ) : (
            <div className="grid sm:grid-cols-2 gap-3">
              <AnimatePresence mode="popLayout">
                {orders.map((o: any, i: number) => (
                  <motion.div
                    key={o.id}
                    layout
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.96 }}
                    transition={{ delay: i * 0.03, duration: 0.2 }}
                  >
                    <OrderCard order={o} onUpdate={updateOrderStatus} />
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}
        </section>
      </main>
    </div>
  );
};

const SectionTitle = ({ icon, title, count }: { icon: React.ReactNode; title: string; count: number }) => (
  <div className="flex items-center gap-2 mb-3">
    <span className="text-muted-foreground">{icon}</span>
    <h2 className="font-serif text-base sm:text-lg font-bold">{title}</h2>
    <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground tabular-nums">{count}</span>
  </div>
);

const EmptyState = ({ icon, text }: { icon: React.ReactNode; text: string }) => (
  <div className="rounded-xl border border-dashed border-border/60 bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground flex flex-col items-center gap-2">
    <span className="opacity-60">{icon}</span>
    {text}
  </div>
);

const Elapsed = ({ since }: { since: string }) => {
  const ms = useElapsed(since);
  return <>{formatDuration(ms)}</>;
};

const AlertPill = ({
  color, icon, title, label, since, onDone,
}: {
  color: 'amber' | 'primary'; icon: React.ReactNode;
  title: string; label: string; since: string; onDone: () => void;
}) => {
  const accent = color === 'amber' ? 'bg-amber-500' : 'bg-primary';
  const tint = color === 'amber' ? 'bg-amber-500/5 border-amber-500/30' : 'bg-primary/5 border-primary/30';
  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.18 }}
    >
      <div className={`relative overflow-hidden rounded-xl border ${tint} pl-3 pr-2 py-2.5 flex items-center gap-3`}>
        <div className={`absolute left-0 top-0 bottom-0 w-1 ${accent}`} />
        <div className={`w-9 h-9 rounded-lg ${accent} text-white grid place-items-center shrink-0`}>
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-sans font-semibold text-sm truncate">{title}</p>
          <p className="text-xs text-muted-foreground truncate">{label} · <Elapsed since={since} /></p>
        </div>
        <Button size="sm" variant="ghost" className="tap-sm shrink-0" onClick={onDone}>
          <CheckCircle2 className="w-4 h-4 mr-1" /> Done
        </Button>
      </div>
    </motion.div>
  );
};

const TableCard = ({ session, activeOrders, onClose }: { session: any; activeOrders: number; onClose: () => void }) => {
  const ms = useElapsed(session.opened_at);
  return (
    <Card className="overflow-hidden transition-shadow hover:shadow-md">
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-2">
          <div>
            <p className="font-serif text-2xl font-bold leading-none">T{session.tables.table_number}</p>
            {session.guest_name && <p className="text-xs text-muted-foreground mt-1 truncate max-w-[160px]">{session.guest_name}</p>}
          </div>
          <span className={`text-[11px] px-2 py-0.5 rounded-full border tabular-nums ${waitBg(ms)}`}>
            <Clock className="w-3 h-3 inline -mt-0.5 mr-1" />{formatDuration(ms)}
          </span>
        </div>
        <div className="flex items-center justify-between text-xs text-muted-foreground mb-3">
          <span>{activeOrders > 0 ? `${activeOrders} active order${activeOrders !== 1 ? 's' : ''}` : 'No active orders'}</span>
        </div>
        <div className="border-t border-border/60 pt-3">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" variant="ghost" className="w-full tap-sm text-muted-foreground hover:text-destructive">
                <PowerOff className="w-3.5 h-3.5 mr-1.5" /> Free table
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Free table T{session.tables.table_number}?</AlertDialogTitle>
                <AlertDialogDescription>
                  This closes the session. The guest will need a new QR scan to order again.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={onClose}>Free table</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardContent>
    </Card>
  );
};

const STATUS_META: Record<string, { dot: string; label: string }> = {
  pending:   { dot: 'bg-muted-foreground', label: 'Pending' },
  confirmed: { dot: 'bg-blue-500',         label: 'Confirmed' },
  preparing: { dot: 'bg-amber-500',        label: 'Preparing' },
  ready:     { dot: 'bg-emerald-500',      label: 'Ready' },
};
const NEXT_META: Record<string, { status: string; label: string; icon: React.ReactNode }> = {
  pending:   { status: 'confirmed', label: 'Confirm',     icon: <Check className="w-4 h-4 mr-1.5" /> },
  confirmed: { status: 'preparing', label: 'Start prep',  icon: <Flame className="w-4 h-4 mr-1.5" /> },
  preparing: { status: 'ready',     label: 'Mark ready',  icon: <Bell className="w-4 h-4 mr-1.5" /> },
  ready:     { status: 'served',    label: 'Mark served', icon: <Utensils className="w-4 h-4 mr-1.5" /> },
};

const OrderCard = ({ order, onUpdate }: { order: any; onUpdate: (id: string, s: string) => void }) => {
  const ms = useElapsed(order.created_at);
  const next = NEXT_META[order.status];
  const meta = STATUS_META[order.status] || STATUS_META.pending;
  return (
    <Card className="transition-shadow hover:shadow-md">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2.5">
          <div className="flex items-center gap-2 min-w-0">
            <p className="font-serif text-lg font-bold shrink-0">T{order.table_sessions.tables.table_number}</p>
            <Badge variant="outline" className="text-[11px] gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
              {meta.label}
            </Badge>
          </div>
          <span className={`text-[11px] px-2 py-0.5 rounded-full border tabular-nums ${waitBg(ms)}`}>{formatDuration(ms)}</span>
        </div>
        <ul className="text-sm font-sans space-y-0.5 mb-3 text-foreground/90">
          {(order.order_items || []).map((it: any, i: number) => (
            <li key={i} className="flex gap-2"><span className="tabular-nums text-muted-foreground w-6">{it.quantity}×</span>{it.menu_items?.name}</li>
          ))}
        </ul>
        {next && (
          <Button size="sm" className="w-full tap" onClick={() => onUpdate(order.id, next.status)}>
            {next.icon}{next.label}
          </Button>
        )}
      </CardContent>
    </Card>
  );
};

export default WaiterDashboard;
