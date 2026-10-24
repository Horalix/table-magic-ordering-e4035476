import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import PaymentBadge from '@/components/PaymentBadge';
import { Skeleton } from '@/components/ui/skeleton';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Banknote,
  Bell,
  Check,
  CheckCircle2,
  ChefHat,
  ChevronDown,
  Clock,
  CreditCard,
  Hand,
  LogOut,
  Monitor,
  PowerOff,
  Sparkles,
  UserX,
  Users,
  Utensils,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { toast } from 'sonner';
import { formatDuration, formatMinutes, useElapsed, useElapsedMinutes, waitBg, seatedBg } from '@/lib/timing';
import {
  canTakePayment, describePaymentResult, km, recordTablePayment,
  resolveBillRequest as rpcResolveBillRequest, resolveWaiterCall as rpcResolveWaiterCall,
  updateOrderStatus as rpcUpdateOrderStatus, type TablePaymentMethod, type TablePaymentResult,
} from '@/lib/staff-api';
import {
  useCoalesced, useLatestRequest, useStaffRealtime, useStaffRealtimeEvent, useStaffRefresh,
} from '@/lib/realtime';
import {
  playBillRequestAlert, playWaiterCallAlert, useAudioUnlock, useReminderChime, vibrate,
} from '@/lib/kitchen-sounds';
import ConnectionPill from '@/components/staff/ConnectionPill';
import PaymentConfirm from '@/components/staff/PaymentConfirm';
import FreeTableDialog from '@/components/staff/FreeTableDialog';
import { useStaffDocument } from '@/components/staff/useStaffDocument';
import { isHeld, isInKitchen, kitchenStart, orderStatusLabel } from '@/components/staff/order-status';
import HeldOrdersCard from '@/components/staff/HeldOrdersCard';
import type { Database } from '@/integrations/supabase/types';

type OrderStatus = Database['public']['Enums']['order_status'];
type OrderItemStatus = Database['public']['Enums']['order_item_status'];
type WaiterRow = Database['public']['Tables']['waiters']['Row'];
type WaiterInfo = Pick<WaiterRow, 'id' | 'display_name'>;
type WaiterSession = Pick<Database['public']['Tables']['table_sessions']['Row'], 'id' | 'opened_at' | 'guest_name' | 'table_id'> & {
  tables: { table_number: number; section_id: string | null } | null;
};
type WaiterOrderItem = {
  notes?: string | null;
  quantity: number;
  status: OrderItemStatus;
  menu_items: { name: string } | null;
};
type WaiterOrder = Pick<
  Database['public']['Tables']['orders']['Row'],
  'id' | 'created_at' | 'status' | 'table_session_id' | 'payment_method' | 'payment_status' | 'total' | 'notes'
  | 'refunded_amount' | 'released_to_kitchen_at'
> & {
  held_reason?: string | null;
  table_sessions: { tables: { table_number: number } | null } | null;
  order_items: WaiterOrderItem[] | null;
};
/** An open call or bill request: pending, or claimed and still not done. */
type FloorAlert = {
  id: string;
  created_at: string;
  table_session_id: string;
  status: string;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  table_sessions: { tables: { table_number: number } | null } | null;
};

const SOUND_KEY = 'waiter-sound-on';

/** A per-table settle-up that is waiting for its second tap. */
interface PendingSettle {
  sessionId: string;
  tableNumber: number | string;
  method: TablePaymentMethod;
  /** Captured at the first tap: an order arriving in between is not swept in unseen. */
  orderIds: string[];
  amount: number;
}

const tableOf = (row: { table_sessions: { tables: { table_number: number } | null } | null }) =>
  row.table_sessions?.tables?.table_number ?? '?';

const WaiterDashboard = () => {
  useStaffDocument();
  const navigate = useNavigate();
  const [waiter, setWaiter] = useState<WaiterInfo | null>(null);
  const [tables, setTables] = useState<WaiterSession[]>([]);
  const [unassigned, setUnassigned] = useState<WaiterSession[]>([]);
  const [orders, setOrders] = useState<WaiterOrder[]>([]);
  const [waiterCalls, setWaiterCalls] = useState<FloorAlert[]>([]);
  const [billRequests, setBillRequests] = useState<FloorAlert[]>([]);
  const [staffNames, setStaffNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  /**
   * The last refresh failed. Persistent, not a toast: a toast is gone in four
   * seconds and the screen stays wrong until the next successful refresh — the
   * waiter has to be able to see that at a glance, any time they look.
   */
  const [stale, setStale] = useState(false);
  const [soundOn, setSoundOn] = useState<boolean>(() => localStorage.getItem(SOUND_KEY) !== 'false');
  const { unlocked: audioUnlocked, unlock: unlockSound } = useAudioUnlock();
  /** null until the first load: alerts that were already open then are not "new". */
  const prevAlertIds = useRef<Set<string> | null>(null);

  /** Taps in flight, so a double tap is one request. */
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [settle, setSettle] = useState<PendingSettle | null>(null);
  const [freeing, setFreeing] = useState<WaiterSession | null>(null);

  const waiterIdRef = useRef<string | null>(null);
  const beginFetch = useLatestRequest();

  // Live-data health from the shared channel: one socket per tab, with the
  // polling fallback and reconnect catch-up the old private channel lacked.
  const connection = useStaffRealtime();

  const fetchAll = useCallback(async () => {
    const waiterId = waiterIdRef.current;
    if (!waiterId) return;
    const isLatest = beginFetch();

    const [mine, free, names] = await Promise.all([
      supabase
        .from('table_sessions')
        .select('id, opened_at, guest_name, table_id, tables!inner(table_number, section_id)')
        .eq('is_active', true)
        .eq('assigned_waiter_id', waiterId),
      // Seated tables nobody has. These used to be invisible to every waiter —
      // and after midnight, before the trading-day fix, that was every table.
      supabase
        .from('table_sessions')
        .select('id, opened_at, guest_name, table_id, tables!inner(table_number, section_id)')
        .eq('is_active', true)
        .is('assigned_waiter_id', null),
      supabase.from('waiters').select('user_id, display_name'),
    ]);

    if (mine.error || free.error) {
      if (isLatest()) setStale(true);
      return;
    }

    const activeSessions = (mine.data ?? []) as WaiterSession[];
    const sessionIds = activeSessions.map((session) => session.id);

    const empty = { data: [], error: null };
    const [ord, calls, bills] = sessionIds.length > 0
      ? await Promise.all([
          // Every order still on the table's bill, served or not: a served
          // order that has not been paid is exactly the one the waiter must
          // collect, and filtering it out removed the only Paid button for it.
          supabase
            .from('orders')
            .select('*, table_sessions!inner(tables!inner(table_number)), order_items(quantity, status, notes, menu_items(name))')
            .in('table_session_id', sessionIds)
            .neq('status', 'cancelled')
            .order('created_at', { ascending: true }),
          // Open, not merely pending: a claimed call is still a guest waiting.
          supabase
            .from('waiter_calls')
            .select('*, table_sessions!inner(tables!inner(table_number))')
            .in('table_session_id', sessionIds)
            .neq('status', 'resolved')
            .order('created_at', { ascending: true }),
          supabase
            .from('bill_requests')
            .select('*, table_sessions!inner(tables!inner(table_number))')
            .in('table_session_id', sessionIds)
            .neq('status', 'resolved')
            .order('created_at', { ascending: true }),
        ])
      : [empty, empty, empty];

    if (!isLatest()) return;
    if (ord.error || calls.error || bills.error) {
      setStale(true);
      return;
    }

    setStale(false);
    setTables(activeSessions);
    setUnassigned((free.data ?? []) as WaiterSession[]);
    setOrders((ord.data ?? []) as WaiterOrder[]);
    setWaiterCalls((calls.data ?? []) as FloorAlert[]);
    setBillRequests((bills.data ?? []) as FloorAlert[]);
    if (Array.isArray(names.data)) {
      const map: Record<string, string> = {};
      for (const w of names.data as { user_id: string | null; display_name: string }[]) {
        if (w.user_id) map[w.user_id] = w.display_name;
      }
      setStaffNames(map);
    }
  }, [beginFetch]);

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
      waiterIdRef.current = waiterProfile.id;
      await fetchAll();
      if (mounted) setLoading(false);
    };

    void init();
    return () => { mounted = false; };
  }, [fetchAll, navigate]);

  /*
   * Refetch on the events that can change this screen — coalesced, so a
   * six-item order is one refetch rather than seven racing ones — and on every
   * poll tick, reconnect, return to the foreground and network recovery. A
   * phone spends most of the shift in a pocket; the moment it comes out is the
   * moment it must be right.
   */
  const refetch = useCoalesced(useCallback(() => { void fetchAll(); }, [fetchAll]));
  useStaffRealtimeEvent(useCallback((table: string) => {
    if (['orders', 'waiter_calls', 'bill_requests', 'table_sessions'].includes(table)) refetch();
  }, [refetch]));
  useStaffRefresh(useCallback(() => { refetch(); }, [refetch]));

  /*
   * In-flight taps. The ref is the gate — two taps inside one frame both see
   * the same render, so state alone lets the second through — and the state
   * mirrors it so the buttons can show they are disabled.
   */
  const inFlight = useRef<Set<string>>(new Set());
  const mark = (key: string, on: boolean) => {
    if (on) inFlight.current.add(key); else inFlight.current.delete(key);
    setBusy(new Set(inFlight.current));
  };

  /** One tap, one request: anything already in flight is ignored. */
  const once = async (key: string, fn: () => Promise<void>) => {
    if (inFlight.current.has(key)) return;
    mark(key, true);
    try { await fn(); } finally { mark(key, false); refetch(); }
  };

  const updateOrderStatus = (id: string, status: OrderStatus) => once(`order:${id}`, async () => {
    // Shown at once; the refetch puts the database's answer back either way.
    setOrders((prev) => prev.map((o) => (o.id === id ? { ...o, status } : o)));
    try {
      // Validated server-side; an illegal move is refused rather than applied.
      await rpcUpdateOrderStatus(id, status);
      toast.success(status === 'served' ? 'Marked served' : 'Accepted');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update the order');
    }
  });

  const resolveCall = (id: string) => once(`call:${id}`, async () => {
    setWaiterCalls((prev) => prev.filter((c) => c.id !== id));
    try {
      // Through the RPC, so the cleared call has a name attached to it.
      await rpcResolveWaiterCall(id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not clear the call');
    }
  });

  const resolveBill = (id: string) => once(`bill:${id}`, async () => {
    setBillRequests((prev) => prev.filter((b) => b.id !== id));
    try {
      await rpcResolveBillRequest(id, false);
      toast.success('Bill request cleared — the table stays open');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not clear the bill request');
    }
  });

  /**
   * Settle a whole table, cash or terminal.
   *
   * Records each order captured at the first tap. Any the server reports as
   * already paid (typically online) are called out loudly — that is money the
   * waiter must NOT take — instead of being announced as "recorded".
   */
  const confirmSettle = () => settle && once(`settle:${settle.sessionId}`, async () => {
    const { orderIds, method, tableNumber } = settle;
    const results: { id: string; result: TablePaymentResult }[] = [];
    let failed = 0;
    for (const id of orderIds) {
      try {
        results.push({ id, result: await recordTablePayment(id, method) });
      } catch (error) {
        failed += 1;
        toast.error(error instanceof Error ? error.message : 'Could not record the payment');
      }
    }
    const done = new Set(results.map((r) => r.id));
    setOrders((prev) => prev.map((o) => (done.has(o.id) ? { ...o, payment_status: 'paid', payment_method: o.payment_method ?? method } : o)));
    setSettle(null);

    const already = results.filter((r) => !describePaymentResult(r.result, method).ok);
    const recorded = results.length - already.length;
    if (already.length > 0) {
      toast.warning(
        `Table ${tableNumber}: ${describePaymentResult(already[0].result, method).message}`
        + (already.length > 1 ? ` (${already.length} orders)` : ''),
        { duration: 10_000 },
      );
    }
    if (recorded > 0 && failed === 0) {
      toast.success(`Table ${tableNumber}: ${describePaymentResult({ status: 'paid', payment_method: method }, method).message}`);
    }
  });

  const logout = async () => {
    await supabase.auth.signOut();
    navigate('/waiter/login');
  };

  /* ---- Derived ------------------------------------------------------- */

  const bySession = useMemo(() => {
    const map: Record<string, WaiterOrder[]> = {};
    for (const o of orders) (map[o.table_session_id] ??= []).push(o);
    return map;
  }, [orders]);

  const owedFor = useCallback((sessionId: string) => {
    const due = (bySession[sessionId] ?? []).filter(canTakePayment);
    return { due, amount: due.reduce((sum, o) => sum + Number(o.total ?? 0), 0) };
  }, [bySession]);

  /** Ready plates are the most time-critical thing a waiter does; they lead. */
  const readyToRun = orders.filter((o) => o.status === 'ready');
  /** In the kitchen, not yet up. */
  const cooking = orders.filter((o) => isInKitchen(o.status) && !isHeld(o) && !['ready', 'served'].includes(o.status));
  /**
   * Card orders whose payment has not cleared, and orders held for staff to
   * confirm — said in words, never counted as cooking.
   */
  const notInKitchen = orders.filter((o) => !isInKitchen(o.status) || isHeld(o));

  const attentionCount = waiterCalls.length + billRequests.length + readyToRun.length;
  const ordersWaiting = cooking.length + readyToRun.length;
  const oldestOrderMs = [...cooking, ...readyToRun].reduce((max, order) => {
    const ms = Date.now() - new Date(kitchenStart(order)).getTime();
    return ms > max ? ms : max;
  }, 0);
  const totalOwed = tables.reduce((sum, t) => sum + owedFor(t.id).amount, 0);

  const initials = (waiter?.display_name || '?')
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  /*
   * Chime and buzz on a NEW call or bill request.
   *
   * The old check only fired when the previous set was non-empty — so on a
   * quiet floor, the first call of the evening (the one most likely to be
   * missed) made no sound at all. The baseline is now "after the first load",
   * not "after the first alert". And it uses the shared, gesture-unlocked
   * audio context: a fresh AudioContext per beep is born suspended on phones,
   * so it was silent there regardless.
   */
  useEffect(() => {
    if (loading) return;
    const ids = new Set<string>([
      ...waiterCalls.map((call) => `c:${call.id}`),
      ...billRequests.map((bill) => `b:${bill.id}`),
    ]);
    const prev = prevAlertIds.current;
    prevAlertIds.current = ids;
    if (prev === null || !soundOn) return;
    const newBill = billRequests.some((b) => !prev.has(`b:${b.id}`));
    const newCall = waiterCalls.some((c) => !prev.has(`c:${c.id}`));
    if (!newBill && !newCall) return;
    vibrate();
    if (newBill) playBillRequestAlert(); else playWaiterCallAlert();
  }, [waiterCalls, billRequests, soundOn, loading]);

  /* Again every ~75s while a table is waiting and nobody is on the way. */
  const alertsRef = useRef({ calls: waiterCalls, bills: billRequests });
  useEffect(() => { alertsRef.current = { calls: waiterCalls, bills: billRequests }; }, [waiterCalls, billRequests]);
  useReminderChime(
    soundOn && (waiterCalls.length > 0 || billRequests.length > 0),
    useCallback(() => {
      const waiting = (a: FloorAlert) => a.status === 'pending'
        || !a.acknowledged_at || Date.now() - new Date(a.acknowledged_at).getTime() > 3 * 60_000;
      const { calls, bills } = alertsRef.current;
      if (!calls.some(waiting) && !bills.some(waiting)) return;
      vibrate();
      if (bills.some(waiting)) playBillRequestAlert(); else playWaiterCallAlert();
    }, []),
  );

  const toggleSound = async () => {
    const next = !soundOn;
    setSoundOn(next);
    localStorage.setItem(SOUND_KEY, String(next));
    if (next && (await unlockSound())) playWaiterCallAlert();
  };

  const startSettle = (sessionId: string, tableNumber: number | string, method: TablePaymentMethod) => {
    const { due, amount } = owedFor(sessionId);
    if (due.length === 0) return;
    setSettle({ sessionId, tableNumber, method, orderIds: due.map((o) => o.id), amount });
  };

  const settleRow = (sessionId: string, tableNumber: number | string) => {
    const { due, amount } = owedFor(sessionId);
    if (settle?.sessionId === sessionId) {
      return (
        <PaymentConfirm
          tableNumber={tableNumber}
          amount={settle.amount}
          method={settle.method}
          busy={busy.has(`settle:${sessionId}`)}
          detail={settle.orderIds.length > 1 ? `${settle.orderIds.length} orders` : undefined}
          onCancel={() => setSettle(null)}
          onConfirm={() => { void confirmSettle(); }}
        />
      );
    }
    if (due.length === 0) return null;
    return (
      <OwesRow
        amount={amount}
        orders={due.length}
        disabled={busy.has(`settle:${sessionId}`)}
        onCash={() => startSettle(sessionId, tableNumber, 'cash')}
        onTerminal={() => startSettle(sessionId, tableNumber, 'pos_terminal')}
      />
    );
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
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 shrink-0 rounded-full bg-gradient-to-br from-primary to-accent text-primary-foreground grid place-items-center font-serif font-bold text-sm">
              {initials}
            </div>
            <div className="min-w-0">
              <h1 className="font-serif text-lg sm:text-xl font-bold leading-tight truncate">{waiter?.display_name}</h1>
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground flex-wrap">
                <ConnectionPill state={connection} />
                <span>{tables.length} table{tables.length !== 1 ? 's' : ''}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button variant="ghost" asChild className="tap-sm min-h-[44px] min-w-[44px] px-2">
              <Link to="/waiter/monitor" aria-label="Floor monitor"><Monitor className="w-5 h-5 sm:mr-1" /><span className="hidden sm:inline text-sm">Floor</span></Link>
            </Button>
            <Button
              variant="ghost"
              onClick={() => { void toggleSound(); }}
              className="tap-sm min-h-[44px] min-w-[44px] px-2"
              aria-label={soundOn ? 'Mute waiter alert sound' : 'Enable waiter alert sound'}
            >
              {soundOn ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5 text-muted-foreground" />}
            </Button>
            <Button variant="ghost" onClick={logout} className="tap-sm min-h-[44px] min-w-[44px] px-2" aria-label="Sign out">
              <LogOut className="w-5 h-5 sm:mr-1" /><span className="hidden sm:inline text-sm">Sign out</span>
            </Button>
          </div>
        </div>

        {/* Phones suspend audio until a tap. Saying so is the difference
            between a waiter who knows to tap once and one who trusts a
            silent phone all evening. */}
        {soundOn && !audioUnlocked && (
          <div className="max-w-6xl mx-auto px-4 sm:px-6 pb-2">
            <button
              onClick={() => { void unlockSound().then((ok) => { if (ok) playWaiterCallAlert(); }); }}
              className="w-full min-h-[44px] rounded-lg bg-destructive/10 text-destructive text-sm font-sans font-semibold flex items-center justify-center gap-2"
            >
              <VolumeX className="w-4 h-4" /> Sound is off on this phone — tap to enable alerts
            </button>
          </div>
        )}

        {stale && (
          <div role="alert" className="bg-destructive text-destructive-foreground text-sm font-sans font-semibold px-4 sm:px-6 py-2 text-center">
            Could not refresh — this screen may be out of date. Retrying automatically.
          </div>
        )}

        <div className="max-w-6xl mx-auto px-4 sm:px-6 pb-3 grid grid-cols-3 gap-2 text-center">
          <StatChip label="Owed" value={totalOwed > 0 ? km(totalOwed) : '-'} tone={totalOwed > 0 ? 'warn' : 'idle'} />
          <StatChip label="In kitchen" value={ordersWaiting} tone={ordersWaiting > 0 ? 'active' : 'idle'} />
          <StatChip
            label="Oldest wait"
            value={oldestOrderMs > 0 ? formatDuration(oldestOrderMs) : '-'}
            tone={oldestOrderMs > 10 * 60_000 ? 'urgent' : oldestOrderMs > 5 * 60_000 ? 'warn' : 'idle'}
          />
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-5 space-y-7">
        {/* Every held order in the venue, not just this waiter's tables: whoever
            is nearest the table is the one who can tell if anyone is there. */}
        <HeldOrdersCard soundEnabled={soundOn} onChanged={refetch} />
        <section>
          <SectionTitle icon={<Bell className="w-4 h-4" />} title="Attention needed" count={attentionCount} />
          {attentionCount === 0 ? (
            <div className="rounded-xl border border-dashed border-border/60 bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
              <Sparkles className="w-4 h-4" /> All caught up
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <AnimatePresence mode="popLayout">
                {billRequests.map((bill) => (
                  <AlertCard
                    key={bill.id}
                    color="primary"
                    icon={<CreditCard className="w-5 h-5" />}
                    title={`Table ${tableOf(bill)}`}
                    label="Wants the bill"
                    alert={bill}
                    claimedBy={bill.acknowledged_by ? staffNames[bill.acknowledged_by] ?? 'Someone' : null}
                    doneLabel="Bill given"
                    busy={busy.has(`bill:${bill.id}`)}
                    onDone={() => { void resolveBill(bill.id); }}
                  >
                    {settleRow(bill.table_session_id, tableOf(bill))}
                  </AlertCard>
                ))}
                {waiterCalls.map((call) => (
                  <AlertCard
                    key={call.id}
                    color="amber"
                    icon={<Hand className="w-5 h-5" />}
                    title={`Table ${tableOf(call)}`}
                    label="Needs you"
                    alert={call}
                    claimedBy={call.acknowledged_by ? staffNames[call.acknowledged_by] ?? 'Someone' : null}
                    doneLabel="Done"
                    busy={busy.has(`call:${call.id}`)}
                    onDone={() => { void resolveCall(call.id); }}
                  />
                ))}
                {readyToRun.map((order) => (
                  <motion.div key={order.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96 }}>
                    <OrderCard
                      order={order}
                      busy={busy.has(`order:${order.id}`)}
                      onUpdate={updateOrderStatus}
                      highlight
                    />
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}
        </section>

        <section>
          <SectionTitle icon={<ChefHat className="w-4 h-4" />} title="In the kitchen" count={cooking.length + notInKitchen.length} />
          {cooking.length + notInKitchen.length === 0 ? (
            <EmptyState icon={<Utensils className="w-5 h-5" />} text="Nothing cooking for your tables." />
          ) : (
            <div className="grid sm:grid-cols-2 gap-3">
              <AnimatePresence mode="popLayout">
                {[...cooking, ...notInKitchen].map((order) => (
                  <motion.div
                    key={order.id}
                    layout
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.96 }}
                    transition={{ duration: 0.2 }}
                  >
                    <OrderCard order={order} busy={busy.has(`order:${order.id}`)} onUpdate={updateOrderStatus} />
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}
        </section>

        {/* Collapsed by default: during service the table list is reference,
            not a to-do list, and it used to push the alerts off the screen. */}
        <Collapsible>
          <CollapsibleTrigger asChild>
            <button className="group w-full flex items-center gap-2 min-h-[44px] text-left">
              <span className="text-muted-foreground"><Users className="w-4 h-4" /></span>
              <h2 className="font-serif text-base sm:text-lg font-bold">My tables</h2>
              <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground tabular-nums">{tables.length}</span>
              {totalOwed > 0 && (
                <span className="text-sm font-sans font-semibold text-amber-700 dark:text-amber-400 tabular-nums">
                  {km(totalOwed)} owed
                </span>
              )}
              <ChevronDown className="w-5 h-5 ml-auto text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-3">
            {tables.length === 0 ? (
              <EmptyState icon={<Users className="w-5 h-5" />} text="No tables yet. Tables appear here once your manager assigns your section for today and a guest sits down." />
            ) : (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {tables.map((session) => (
                  <TableCard
                    key={session.id}
                    session={session}
                    activeOrders={(bySession[session.id] ?? []).filter((o) => isInKitchen(o.status) && !isHeld(o) && o.status !== 'served').length}
                    onClose={() => setFreeing(session)}
                  >
                    {settleRow(session.id, session.tables?.table_number ?? '?')}
                  </TableCard>
                ))}
              </div>
            )}
          </CollapsibleContent>
        </Collapsible>

        {unassigned.length > 0 && (
          <section>
            <SectionTitle icon={<UserX className="w-4 h-4" />} title="Unassigned tables" count={unassigned.length} />
            <p className="text-sm text-muted-foreground font-sans mb-2">
              Seated, but no waiter has them. Tell your manager, or look after them.
            </p>
            <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {unassigned.map((session) => <UnassignedRow key={session.id} session={session} />)}
            </ul>
          </section>
        )}
      </main>

      <FreeTableDialog
        open={freeing !== null}
        onOpenChange={(open) => { if (!open) setFreeing(null); }}
        sessionId={freeing?.id ?? null}
        tableNumber={freeing?.tables?.table_number ?? '?'}
        knownOwed={freeing ? owedFor(freeing.id).amount : 0}
        onFreed={refetch}
      />
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
      <p className="text-[11px] uppercase tracking-wide opacity-70 leading-none">{label}</p>
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

/** "Marko is going (3m)". */
const Going = ({ name, since }: { name: string; since: string | null }) => {
  const ms = useElapsedMinutes(since);
  return <>{name} is going{since ? ` (${formatMinutes(ms)})` : ''}</>;
};

/** What a table owes, with the two ways to settle it in the room. */
const OwesRow = ({
  amount, orders, disabled, onCash, onTerminal,
}: {
  amount: number;
  orders: number;
  disabled: boolean;
  onCash: () => void;
  onTerminal: () => void;
}) => (
  <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-2.5">
    <p className="text-sm font-sans font-semibold text-foreground">
      Owes <span className="tabular-nums">{km(amount)}</span>
      {orders > 1 && <span className="font-normal text-muted-foreground"> · {orders} orders</span>}
    </p>
    <div className="flex gap-2 mt-2">
      <Button variant="outline" className="flex-1 min-h-[44px] tap text-sm gap-1.5" disabled={disabled} onClick={onCash}>
        <Banknote className="w-4 h-4" /> Cash
      </Button>
      <Button variant="outline" className="flex-1 min-h-[44px] tap text-sm gap-1.5" disabled={disabled} onClick={onTerminal}>
        <CreditCard className="w-4 h-4" /> Terminal
      </Button>
    </div>
  </div>
);

const AlertCard = ({
  color,
  icon,
  title,
  label,
  alert,
  claimedBy,
  doneLabel,
  busy,
  onDone,
  children,
}: {
  color: 'amber' | 'primary';
  icon: React.ReactNode;
  title: string;
  label: string;
  alert: FloorAlert;
  /** Who said they are going — the call stays here until it is actually done. */
  claimedBy: string | null;
  doneLabel: string;
  busy: boolean;
  onDone: () => void;
  children?: React.ReactNode;
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
      <div className={`relative overflow-hidden rounded-xl border ${tint} pl-3 pr-2 py-2.5 space-y-2`}>
        <div className={`absolute left-0 top-0 bottom-0 w-1 ${accent}`} />
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-lg ${accent} text-white grid place-items-center shrink-0`}>
            {icon}
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-sans font-bold text-base truncate">{title}</p>
            <p className="text-sm text-muted-foreground truncate">
              {label} | <Elapsed since={alert.created_at} />
            </p>
            {alert.status === 'acknowledged' && claimedBy && (
              <p className="text-sm font-medium text-foreground truncate"><Going name={claimedBy} since={alert.acknowledged_at} /></p>
            )}
          </div>
          <Button variant="ghost" className="tap-sm shrink-0 min-h-[44px] text-sm" disabled={busy} onClick={onDone}>
            <CheckCircle2 className="w-4 h-4 mr-1" /> {doneLabel}
          </Button>
        </div>
        {children}
      </div>
    </motion.div>
  );
};

const TableCard = ({
  session, activeOrders, onClose, children,
}: {
  session: WaiterSession;
  activeOrders: number;
  onClose: () => void;
  /** The owes row, when there is anything to collect. */
  children?: React.ReactNode;
}) => {
  const ms = useElapsed(session.opened_at);
  const tableNumber = session.tables?.table_number ?? '?';
  return (
    <Card className="overflow-hidden card-lux-hover">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between">
          <div>
            <p className="font-serif text-2xl font-bold leading-none">T{tableNumber}</p>
            {session.guest_name && <p className="text-sm text-muted-foreground mt-1 truncate max-w-[160px]">{session.guest_name}</p>}
          </div>
          {/* Seated duration, on the seated scale. Colouring it with the
              ORDER scale turned every table twenty minutes into a normal
              dinner destructive-red, and the colour stopped meaning anything. */}
          <span className={`text-xs px-2 py-0.5 rounded-full border tabular-nums ${seatedBg(ms)}`}>
            <Clock className="w-3 h-3 inline -mt-0.5 mr-1" />{formatDuration(ms)}
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          {activeOrders > 0 ? `${activeOrders} order${activeOrders !== 1 ? 's' : ''} in the kitchen` : 'Nothing in the kitchen'}
        </p>
        {children}
        <div className="border-t border-border/60 pt-2">
          <Button variant="ghost" className="w-full tap-sm min-h-[44px] text-sm text-muted-foreground hover:text-destructive" onClick={onClose}>
            <PowerOff className="w-4 h-4 mr-1.5" /> Free table
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

const UnassignedRow = ({ session }: { session: WaiterSession }) => {
  const ms = useElapsed(session.opened_at);
  return (
    <li className="rounded-lg border border-border px-3 min-h-[44px] flex items-center justify-between gap-2 text-sm">
      <span className="font-serif text-lg font-bold">T{session.tables?.table_number ?? '?'}</span>
      <span className="text-muted-foreground truncate">{session.guest_name ?? ''}</span>
      <span className={`text-xs px-2 py-0.5 rounded-full border tabular-nums ${seatedBg(ms)}`}>{formatDuration(ms)}</span>
    </li>
  );
};

const STATUS_META: Partial<Record<OrderStatus, { dot: string }>> = {
  pending: { dot: 'bg-muted-foreground' },
  confirmed: { dot: 'bg-blue-500' },
  preparing: { dot: 'bg-amber-500' },
  ready: { dot: 'bg-emerald-500' },
  awaiting_payment: { dot: 'bg-accent' },
  payment_failed: { dot: 'bg-destructive' },
};

/**
 * What a WAITER may do to an order.
 *
 * Deliberately only two things: accept it, and say the plates are down.
 *
 * "Start prep" and "Mark ready" used to be here, which meant a waiter on the
 * floor could mark food ready that the kitchen had not touched — irreversibly,
 * from a phone, with the pass none the wiser. Those transitions belong to
 * whoever is holding the pan. The board derives them from the lines now.
 */
const NEXT_META: Partial<Record<OrderStatus, { status: OrderStatus; label: string; icon: React.ReactNode }>> = {
  pending: { status: 'confirmed', label: 'Accept', icon: <Check className="w-4 h-4 mr-1.5" /> },
  ready: { status: 'served', label: 'Mark served', icon: <Utensils className="w-4 h-4 mr-1.5" /> },
};

const OrderCard = ({ order, busy, onUpdate, highlight = false }: {
  order: WaiterOrder;
  busy: boolean;
  onUpdate: (id: string, status: OrderStatus) => void;
  highlight?: boolean;
}) => {
  const held = isHeld(order);
  const inKitchen = isInKitchen(order.status) && !held;
  const ms = useElapsed(kitchenStart(order));
  const next = inKitchen ? NEXT_META[order.status] : undefined;
  const meta = STATUS_META[order.status] ?? STATUS_META.pending;
  const tableNumber = tableOf(order);

  return (
    <Card className={`card-lux-hover ${highlight ? 'border-emerald-500/50 bg-emerald-500/5' : ''}`}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2.5 gap-2">
          <div className="flex items-center gap-2 min-w-0 flex-wrap">
            <p className="font-serif text-lg font-bold shrink-0">T{tableNumber}</p>
            <Badge variant="outline" className="text-xs gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full ${meta?.dot ?? ''}`} />
              {highlight ? 'Ready to run' : held ? 'Needs confirming' : orderStatusLabel(order.status)}
            </Badge>
            <PaymentBadge method={order.payment_method} status={order.payment_status} />
          </div>
          {inKitchen && (
            <span className={`text-xs px-2 py-0.5 rounded-full border tabular-nums ${waitBg(ms)}`}>{formatDuration(ms)}</span>
          )}
        </div>
        {/* A card order whose payment has not cleared looked exactly like a
            new "Pending" one, and the waiter chased the kitchen for food it had
            never been sent. */}
        {!inKitchen && (
          <p className="text-sm font-sans font-semibold text-accent mb-2">
            {held ? 'Not in kitchen — confirm it above' : 'Not in kitchen — payment pending'}
          </p>
        )}
        <ul className="text-sm font-sans space-y-0.5 mb-3 text-foreground/90">
          {(order.order_items ?? []).map((item, index) => (
            <li key={`${item.menu_items?.name ?? 'item'}-${index}`} className="flex gap-2">
              <span className="tabular-nums text-muted-foreground w-6">{item.quantity}x</span>
              <span>
                {item.menu_items?.name ?? 'Menu item'}
                {item.notes && <span className="block text-sm text-accent font-semibold">! {item.notes}</span>}
              </span>
            </li>
          ))}
        </ul>
        {/* The kitchen has always printed this. The person actually carrying
            the plate to the guest could not see it. */}
        {order.notes && (
          <p className="text-sm text-accent font-semibold mb-3 -mt-2">Note: {order.notes}</p>
        )}
        {next && (
          <Button className="w-full tap min-h-[44px] text-sm" disabled={busy} onClick={() => onUpdate(order.id, next.status)}>
            {next.icon}{next.label}
          </Button>
        )}
      </CardContent>
    </Card>
  );
};

export default WaiterDashboard;
