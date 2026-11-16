import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { LayoutGroup, motion } from 'framer-motion';
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
import { ArrowLeft, Bell, CheckCircle2, ChefHat, Clock, Grid3x3, Hand, Lock, LogIn, Receipt, Users, Volume2, VolumeX } from 'lucide-react';
import PinPad from '@/components/monitor/PinPad';
import { toast } from 'sonner';
import {
  playOrderAlert, playWaiterCallAlert, playBillRequestAlert, useAudioUnlock, useReminderChime, vibrate,
} from '@/lib/kitchen-sounds';
import { useStaffSound } from '@/lib/staff-sound';
import { useStaffDocument, useStaffVenueLook } from '@/components/staff/useStaffDocument';
import { plural } from '@/components/staff/floor-words';
import { useStaffVenue } from '@/hooks/useStaffVenue';
import { useWakeLock } from '@/lib/wake-lock';
import { isHeld, isInKitchen, kitchenStart } from '@/components/staff/order-status';
import HeldOrdersCard from '@/components/staff/HeldOrdersCard';
import EndOfDayTables from '@/components/staff/EndOfDayTables';
import MenuOnlyNotice from '@/components/staff/MenuOnlyNotice';
import { TONE, toneGlow, type StaffTone } from '@/components/staff/status-tone';
import { staffMove } from '@/components/staff/staff-motion';
import { ArrivalGlow } from '@/components/staff/StaffMotion';
import type { Database } from '@/integrations/supabase/types';
import { isKitchenUsername } from '@/lib/staff-accounts';

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
  /** Which restaurant's floor this is — the heading said La Soul at both. */
  const staffVenue = useStaffVenue(meId);
  const venueName = staffVenue?.venue.name ?? null;
  useStaffDocument(venueName ? `Floor · ${venueName}` : 'Floor');
  useStaffVenueLook(staffVenue?.venue.slug);
  const [activeWaiterId, setActiveWaiterId] = useState<string | null>(null);

  const [pinTarget, setPinTarget] = useState<Waiter | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);
  const lockoutRef = useRef<Map<string, { fails: number; until: number }>>(new Map());
  const idleTimerRef = useRef<number | null>(null);

  // Sound alerts (shared floor display)
  // On unless muted, and a mute ends by itself (src/lib/staff-sound.ts).
  const { soundOn, setSoundOn } = useStaffSound('floor');
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
  /** The floor has answered once. Before that, "0/0" and an empty rail are not known, not quiet. */
  const [loaded, setLoaded] = useState(false);
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
      supabase.from('waiters').select('id, user_id, display_name, username, is_active, has_pin').eq('is_active', true).order('display_name'),
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
    if (initialLoadRef.current) {
      const hasNew = (cur: Set<string>, prev: Set<string>) => [...cur].some((id) => !prev.has(id));
      const newBill = hasNew(billIds, prevBillIds.current);
      const newCall = hasNew(callIds, prevCallIds.current);
      // A waiter holding the floor screen on a phone feels a table asking,
      // muted or not. Tablets have no motor; this does nothing there.
      if (newBill || newCall) vibrate();
      if (soundOnRef.current) {
        if (newBill) playBillRequestAlert();
        else if (newCall) playWaiterCallAlert();
        else if (hasNew(readyIds, prevReadyIds.current)) playOrderAlert();
      }
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
    // A kitchen tablet signs in as a waiter (Admin → Waiters) but serves no tables.
    setWaiters(((w.data ?? []) as (Waiter & { username: string | null })[]).filter((x) => !isKitchenUsername(x.username)));
    setAssignments((a.data ?? []) as Assignment[]);
    setLoaded(true);
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
        // The pad closes, so the reason goes where it can still be read.
        setPinError(null);
        setPinTarget(null);
        toast.error('Three wrong PINs. Try again in 30 seconds.');
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
                {mode === 'mine' && activeWaiter ? `${activeWaiter.display_name}'s floor` : mode === 'all' ? 'All tables' : venueName ? `${venueName} · Floor` : 'Floor'}
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
              onClick={() => { const next = !soundOn; setSoundOn(next); if (next) void unlockSound(); }}
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
            wrapping the header to three lines. The faded right edge says
            there is more; a chip simply cut in half did not. */}
        <div className="px-4 sm:px-6 pb-3 pe-10 sm:pe-6 flex items-center gap-2 overflow-x-auto scrollbar-hide [mask-image:linear-gradient(to_right,#000_calc(100%-2.5rem),transparent)] sm:[mask-image:none]">
          <ConnectionPill state={connection} className="shrink-0" />
          {/* Never an unmuted speaker over a context the browser has suspended. */}
          {soundOn && !audioUnlocked && (
            <button
              onClick={() => { void unlockSound(); }}
              className="shrink-0 inline-flex items-center gap-1.5 h-9 px-3 rounded-full text-sm font-sans font-semibold bg-amber-500/10 text-foreground border border-amber-500/40 hover:bg-amber-500/15 transition-colors"
            >
              <VolumeX className="w-4 h-4 text-amber-700" aria-hidden /> Tap to enable sound
            </button>
          )}
          <StatPill icon={<Users className="w-3.5 h-3.5" />} label="Occupied" value={loaded ? `${occupied}/${tables.length}` : '—'} tone="active" />
          <StatPill icon={<ChefHat className="w-3.5 h-3.5" />} label="Orders" value={loaded ? openOrders.length : '—'} tone={openOrders.length ? 'active' : 'idle'} />
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
        {/* In the page, not the sticky header: there they took a quarter of a
            1024×768 tablet for the whole shift, over the tables. */}
        <MenuOnlyNotice audience="waiter" outerClassName="mb-4" />
        {staffVenue && <EndOfDayTables hours={staffVenue.venue.hours} outerClassName="mb-4" />}
        {/* Pinned above every mode: the floor monitor is often the screen nearest the door. */}
        <HeldOrdersCard soundEnabled={soundOn} className="mb-4" onChanged={refetch} />
        {mode === 'rail' && !loaded && <RailSkeleton />}
        {mode === 'rail' && loaded && (
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
            emptyText="No tables are set up yet. A manager adds them under Admin › Tables."
            tables={allTables}
            sessions={sessions}
            orders={orders}
            calls={calls}
            bills={bills}
            waiterById={waiterById}
            tableWaiter={tableWaiter}
            now={sortNow}
            large={false}
            showWaiter
            onOpen={setOpenTableId}
          />
        )}

        {/* One empty message, not two: the grid said "No tables." and this
            page said "No tables assigned right now." underneath it. */}
        {mode === 'mine' && activeWaiter && (
          <TablesGrid
            emptyText="No tables for you today yet. They appear once a manager assigns your section, or a table is given to you."
            tables={myTables}
            sessions={sessions}
            orders={orders}
            calls={calls}
            bills={bills}
            waiterById={waiterById}
            tableWaiter={tableWaiter}
            now={sortNow}
            large
            showWaiter={false}
            onOpen={setOpenTableId}
          />
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

/** The rail's shape while the floor loads, so the cards do not pop in under a finger. */
const RailSkeleton = () => (
  <div aria-busy="true" aria-label="Loading the floor">
    <div className="mx-auto mb-6 h-4 w-48 rounded-full bg-muted animate-pulse motion-reduce:animate-none" />
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="min-h-[120px] rounded-2xl border border-border bg-card animate-pulse motion-reduce:animate-none" />
      ))}
    </div>
  </div>
);

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
        className="min-h-[120px] rounded-2xl border border-dashed border-border bg-card/60 hover:bg-card active:scale-[0.98] transition-all p-5 text-left"
      >
        <div className="flex items-center gap-3 mb-2">
          <Grid3x3 className="w-6 h-6 text-muted-foreground" />
          <span className="font-serif text-xl font-bold">All Tables</span>
        </div>
        <p className="text-sm font-sans text-muted-foreground">For the host or manager · {plural(totalTables, 'table')}</p>
      </button>

      {waiters.map((waiter) => {
        const stats = waiterStats(waiter.id);
        const urgent = stats.bills + stats.calls;
        // The most pressing thing on this waiter's floor colours the card, in
        // the colours every staff screen uses: a call, then a bill, then food.
        const tone: StaffTone | null = stats.calls > 0 ? 'calling' : stats.bills > 0 ? 'bill' : stats.ready > 0 ? 'ready' : null;
        return (
          <button
            key={waiter.id}
            type="button"
            onClick={() => onSelectWaiter(waiter)}
            style={stats.calls > 0 ? toneGlow('calling') : undefined}
            className={`min-h-[120px] rounded-2xl border bg-card p-5 text-left shadow-lux active:scale-[0.98] transition-[transform,background-color,border-color] hover:bg-muted/40 ${
              tone ? `${TONE[tone].border} ${stats.calls > 0 ? 'breathe' : ''}` : 'border-border'
            }`}
          >
            <div className="flex items-start justify-between gap-2 mb-2">
              <div className="min-w-0">
                {/* Two lines before an ellipsis: a long surname is still who it is. */}
                <p className="font-serif text-2xl font-bold leading-tight line-clamp-2 break-words">{waiter.display_name}</p>
                <p className="text-sm font-sans text-muted-foreground mt-0.5">
                  {plural(stats.total, 'table')} · {stats.occupied} seated
                </p>
              </div>
              {!waiter.has_pin ? (
                <span className="shrink-0 text-xs font-sans px-2 py-1 rounded-full bg-muted text-muted-foreground">No PIN yet</span>
              ) : (
                <Lock className="w-4 h-4 text-muted-foreground shrink-0 mt-1.5" aria-label="PIN required" />
              )}
            </div>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {stats.calls > 0 && (
                <Chip tone="calling" icon={<Hand className="w-3.5 h-3.5" />}>{plural(stats.calls, 'call')}</Chip>
              )}
              {stats.bills > 0 && (
                <Chip tone="bill" icon={<Receipt className="w-3.5 h-3.5" />}>{plural(stats.bills, 'bill')}</Chip>
              )}
              {stats.ready > 0 && (
                <Chip tone="ready" icon={<CheckCircle2 className="w-3.5 h-3.5" />}>{stats.ready} food up</Chip>
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

const Chip = ({ tone, icon, children }: { tone: 'idle' | 'calling' | 'bill' | 'ready'; icon?: React.ReactNode; children: React.ReactNode }) => {
  // A guest waiting (call, bill) is solid; food up is tinted; quiet is grey.
  const tones = {
    idle: 'bg-muted text-muted-foreground',
    calling: TONE.calling.solid,
    bill: TONE.bill.solid,
    ready: TONE.ready.chip,
  } as const;
  return (
    // Read from a step back, across a counter: 13px, not 11.
    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[13px] leading-none font-sans font-semibold ${tones[tone]}`}>
      {icon}{children}
    </span>
  );
};

const TablesGrid = ({
  emptyText,
  tables,
  sessions,
  orders,
  calls,
  bills,
  waiterById,
  tableWaiter,
  now,
  large,
  showWaiter,
  onOpen,
}: {
  /** Says why there is nothing here, which depends on whose view this is. */
  emptyText: string;
  tables: TableRow[];
  sessions: Session[];
  orders: Order[];
  calls: Call[];
  bills: BillReq[];
  waiterById: Record<string, Waiter>;
  tableWaiter: (table: TableRow) => string | null;
  now: number;
  large: boolean;
  /** "Waiter: Amra" on each card. Not on Amra's own floor, where it is every card. */
  showWaiter: boolean;
  onOpen: (tableId: string) => void;
}) => {
  if (tables.length === 0) {
    return (
      <div className="max-w-md mx-auto my-12 rounded-xl border border-dashed border-border bg-muted/30 px-6 py-10 text-center text-muted-foreground font-sans flex flex-col items-center gap-2">
        <Grid3x3 className="w-6 h-6 opacity-60" aria-hidden />
        {emptyText}
      </div>
    );
  }

  const cols = large
    ? 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5'
    : 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6';

  // Tables are sorted by urgency, so a table that starts calling moves up:
  // it slides there rather than jumping (no movement with reduce motion).
  return (
    <LayoutGroup id="floor-grid">
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
          <motion.div key={table.id} layout="position" transition={{ layout: staffMove }} className="min-w-0 flex">
          <TableCard
            table={table}
            session={sess}
            ordersCount={tOrders.length}
            readyCount={readyOrders}
            awaitingPayment={awaitingPayment}
            oldestMs={oldestMs}
            hasCall={hasCall}
            hasBill={hasBill}
            waiterName={showWaiter ? waiterName : null}
            onOpen={() => onOpen(table.id)}
          />
          </motion.div>
        );
      })}
    </div>
    </LayoutGroup>
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
  // Fine is quiet (white, grey words); only what needs a look takes a colour.
  const tones = {
    idle: 'bg-card text-muted-foreground border-border',
    active: 'bg-card text-muted-foreground border-border [&>span:last-child]:text-foreground',
    warn: `${TONE.preparing.chip} border-transparent`,
    urgent: `${TONE.late.chip} border-transparent`,
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

  /*
   * A calling table breathes, in the violet of a call on every staff screen.
   * A bill waits in ink, with a solid "Wants bill" label: a dark glow read as
   * a smudge. It used to `animate-pulse`, which fades the WHOLE card, text and all, to
   * half opacity and back — so the tables that most needed a waiter looked
   * greyed-out and disabled for half of every second.
   *
   * Free tables recede (dashed, no fill); a seated table is a plain card; only
   * a table that needs someone is coloured.
   */
  const palette: Record<TableState, { ring: string; bg: string; chip: string; label: string; tone?: StaffTone }> = {
    free: { ring: 'border-dashed border-border', bg: 'bg-card/50 shadow-none', chip: 'bg-transparent text-muted-foreground px-0', label: 'Free' },
    occupied: { ring: 'border-border', bg: 'bg-card', chip: 'bg-muted text-muted-foreground', label: 'Seated' },
    ready: { ring: TONE.ready.border, bg: 'bg-[hsl(150_46%_36%/0.06)]', chip: TONE.ready.solid, label: 'Food up', tone: 'ready' },
    call: { ring: `${TONE.calling.border} breathe`, bg: 'bg-[hsl(266_46%_54%/0.07)]', chip: TONE.calling.solid, label: 'Calling', tone: 'calling' },
    bill: { ring: TONE.bill.border, bg: 'bg-[hsl(210_16%_26%/0.05)]', chip: TONE.bill.solid, label: 'Wants bill', tone: 'bill' },
  };
  const selectedPalette = palette[state];

  /*
   * When a table starts needing someone while the screen is open — a call, the
   * bill, food up — it glows once in that colour (and slides up the grid, see
   * TablesGrid). What was already so when the screen opened is simply shown.
   */
  const lastState = useRef(state);
  const [flash, setFlash] = useState<{ tone: StaffTone; at: number } | null>(null);
  useEffect(() => {
    if (lastState.current === state) return;
    lastState.current = state;
    const tone = palette[state].tone;
    if (tone) setFlash({ tone, at: Date.now() });
    // `palette` is rebuilt each render from constants; only `state` matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
      aria-label={`Table ${table.table_number} — ${selectedPalette.label}`}
      data-state={state}
      style={state === 'call' ? toneGlow('calling') : undefined}
      className={`relative w-full rounded-2xl border cursor-pointer text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99] ${selectedPalette.ring} ${selectedPalette.bg} transition-[background-color,border-color,transform] duration-300`}
    >
      {flash && <ArrivalGlow key={flash.at} tone={flash.tone} />}
      <CardContent className="p-3">
        <div className="mb-2">
          <div className="flex items-start justify-between gap-2">
            <p className={`font-serif text-[28px] font-bold leading-none tracking-tight ${occupied ? 'text-foreground' : 'text-foreground/45'}`}>T{table.table_number}</p>
            <span className={`shrink-0 text-[11px] px-2 py-0.5 rounded-full font-sans font-semibold uppercase tracking-[0.08em] transition-colors duration-300 ${selectedPalette.chip}`}>
              {selectedPalette.label}
            </span>
          </div>
          {/* Under the number, the card's full width: beside the state it was
              cut to "GARDEN R…" as soon as it was big enough to read. */}
          {table.sections && (
            <div className="flex items-center gap-1 mt-1">
              <span className="w-2 h-2 shrink-0 rounded-full" style={{ background: table.sections.color }} />
              <span className="text-xs uppercase tracking-wide text-muted-foreground truncate">{table.sections.name}</span>
            </div>
          )}
        </div>

        {/* Readable from a step back: 12–14px. The details were 10–11px, which
            is a tablet held in the hand, not one standing on a counter. */}
        {occupied && session ? (
          <>
            {session.guest_name && (
              <p className="text-sm font-sans text-foreground truncate">{session.guest_name}</p>
            )}
            <p className="text-sm text-muted-foreground font-sans flex items-center gap-1 mt-0.5">
              <Clock className="w-3.5 h-3.5" aria-hidden /> {formatDuration(elapsed)}
            </p>
            <div className="flex items-center gap-x-2.5 gap-y-1 mt-2 text-sm font-sans flex-wrap">
              {hasBill && (
                <span className={`inline-flex items-center gap-1 font-semibold ${TONE.bill.text}`}>
                  <Receipt className="w-3.5 h-3.5" aria-hidden /> Bill
                </span>
              )}
              {hasCall && (
                <span className={`inline-flex items-center gap-1 font-semibold ${TONE.calling.text}`}>
                  <Hand className="w-3.5 h-3.5" aria-hidden /> Calling
                </span>
              )}
              {readyCount > 0 && (
                <span className={`inline-flex items-center gap-1 font-semibold ${TONE.ready.text}`}>
                  <CheckCircle2 className="w-3.5 h-3.5" aria-hidden /> {readyCount} up
                </span>
              )}
              {/* Not counting what is already up: "1 up · 1 order" was one plate. */}
              {ordersCount - readyCount > 0 && (
                <span className={`inline-flex items-center gap-1 ${TONE.preparing.text}`}>
                  <ChefHat className="w-3.5 h-3.5" aria-hidden /> {ordersCount - readyCount} in kitchen
                </span>
              )}
            </div>
            {awaitingPayment > 0 && (
              <p className="text-xs text-foreground font-sans font-medium mt-1">
                {awaitingPayment} not in kitchen — payment pending
              </p>
            )}
            {oldestMs > 0 && (
              <p className="text-xs text-muted-foreground font-sans mt-1">
                Oldest order {formatMinutes(oldestMs)}
              </p>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground/80 font-sans">Available</p>
        )}

        {waiterName && (
          <p className="text-xs text-muted-foreground font-sans mt-2.5 pt-2 border-t border-border/60 truncate">
            Waiter: {waiterName}
          </p>
        )}
      </CardContent>
    </Card>
  );
};

export default WaiterMonitor;
