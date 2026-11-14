import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { supabase } from '@/integrations/supabase/client';
import { SHOW_DELETED } from '@/lib/menu-bin';
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
  ChevronRight,
  Clock,
  CloudOff,
  CreditCard,
  Footprints,
  Hand,
  LogOut,
  Monitor,
  PowerOff,
  RefreshCw,
  Settings,
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
  ackBillRequest, ackWaiterCall, canTakePayment, closeTableSession, describePaymentResult, km, recordTablePayment,
  resolveBillRequest as rpcResolveBillRequest, resolveWaiterCall as rpcResolveWaiterCall,
  takeTable, updateOrderStatus as rpcUpdateOrderStatus, type TablePaymentMethod, type TablePaymentResult,
} from '@/lib/staff-api';
import {
  useCoalesced, useLatestRequest, useStaffRealtime, useStaffRealtimeEvent, useStaffRefresh,
} from '@/lib/realtime';
import {
  canVibrate, playBillRequestAlert, playOrderAlert, playOrderPlacedAlert, playWaiterCallAlert, ringThroughSilentSwitch,
  useAudioUnlock, useReminderChime, vibrate,
} from '@/lib/kitchen-sounds';
import { soundBackAt, useStaffSound } from '@/lib/staff-sound';
import ConnectionPill from '@/components/staff/ConnectionPill';
import PaymentConfirm from '@/components/staff/PaymentConfirm';
import FreeTableDialog from '@/components/staff/FreeTableDialog';
import { useStaffDocument, useStaffVenueLook } from '@/components/staff/useStaffDocument';
import { isHeld, isInKitchen, kitchenStart, orderStatusLabel } from '@/components/staff/order-status';
import { attentionSummary as summarize, plural } from '@/components/staff/floor-words';
import HeldOrdersCard from '@/components/staff/HeldOrdersCard';
import EndOfDayTables from '@/components/staff/EndOfDayTables';
import LockScreenAlerts from '@/components/staff/LockScreenAlerts';
import MenuOnlyNotice from '@/components/staff/MenuOnlyNotice';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useLockScreenAlerts } from '@/hooks/useLockScreenAlerts';
import { useStaffVenue } from '@/hooks/useStaffVenue';
import { forgetThisPhone, STAFF_PUSH_MESSAGE } from '@/lib/push-alerts';
import { inWaiterApp } from '@/lib/waiter-app';
import { businessDayISO } from '@/lib/reporting';
import {
  NO_SIGNALS, floorSummary, floorTiles, readTablesView, tileLabel, urgentSignal, useTablesView,
  type FloorTile, type SectionSession, type SectionTable, type TableSignals, type TablesView,
} from '@/lib/waiter-tables';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
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

/** Who is on their way to an alert. */
type Claimer = { name: string; mine: boolean };

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

/** The waiter's sections today, their tables, and who is seated at them ("All my tables"). */
interface MyFloor {
  sectionIds: string[];
  tables: SectionTable[];
  sessions: SectionSession[];
}

/**
 * Only asked for while "All my tables" is chosen, so a phone on the usual view
 * makes no extra requests. Staff may read their own restaurant's tables and
 * rota (20261028090000_two_restaurants_foundation.sql), and the rota is the
 * trading day's, which runs to 05:00.
 */
async function loadMyFloor(waiterId: string): Promise<MyFloor | 'failed'> {
  const assigned = await supabase
    .from('section_assignments')
    .select('section_id')
    .eq('waiter_id', waiterId)
    .eq('shift_date', businessDayISO());
  if (assigned.error) return 'failed';
  const sectionIds = [...new Set((assigned.data ?? []).map((a) => a.section_id))];
  if (sectionIds.length === 0) return { sectionIds, tables: [], sessions: [] };
  const [t, s] = await Promise.all([
    supabase.from('tables').select('id, table_number, section_id').in('section_id', sectionIds).order('table_number'),
    supabase
      .from('table_sessions')
      .select('id, table_id, assigned_waiter_id, tables!inner(section_id)')
      .eq('is_active', true)
      .in('tables.section_id', sectionIds),
  ]);
  if (t.error || s.error) return 'failed';
  return { sectionIds, tables: (t.data ?? []) as SectionTable[], sessions: (s.data ?? []) as SectionSession[] };
}

const WaiterDashboard = () => {
  /** The signed-in account, for which restaurant this phone works at. */
  const [userId, setUserId] = useState<string | null>(null);
  const staffVenue = useStaffVenue(userId);
  const venueName = staffVenue?.venue.name ?? null;
  useStaffDocument(venueName ? `Waiter · ${venueName}` : 'Waiter');
  useStaffVenueLook(staffVenue?.venue.slug);
  const navigate = useNavigate();
  const [waiter, setWaiter] = useState<WaiterInfo | null>(null);
  const [tables, setTables] = useState<WaiterSession[]>([]);
  const [unassigned, setUnassigned] = useState<WaiterSession[]>([]);
  const [orders, setOrders] = useState<WaiterOrder[]>([]);
  const [waiterCalls, setWaiterCalls] = useState<FloorAlert[]>([]);
  const [billRequests, setBillRequests] = useState<FloorAlert[]>([]);
  const [staffNames, setStaffNames] = useState<Record<string, string>>({});
  /** waiters.id → name, for a table in my section that a colleague has. */
  const [waiterNames, setWaiterNames] = useState<Record<string, string>>({});
  /* "My tables": only the seated ones, or every table in my sections (Settings). */
  const [tablesView, chooseTablesView] = useTablesView(waiter?.id ?? null);
  /*
   * What the next load asks for. Set where the choice is made (the first load
   * and Settings), not copied from state after a render: the first load runs
   * before that render, and a phone left on "All my tables" came back from a
   * reload without its tiles until the next refresh, up to a minute later.
   */
  const tablesViewRef = useRef<TablesView>(tablesView);
  /** Loaded with everything else while "All my tables" is chosen; null otherwise. */
  const [myFloor, setMyFloor] = useState<MyFloor | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** "All my tables": the seated table whose details are open, by session id. */
  const [openTableId, setOpenTableId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  /**
   * The last refresh failed. Persistent, not a toast: a toast is gone in four
   * seconds and the screen stays wrong until the next successful refresh — the
   * waiter has to be able to see that at a glance, any time they look.
   */
  const [stale, setStale] = useState(false);
  /**
   * At least one refresh has answered. Until then, empty lists mean "not
   * known", not "nothing waiting": a phone that came up on a dead wifi said
   * "All caught up" and "Nothing cooking" over a red banner, and the calm
   * words are the ones a busy waiter believes.
   */
  const [loaded, setLoaded] = useState(false);
  // On unless muted, and a mute ends by itself (src/lib/staff-sound.ts):
  // it used to be remembered into every later shift.
  const { soundOn, mutedUntil, setSoundOn } = useStaffSound('waiter');
  const soundOnRef = useRef(soundOn);
  useEffect(() => { soundOnRef.current = soundOn; }, [soundOn]);
  // An iPhone on its silent switch muted every alert, and it cannot buzz.
  useEffect(() => { ringThroughSilentSwitch(); }, []);
  // Signing out stops every alert for this waiter's tables, and signing back
  // in needs the password from the manager: one stray tap must not do it.
  const [confirmSignOut, setConfirmSignOut] = useState(false);
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
    // Alongside the rest, not after it: the floor is two short reads.
    const floorRequest = tablesViewRef.current === 'all' ? loadMyFloor(waiterId) : Promise.resolve(null);

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
      supabase.from('waiters').select('id, user_id, display_name'),
    ]);

    if (mine.error || free.error) {
      if (isLatest()) setStale(true);
      return;
    }

    const activeSessions = (mine.data ?? []) as WaiterSession[];
    const freeSessions = (free.data ?? []) as WaiterSession[];
    /*
     * Mine AND nobody's. A table outside the day's rota used to be silent on
     * every phone — its call, its bill request, its plates on the pass — and
     * only the floor monitor showed them. Everyone sees those now, with a
     * one-tap "Take table" (staff_take_table).
     */
    const sessionIds = [...activeSessions, ...freeSessions].map((session) => session.id);

    const empty = { data: [], error: null };
    const [ord, calls, bills] = sessionIds.length > 0
      ? await Promise.all([
          // Every order still on the table's bill, served or not: a served
          // order that has not been paid is exactly the one the waiter must
          // collect, and filtering it out removed the only Paid button for it.
          supabase
            .from('orders')
            .select('*, table_sessions!inner(tables!inner(table_number)), order_items(quantity, status, notes, menu_items(name))')
            // Names of dishes deleted since (src/lib/menu-bin.ts).
            .setHeader(SHOW_DELETED[0], SHOW_DELETED[1])
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
    const floor = await floorRequest;

    if (!isLatest()) return;
    if (ord.error || calls.error || bills.error || floor === 'failed') {
      setStale(true);
      return;
    }

    setStale(false);
    setLoaded(true);
    setTables(activeSessions);
    setUnassigned(freeSessions);
    setOrders((ord.data ?? []) as WaiterOrder[]);
    setWaiterCalls((calls.data ?? []) as FloorAlert[]);
    setBillRequests((bills.data ?? []) as FloorAlert[]);
    setMyFloor(floor);
    if (Array.isArray(names.data)) {
      const byUser: Record<string, string> = {};
      const byWaiter: Record<string, string> = {};
      for (const w of names.data as { id: string; user_id: string | null; display_name: string }[]) {
        if (w.user_id) byUser[w.user_id] = w.display_name;
        byWaiter[w.id] = w.display_name;
      }
      setStaffNames(byUser);
      setWaiterNames(byWaiter);
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
      if (mounted) setUserId(session.user.id);

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
      tablesViewRef.current = readTablesView(waiterProfile.id);
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

  /** Settings → "My tables shows": applied at once, and the floor loaded straight away. */
  const changeTablesView = (view: TablesView) => {
    chooseTablesView(view);
    tablesViewRef.current = view;
    if (view === 'seated') setMyFloor(null);
    refetch();
  };

  /* "Alerts on lock screen": this phone, for this waiter's restaurant. */
  const alerts = useLockScreenAlerts(staffVenue?.venue.dbId ?? null);
  /*
   * A lock-screen alert reached this phone while the screen is open
   * (public/sw-push.js): the same news, so load it now rather than at the
   * next tick. The usual new-order chime then plays from the refresh.
   */
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      if ((event.data as { type?: unknown } | null)?.type === STAFF_PUSH_MESSAGE) refetch();
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [refetch]);

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
   * "I'm going": the claim the floor monitor has always had, from the phone.
   *
   * A call from a table nobody has reaches every phone, and without a claim
   * two waiters walked to it — or none, each assuming the other had — while
   * every device kept re-chiming. The claim puts "Marko is going" on the other
   * screens and quiets the reminder for the takeover window (useReminderChime).
   */
  const claim = (kind: 'call' | 'bill', alert: FloorAlert) => once(`claim:${alert.id}`, async () => {
    const set = kind === 'call' ? setWaiterCalls : setBillRequests;
    const now = new Date().toISOString();
    set((prev) => prev.map((a) => (a.id === alert.id
      ? { ...a, status: 'acknowledged', acknowledged_by: userId, acknowledged_at: now }
      : a)));
    try {
      const result = kind === 'call' ? await ackWaiterCall(alert.id) : await ackBillRequest(alert.id);
      if (!result.mine) {
        const who = (result.claimed_by && staffNames[result.claimed_by]) || 'Someone else';
        toast.info(result.status === 'resolved'
          ? `${who} already dealt with table ${tableOf(alert)}`
          : `${who} is already going to table ${tableOf(alert)}`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not say you are going');
    }
  });

  /**
   * Settle a whole table, cash or terminal.
   *
   * Records each order captured at the first tap. Any the server reports as
   * already paid (typically online) are called out loudly — that is money the
   * waiter must NOT take — instead of being announced as "recorded".
   */
  const confirmSettle = (freeAfter = false) => settle && once(`settle:${settle.sessionId}`, async () => {
    const { orderIds, method, tableNumber, sessionId } = settle;
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
    if (recorded > 0 && failed === 0 && !freeAfter) {
      toast.success(`Table ${tableNumber}: ${describePaymentResult({ status: 'paid', payment_method: method }, method).message}`);
    }

    // Paid and leaving: free the table in the same breath. Not when anything
    // went wrong above — that is a conversation at the table first.
    if (freeAfter && failed === 0 && already.length === 0) {
      try {
        const result = await closeTableSession(sessionId);
        if (result.closed) toast.success(`Table ${tableNumber}: ${km(settle.amount)} recorded, table is free`);
        else toast.error(`Table ${tableNumber}: payment recorded, but it still owes ${km(result.outstanding)} — not freed`);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Payment recorded, but the table could not be freed');
      }
    }
  });

  /** Make a table nobody has this waiter's. */
  const take = (sessionId: string, tableNumber: number | string) => once(`take:${sessionId}`, async () => {
    try {
      const result = await takeTable(sessionId);
      if (result.taken) toast.success(`Table ${tableNumber} is yours`);
      else if (result.reason === 'already_taken') toast.info(`${result.waiter ?? 'Someone'} already has table ${tableNumber}`);
      else toast.error(`Table ${tableNumber} has closed`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not take the table');
    }
  });

  const logout = async () => {
    // Whoever signs in next on this phone does not get this waiter's alerts.
    await forgetThisPhone();
    await supabase.auth.signOut();
    navigate('/waiter/login');
  };

  /* ---- Derived ------------------------------------------------------- */

  const bySession = useMemo(() => {
    const map: Record<string, WaiterOrder[]> = {};
    for (const o of orders) (map[o.table_session_id] ??= []).push(o);
    return map;
  }, [orders]);

  const unassignedIds = useMemo(() => new Set(unassigned.map((s) => s.id)), [unassigned]);

  /** On an alert from a table nobody has: say so, and offer to take it. */
  const takeStrip = (sessionId: string, tableNumber: number | string) => (
    unassignedIds.has(sessionId) ? (
      <TakeTableStrip
        tableNumber={tableNumber}
        busy={busy.has(`take:${sessionId}`)}
        onTake={() => { void take(sessionId, tableNumber); }}
      />
    ) : null
  );

  /** Who said they are going — "you" when it was this phone, not this waiter's own name. */
  const claimer = (alert: FloorAlert): Claimer | null => (alert.acknowledged_by
    ? { name: staffNames[alert.acknowledged_by] ?? 'Someone', mine: alert.acknowledged_by === userId }
    : null);

  const owedFor = useCallback((sessionId: string) => {
    const due = (bySession[sessionId] ?? []).filter(canTakePayment);
    return { due, amount: due.reduce((sum, o) => sum + Number(o.total ?? 0), 0) };
  }, [bySession]);

  /** Ready plates are the most time-critical thing a waiter does; they lead. */
  const readyToRun = useMemo(() => orders.filter((o) => o.status === 'ready'), [orders]);
  /** In the kitchen, not yet up. */
  const cooking = orders.filter((o) => isInKitchen(o.status) && !isHeld(o) && !['ready', 'served'].includes(o.status));
  /**
   * Card orders whose payment has not cleared — said in words, never counted
   * as cooking, and in a list of their own: under "In the kitchen" they made
   * its count disagree with the header's. Held orders are not here either;
   * they are on the "Needs confirming" card above, with its Confirm button,
   * and listing them twice only pushed the kitchen off the screen.
   */
  const notInKitchen = orders.filter((o) => !isInKitchen(o.status) && !isHeld(o));

  const attentionCount = waiterCalls.length + billRequests.length + readyToRun.length;
  const oldestOrderMs = [...cooking, ...readyToRun].reduce((max, order) => {
    const ms = Date.now() - new Date(kitchenStart(order)).getTime();
    return ms > max ? ms : max;
  }, 0);
  const totalOwed = tables.reduce((sum, t) => sum + owedFor(t.id).amount, 0);

  /** Every table in my sections today, by number — only while "All my tables" is chosen. */
  const tiles = useMemo(() => (tablesView === 'all' && myFloor && waiter
    ? floorTiles({
        sectionTables: myFloor.tables,
        sectionSessions: myFloor.sessions,
        mine: tables,
        myWaiterId: waiter.id,
        waiterNames,
      })
    : null), [tablesView, myFloor, waiter, tables, waiterNames]);

  /** What is going on at a seated table, for its tile: the same lists the rest of the screen shows. */
  const signalsFor = (sessionId: string): TableSignals => ({
    ready: readyToRun.filter((o) => o.table_session_id === sessionId).length,
    calling: waiterCalls.some((c) => c.table_session_id === sessionId),
    bill: billRequests.some((b) => b.table_session_id === sessionId),
    cooking: cooking.filter((o) => o.table_session_id === sessionId).length,
    owed: owedFor(sessionId).amount,
  });

  /*
   * In "All my tables" a seated table with no waiter is a tile with Take, so
   * it is not listed a second time under "No waiter yet"; tables outside my
   * sections still are.
   */
  const unassignedListed = tiles
    ? unassigned.filter((s) => !tiles.some((t) => t.kind === 'nobody' && t.sessionId === s.id))
    : unassigned;

  /** The table whose details are open from its tile; it closes by itself once the table is freed or moved. */
  const openTable = openTableId ? tables.find((t) => t.id === openTableId) ?? null : null;

  /*
   * A call that came in while the waiter was scrolled down — settling a table
   * in "My tables" — landed above the screen, under a header that counted
   * only money and minutes. Once "Attention needed" has gone up under the
   * header, the header says what is waiting, and one tap goes back to it.
   */
  const headerRef = useRef<HTMLElement>(null);
  const attentionRef = useRef<HTMLElement>(null);
  const [attentionAbove, setAttentionAbove] = useState(false);
  useEffect(() => {
    if (loading) return;
    const check = () => {
      const header = headerRef.current;
      const section = attentionRef.current;
      if (header && section) setAttentionAbove(section.getBoundingClientRect().top < header.getBoundingClientRect().bottom);
    };
    check();
    window.addEventListener('scroll', check, { passive: true });
    window.addEventListener('resize', check);
    return () => {
      window.removeEventListener('scroll', check);
      window.removeEventListener('resize', check);
    };
  }, [loading, attentionCount]);
  const showAttention = () => {
    const section = attentionRef.current;
    if (!section) return;
    const top = section.getBoundingClientRect().top + window.scrollY - (headerRef.current?.offsetHeight ?? 0) - 12;
    window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  };
  /** Same order as the list: food going cold, a guest waiting, the bill. */
  const attentionSummary = summarize({
    ready: readyToRun.map(tableOf),
    calls: waiterCalls.map(tableOf),
    bills: billRequests.map(tableOf),
  });

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
    if (prev === null) return;
    const newBill = billRequests.some((b) => !prev.has(`b:${b.id}`));
    const newCall = waiterCalls.some((c) => !prev.has(`c:${c.id}`));
    if (!newBill && !newCall) return;
    // The buzz comes even with the sound muted: it used to be muted with it.
    vibrate();
    if (!soundOn) return;
    if (newBill) playBillRequestAlert(); else playWaiterCallAlert();
  }, [waiterCalls, billRequests, soundOn, loading]);

  /*
   * Buzz when food for MY tables comes up. The pass rings a bell the waiter
   * on the terrace cannot hear; the phone in the apron can. Same baseline
   * rule as calls: nothing already up at the first load is "new".
   */
  const prevReady = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (loading) return;
    const ids = new Set(readyToRun.map((o) => o.id));
    const prev = prevReady.current;
    prevReady.current = ids;
    if (prev === null) return;
    if (![...ids].some((id) => !prev.has(id))) return;
    vibrate([120, 80, 120, 80, 120]);
    if (soundOn) playOrderAlert();
  }, [readyToRun, soundOn, loading]);

  /*
   * A table of mine — or one nobody has yet — has ordered: one short buzz
   * and a soft ding. The order used to appear without a sound, so a waiter
   * only found out by looking. An order first seen as held is not new when it
   * is confirmed (the waiter just did that); held orders chime on their own
   * (HeldOrdersCard). Same baseline rule as above.
   */
  const prevOrderIds = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (loading) return;
    const prev = prevOrderIds.current;
    prevOrderIds.current = new Set(orders.map((o) => o.id));
    if (prev === null) return;
    if (!orders.some((o) => !prev.has(o.id) && isInKitchen(o.status) && !isHeld(o))) return;
    vibrate(150);
    if (soundOn) playOrderPlacedAlert();
  }, [orders, soundOn, loading]);

  /* Again every ~75s while a table is waiting and nobody is on the way — a buzz, and the chime unless muted. */
  const alertsRef = useRef({ calls: waiterCalls, bills: billRequests });
  useEffect(() => { alertsRef.current = { calls: waiterCalls, bills: billRequests }; }, [waiterCalls, billRequests]);
  useReminderChime(
    waiterCalls.length > 0 || billRequests.length > 0,
    useCallback(() => {
      const waiting = (a: FloorAlert) => a.status === 'pending'
        || !a.acknowledged_at || Date.now() - new Date(a.acknowledged_at).getTime() > 3 * 60_000;
      const { calls, bills } = alertsRef.current;
      if (!calls.some(waiting) && !bills.some(waiting)) return;
      vibrate();
      if (!soundOnRef.current) return;
      if (bills.some(waiting)) playBillRequestAlert(); else playWaiterCallAlert();
    }, []),
  );

  const toggleSound = async () => {
    const next = !soundOn;
    setSoundOn(next);
    if (next && (await unlockSound())) playWaiterCallAlert();
  };
  /** Only Android buzzes from a web page; an iPhone must not be promised it. */
  const buzzes = canVibrate();

  const startSettle = (sessionId: string, tableNumber: number | string, method: TablePaymentMethod) => {
    const { due, amount } = owedFor(sessionId);
    if (due.length === 0) return;
    setSettle({ sessionId, tableNumber, method, orderIds: due.map((o) => o.id), amount });
  };

  const settleRow = (sessionId: string, tableNumber: number | string, offerFree = false) => {
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
          onConfirmAndFree={offerFree ? () => { void confirmSettle(true); } : undefined}
        />
      );
    }
    if (due.length === 0) {
      // Nothing owed (paid online, or just settled): the next thing is the
      // table itself, so the button is right here rather than in "My tables".
      if (!offerFree) return null;
      const session = tables.find((t) => t.id === sessionId);
      return session ? (
        <Button className="w-full min-h-[48px] tap text-sm gap-1.5" onClick={() => setFreeing(session)}>
          <PowerOff className="w-4 h-4" /> Nothing owed — free table {tableNumber}
        </Button>
      ) : null;
    }
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
      <header ref={headerRef} className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 shrink-0 rounded-full bg-gradient-to-br from-primary to-accent text-primary-foreground grid place-items-center font-serif font-bold text-sm">
              {initials}
            </div>
            <div className="min-w-0">
              <h1 className="font-serif text-lg sm:text-xl font-bold leading-tight truncate">{waiter?.display_name}</h1>
              {/* Wraps rather than running under the buttons: "Offline ·
                  retrying" next to "3 tables" is wider than a 360px phone
                  leaves here. */}
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-muted-foreground mt-0.5">
                {/* Not "0 tables" before anything has loaded. */}
                {loaded && <span className="whitespace-nowrap">{plural(tables.length, 'table')}</span>}
                {venueName && <span className="whitespace-nowrap">{loaded ? '· ' : ''}{venueName}</span>}
                <ConnectionPill state={connection} />
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {/* The Android waiter app is this screen and nothing else (src/lib/waiter-app.ts). */}
            {!inWaiterApp() && (
              <Button variant="ghost" asChild className="tap-sm min-h-[44px] min-w-[44px] px-2">
                <Link to="/waiter/monitor" aria-label="Floor monitor"><Monitor className="w-5 h-5 sm:mr-1" /><span className="hidden sm:inline text-sm">Floor</span></Link>
              </Button>
            )}
            <Button
              variant="ghost"
              onClick={() => { void toggleSound(); }}
              className="tap-sm min-h-[44px] min-w-[44px] px-2"
              aria-label={soundOn ? 'Mute waiter alert sound' : 'Enable waiter alert sound'}
            >
              {soundOn ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5 text-muted-foreground" />}
            </Button>
            <Button variant="ghost" onClick={() => setSettingsOpen(true)} className="tap-sm min-h-[44px] min-w-[44px] px-2" aria-label="Settings">
              <Settings className="w-5 h-5" />
            </Button>
            <Button variant="ghost" onClick={() => setConfirmSignOut(true)} className="tap-sm min-h-[44px] min-w-[44px] px-2" aria-label="Sign out">
              <LogOut className="w-5 h-5 sm:mr-1" /><span className="hidden sm:inline text-sm">Sign out</span>
            </Button>
          </div>
        </div>

        {/* Phones suspend audio until a tap. Saying so is the difference
            between a waiter who knows to tap once and one who trusts a
            silent phone all evening. */}
        {/* Muted on purpose is still worth saying in words: the crossed-out
            speaker alone let a phone stay silent all evening. The mute ends by
            itself, and the strip says when. */}
        {!soundOn && (
          <div className="max-w-6xl mx-auto px-4 sm:px-6 pb-2">
            <button
              onClick={() => { void toggleSound(); }}
              className="w-full min-h-[44px] rounded-xl bg-amber-100 text-amber-900 border border-amber-200 text-sm font-sans font-semibold flex items-center justify-center gap-2 px-3"
            >
              <VolumeX className="w-4 h-4 shrink-0" aria-hidden />
              {mutedUntil ? `Sound is off until ${soundBackAt(mutedUntil)}` : 'Sound is off'}
              {buzzes ? ' — the phone only buzzes. Tap to turn on.' : ' — you will not hear calls or ready food. Tap to turn on.'}
            </button>
          </div>
        )}

        <MenuOnlyNotice audience="waiter" outerClassName="max-w-6xl mx-auto px-4 sm:px-6 pb-2" />
        {staffVenue && <EndOfDayTables hours={staffVenue.venue.hours} outerClassName="max-w-6xl mx-auto px-4 sm:px-6 pb-2" />}

        {soundOn && !audioUnlocked && (
          <div className="max-w-6xl mx-auto px-4 sm:px-6 pb-2">
            <button
              onClick={() => { void unlockSound().then((ok) => { if (ok) playWaiterCallAlert(); }); }}
              className="w-full min-h-[44px] rounded-xl bg-amber-100 text-amber-900 border border-amber-200 text-sm font-sans font-semibold flex items-center justify-center gap-2"
            >
              <VolumeX className="w-4 h-4" aria-hidden /> {buzzes ? 'Alerts are silent — tap once to turn on sound and vibration' : 'Alerts are silent — tap once to turn on sound'}
            </button>
          </div>
        )}

        {stale && (
          <div role="alert" className="bg-destructive text-destructive-foreground text-sm font-sans font-semibold">
            <div className="max-w-6xl mx-auto px-4 sm:px-6 py-1.5 flex items-center gap-3">
              <CloudOff className="w-4 h-4 shrink-0" aria-hidden />
              <span className="flex-1 min-w-0">
                {loaded ? 'Could not refresh — this screen may be out of date.' : 'Could not load your tables.'}
                <span className="font-normal"> Retrying automatically.</span>
              </span>
              {/* Back in wifi range, a waiter should not have to wait for the next tick. */}
              <button
                type="button"
                onClick={() => { void fetchAll(); }}
                className="shrink-0 min-h-[44px] px-3 rounded-lg bg-destructive-foreground/15 hover:bg-destructive-foreground/25 inline-flex items-center gap-1.5"
              >
                <RefreshCw className="w-4 h-4" aria-hidden /> Retry now
              </button>
            </div>
          </div>
        )}

        <div className="max-w-6xl mx-auto px-4 sm:px-6 pb-3 grid grid-cols-3 gap-2 text-center">
          <StatChip
            label="Owed"
            // The unit small, so "114.00 KM" stays on one line in a third of a phone.
            value={totalOwed > 0 ? <>{totalOwed.toFixed(2)}<span className="text-xs font-medium"> KM</span></> : '—'}
            tone={totalOwed > 0 ? 'warn' : 'idle'}
          />
          {/* The same count as the "In the kitchen" list below. Plates already
              up are not in it: they are on top of the screen, to be run. */}
          <StatChip label="In kitchen" value={loaded ? cooking.length : '—'} tone={cooking.length > 0 ? 'active' : 'idle'} />
          <StatChip
            label="Oldest wait"
            value={oldestOrderMs > 0 ? formatDuration(oldestOrderMs) : '—'}
            tone={oldestOrderMs > 10 * 60_000 ? 'urgent' : oldestOrderMs > 5 * 60_000 ? 'warn' : 'idle'}
          />
        </div>

        {/* Over the content rather than in the header's flow: a header that
            grew when a call came in would move the list under a finger. */}
        {attentionAbove && attentionCount > 0 && (
          <div className="absolute inset-x-0 top-full pointer-events-none">
            <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-2">
              <button
                key={attentionSummary}
                type="button"
                onClick={showAttention}
                className="pointer-events-auto w-full min-h-[48px] rounded-xl bg-amber-400 text-amber-950 shadow-lux-lg px-3 py-2 flex items-center gap-2 text-left text-sm font-sans font-semibold kds-flash"
              >
                <Bell className="w-5 h-5 shrink-0" aria-hidden />
                {/* Two lines before an ellipsis: the bill is last, and it is money. */}
                <span className="min-w-0 flex-1 line-clamp-2">{attentionSummary}</span>
                <span className="shrink-0 rounded-lg bg-amber-950/10 px-2.5 py-1">Show</span>
              </button>
            </div>
          </div>
        )}
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-5 space-y-7">
        {/* On top while there is something to do about it (turn it on, add the
            app to the Home Screen, unblock notifications); below the tables
            once it is on, or put off with "Not now". */}
        {alerts.wantsAttention && <LockScreenAlerts alerts={alerts} venueName={venueName} />}
        {/* Every held order in the venue, not just this waiter's tables: whoever
            is nearest the table is the one who can tell if anyone is there. */}
        <HeldOrdersCard soundEnabled={soundOn} onChanged={refetch} />
        {!loaded ? (
          // Nothing is known yet, so nothing is said to be quiet.
          <div className="rounded-xl border-2 border-destructive/40 bg-destructive/5 px-4 py-8 text-center font-sans flex flex-col items-center gap-3">
            <CloudOff className="w-6 h-6 text-destructive" aria-hidden />
            <p className="text-base font-semibold text-foreground">
              {stale ? 'Your tables could not be loaded' : 'Loading your tables…'}
            </p>
            {stale && (
              <>
                <p className="text-sm text-muted-foreground max-w-sm">
                  Calls, bills and plates for your tables will show here as soon as the connection is back. Check the wifi if this stays.
                </p>
                <Button className="min-h-[48px] gap-1.5" onClick={() => { void fetchAll(); }}>
                  <RefreshCw className="w-4 h-4" aria-hidden /> Try again
                </Button>
              </>
            )}
          </div>
        ) : (
        <>
        <section ref={attentionRef}>
          <SectionTitle icon={<Bell className="w-4 h-4" />} title="Attention needed" count={attentionCount} />
          {attentionCount === 0 ? (
            <div className="rounded-xl border border-dashed border-border/60 bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
              {stale
                ? <><CloudOff className="w-4 h-4" aria-hidden /> Nothing at the last refresh — not up to date</>
                : <><Sparkles className="w-4 h-4" aria-hidden /> All caught up</>}
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <AnimatePresence mode="popLayout">
                {/* Food going cold first, then a guest waiting, then the bill. */}
                {readyToRun.map((order) => (
                  <motion.div key={order.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96 }}>
                    <OrderCard
                      order={order}
                      busy={busy.has(`order:${order.id}`)}
                      onUpdate={updateOrderStatus}
                      highlight
                    />
                    {takeStrip(order.table_session_id, tableOf(order))}
                  </motion.div>
                ))}
                {waiterCalls.map((call) => (
                  <AlertCard
                    key={call.id}
                    color="amber"
                    icon={<Hand className="w-5 h-5" />}
                    title={`Table ${tableOf(call)}`}
                    label="Needs you"
                    alert={call}
                    claimedBy={claimer(call)}
                    doneLabel="Done"
                    busy={busy.has(`call:${call.id}`)}
                    onDone={() => { void resolveCall(call.id); }}
                    claimBusy={busy.has(`claim:${call.id}`)}
                    onClaim={() => { void claim('call', call); }}
                  >
                    {takeStrip(call.table_session_id, tableOf(call))}
                  </AlertCard>
                ))}
                {billRequests.map((bill) => (
                  <AlertCard
                    key={bill.id}
                    color="primary"
                    icon={<CreditCard className="w-5 h-5" />}
                    title={`Table ${tableOf(bill)}`}
                    label="Wants the bill"
                    alert={bill}
                    claimedBy={claimer(bill)}
                    doneLabel="Bill given"
                    busy={busy.has(`bill:${bill.id}`)}
                    onDone={() => { void resolveBill(bill.id); }}
                    claimBusy={busy.has(`claim:${bill.id}`)}
                    onClaim={() => { void claim('bill', bill); }}
                  >
                    {takeStrip(bill.table_session_id, tableOf(bill))}
                    {settleRow(bill.table_session_id, tableOf(bill), true)}
                  </AlertCard>
                ))}
              </AnimatePresence>
            </div>
          )}
        </section>

        {/* "All my tables" (Settings): the room at a glance, straight under
            what needs doing now. One tile per table; a tile of mine says what
            is going on there and opens the table's bill and "Free table". */}
        {tablesView === 'all' && (
          <section aria-label="My tables">
            <div className="flex items-center gap-2 min-h-[44px]">
              <span className="text-muted-foreground"><Users className="w-4 h-4" /></span>
              <h2 className="font-serif text-base sm:text-lg font-bold">My tables</h2>
              {totalOwed > 0 && (
                <span className="ml-auto text-sm font-sans font-semibold text-amber-700 dark:text-amber-400 tabular-nums">
                  {km(totalOwed)} owed
                </span>
              )}
            </div>
            {!tiles ? (
              <p className="text-sm text-muted-foreground font-sans">Loading your sections…</p>
            ) : (
              <>
                {myFloor?.sectionIds.length === 0 && (
                  <p className="text-sm text-muted-foreground font-sans mb-2">
                    No section is yours today, so only your seated tables are here. Your manager sets sections under Tonight&rsquo;s waiters.
                  </p>
                )}
                {tiles.length === 0 ? (
                  <EmptyState icon={<Users className="w-5 h-5" />} text="No tables yet. They appear here once your manager gives you a section for today." />
                ) : (
                  <>
                    {/* The floor in numbers, each with a tiny tile as its key. */}
                    <ul aria-label="Floor summary" className="flex flex-wrap gap-x-4 gap-y-1 mb-3 text-xs font-sans text-muted-foreground">
                      {floorSummary(tiles).map((row) => (
                        <li key={row.kind} className="inline-flex items-center gap-1.5">
                          <span className={`w-2 h-2 rounded-full shrink-0 ${SWATCH[row.kind]}`} aria-hidden />
                          <span><span className="text-foreground tabular-nums">{row.count}</span> {row.text}</span>
                        </li>
                      ))}
                    </ul>
                    <ul className="grid grid-cols-3 min-[480px]:grid-cols-4 sm:grid-cols-5 lg:grid-cols-8 gap-2" aria-label="All my tables">
                      {tiles.map((tile) => (
                        <FloorTileCard
                          key={tile.kind === 'mine' || tile.kind === 'nobody' ? tile.sessionId : tile.tableId}
                          tile={tile}
                          signals={tile.kind === 'mine' || tile.kind === 'nobody' ? signalsFor(tile.sessionId) : undefined}
                          busy={tile.kind === 'nobody' && busy.has(`take:${tile.sessionId}`)}
                          onOpen={tile.kind === 'mine' ? () => setOpenTableId(tile.sessionId) : undefined}
                          onTake={tile.kind === 'nobody' ? () => { void take(tile.sessionId, tile.tableNumber); } : undefined}
                        />
                      ))}
                    </ul>
                  </>
                )}
              </>
            )}
          </section>
        )}

        <section>
          <SectionTitle icon={<ChefHat className="w-4 h-4" />} title="In the kitchen" count={cooking.length} />
          {cooking.length === 0 ? (
            <EmptyState icon={<Utensils className="w-5 h-5" />} text="Nothing cooking for your tables." />
          ) : (
            <div className="grid sm:grid-cols-2 gap-3">
              <AnimatePresence mode="popLayout">
                {cooking.map((order) => (
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

        {notInKitchen.length > 0 && (
          <section aria-label="Not in the kitchen yet">
            <SectionTitle icon={<Clock className="w-4 h-4" />} title="Not in the kitchen yet" count={notInKitchen.length} />
            <p className="text-sm text-muted-foreground font-sans mb-2 -mt-1">
              Paid by card online: the kitchen gets it once the payment clears. Nobody is cooking these yet.
            </p>
            <div className="grid sm:grid-cols-2 gap-3">
              {notInKitchen.map((order) => (
                <OrderCard key={order.id} order={order} busy={busy.has(`order:${order.id}`)} onUpdate={updateOrderStatus} />
              ))}
            </div>
          </section>
        )}

        {unassignedListed.length > 0 && (
          <section>
            <SectionTitle icon={<UserX className="w-4 h-4" />} title="No waiter yet" count={unassignedListed.length} />
            <p className="text-sm text-muted-foreground font-sans mb-2">
              Seated, but on nobody&rsquo;s section. Their calls and plates show above for everyone — take a table to make it yours.
            </p>
            <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {unassignedListed.map((session) => (
                <UnassignedRow
                  key={session.id}
                  session={session}
                  busy={busy.has(`take:${session.id}`)}
                  onTake={() => { void take(session.id, session.tables?.table_number ?? '?'); }}
                />
              ))}
            </ul>
          </section>
        )}

        {/* Collapsed by default: during service the table list is reference,
            not a to-do list, and it used to push the alerts off the screen.
            With no tables there is nothing to push away, and the reason there
            are none belonged in view, not behind a chevron. */}
        {tablesView === 'all' ? null : tables.length === 0 ? (
          <section>
            <SectionTitle icon={<Users className="w-4 h-4" />} title="My tables" count={0} />
            <EmptyState icon={<Users className="w-5 h-5" />} text="No tables yet. Tables appear here once your manager assigns your section for today and a guest sits down." />
          </section>
        ) : (
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
          </CollapsibleContent>
        </Collapsible>
        )}
        </>
        )}
        {!alerts.wantsAttention && <LockScreenAlerts alerts={alerts} venueName={venueName} />}
      </main>

      <FreeTableDialog
        open={freeing !== null}
        onOpenChange={(open) => { if (!open) setFreeing(null); }}
        sessionId={freeing?.id ?? null}
        tableNumber={freeing?.tables?.table_number ?? '?'}
        knownOwed={freeing ? owedFor(freeing.id).amount : 0}
        onFreed={refetch}
      />

      {/* A seated table of mine, opened from its tile in "All my tables":
          what is going on there, the money, and "Free table". A sheet from the
          bottom, where a thumb already is, rather than a second copy of every
          table as a card under the tiles. */}
      <Sheet open={openTable !== null} onOpenChange={(open) => { if (!open) setOpenTableId(null); }}>
        <SheetContent side="bottom" className="rounded-t-2xl max-h-[85vh] overflow-y-auto pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          {openTable && (() => {
            const number = openTable.tables?.table_number ?? '?';
            const s = signalsFor(openTable.id);
            const goToAttention = () => { setOpenTableId(null); window.setTimeout(showAttention, 250); };
            return (
              <>
                <SheetHeader className="text-left">
                  <SheetTitle className="font-serif text-2xl">Table {number}</SheetTitle>
                  <SheetDescription className="font-sans">
                    {openTable.guest_name ? `${openTable.guest_name} · ` : ''}seated <SeatedFor since={openTable.opened_at} />
                  </SheetDescription>
                </SheetHeader>
                {/* Plain rows, one fact each: what needs doing first, then the kitchen. */}
                <div className="mt-3 font-sans divide-y divide-border/70 border-y border-border/70">
                  {s.ready > 0 && (
                    <TableNeed tone="ready" text={s.ready > 1 ? `${s.ready} orders are up` : 'Food is up'} onGo={goToAttention} />
                  )}
                  {s.calling && <TableNeed tone="calling" text="Asking for you" onGo={goToAttention} />}
                  {s.bill && <TableNeed tone="bill" text="Wants the bill" onGo={goToAttention} />}
                  <div className="flex items-center justify-between min-h-[48px] text-sm">
                    <span className="text-muted-foreground">Kitchen</span>
                    <span className="text-foreground">{s.cooking > 0 ? `${plural(s.cooking, 'order')} cooking` : 'Nothing cooking'}</span>
                  </div>
                </div>
                <div className="mt-4 space-y-2 font-sans">
                  {settleRow(openTable.id, number)}
                  <Button
                    variant="ghost"
                    className="w-full min-h-[48px] tap text-sm text-muted-foreground hover:bg-destructive/10 hover:text-destructive gap-1.5"
                    onClick={() => { const session = openTable; setOpenTableId(null); setFreeing(session); }}
                  >
                    <PowerOff className="w-4 h-4" /> Free table
                  </Button>
                </div>
              </>
            );
          })()}
        </SheetContent>
      </Sheet>

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Settings</DialogTitle>
            <DialogDescription>
              {waiter?.display_name ? `For ${waiter.display_name}, on this phone.` : 'On this phone.'}
            </DialogDescription>
          </DialogHeader>
          <fieldset className="space-y-2">
            <legend className="text-sm font-sans font-semibold mb-2">My tables shows</legend>
            <RadioGroup value={tablesView} onValueChange={(value) => changeTablesView(value as TablesView)} aria-label="My tables shows">
              {([
                ['seated', 'Only seated tables', 'The tables with guests at them right now.'],
                ['all', 'All my tables', 'Every table in your sections today, free ones too.'],
              ] as const).map(([value, title, detail]) => (
                <label
                  key={value}
                  htmlFor={`tables-view-${value}`}
                  className={`flex items-start gap-3 rounded-xl border p-3 min-h-[56px] cursor-pointer font-sans ${
                    tablesView === value ? 'border-primary bg-primary/5' : 'border-border'
                  }`}
                >
                  <RadioGroupItem id={`tables-view-${value}`} value={value} className="mt-0.5 shrink-0" />
                  <span>
                    <span className="block font-semibold text-foreground">{title}</span>
                    <span className="block text-sm text-muted-foreground">{detail}</span>
                  </span>
                </label>
              ))}
            </RadioGroup>
          </fieldset>
          <DialogFooter>
            <Button className="min-h-[44px] w-full sm:w-auto" onClick={() => setSettingsOpen(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmSignOut} onOpenChange={setConfirmSignOut}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sign out?</AlertDialogTitle>
            <AlertDialogDescription>
              Your phone stops alerting you about your tables until you sign in again, and signing in needs your password.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-[44px]">Stay signed in</AlertDialogCancel>
            <AlertDialogAction className="min-h-[44px]" onClick={() => { void logout(); }}>Sign out</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
    <div className={`rounded-xl ${toneCls} px-2 py-2`}>
      <p className="text-xs font-medium opacity-75 leading-none">{label}</p>
      <p className="font-sans font-semibold text-base sm:text-lg leading-tight tabular-nums whitespace-nowrap mt-1">{value}</p>
    </div>
  );
};

const SectionTitle = ({ icon, title, count }: { icon: React.ReactNode; title: string; count: number }) => (
  <div className="flex items-center gap-2 mb-3">
    <span className="text-muted-foreground">{icon}</span>
    <h2 className="font-serif text-lg font-semibold">{title}</h2>
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

/** "Marko is going (3m)", or "You are going (3m)". */
const Going = ({ who, since }: { who: Claimer; since: string | null }) => {
  const ms = useElapsedMinutes(since);
  return <>{who.mine ? 'You are' : `${who.name} is`} going{since ? ` (${formatMinutes(ms)})` : ''}</>;
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
  claimBusy = false,
  onClaim,
  children,
}: {
  color: 'amber' | 'primary';
  icon: React.ReactNode;
  title: string;
  label: string;
  alert: FloorAlert;
  /** Who said they are going — the call stays here until it is actually done. */
  claimedBy: Claimer | null;
  doneLabel: string;
  busy: boolean;
  onDone: () => void;
  claimBusy?: boolean;
  /** "I'm going" — offered while nobody has said so. */
  onClaim?: () => void;
  children?: React.ReactNode;
}) => {
  const accent = color === 'amber' ? 'bg-amber-500' : 'bg-primary';
  const tint = color === 'amber' ? 'bg-amber-500/5 border-amber-500/30' : 'bg-primary/5 border-primary/30';
  const claimed = alert.status === 'acknowledged' && claimedBy !== null;
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
            <p className="font-sans font-bold text-xl leading-tight truncate">{title}</p>
            <p className="text-sm font-medium text-foreground/80 truncate">
              {label} · <Elapsed since={alert.created_at} />
            </p>
            <p className={`text-sm truncate ${claimed ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>
              {claimed && claimedBy ? <Going who={claimedBy} since={alert.acknowledged_at} /> : 'Nobody going yet'}
            </p>
          </div>
          {/* One column, so Done is in the same place whether or not anyone
              has said they are going. */}
          <div className="flex flex-col gap-2 shrink-0 w-[8.5rem]">
            {!claimed && onClaim && (
              <Button className="tap-sm min-h-[48px] w-full text-sm font-semibold gap-1.5" disabled={busy || claimBusy} onClick={onClaim}>
                <Footprints className="w-4 h-4" aria-hidden /> I&rsquo;m going
              </Button>
            )}
            <Button variant="outline" className="tap-sm min-h-[48px] w-full text-sm font-semibold gap-1.5" disabled={busy} onClick={onDone}>
              <CheckCircle2 className="w-4 h-4" aria-hidden /> {doneLabel}
            </Button>
          </div>
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
          {activeOrders > 0 ? `${plural(activeOrders, 'order')} in the kitchen` : 'Nothing in the kitchen'}
        </p>
        {children}
        <div className="border-t border-border/60 pt-2">
          {/* Its own hover: the ghost one is the accent fill, and red on gold
              stayed on a phone after the tap, behind the dialog and after it. */}
          <Button variant="ghost" className="w-full tap-sm min-h-[44px] text-sm text-muted-foreground hover:bg-destructive/10 hover:text-destructive" onClick={onClose}>
            <PowerOff className="w-4 h-4 mr-1.5" /> Free table
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

const UnassignedRow = ({ session, busy, onTake }: { session: WaiterSession; busy: boolean; onTake: () => void }) => {
  const ms = useElapsed(session.opened_at);
  return (
    <li className="rounded-lg border border-border ps-3 pe-1.5 py-1.5 min-h-[56px] flex items-center gap-2 text-sm">
      <span className="font-serif text-lg font-bold shrink-0">T{session.tables?.table_number ?? '?'}</span>
      <span className="text-muted-foreground truncate flex-1">{session.guest_name ?? ''}</span>
      <span className={`text-xs px-2 py-0.5 rounded-full border tabular-nums shrink-0 ${seatedBg(ms)}`}>{formatDuration(ms)}</span>
      <Button className="tap-sm min-h-[44px] shrink-0 text-sm font-semibold" disabled={busy} onClick={onTake}>
        Take
      </Button>
    </li>
  );
};

/** The summary's key: a dot the colour of each kind of tile's number or edge (squares read as checkboxes). */
const SWATCH: Record<FloorTile['kind'], string> = {
  mine: 'bg-foreground',
  colleague: 'bg-muted-foreground/40',
  nobody: 'bg-amber-500',
  free: 'border border-muted-foreground/60',
};

/**
 * The one thing that needs doing at a table, in the order of "Attention
 * needed": a thin bar down the tile's edge and a word in the same colour.
 * Nothing else on the tile is coloured, so the eye goes straight to these.
 */
const URGENT: Record<'ready' | 'calling' | 'bill', { text: string; bar: string; ink: string }> = {
  ready: { text: 'Food up', bar: 'bg-emerald-500', ink: 'text-emerald-700 dark:text-emerald-400' },
  calling: { text: 'Calling', bar: 'bg-amber-500', ink: 'text-amber-700 dark:text-amber-400' },
  bill: { text: 'Bill', bar: 'bg-primary', ink: 'text-primary' },
};

const TILE = 'relative w-full h-[84px] rounded-xl p-2.5 text-left flex flex-col justify-between font-sans overflow-hidden';

/**
 * One table in "All my tables", drawn like a floor plan: the number, and at
 * most two quiet facts. Every tile is the same size so the room reads as a
 * grid.
 *  - mine: a white tile; how long they have sat, what needs doing (or what is
 *    cooking) and what they owe. A tap opens the table;
 *  - seated with nobody: a white tile with an amber edge; a tap takes it;
 *  - a colleague's: grey, with their name;
 *  - free: just an outline.
 */
const FloorTileCard = ({
  tile, signals = NO_SIGNALS, busy, onOpen, onTake,
}: {
  tile: FloorTile;
  signals?: TableSignals;
  busy: boolean;
  onOpen?: () => void;
  onTake?: () => void;
}) => {
  const label = tileLabel(tile, signals, km);
  const urgent = urgentSignal(signals);
  const number = (tone: string) => (
    <span className={`font-serif text-[1.65rem] font-semibold leading-none tabular-nums ${tone}`}>{tile.tableNumber}</span>
  );
  const bar = urgent ? <span aria-hidden className={`absolute left-0 top-2 bottom-2 w-1 rounded-r-full ${URGENT[urgent].bar}`} /> : null;

  if (tile.kind === 'mine') {
    const note = urgent
      ? <span className={`font-semibold ${URGENT[urgent].ink}`}>{URGENT[urgent].text}</span>
      : signals.cooking > 0 ? <span className="text-muted-foreground">{signals.cooking} cooking</span> : null;
    return (
      <li>
        <button
          type="button"
          onClick={onOpen}
          aria-label={label}
          className={`${TILE} bg-card border border-border shadow-sm hover:border-foreground/30 active:bg-muted/50 transition-colors`}
        >
          {bar}
          <span className="flex items-start justify-between gap-1">
            {number('text-foreground')}
            <span className="text-[11px] tabular-nums text-muted-foreground pt-0.5"><SeatedFor since={tile.openedAt} /></span>
          </span>
          <span className="flex items-end justify-between gap-1.5 text-xs min-w-0">
            <span className="truncate min-w-0">{note}</span>
            {signals.owed > 0 && <span className="shrink-0 tabular-nums text-foreground">{signals.owed.toFixed(2)}</span>}
          </span>
        </button>
      </li>
    );
  }
  if (tile.kind === 'nobody') {
    return (
      <li>
        <button
          type="button"
          onClick={onTake}
          disabled={busy}
          aria-label={label}
          className={`${TILE} bg-card border border-amber-500/70 shadow-sm active:bg-amber-500/10 disabled:opacity-60 transition-colors`}
        >
          {bar}
          {number('text-foreground')}
          <span className="flex items-end justify-between gap-1.5 text-xs min-w-0">
            <span className={`truncate min-w-0 ${urgent ? `font-semibold ${URGENT[urgent].ink}` : 'text-muted-foreground'}`}>
              {urgent ? URGENT[urgent].text : 'No waiter'}
            </span>
            <span className="shrink-0 font-semibold text-primary">{busy ? '…' : 'Take'}</span>
          </span>
        </button>
      </li>
    );
  }
  if (tile.kind === 'colleague') {
    return (
      <li aria-label={label} className={`${TILE} bg-muted/70`}>
        {number('text-muted-foreground')}
        <span className="text-xs text-muted-foreground truncate">{tile.waiterName}</span>
      </li>
    );
  }
  return (
    <li aria-label={label} className={`${TILE} border border-border`}>
      {number('text-muted-foreground/60')}
    </li>
  );
};

/** In a table's sheet: one thing that needs doing there, and the way to the card that does it. */
const TableNeed = ({ tone, text, onGo }: { tone: 'ready' | 'calling' | 'bill'; text: string; onGo: () => void }) => (
  <div className="flex items-center gap-3 min-h-[52px] text-sm">
    <span aria-hidden className={`w-2 h-2 rounded-full shrink-0 ${URGENT[tone].bar}`} />
    <span className="flex-1 font-semibold text-foreground">{text}</span>
    <Button variant="ghost" className="tap-sm min-h-[44px] -me-2 px-2 text-sm text-primary gap-0.5" onClick={onGo}>
      Go to it <ChevronRight className="w-4 h-4" aria-hidden />
    </Button>
  </div>
);

const SeatedFor = ({ since }: { since: string }) => {
  const ms = useElapsed(since);
  return <>{formatDuration(ms)}</>;
};

/** Under an alert from a table nobody has: whose it is, and the tap that makes it yours. */
const TakeTableStrip = ({ tableNumber, busy, onTake }: { tableNumber: number | string; busy: boolean; onTake: () => void }) => (
  <div className="flex items-center gap-2 rounded-lg bg-muted/60 ps-3 pe-1.5 py-1.5 mt-2">
    <UserX className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden />
    <span className="text-sm text-muted-foreground flex-1">No waiter on table {tableNumber}</span>
    <Button className="tap-sm min-h-[44px] shrink-0 text-sm font-semibold" disabled={busy} onClick={onTake}>
      Take table
    </Button>
  </div>
);

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
            <p className="font-serif text-2xl font-bold leading-none shrink-0">T{tableNumber}</p>
            <Badge variant="outline" className="text-xs gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full ${meta?.dot ?? ''}`} />
              {highlight ? 'Ready to run' : held ? 'Needs confirming' : orderStatusLabel(order.status)}
            </Badge>
            {/* Not in the kitchen, the status already says what the money is
                doing; a second pill saying it again only wrapped the row. */}
            {inKitchen && <PaymentBadge method={order.payment_method} status={order.payment_status} />}
          </div>
          {inKitchen && (
            <span className={`text-xs px-2 py-0.5 rounded-full border tabular-nums ${waitBg(ms)}`}>{formatDuration(ms)}</span>
          )}
        </div>
        {/* A card order whose payment has not cleared looked exactly like a
            new "Pending" one, and the waiter chased the kitchen for food it had
            never been sent. */}
        {!inKitchen && (
          <p className={`text-sm font-sans font-semibold mb-2 ${order.status === 'payment_failed' ? 'text-destructive' : 'text-accent'}`}>
            {held
              ? 'Not in kitchen — confirm it above'
              : order.status === 'payment_failed'
                ? 'Not in kitchen — the card payment failed. See the table.'
                : 'Not in kitchen — payment pending'}
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
          <Button className="w-full tap min-h-[52px] text-base font-semibold" disabled={busy} onClick={() => onUpdate(order.id, next.status)}>
            {next.icon}{next.label}
          </Button>
        )}
      </CardContent>
    </Card>
  );
};

export default WaiterDashboard;
