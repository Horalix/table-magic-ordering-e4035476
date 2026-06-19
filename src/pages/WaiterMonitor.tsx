import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { formatDuration, formatMinutes, useElapsed } from '@/lib/timing';
import { ArrowLeft, Bell, CheckCircle2, ChefHat, Clock, Grid3x3, Lock, LogIn, Receipt, Users, Volume2, VolumeX } from 'lucide-react';
import PinPad from '@/components/monitor/PinPad';
import { toast } from 'sonner';
import { playOrderAlert, playWaiterCallAlert, playBillRequestAlert, unlockAudio } from '@/lib/kitchen-sounds';
import type { Database } from '@/integrations/supabase/types';

type Section = Pick<Database['public']['Tables']['sections']['Row'], 'id' | 'name' | 'color'>;
type Waiter = Pick<Database['public']['Tables']['waiters']['Row'], 'id' | 'display_name' | 'is_active' | 'pin_hash'>;
type TableRow = Pick<Database['public']['Tables']['tables']['Row'], 'id' | 'table_number' | 'section_id'> & {
  sections?: Section | null;
};
type Session = Pick<
  Database['public']['Tables']['table_sessions']['Row'],
  'id' | 'table_id' | 'is_active' | 'opened_at' | 'guest_name' | 'assigned_waiter_id'
>;
type Order = Pick<
  Database['public']['Tables']['orders']['Row'],
  'id' | 'table_session_id' | 'status' | 'created_at' | 'assigned_waiter_id'
>;
type Call = Pick<Database['public']['Tables']['waiter_calls']['Row'], 'id' | 'table_session_id' | 'status' | 'created_at'>;
type BillReq = Pick<Database['public']['Tables']['bill_requests']['Row'], 'id' | 'table_session_id' | 'status' | 'created_at'>;
type Assignment = Pick<Database['public']['Tables']['section_assignments']['Row'], 'section_id' | 'waiter_id' | 'shift_date'>;
type WaiterStats = { total: number; occupied: number; calls: number; bills: number; ready: number };
type TableState = 'free' | 'occupied' | 'ready' | 'call' | 'bill';

const LAST_WAITER_KEY = 'monitor:lastWaiterId';
const IDLE_MS = 5 * 60 * 1000;

const WaiterMonitor = () => {
  const [tables, setTables] = useState<TableRow[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [calls, setCalls] = useState<Call[]>([]);
  const [bills, setBills] = useState<BillReq[]>([]);
  const [waiters, setWaiters] = useState<Waiter[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);

  const [now, setNow] = useState(new Date());
  const [mode, setMode] = useState<'rail' | 'mine' | 'all'>('rail');
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
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // Unlock audio on the first tap so event-driven alerts can play.
  useEffect(() => {
    const unlock = () => unlockAudio();
    window.addEventListener('pointerdown', unlock, { once: true });
    return () => window.removeEventListener('pointerdown', unlock);
  }, []);

  const fetchAll = useCallback(async () => {
    const today = new Date().toISOString().slice(0, 10);
    const [t, s, o, c, b, w, a] = await Promise.all([
      supabase.from('tables').select('id, table_number, section_id, sections(id, name, color)').order('table_number'),
      supabase.from('table_sessions').select('id, table_id, is_active, opened_at, guest_name, assigned_waiter_id').eq('is_active', true),
      supabase.from('orders').select('id, table_session_id, status, created_at, assigned_waiter_id').not('status', 'in', '("served","cancelled")'),
      supabase.from('waiter_calls').select('id, table_session_id, status, created_at').eq('status', 'pending'),
      supabase.from('bill_requests').select('id, table_session_id, status, created_at').eq('status', 'pending'),
      supabase.from('waiters').select('id, display_name, is_active, pin_hash').eq('is_active', true).order('display_name'),
      supabase.from('section_assignments').select('section_id, waiter_id, shift_date').eq('shift_date', today),
    ]);

    if (t.error || s.error || o.error || c.error || b.error || w.error || a.error) {
      toast.error('Failed to refresh floor monitor');
      return;
    }

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
  }, []);

  useEffect(() => {
    void fetchAll();
    const ch = supabase
      .channel('monitor')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tables' }, () => { void fetchAll(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'table_sessions' }, () => { void fetchAll(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => { void fetchAll(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'waiter_calls' }, () => { void fetchAll(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bill_requests' }, () => { void fetchAll(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'section_assignments' }, () => { void fetchAll(); })
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [fetchAll]);

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
    const tOrders = orders.filter((order) => order.table_session_id === sess.id);
    if (tOrders.some((order) => order.status === 'ready')) return 60;
    const oldestMs = tOrders.reduce((acc, order) => Math.max(acc, now.getTime() - new Date(order.created_at).getTime()), 0);
    if (oldestMs > 15 * 60_000) return 40 + oldestMs / 60_000;
    return 20 + oldestMs / 60_000;
  }, [bills, calls, now, orders, sessions]);

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
  const oldestOrderMs = orders.reduce((acc, order) => Math.max(acc, now.getTime() - new Date(order.created_at).getTime()), 0);

  const openWaiter = (waiter: Waiter) => {
    if (!waiter.pin_hash) {
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

  const activeWaiter = activeWaiterId ? waiterById[activeWaiterId] : null;
  const myTables = activeWaiterId
    ? sortByUrgency(tables.filter((table) => tableWaiter(table) === activeWaiterId))
    : [];
  const allTables = sortByUrgency(tables);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 bg-card/95 backdrop-blur border-b border-border">
        <div className="px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            {mode !== 'rail' && (
              <Button variant="ghost" size="sm" onClick={() => { setMode('rail'); setActiveWaiterId(null); }} className="gap-1.5">
                <ArrowLeft className="w-4 h-4" /> Back
              </Button>
            )}
            <div>
              <h1 className="font-serif text-xl sm:text-2xl font-bold leading-tight">
                {mode === 'mine' && activeWaiter ? `${activeWaiter.display_name}'s Floor` : mode === 'all' ? 'All Tables' : 'La Soul - Floor'}
              </h1>
              <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-sans">
                {now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} | {now.toLocaleDateString()}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <StatPill icon={<Users className="w-3.5 h-3.5" />} label="Occupied" value={`${occupied}/${tables.length}`} tone="active" />
            <StatPill icon={<ChefHat className="w-3.5 h-3.5" />} label="Orders" value={orders.length} tone={orders.length ? 'active' : 'idle'} />
            <StatPill icon={<Bell className="w-3.5 h-3.5" />} label="Alerts" value={pendingAlerts} tone={pendingAlerts ? 'urgent' : 'idle'} />
            <StatPill
              icon={<Clock className="w-3.5 h-3.5" />}
              label="Oldest"
              value={oldestOrderMs ? formatMinutes(oldestOrderMs) : '-'}
              tone={oldestOrderMs > 20 * 60_000 ? 'urgent' : oldestOrderMs > 10 * 60_000 ? 'warn' : 'idle'}
            />
            <button
              onClick={() => { const next = !soundOn; setSoundOn(next); localStorage.setItem('monitor:sound', String(next)); if (next) unlockAudio(); }}
              aria-label={soundOn ? 'Mute alerts' : 'Enable alerts'}
              className="inline-flex items-center justify-center w-9 h-9 rounded-md border border-border hover:bg-accent/10"
            >
              {soundOn ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4 text-muted-foreground" />}
            </button>
            <Link to="/waiter/login" className="inline-flex items-center gap-1.5 text-xs font-sans px-3 py-1.5 rounded-md border border-border hover:bg-accent/10">
              <LogIn className="w-3.5 h-3.5" /> Sign in
            </Link>
          </div>
        </div>
      </header>

      <main className="p-4 sm:p-6">
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
            now={now}
            large={false}
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
              now={now}
              large
            />
            {myTables.length === 0 && (
              <p className="text-center text-muted-foreground font-sans py-20">
                No tables assigned right now.
              </p>
            )}
          </>
        )}
      </main>

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
                ? 'border-destructive/60 bg-destructive/5 hover:bg-destructive/10 breathe'
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
              {!waiter.pin_hash ? (
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
}: {
  tables: TableRow[];
  sessions: Session[];
  orders: Order[];
  calls: Call[];
  bills: BillReq[];
  waiterById: Record<string, Waiter>;
  tableWaiter: (table: TableRow) => string | null;
  now: Date;
  large: boolean;
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
        const tOrders = sess ? orders.filter((order) => order.table_session_id === sess.id) : [];
        const hasCall = sess ? calls.some((call) => call.table_session_id === sess.id) : false;
        const hasBill = sess ? bills.some((bill) => bill.table_session_id === sess.id) : false;
        const readyOrders = tOrders.filter((order) => order.status === 'ready').length;
        const oldestMs = tOrders.reduce((acc, order) => Math.max(acc, now.getTime() - new Date(order.created_at).getTime()), 0);
        const waiterId = tableWaiter(table);
        const waiterName = waiterId ? waiterById[waiterId]?.display_name : null;
        return (
          <TableCard
            key={table.id}
            table={table}
            session={sess}
            ordersCount={tOrders.length}
            readyCount={readyOrders}
            oldestMs={oldestMs}
            hasCall={hasCall}
            hasBill={hasBill}
            waiterName={waiterName}
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
    <div className={`hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[11px] font-sans ${tones[tone]}`}>
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
  oldestMs,
  hasCall,
  hasBill,
  waiterName,
}: {
  table: TableRow;
  session?: Session;
  ordersCount: number;
  readyCount: number;
  oldestMs: number;
  hasCall: boolean;
  hasBill: boolean;
  waiterName: string | null;
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
    bill: { ring: 'border-destructive/60 breathe', bg: 'bg-destructive/10', chip: 'bg-destructive text-destructive-foreground', label: 'Bill' },
  };
  const selectedPalette = palette[state];

  return (
    <Card className={`border-2 ${selectedPalette.ring} ${selectedPalette.bg} transition-colors`}>
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
              <p className="text-xs font-sans text-foreground truncate">{session.guest_name}</p>
            )}
            <p className="text-[11px] text-muted-foreground font-sans flex items-center gap-1 mt-0.5">
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
            {oldestMs > 0 && (
              <p className="text-[10px] text-muted-foreground font-sans mt-1">
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
