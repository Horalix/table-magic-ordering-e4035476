import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { formatDuration, formatMinutes, useElapsed, useElapsedMinutes } from '@/lib/timing';
import { useNow, useNowBucketed } from '@/lib/clock';
import {
  useCoalesced, useLatestRequest, useStaffRealtime, useStaffRealtimeEvent, useStaffRefresh,
} from '@/lib/realtime';
import ConnectionPill from '@/components/staff/ConnectionPill';
import TableActionSheet, { type SheetTable } from '@/components/monitor/TableActionSheet';
import { businessDayISO } from '@/lib/reporting';
import { ArrowLeft, Bell, CheckCircle2, ChefHat, Clock, Grid3x3, Lock, LogIn, Receipt, Users, Volume2, VolumeX } from 'lucide-react';
import PinPad from '@/components/monitor/PinPad';
import { toast } from 'sonner';
import {
  playOrderAlert, playWaiterCallAlert, playBillRequestAlert, useAudioUnlock, useReminderChime,
} from '@/lib/kitchen-sounds';
import { useStaffDocument } from '@/components/staff/useStaffDocument';
import { useWakeLock } from '@/lib/wake-lock';
import { isHeld, isInKitchen, kitchenStart } from '@/components/staff/order-status';
import HeldOrdersCard from '@/components/staff/HeldOrdersCard';
import type { Database } from '@/integrations/supabase/types';

type Section = Pick<Database['public']['Tables']['sections']['Row'], 'id' | 'name' | 'color'>;
type Waiter = Pick<Database['public']['Tables']['waiters']['Row'], 'id' | 'display_name' | 'is_active'> & {
  has_pin?: boolean | null;
  /** The auth user — what `acknowledged_by` on a call holds, NOT the waiter id. */
  user_id?: string | null;
};
type TableRow = Pick<Database['public']['Tables']['tables']['Row'], 'id' | 'table_number' | 'section_id'> & {
  sections?: Section | null;
};
type Session = Pick<
  Database['public']['Tables']['table_sessions']['Row'],
  'id' | 'table_id' | 'is_active' | 'opened_at' | 'guest_name' | 'assigned_waiter_id' | 'covers'
>;
type Order = Pick<
  Database['public']['Tables']['orders']['Row'],
  'id' | 'table_session_id' | 'status' | 'created_at' | 'assigned_waiter_id'
  | 'order_code' | 'total' | 'payment_status' | 'payment_method' | 'notes'
  | 'refunded_amount' | 'released_to_kitchen_at'
> & { held_reason?: string | null };
type Call = Pick<
  Database['public']['Tables']['waiter_calls']['Row'],
  'id' | 'table_session_id' | 'status' | 'created_at' | 'acknowledged_by'
> & { acknowledged_at?: string | null };
type BillReq = Pick<
  Database['public']['Tables']['bill_requests']['Row'],
  'id' | 'table_session_id' | 'status' | 'created_at' | 'acknowledged_by'
> & { acknowledged_at?: string | null };

/**
 * In the kitchen and not yet on the table — what "orders" and "oldest wait" mean on this screen.
 * A held order is not in the kitchen: it sits in the "Needs confirming" card instead.
 */
const isOpenKitchenOrder = (o: Order) => isInKitchen(o.status) && !isHeld(o) && o.status !== 'served';
type Assignment = Pick<Database['public']['Tables']['section_assignments']['Row'], 'section_id' | 'waiter_id' | 'shift_date'>;
type WaiterStats = { total: number; occupied: number; calls: number; bills: number; ready: number };
type TableState = 'free' | 'occupied' | 'ready' | 'call' | 'bill';

const LAST_WAITER_KEY = 'monitor:lastWaiterId';
const IDLE_MS = 5 * 60 * 1000;

const WaiterMonitor = () => {
  useStaffDocument();
  // A wall or counter screen that dims is a floor nobody is watching.
  useWakeLock(true);
  const [tables, setTables] = useState<TableRow[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [calls, setCalls] = useState<Call[]>([]);
  const [bills, setBills] = useState<BillReq[]>([]);
  const [waiters, setWaiters] = useState<Waiter[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);

  /**
   * Two clocks, on purpose.
   *
   * `now` drives the header time. `sortNow` drives card ORDER, and is bucketed
   * to the minute — the grid used to re-sort on every one-second tick, so a
   * card could slide out from under a finger already reaching for it. Ordering
   * that changes at most once a minute is still fresh enough to be useful and
   * stable enough to touch.
   */
  const now = useNow();
  const sortNow = useNowBucketed(60_000);
  const [mode, setMode] = useState<'rail' | 'mine' | 'all'>('rail');
  const [openTableId, setOpenTableId] = useState<string | null>(null);
  const [meId, setMeId] = useState<string | null>(null);
  const [activeWaiterId, setActiveWaiterId] = useState<string | null>(null);

  const [pinTarget, setPinTarget] = useState<Waiter | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);
  const lockoutRef = useRef<Map<string, { fails: number; until: number }>>(new Map());
  const idleTimerRef = useRef<number | null>(null);

  // Sound alerts (shared floor display)
  const [soundOn, setSoundOn] = useState(() => localStorage.getItem('monitor:sound') !== 'false');
  const soundOnRef = useRef(soundOn);
  useEffect(() => { soundOnRef.current = soundOn; }, [soundOn]);
  const initialLoadRef = useRef(false);
  const prevCallIds = useRef<Set<string>>(new Set());
  const prevBillIds = useRef<Set<string>>(new Set());
  const prevReadyIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => setMeId(data.user?.id ?? null));
  }, []);

  // One shared audio context, unlocked on the first tap anywhere, with an
  // honest flag the header can show. This screen used to unlock on
  // pointerdown with no way to tell whether it had worked.
  const { unlocked: audioUnlocked, unlock: unlockSound } = useAudioUnlock();
  /** Shown instead of a toast storm: the board says it is stale until a fetch succeeds. */
  const [stale, setStale] = useState(false);
  const beginFetch = useLatestRequest();

  const fetchAll = useCallback(async () => {
    const isLatest = beginFetch();
    // The TRADING day, which runs to 05:00. The calendar day rolled the floor
    // plan over at midnight, mid-service, and every section lost its waiter.
    const today = businessDayISO();
    const [t, s, o, c, b, w, a] = await Promise.all([
      supabase.from('tables').select('id, table_number, section_id, sections(id, name, color)').order('table_number'),
      supabase.from('table_sessions').select('id, table_id, is_active, opened_at, guest_name, assigned_waiter_id, covers').eq('is_active', true),
      supabase.from('orders')
        .select('*')
        .not('status', 'in', '("cancelled")')
        .gte('created_at', new Date(Date.now() - 18 * 60 * 60 * 1000).toISOString()),
      // Open, not merely pending: a claimed call is still someone's problem
      // until it is resolved, and hiding it makes the claim look like a fix.
      supabase.from('waiter_calls').select('id, table_session_id, status, created_at, acknowledged_by, acknowledged_at')
        .neq('status', 'resolved').order('created_at', { ascending: true }),
      supabase.from('bill_requests').select('id, table_session_id, status, created_at, acknowledged_by, acknowledged_at')
        .neq('status', 'resolved').order('created_at', { ascending: true }),
      supabase.from('waiters').select('id, user_id, display_name, is_active, has_pin').eq('is_active', true).order('display_name'),
      supabase.from('section_assignments').select('section_id, waiter_id, shift_date').eq('shift_date', today),
    ]);

    // An older refresh finishing after a newer one must not roll the floor back.
    if (!isLatest()) return;

    if (t.error || s.error || o.error || c.error || b.error || w.error || a.error) {
      setStale(true);
      return;
    }
    setStale(false);

    // Chime on newly-arrived alerts (one sound per refresh, highest priority).
    const callIds = new Set((c.data ?? []).map((x) => x.id));
    const billIds = new Set((b.data ?? []).map((x) => x.id));
    const readyIds = new Set((o.data ?? []).filter((x) => x.status === 'ready').map((x) => x.id));
    if (initialLoadRef.current && soundOnRef.current) {
      const hasNew = (cur: Set<string>, prev: Set<string>) => [...cur].some((id) => !prev.has(id));
      if (hasNew(billIds, prevBillIds.current)) playBillRequestAlert();
      else if (hasNew(callIds, prevCallIds.current)) playWaiterCallAlert();
      else if (hasNew(readyIds, prevReadyIds.current)) playOrderAlert();
    }
    prevCallIds.current = callIds;
    prevBillIds.current = billIds;
    prevReadyIds.current = readyIds;
    initialLoadRef.current = true;

    setTables((t.data ?? []) as TableRow[]);
    setSessions((s.data ?? []) as Session[]);
    setOrders((o.data ?? []) as Order[]);
    setCalls((c.data ?? []) as Call[]);
    setBills((b.data ?? []) as BillReq[]);
    setWaiters((w.data ?? []) as Waiter[]);
    setAssignments((a.data ?? []) as Assignment[]);
  }, [beginFetch]);

  useEffect(() => { void fetchAll(); }, [fetchAll]);

  /**
   * One refetch per burst, not one per event per table.
   *
   * This screen used to subscribe to six tables and run all seven of its
   * queries on every single event, so a six-item order cost 49 queries on this
   * device alone — and the cost scaled with floor activity times the number of
   * screens open. The shared channel delivers the events; `useCoalesced` turns
   * the burst into one refetch ~300ms after it ends.
   */
  const connection = useStaffRealtime();
  const refetch = useCoalesced(useCallback(() => { void fetchAll(); }, [fetchAll]));
  useStaffRealtimeEvent(useCallback(() => { refetch(); }, [refetch]));
  // Polling while the socket is down, catch-up on reconnect, and a reload when
  // the screen wakes — none of which reached this screen's plain state before.
  useStaffRefresh(useCallback(() => { refetch(); }, [refetch]));

  /*
   * Chime again every ~75s while a table is waiting and nobody has claimed it
   * (or the claim is past the three-minute takeover window).
   */
  const alertsRef = useRef({ calls, bills });
  useEffect(() => { alertsRef.current = { calls, bills }; }, [calls, bills]);
  useReminderChime(
    soundOn && (calls.length > 0 || bills.length > 0),
    useCallback(() => {
      const waiting = (a: Call | BillReq) => a.status === 'pending'
        || !a.acknowledged_at || Date.now() - new Date(a.acknowledged_at).getTime() > 3 * 60_000;
      if (alertsRef.current.bills.some(waiting)) playBillRequestAlert();
      else if (alertsRef.current.calls.some(waiting)) playWaiterCallAlert();
    }, []),
  );

  const sectionWaiter = useMemo(() => {
    const m = new Map<string, string>();
    assignments.forEach((assignment) => m.set(assignment.section_id, assignment.waiter_id));
    return m;
  }, [assignments]);

  const tableWaiter = useCallback((table: TableRow): string | null => {
    const sess = sessions.find((session) => session.table_id === table.id);
    if (sess?.assigned_waiter_id) return sess.assigned_waiter_id;
    if (table.section_id) return sectionWaiter.get(table.section_id) ?? null;
    return null;
  }, [sectionWaiter, sessions]);

  const waiterById = useMemo<Record<string, Waiter>>(
    () => Object.fromEntries(waiters.map((waiter) => [waiter.id, waiter])),
    [waiters],
  );

  const tableUrgency = useCallback((table: TableRow) => {
    const sess = sessions.find((session) => session.table_id === table.id);
    if (!sess) return -1;
    if (bills.some((bill) => bill.table_session_id === sess.id)) return 100;
    if (calls.some((call) => call.table_session_id === sess.id)) return 80;
    const tOrders = orders.filter((order) => order.table_session_id === sess.id && isOpenKitchenOrder(order));
    if (tOrders.some((order) => order.status === 'ready')) return 60;
    const oldestMs = tOrders.reduce((acc, order) => Math.max(acc, sortNow - new Date(kitchenStart(order)).getTime()), 0);
    if (oldestMs > 15 * 60_000) return 40 + oldestMs / 60_000;
    return 20 + oldestMs / 60_000;
  }, [bills, calls, sortNow, orders, sessions]);

  const sortByUrgency = useCallback((arr: TableRow[]) =>
    [...arr].sort((a, b) => tableUrgency(b) - tableUrgency(a)), [tableUrgency]);

  const waiterStats = useCallback((waiterId: string): WaiterStats => {
    const myTables = tables.filter((table) => tableWaiter(table) === waiterId);
    const mySess = sessions.filter((session) => myTables.some((table) => table.id === session.table_id));
    const sessIds = new Set(mySess.map((session) => session.id));
    return {
      total: myTables.length,
      occupied: mySess.length,
      calls: calls.filter((call) => sessIds.has(call.table_session_id)).length,
      bills: bills.filter((bill) => sessIds.has(bill.table_session_id)).length,
      ready: orders.filter((order) => order.status === 'ready' && sessIds.has(order.table_session_id)).length,
    };
  }, [bills, calls, orders, sessions, tableWaiter, tables]);

  const occupied = sessions.length;
  const pendingAlerts = calls.length + bills.length;
  /*
   * Orders in the kitchen. A card order still waiting for its payment is not
   * one — it was counted here and set "oldest wait" ticking for food nobody
   * had been asked to cook.
   */
  const openOrders = useMemo(() => orders.filter(isOpenKitchenOrder), [orders]);
  const oldestOrderMs = openOrders.reduce(
    (acc, order) => Math.max(acc, now - new Date(kitchenStart(order)).getTime()), 0);
  /** The longest-waiting guest, not the newest — the list is oldest-first. */
  const oldestAlertMs = [...calls, ...bills].reduce(
    (acc, alert) => Math.max(acc, now - new Date(alert.created_at).getTime()), 0);

  const openWaiter = (waiter: Waiter) => {
    if (!waiter.has_pin) {
      toast.error(`${waiter.display_name} has no PIN yet - ask the manager to set one.`);
      return;
    }
    const lock = lockoutRef.current.get(waiter.id);
    if (lock && lock.until > Date.now()) {
      const sec = Math.ceil((lock.until - Date.now()) / 1000);
      toast.error(`Locked. Try again in ${sec}s.`);
      return;
    }
    setPinError(null);
    setPinTarget(waiter);
  };

  const submitPin = async (pin: string) => {
    if (!pinTarget) return;
    const { data, error } = await supabase.rpc('verify_waiter_pin', { _waiter_id: pinTarget.id, _pin: pin });
    if (error) {
      setPinError('Could not verify. Try again.');
      return;
    }
    if (data === true) {
      const waiter = pinTarget;
      lockoutRef.current.delete(waiter.id);
      setPinTarget(null);
      setPinError(null);
      setActiveWaiterId(waiter.id);
      setMode('mine');
      localStorage.setItem(LAST_WAITER_KEY, waiter.id);
    } else {
      const cur = lockoutRef.current.get(pinTarget.id) ?? { fails: 0, until: 0 };
      cur.fails += 1;
      if (cur.fails >= 3) {
        cur.until = Date.now() + 30_000;
        cur.fails = 0;
        setPinError('Too many tries. Locked 30s.');
        setPinTarget(null);
      } else {
        setPinError(`Wrong PIN (${3 - cur.fails} left)`);
      }
      lockoutRef.current.set(pinTarget.id, cur);
    }
  };

  const resetIdle = useCallback(() => {
    if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
    idleTimerRef.current = window.setTimeout(() => {
      setMode('rail');
      setActiveWaiterId(null);
    }, IDLE_MS);
  }, []);

  useEffect(() => {
    if (mode !== 'mine') {
      if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
      return;
    }

    resetIdle();
    const events = ['mousemove', 'keydown', 'touchstart', 'click'];
    events.forEach((eventName) => window.addEventListener(eventName, resetIdle));
    return () => {
      events.forEach((eventName) => window.removeEventListener(eventName, resetIdle));
      if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
    };
  }, [mode, resetIdle]);

  /**
   * Everything the action sheet needs about one table, assembled here so the
   * sheet itself does no querying and cannot show a different picture from the
   * card that was tapped.
   */
  const openTable = useMemo<SheetTable | null>(() => {
    if (!openTableId) return null;
    const table = tables.find((t) => t.id === openTableId);
    if (!table) return null;
    const session = sessions.find((sess) => sess.table_id === table.id);
    const call = session ? calls.find((c) => c.table_session_id === session.id) : undefined;
    const bill = session ? bills.find((b) => b.table_session_id === session.id) : undefined;
    const waiterId = tableWaiter(table);
    const nameOf = (id: string | null | undefined) => (id ? waiterById[id]?.display_name ?? null : null);
    // Claims are recorded against the auth user, not the waiter row, so they
    // need their own lookup — the waiter-id one never matched and every claim
    // read "Someone is going".
    const nameOfUser = (uid: string | null | undefined) =>
      (uid ? waiters.find((w) => w.user_id === uid)?.display_name ?? null : null);

    return {
      tableId: table.id,
      tableNumber: table.table_number,
      sectionName: table.sections?.name ?? null,
      sessionId: session?.id ?? null,
      guestName: session?.guest_name ?? null,
      openedAt: session?.opened_at ?? null,
      covers: session?.covers ?? null,
      waiterName: nameOf(waiterId),
      callId: call?.id ?? null,
      callHeldBy: call?.acknowledged_by ?? null,
      callHeldByName: nameOfUser(call?.acknowledged_by),
      callHeldSince: call?.acknowledged_at ?? null,
      billId: bill?.id ?? null,
      billHeldBy: bill?.acknowledged_by ?? null,
      billHeldByName: nameOfUser(bill?.acknowledged_by),
      billHeldSince: bill?.acknowledged_at ?? null,
      orders: session
        ? orders
            .filter((o) => o.table_session_id === session.id)
            .map((o) => ({
              id: o.id,
              order_code: o.order_code ?? null,
              status: o.status,
              total: Number(o.total ?? 0),
              payment_status: o.payment_status ?? null,
              payment_method: o.payment_method ?? null,
              refunded_amount: o.refunded_amount ?? null,
              notes: o.notes ?? null,
              created_at: o.created_at,
              released_to_kitchen_at: o.released_to_kitchen_at ?? null,
              held_reason: o.held_reason ?? null,
            }))
        : [],
    };
  }, [bills, calls, openTableId, orders, sessions, tableWaiter, tables, waiterById, waiters]);

  const activeWaiter = activeWaiterId ? waiterById[activeWaiterId] : null;
  const myTables = activeWaiterId
    ? sortByUrgency(tables.filter((table) => tableWaiter(table) === activeWaiterId))
    : [];
  const allTables = sortByUrgency(tables);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 bg-card/95 backdrop-blur border-b border-border">
        <div className="px-4 sm:px-6 pt-3 pb-2 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            {mode !== 'rail' && (
              <Button variant="ghost" onClick={() => { setMode('rail'); setActiveWaiterId(null); }} className="w-11 h-11 p-0 shrink-0" aria-label="Back">
                <ArrowLeft className="w-5 h-5" />
              </Button>
            )}
            <div className="min-w-0">
              <h1 className="font-serif text-xl sm:text-2xl font-semibold leading-tight truncate">
                {mode === 'mine' && activeWaiter ? `${activeWaiter.display_name}'s floor` : mode === 'all' ? 'All tables' : 'La Soul · Floor'}
              </h1>
              {/* Restaurant time, 24-hour, and a date a Sarajevo team reads at
                  a glance — not "01:58 AM | 10/25/2026". */}
              <p className="text-xs text-muted-foreground font-sans tabular-nums">
                {new Date(now).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Europe/Sarajevo' })}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => { const next = !soundOn; setSoundOn(next); localStorage.setItem('monitor:sound', String(next)); if (next) void unlockSound(); }}
              aria-label={soundOn ? 'Mute alerts' : 'Enable alerts'}
              className="inline-flex items-center justify-center w-11 h-11 rounded-full border border-border bg-card hover:bg-muted"
            >
              {soundOn ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5 text-muted-foreground" />}
            </button>
            <Link to="/waiter/login" aria-label="Sign in" className="inline-flex items-center justify-center gap-1.5 h-11 min-w-[44px] px-3 rounded-full border border-border bg-card hover:bg-muted text-sm font-sans font-medium">
              <LogIn className="w-4 h-4" aria-hidden /> <span className="hidden sm:inline">Sign in</span>
            </Link>
          </div>
        </div>
        {/* One row of status, scrolling sideways on a narrow phone rather than
            wrapping the header to three lines. */}
        <div className="px-4 sm:px-6 pb-3 flex items-center gap-2 overflow-x-auto scrollbar-hide">
          <ConnectionPill state={connection} className="shrink-0" />
          {/* Never an unmuted speaker over a context the browser has suspended. */}
          {soundOn && !audioUnlocked && (
            <button
              onClick={() => { void unlockSound(); }}
              className="shrink-0 inline-flex items-center gap-1.5 h-9 px-3 rounded-full text-sm font-sans font-semibold bg-amber-100 text-amber-900 border border-amber-200"
            >
              <VolumeX className="w-4 h-4" aria-hidden /> Tap to enable sound
            </button>
          )}
          <StatPill icon={<Users className="w-3.5 h-3.5" />} label="Occupied" value={`${occupied}/${tables.length}`} tone="active" />
          <StatPill icon={<ChefHat className="w-3.5 h-3.5" />} label="Orders" value={openOrders.length} tone={openOrders.length ? 'active' : 'idle'} />
          <StatPill
            icon={<Bell className="w-3.5 h-3.5" />}
            label="Alerts"
            /* The age of the longest wait, not just the count — five calls
               one minute old is a different night from one call ten minutes
               old, and the count alone cannot tell them apart. */
            value={pendingAlerts ? `${pendingAlerts} · ${formatMinutes(oldestAlertMs)}` : 0}
            tone={oldestAlertMs > 5 * 60_000 ? 'urgent' : pendingAlerts ? 'warn' : 'idle'}
          />
          <StatPill
            icon={<Clock className="w-3.5 h-3.5" />}
            label="Oldest"
            value={oldestOrderMs ? formatMinutes(oldestOrderMs) : '—'}
            tone={oldestOrderMs > 20 * 60_000 ? 'urgent' : oldestOrderMs > 10 * 60_000 ? 'warn' : 'idle'}
          />
        </div>
        {/* Persistent, not a toast: a toast is gone in four seconds and the
            board stays wrong until the next successful refresh. */}
        {stale && (
          <div role="alert" className="px-4 sm:px-6 py-2 bg-destructive text-destructive-foreground text-sm font-sans font-semibold">
            Could not refresh — this floor may be out of date. Retrying automatically.
          </div>
        )}
      </header>

      <main className="p-4 sm:p-6">
        {/* Pinned above every mode: the floor monitor is often the screen nearest the door. */}
        <HeldOrdersCard soundEnabled={soundOn} className="mb-4" onChanged={refetch} />
        {mode === 'rail' && (
          <RailView
            waiters={waiters}
            waiterStats={waiterStats}
            onSelectWaiter={openWaiter}
            onAllTables={() => setMode('all')}
            totalTables={tables.length}
          />
        )}

        {mode === 'all' && (
          <TablesGrid
            tables={allTables}
            sessions={sessions}
            orders={orders}
            calls={calls}
            bills={bills}
            waiterById={waiterById}
            tableWaiter={tableWaiter}
            now={sortNow}
            large={false}
            onOpen={setOpenTableId}
          />
        )}

        {mode === 'mine' && activeWaiter && (
          <>
            <TablesGrid
              tables={myTables}
              sessions={sessions}
              orders={orders}
              calls={calls}
              bills={bills}
              waiterById={waiterById}
              tableWaiter={tableWaiter}
              now={sortNow}
              large
              onOpen={setOpenTableId}
            />
            {myTables.length === 0 && (
              <p className="text-center text-muted-foreground font-sans py-20">
                No tables assigned right now.
              </p>
            )}
          </>
        )}
      </main>

      {/* Keyed on the table: a confirmation armed on one table must never
          survive into another table's sheet. */}
      <TableActionSheet
        key={openTableId ?? 'none'}
        table={openTable}
        meId={meId}
        onClose={() => setOpenTableId(null)}
        onChanged={() => { void fetchAll(); }}
      />

      <PinPad
        open={!!pinTarget}
        title={pinTarget ? pinTarget.display_name : ''}
        subtitle="Enter your 4-digit PIN"
        error={pinError}
        onCancel={() => { setPinTarget(null); setPinError(null); }}
        onComplete={submitPin}
      />
    </div>
  );
};

const RailView = ({
  waiters,
  waiterStats,
  onSelectWaiter,
  onAllTables,
  totalTables,
}: {
  waiters: Waiter[];
  waiterStats: (id: string) => WaiterStats;
  onSelectWaiter: (waiter: Waiter) => void;
  onAllTables: () => void;
  totalTables: number;
}) => (
  <div>
    <p className="text-center text-sm font-sans text-muted-foreground mb-6">
      Tap your name to see your tables
    </p>
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      <button
        type="button"
        onClick={onAllTables}
        className="min-h-[120px] rounded-2xl border-2 border-dashed border-border bg-card hover:bg-accent/10 active:scale-[0.98] transition-all p-5 text-left"
      >
        <div className="flex items-center gap-3 mb-2">
          <Grid3x3 className="w-6 h-6 text-muted-foreground" />
          <span className="font-serif text-xl font-bold">All Tables</span>
        </div>
        <p className="text-xs font-sans text-muted-foreground">Manager / host view | {totalTables} tables</p>
      </button>

      {waiters.map((waiter) => {
        const stats = waiterStats(waiter.id);
        const urgent = stats.bills + stats.calls;
        return (
          <button
            key={waiter.id}
            type="button"
            onClick={() => onSelectWaiter(waiter)}
            className={`min-h-[120px] rounded-2xl border-2 p-5 text-left active:scale-[0.98] transition-all ${
              urgent > 0
                ? 'border-destructive/60 bg-destructive/5 hover:bg-destructive/10 breathe breathe-urgent'
                : stats.ready > 0
                  ? 'border-accent/60 bg-accent/5 hover:bg-accent/10'
                  : 'border-border bg-card hover:bg-accent/10'
            }`}
          >
            <div className="flex items-start justify-between mb-2">
              <div className="min-w-0">
                <p className="font-serif text-2xl font-bold truncate">{waiter.display_name}</p>
                <p className="text-xs font-sans text-muted-foreground">
                  {stats.total} tables | {stats.occupied} seated
                </p>
              </div>
              {!waiter.has_pin ? (
                <span className="text-[10px] font-sans px-2 py-1 rounded-full bg-muted text-muted-foreground">no PIN</span>
              ) : (
                <Lock className="w-4 h-4 text-muted-foreground shrink-0" />
              )}
            </div>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {stats.bills > 0 && (
                <Chip tone="urgent" icon={<Receipt className="w-3 h-3" />}>{stats.bills} bill</Chip>
              )}
              {stats.calls > 0 && (
                <Chip tone="urgent" icon={<Bell className="w-3 h-3" />}>{stats.calls} call</Chip>
              )}
              {stats.ready > 0 && (
                <Chip tone="warn" icon={<CheckCircle2 className="w-3 h-3" />}>{stats.ready} ready</Chip>
              )}
              {urgent === 0 && stats.ready === 0 && (
                <Chip tone="idle">All quiet</Chip>
              )}
            </div>
          </button>
        );
      })}
    </div>
  </div>
);

const Chip = ({ tone, icon, children }: { tone: 'idle' | 'warn' | 'urgent'; icon?: React.ReactNode; children: React.ReactNode }) => {
  const tones = {
    idle: 'bg-muted text-muted-foreground',
    warn: 'bg-accent/20 text-accent',
    urgent: 'bg-destructive text-destructive-foreground',
  } as const;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-sans font-semibold ${tones[tone]}`}>
      {icon}{children}
    </span>
  );
};

const TablesGrid = ({
  tables,
  sessions,
  orders,
  calls,
  bills,
  waiterById,
  tableWaiter,
  now,
  large,
  onOpen,
}: {
  tables: TableRow[];
  sessions: Session[];
  orders: Order[];
  calls: Call[];
  bills: BillReq[];
  waiterById: Record<string, Waiter>;
  tableWaiter: (table: TableRow) => string | null;
  now: number;
  large: boolean;
  onOpen: (tableId: string) => void;
}) => {
  if (tables.length === 0) {
    return <p className="text-center text-muted-foreground font-sans py-20">No tables.</p>;
  }

  const cols = large
    ? 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5'
    : 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6';

  return (
    <div className={`grid ${cols} gap-3`}>
      {tables.map((table) => {
        const sess = sessions.find((session) => session.table_id === table.id);
        const tOrders = sess
          ? orders.filter((order) => order.table_session_id === sess.id && isOpenKitchenOrder(order))
          : [];
        const awaitingPayment = sess
          ? orders.filter((order) => order.table_session_id === sess.id && order.status === 'awaiting_payment').length
          : 0;
        const hasCall = sess ? calls.some((call) => call.table_session_id === sess.id) : false;
        const hasBill = sess ? bills.some((bill) => bill.table_session_id === sess.id) : false;
        const readyOrders = tOrders.filter((order) => order.status === 'ready').length;
        const oldestMs = tOrders.reduce((acc, order) => Math.max(acc, now - new Date(kitchenStart(order)).getTime()), 0);
        const waiterId = tableWaiter(table);
        const waiterName = waiterId ? waiterById[waiterId]?.display_name : null;
        return (
          <TableCard
            key={table.id}
            table={table}
            session={sess}
            ordersCount={tOrders.length}
            readyCount={readyOrders}
            awaitingPayment={awaitingPayment}
            oldestMs={oldestMs}
            hasCall={hasCall}
            hasBill={hasBill}
            waiterName={waiterName}
            onOpen={() => onOpen(table.id)}
          />
        );
      })}
    </div>
  );
};

const StatPill = ({
  icon,
  label,
  value,
  tone = 'idle',
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  tone?: 'idle' | 'active' | 'warn' | 'urgent';
}) => {
  const tones = {
    idle: 'bg-muted text-muted-foreground border-border',
    active: 'bg-primary/10 text-primary border-primary/20',
    warn: 'bg-accent/10 text-accent border-accent/20',
    urgent: 'bg-destructive/10 text-destructive border-destructive/20',
  } as const;
  return (
    // Shown on phones too now: the status row scrolls sideways instead of
    // wrapping, so there is room for the numbers a host actually needs.
    <div className={`flex shrink-0 items-center gap-1.5 h-9 px-3 rounded-full border text-xs font-sans whitespace-nowrap ${tones[tone]}`}>
      {icon}
      <span className="opacity-80">{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  );
};

const TableCard = ({
  table,
  session,
  ordersCount,
  readyCount,
  awaitingPayment,
  oldestMs,
  hasCall,
  hasBill,
  waiterName,
  onOpen,
}: {
  table: TableRow;
  session?: Session;
  ordersCount: number;
  readyCount: number;
  /** Card orders not yet paid, so not in the kitchen. Said in words, never counted as cooking. */
  awaitingPayment: number;
  oldestMs: number;
  hasCall: boolean;
  hasBill: boolean;
  waiterName: string | null;
  onOpen: () => void;
}) => {
  const elapsed = useElapsed(session?.opened_at);
  const occupied = !!session;

  let state: TableState = 'free';
  if (hasBill) state = 'bill';
  else if (hasCall) state = 'call';
  else if (readyCount > 0) state = 'ready';
  else if (occupied) state = 'occupied';

  const palette: Record<TableState, { ring: string; bg: string; chip: string; label: string }> = {
    free: { ring: 'border-border', bg: 'bg-card', chip: 'bg-muted text-muted-foreground', label: 'Free' },
    occupied: { ring: 'border-primary/30', bg: 'bg-primary/5', chip: 'bg-primary/15 text-primary', label: 'Seated' },
    ready: { ring: 'border-accent/40', bg: 'bg-accent/5', chip: 'bg-accent/20 text-accent', label: 'Ready' },
    call: { ring: 'border-accent/60 animate-pulse', bg: 'bg-accent/10', chip: 'bg-accent text-accent-foreground', label: 'Calling' },
    bill: { ring: 'border-destructive/60 breathe breathe-urgent', bg: 'bg-destructive/10', chip: 'bg-destructive text-destructive-foreground', label: 'Bill' },
  };
  const selectedPalette = palette[state];

  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
      aria-label={`Table ${table.table_number} — ${selectedPalette.label}`}
      className={`border-2 cursor-pointer text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99] ${selectedPalette.ring} ${selectedPalette.bg} transition-all`}
    >
      <CardContent className="p-3">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="min-w-0">
            {table.sections && (
              <div className="flex items-center gap-1 mb-0.5">
                <span className="w-2 h-2 rounded-full" style={{ background: table.sections.color }} />
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground truncate">{table.sections.name}</span>
              </div>
            )}
            <p className="font-serif text-2xl font-bold leading-none">T{table.table_number}</p>
          </div>
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-sans font-semibold uppercase tracking-wide ${selectedPalette.chip}`}>
            {selectedPalette.label}
          </span>
        </div>

        {occupied && session ? (
          <>
            {session.guest_name && (
              <p className="text-sm font-sans text-foreground truncate">{session.guest_name}</p>
            )}
            <p className="text-sm text-muted-foreground font-sans flex items-center gap-1 mt-0.5">
              <Clock className="w-3 h-3" /> {formatDuration(elapsed)}
            </p>
            <div className="flex items-center gap-2 mt-2 text-[11px] font-sans flex-wrap">
              {ordersCount > 0 && (
                <span className="inline-flex items-center gap-1 text-primary">
                  <ChefHat className="w-3 h-3" /> {ordersCount}
                </span>
              )}
              {readyCount > 0 && (
                <span className="inline-flex items-center gap-1 text-accent">
                  <CheckCircle2 className="w-3 h-3" /> {readyCount} ready
                </span>
              )}
              {hasCall && (
                <span className="inline-flex items-center gap-1 text-accent font-semibold">
                  <Bell className="w-3 h-3" /> call
                </span>
              )}
              {hasBill && (
                <span className="inline-flex items-center gap-1 text-destructive font-semibold">
                  <Receipt className="w-3 h-3" /> bill
                </span>
              )}
            </div>
            {awaitingPayment > 0 && (
              <p className="text-[11px] text-accent font-sans mt-1">
                {awaitingPayment} not in kitchen — payment pending
              </p>
            )}
            {oldestMs > 0 && (
              <p className="text-[11px] text-muted-foreground font-sans mt-1">
                oldest order: {formatMinutes(oldestMs)}
              </p>
            )}
          </>
        ) : (
          <p className="text-xs text-muted-foreground font-sans">Available</p>
        )}

        {waiterName && (
          <p className="text-[10px] text-muted-foreground font-sans mt-2 pt-2 border-t border-border/60 truncate">
            Waiter: {waiterName}
          </p>
        )}
      </CardContent>
    </Card>
  );
};

export default WaiterMonitor;
