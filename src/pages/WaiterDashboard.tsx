import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Bell,
  Check,
  CheckCircle2,
  ChefHat,
  Clock,
  CreditCard,
  Flame,
  Hand,
  LogOut,
  Monitor,
  PowerOff,
  Sparkles,
  Users,
  Utensils,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { toast } from 'sonner';
import { formatDuration, useElapsed, waitBg } from '@/lib/timing';
import type { Database } from '@/integrations/supabase/types';

type OrderStatus = Database['public']['Enums']['order_status'];
type OrderItemStatus = Database['public']['Enums']['order_item_status'];
type WaiterRow = Database['public']['Tables']['waiters']['Row'];
type WaiterInfo = Pick<WaiterRow, 'id' | 'display_name'>;
type WaiterSession = Pick<Database['public']['Tables']['table_sessions']['Row'], 'id' | 'opened_at' | 'guest_name' | 'table_id'> & {
  tables: { table_number: number; section_id: string | null } | null;
};
type WaiterOrderItem = {
  quantity: number;
  status: OrderItemStatus;
  menu_items: { name: string } | null;
};
type WaiterOrder = Pick<Database['public']['Tables']['orders']['Row'], 'id' | 'created_at' | 'status' | 'table_session_id'> & {
  table_sessions: { tables: { table_number: number } | null } | null;
  order_items: WaiterOrderItem[] | null;
};
type WaiterCall = Pick<Database['public']['Tables']['waiter_calls']['Row'], 'id' | 'created_at' | 'table_session_id'> & {
  table_sessions: { tables: { table_number: number } | null } | null;
};
type BillRequest = Pick<Database['public']['Tables']['bill_requests']['Row'], 'id' | 'created_at' | 'table_session_id'> & {
  table_sessions: { tables: { table_number: number } | null } | null;
};
type WindowWithWebAudioFallback = Window & typeof globalThis & {
  webkitAudioContext?: typeof AudioContext;
};

const SOUND_KEY = 'waiter-sound-on';

const playBeep = () => {
  try {
    const AudioContextCtor = window.AudioContext ?? (window as WindowWithWebAudioFallback).webkitAudioContext;
    if (!AudioContextCtor) return;

    const ctx = new AudioContextCtor();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.frequency.value = 880;
    oscillator.type = 'sine';
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.45);
    oscillator.start();
    oscillator.stop(ctx.currentTime + 0.5);
  } catch (error) {
    console.warn('Unable to play waiter alert sound', error);
  }
};

const WaiterDashboard = () => {
  const navigate = useNavigate();
  const [waiter, setWaiter] = useState<WaiterInfo | null>(null);
  const [tables, setTables] = useState<WaiterSession[]>([]);
  const [orders, setOrders] = useState<WaiterOrder[]>([]);
  const [waiterCalls, setWaiterCalls] = useState<WaiterCall[]>([]);
  const [billRequests, setBillRequests] = useState<BillRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [soundOn, setSoundOn] = useState<boolean>(() => localStorage.getItem(SOUND_KEY) !== 'false');
  const prevAlertIds = useRef<Set<string>>(new Set());

  const fetchAll = useCallback(async (waiterId: string) => {
    const { data: sessions, error: sessionsError } = await supabase
      .from('table_sessions')
      .select('id, opened_at, guest_name, table_id, tables!inner(table_number, section_id)')
      .eq('is_active', true)
      .eq('assigned_waiter_id', waiterId);

    if (sessionsError) {
      toast.error('Failed to load tables');
      return;
    }

    const activeSessions = (sessions ?? []) as WaiterSession[];
    const sessionIds = activeSessions.map((session) => session.id);

    const { data: ord, error: ordersError } = sessionIds.length > 0
      ? await supabase
          .from('orders')
          .select('*, table_sessions!inner(tables!inner(table_number)), order_items(quantity, status, menu_items(name))')
          .in('table_session_id', sessionIds)
          .neq('status', 'served')
          .neq('status', 'cancelled')
          .order('created_at', { ascending: true })
      : { data: [], error: null };

    const { data: calls, error: callsError } = sessionIds.length > 0
      ? await supabase
          .from('waiter_calls')
          .select('*, table_sessions!inner(tables!inner(table_number))')
          .in('table_session_id', sessionIds)
          .eq('status', 'pending')
      : { data: [], error: null };

    const { data: bills, error: billsError } = sessionIds.length > 0
      ? await supabase
          .from('bill_requests')
          .select('*, table_sessions!inner(tables!inner(table_number))')
          .in('table_session_id', sessionIds)
          .eq('status', 'pending')
      : { data: [], error: null };

    if (ordersError || callsError || billsError) {
      toast.error('Failed to load live service queue');
      return;
    }

    setTables(activeSessions);
    setOrders((ord ?? []) as WaiterOrder[]);
    setWaiterCalls((calls ?? []) as WaiterCall[]);
    setBillRequests((bills ?? []) as BillRequest[]);
  }, []);

  useEffect(() => {
    let mounted = true;

    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        navigate('/waiter/login');
        return;
      }

      const { data: waiterProfile, error } = await supabase
        .from('waiters')
        .select('id, display_name')
        .eq('user_id', session.user.id)
        .maybeSingle();

      if (error || !waiterProfile) {
        toast.error('No waiter profile linked to this account');
        navigate('/waiter/login');
        return;
      }

      if (!mounted) return;
      setWaiter(waiterProfile);
      await fetchAll(waiterProfile.id);
      if (mounted) setLoading(false);

      const ch = supabase
        .channel(`waiter-${waiterProfile.id}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => { void fetchAll(waiterProfile.id); })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'waiter_calls' }, () => { void fetchAll(waiterProfile.id); })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'bill_requests' }, () => { void fetchAll(waiterProfile.id); })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'table_sessions' }, () => { void fetchAll(waiterProfile.id); })
        .subscribe();

      return () => {
        supabase.removeChannel(ch);
      };
    };

    const cleanupPromise = init();

    return () => {
      mounted = false;
      void cleanupPromise.then((cleanup) => cleanup?.());
    };
  }, [fetchAll, navigate]);

  const updateOrderStatus = async (id: string, status: OrderStatus) => {
    const { error } = await supabase.from('orders').update({ status }).eq('id', id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success('Updated');
  };

  const resolveCall = async (id: string) => {
    const { error } = await supabase
      .from('waiter_calls')
      .update({ status: 'resolved', resolved_at: new Date().toISOString() })
      .eq('id', id);
    if (error) toast.error(error.message);
  };

  const resolveBill = async (id: string) => {
    const { error } = await supabase
      .from('bill_requests')
      .update({ status: 'resolved', resolved_at: new Date().toISOString() })
      .eq('id', id);
    if (error) toast.error(error.message);
  };

  const closeSession = async (id: string) => {
    const { error } = await supabase
      .from('table_sessions')
      .update({ is_active: false, closed_at: new Date().toISOString() })
      .eq('id', id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success('Table freed');
  };

  const logout = async () => {
    await supabase.auth.signOut();
    navigate('/waiter/login');
  };

  const ordersByTable = useMemo(() => {
    const map: Record<string, number> = {};
    orders.forEach((order) => {
      const tableNumber = order.table_sessions?.tables?.table_number;
      if (tableNumber != null) map[tableNumber] = (map[tableNumber] ?? 0) + 1;
    });
    return map;
  }, [orders]);

  const initials = (waiter?.display_name || '?')
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  const attentionCount = waiterCalls.length + billRequests.length;
  const ordersWaiting = orders.filter((order) => order.status !== 'served' && order.status !== 'cancelled').length;
  const oldestOrderMs = orders.reduce((max, order) => {
    const ms = Date.now() - new Date(order.created_at).getTime();
    return ms > max ? ms : max;
  }, 0);

  useEffect(() => {
    const ids = new Set<string>([
      ...waiterCalls.map((call) => `c:${call.id}`),
      ...billRequests.map((bill) => `b:${bill.id}`),
    ]);
    if (prevAlertIds.current.size > 0) {
      let isNew = false;
      ids.forEach((id) => {
        if (!prevAlertIds.current.has(id)) isNew = true;
      });
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
                On shift | {tables.length} table{tables.length !== 1 ? 's' : ''}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" asChild className="tap-sm">
              <Link to="/waiter/monitor"><Monitor className="w-4 h-4 sm:mr-1" /><span className="hidden sm:inline">Floor</span></Link>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleSound}
              className="tap-sm"
              aria-label={soundOn ? 'Mute waiter alert sound' : 'Enable waiter alert sound'}
            >
              {soundOn ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4 text-muted-foreground" />}
            </Button>
            <Button variant="ghost" size="sm" onClick={logout} className="tap-sm">
              <LogOut className="w-4 h-4 sm:mr-1" /><span className="hidden sm:inline">Sign out</span>
            </Button>
          </div>
        </div>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 pb-3 grid grid-cols-3 gap-2 text-center">
          <StatChip label="Tables" value={tables.length} />
          <StatChip label="Orders" value={ordersWaiting} tone={ordersWaiting > 0 ? 'active' : 'idle'} />
          <StatChip
            label="Oldest wait"
            value={oldestOrderMs > 0 ? formatDuration(oldestOrderMs) : '-'}
            tone={oldestOrderMs > 10 * 60_000 ? 'urgent' : oldestOrderMs > 5 * 60_000 ? 'warn' : 'idle'}
          />
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-5 space-y-7">
        <section>
          <SectionTitle icon={<Bell className="w-4 h-4" />} title="Attention needed" count={attentionCount} />
          {attentionCount === 0 ? (
            <div className="rounded-xl border border-dashed border-border/60 bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
              <Sparkles className="w-4 h-4" /> All caught up
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <AnimatePresence mode="popLayout">
                {waiterCalls.map((call) => (
                  <AlertPill
                    key={call.id}
                    color="amber"
                    icon={<Hand className="w-4 h-4" />}
                    title={`Table ${call.table_sessions?.tables?.table_number ?? '?'}`}
                    label="Needs you"
                    since={call.created_at}
                    onDone={() => { void resolveCall(call.id); }}
                  />
                ))}
                {billRequests.map((bill) => (
                  <AlertPill
                    key={bill.id}
                    color="primary"
                    icon={<CreditCard className="w-4 h-4" />}
                    title={`Table ${bill.table_sessions?.tables?.table_number ?? '?'}`}
                    label="Wants the bill"
                    since={bill.created_at}
                    onDone={() => { void resolveBill(bill.id); }}
                  />
                ))}
              </AnimatePresence>
            </div>
          )}
        </section>

        <section>
          <SectionTitle icon={<Users className="w-4 h-4" />} title="My tables" count={tables.length} />
          {tables.length === 0 ? (
            <EmptyState icon={<Users className="w-5 h-5" />} text="No tables yet. Tables appear here once your manager assigns your section for today and a guest sits down." />
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {tables.map((session, index) => (
                <motion.div
                  key={session.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.04, duration: 0.2 }}
                >
                  <TableCard
                    session={session}
                    activeOrders={ordersByTable[String(session.tables?.table_number ?? '')] ?? 0}
                    onClose={() => { void closeSession(session.id); }}
                  />
                </motion.div>
              ))}
            </div>
          )}
        </section>

        <section>
          <SectionTitle icon={<ChefHat className="w-4 h-4" />} title="Live orders" count={orders.length} />
          {orders.length === 0 ? (
            <EmptyState icon={<Utensils className="w-5 h-5" />} text="No active orders right now." />
          ) : (
            <div className="grid sm:grid-cols-2 gap-3">
              <AnimatePresence mode="popLayout">
                {orders.map((order, index) => (
                  <motion.div
                    key={order.id}
                    layout
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.96 }}
                    transition={{ delay: index * 0.03, duration: 0.2 }}
                  >
                    <OrderCard order={order} onUpdate={updateOrderStatus} />
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

const StatChip = ({
  label,
  value,
  tone = 'idle',
}: {
  label: string;
  value: React.ReactNode;
  tone?: 'idle' | 'active' | 'warn' | 'urgent';
}) => {
  const toneCls = {
    idle: 'bg-muted/50 text-foreground',
    active: 'bg-primary/10 text-primary',
    warn: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
    urgent: 'bg-destructive/10 text-destructive',
  }[tone];
  return (
    <div className={`rounded-lg ${toneCls} px-2 py-1.5`}>
      <p className="text-[10px] uppercase tracking-wide opacity-70 leading-none">{label}</p>
      <p className="font-serif font-bold text-base leading-tight tabular-nums mt-0.5">{value}</p>
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
  color,
  icon,
  title,
  label,
  since,
  onDone,
}: {
  color: 'amber' | 'primary';
  icon: React.ReactNode;
  title: string;
  label: string;
  since: string;
  onDone: () => void;
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
          <p className="text-xs text-muted-foreground truncate">{label} | <Elapsed since={since} /></p>
        </div>
        <Button size="sm" variant="ghost" className="tap-sm shrink-0" onClick={onDone}>
          <CheckCircle2 className="w-4 h-4 mr-1" /> Done
        </Button>
      </div>
    </motion.div>
  );
};

const TableCard = ({ session, activeOrders, onClose }: { session: WaiterSession; activeOrders: number; onClose: () => void }) => {
  const ms = useElapsed(session.opened_at);
  const tableNumber = session.tables?.table_number ?? '?';
  return (
    <Card className="overflow-hidden card-lux-hover">
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-2">
          <div>
            <p className="font-serif text-2xl font-bold leading-none">T{tableNumber}</p>
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
                <AlertDialogTitle>Free table T{tableNumber}?</AlertDialogTitle>
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

const STATUS_META: Partial<Record<OrderStatus, { dot: string; label: string }>> = {
  pending: { dot: 'bg-muted-foreground', label: 'Pending' },
  confirmed: { dot: 'bg-blue-500', label: 'Confirmed' },
  preparing: { dot: 'bg-amber-500', label: 'Preparing' },
  ready: { dot: 'bg-emerald-500', label: 'Ready' },
};

const NEXT_META: Partial<Record<OrderStatus, { status: OrderStatus; label: string; icon: React.ReactNode }>> = {
  pending: { status: 'confirmed', label: 'Confirm', icon: <Check className="w-4 h-4 mr-1.5" /> },
  confirmed: { status: 'preparing', label: 'Start prep', icon: <Flame className="w-4 h-4 mr-1.5" /> },
  preparing: { status: 'ready', label: 'Mark ready', icon: <Bell className="w-4 h-4 mr-1.5" /> },
  ready: { status: 'served', label: 'Mark served', icon: <Utensils className="w-4 h-4 mr-1.5" /> },
};

const OrderCard = ({ order, onUpdate }: { order: WaiterOrder; onUpdate: (id: string, status: OrderStatus) => void }) => {
  const ms = useElapsed(order.created_at);
  const next = NEXT_META[order.status];
  const meta = STATUS_META[order.status] ?? STATUS_META.pending;
  const tableNumber = order.table_sessions?.tables?.table_number ?? '?';

  return (
    <Card className="card-lux-hover">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2.5">
          <div className="flex items-center gap-2 min-w-0">
            <p className="font-serif text-lg font-bold shrink-0">T{tableNumber}</p>
            <Badge variant="outline" className="text-[11px] gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full ${meta?.dot ?? ''}`} />
              {meta?.label ?? order.status}
            </Badge>
          </div>
          <span className={`text-[11px] px-2 py-0.5 rounded-full border tabular-nums ${waitBg(ms)}`}>{formatDuration(ms)}</span>
        </div>
        <ul className="text-sm font-sans space-y-0.5 mb-3 text-foreground/90">
          {(order.order_items ?? []).map((item, index) => (
            <li key={`${item.menu_items?.name ?? 'item'}-${index}`} className="flex gap-2">
              <span className="tabular-nums text-muted-foreground w-6">{item.quantity}x</span>
              {item.menu_items?.name ?? 'Menu item'}
            </li>
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
