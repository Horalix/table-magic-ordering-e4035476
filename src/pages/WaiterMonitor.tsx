import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useElapsed, formatDuration, formatMinutes } from '@/lib/timing';
import { Bell, Receipt, Clock, Users, CheckCircle2, ChefHat, LogIn, ArrowLeft, Grid3x3, Lock } from 'lucide-react';
import PinPad from '@/components/monitor/PinPad';
import { toast } from 'sonner';

type Section = { id: string; name: string; color: string };
type Waiter = { id: string; display_name: string; is_active: boolean; pin_hash: string | null };
type TableRow = { id: string; table_number: number; section_id: string | null; sections?: Section | null };
type Session = { id: string; table_id: string; is_active: boolean; opened_at: string; guest_name: string | null; assigned_waiter_id: string | null };
type Order = { id: string; table_session_id: string; status: string; created_at: string; assigned_waiter_id: string | null };
type Call = { id: string; table_session_id: string; status: string; created_at: string };
type BillReq = { id: string; table_session_id: string; status: string; created_at: string };
type Assignment = { section_id: string; waiter_id: string; shift_date: string };

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

  /* ---------- clock ---------- */
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  /* ---------- data ---------- */
  const fetchAll = async () => {
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
    setTables((t.data as any) || []);
    setSessions((s.data as any) || []);
    setOrders((o.data as any) || []);
    setCalls((c.data as any) || []);
    setBills((b.data as any) || []);
    setWaiters((w.data as any) || []);
    setAssignments((a.data as any) || []);
  };

  useEffect(() => {
    fetchAll();
    const ch = supabase
      .channel('monitor')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tables' }, fetchAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'table_sessions' }, fetchAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, fetchAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'waiter_calls' }, fetchAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bill_requests' }, fetchAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'section_assignments' }, fetchAll)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  /* ---------- derived ---------- */
  const sectionWaiter = useMemo(() => {
    const m = new Map<string, string>();
    assignments.forEach((a) => m.set(a.section_id, a.waiter_id));
    return m;
  }, [assignments]);

  const tableWaiter = (t: TableRow): string | null => {
    const sess = sessions.find((s) => s.table_id === t.id);
    if (sess?.assigned_waiter_id) return sess.assigned_waiter_id;
    if (t.section_id) return sectionWaiter.get(t.section_id) || null;
    return null;
  };

  const waiterById = useMemo(() => Object.fromEntries(waiters.map((w) => [w.id, w])), [waiters]);

  // Urgency score: bigger = more urgent
  const tableUrgency = (t: TableRow) => {
    const sess = sessions.find((s) => s.table_id === t.id);
    if (!sess) return -1;
    if (bills.some((b) => b.table_session_id === sess.id)) return 100;
    if (calls.some((c) => c.table_session_id === sess.id)) return 80;
    const tOrders = orders.filter((o) => o.table_session_id === sess.id);
    if (tOrders.some((o) => o.status === 'ready')) return 60;
    const oldestMs = tOrders.reduce((acc, o) => Math.max(acc, now.getTime() - new Date(o.created_at).getTime()), 0);
    if (oldestMs > 15 * 60_000) return 40 + oldestMs / 60_000;
    return 20 + oldestMs / 60_000;
  };

  const sortByUrgency = (arr: TableRow[]) =>
    [...arr].sort((a, b) => tableUrgency(b) - tableUrgency(a));

  // Per-waiter quick stats for the rail
  const waiterStats = (waiterId: string) => {
    const myTables = tables.filter((t) => tableWaiter(t) === waiterId);
    const mySess = sessions.filter((s) => myTables.some((t) => t.id === s.table_id));
    const sessIds = new Set(mySess.map((s) => s.id));
    return {
      total: myTables.length,
      occupied: mySess.length,
      calls: calls.filter((c) => sessIds.has(c.table_session_id)).length,
      bills: bills.filter((b) => sessIds.has(b.table_session_id)).length,
      ready: orders.filter((o) => o.status === 'ready' && sessIds.has(o.table_session_id)).length,
    };
  };

  /* ---------- global stats ---------- */
  const occupied = sessions.length;
  const pendingAlerts = calls.length + bills.length;
  const oldestOrderMs = orders.reduce((acc, o) => Math.max(acc, now.getTime() - new Date(o.created_at).getTime()), 0);

  /* ---------- PIN flow ---------- */
  const openWaiter = (w: Waiter) => {
    if (!w.pin_hash) {
      toast.error(`${w.display_name} has no PIN yet — ask the manager to set one.`);
      return;
    }
    const lock = lockoutRef.current.get(w.id);
    if (lock && lock.until > Date.now()) {
      const sec = Math.ceil((lock.until - Date.now()) / 1000);
      toast.error(`Locked. Try again in ${sec}s.`);
      return;
    }
    setPinError(null);
    setPinTarget(w);
  };

  const submitPin = async (pin: string) => {
    if (!pinTarget) return;
    const { data, error } = await supabase.rpc('verify_waiter_pin' as any, { _waiter_id: pinTarget.id, _pin: pin });
    if (error) {
      setPinError('Could not verify. Try again.');
      return;
    }
    if (data === true) {
      const w = pinTarget;
      lockoutRef.current.delete(w.id);
      setPinTarget(null);
      setPinError(null);
      setActiveWaiterId(w.id);
      setMode('mine');
      localStorage.setItem(LAST_WAITER_KEY, w.id);
    } else {
      const cur = lockoutRef.current.get(pinTarget.id) || { fails: 0, until: 0 };
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

  /* ---------- idle auto-exit in 'mine' ---------- */
  const resetIdle = () => {
    if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
    idleTimerRef.current = window.setTimeout(() => {
      setMode('rail');
      setActiveWaiterId(null);
    }, IDLE_MS);
  };

  useEffect(() => {
    if (mode !== 'mine') {
      if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
      return;
    }
    resetIdle();
    const events = ['mousemove', 'keydown', 'touchstart', 'click'];
    events.forEach((e) => window.addEventListener(e, resetIdle));
    return () => {
      events.forEach((e) => window.removeEventListener(e, resetIdle));
      if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
    };
  }, [mode]);

  /* ---------- render ---------- */
  const activeWaiter = activeWaiterId ? waiterById[activeWaiterId] : null;
  const myTables = activeWaiterId
    ? sortByUrgency(tables.filter((t) => tableWaiter(t) === activeWaiterId))
    : [];

  const allTables = sortByUrgency(tables);

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
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
                {mode === 'mine' && activeWaiter ? `${activeWaiter.display_name}'s Floor` : mode === 'all' ? 'All Tables' : 'La Soul — Floor'}
              </h1>
              <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-sans">
                {now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · {now.toLocaleDateString()}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <StatPill icon={<Users className="w-3.5 h-3.5" />} label="Occupied" value={`${occupied}/${tables.length}`} tone="active" />
            <StatPill icon={<ChefHat className="w-3.5 h-3.5" />} label="Orders" value={orders.length} tone={orders.length ? 'active' : 'idle'} />
            <StatPill icon={<Bell className="w-3.5 h-3.5" />} label="Alerts" value={pendingAlerts} tone={pendingAlerts ? 'urgent' : 'idle'} />
            <StatPill icon={<Clock className="w-3.5 h-3.5" />} label="Oldest" value={oldestOrderMs ? formatMinutes(oldestOrderMs) : '—'} tone={oldestOrderMs > 20 * 60_000 ? 'urgent' : oldestOrderMs > 10 * 60_000 ? 'warn' : 'idle'} />
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
          <TablesGrid tables={allTables} sessions={sessions} orders={orders} calls={calls} bills={bills} waiterById={waiterById} tableWaiter={tableWaiter} now={now} large={false} />
        )}

        {mode === 'mine' && activeWaiter && (
          <>
            <TablesGrid tables={myTables} sessions={sessions} orders={orders} calls={calls} bills={bills} waiterById={waiterById} tableWaiter={tableWaiter} now={now} large />
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

/* ============ Rail (waiter tiles) ============ */
const RailView = ({
  waiters, waiterStats, onSelectWaiter, onAllTables, totalTables,
}: {
  waiters: Waiter[];
  waiterStats: (id: string) => { total: number; occupied: number; calls: number; bills: number; ready: number };
  onSelectWaiter: (w: Waiter) => void;
  onAllTables: () => void;
  totalTables: number;
}) => {
  return (
    <div>
      <p className="text-center text-sm font-sans text-muted-foreground mb-6">
        Tap your name to see your tables
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        <button
          onClick={onAllTables}
          className="min-h-[120px] rounded-2xl border-2 border-dashed border-border bg-card hover:bg-accent/10 active:scale-[0.98] transition-all p-5 text-left"
        >
          <div className="flex items-center gap-3 mb-2">
            <Grid3x3 className="w-6 h-6 text-muted-foreground" />
            <span className="font-serif text-xl font-bold">All Tables</span>
          </div>
          <p className="text-xs font-sans text-muted-foreground">Manager / host view · {totalTables} tables</p>
        </button>

        {waiters.map((w) => {
          const s = waiterStats(w.id);
          const urgent = s.bills + s.calls;
          return (
            <button
              key={w.id}
              onClick={() => onSelectWaiter(w)}
              className={`min-h-[120px] rounded-2xl border-2 p-5 text-left active:scale-[0.98] transition-all ${
                urgent > 0
                  ? 'border-destructive/60 bg-destructive/5 hover:bg-destructive/10 animate-pulse'
                  : s.ready > 0
                  ? 'border-accent/60 bg-accent/5 hover:bg-accent/10'
                  : 'border-border bg-card hover:bg-accent/10'
              }`}
            >
              <div className="flex items-start justify-between mb-2">
                <div className="min-w-0">
                  <p className="font-serif text-2xl font-bold truncate">{w.display_name}</p>
                  <p className="text-xs font-sans text-muted-foreground">
                    {s.total} tables · {s.occupied} seated
                  </p>
                </div>
                {!w.pin_hash ? (
                  <span className="text-[10px] font-sans px-2 py-1 rounded-full bg-muted text-muted-foreground">no PIN</span>
                ) : (
                  <Lock className="w-4 h-4 text-muted-foreground shrink-0" />
                )}
              </div>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {s.bills > 0 && (
                  <Chip tone="urgent" icon={<Receipt className="w-3 h-3" />}>{s.bills} bill</Chip>
                )}
                {s.calls > 0 && (
                  <Chip tone="urgent" icon={<Bell className="w-3 h-3" />}>{s.calls} call</Chip>
                )}
                {s.ready > 0 && (
                  <Chip tone="warn" icon={<CheckCircle2 className="w-3 h-3" />}>{s.ready} ready</Chip>
                )}
                {urgent === 0 && s.ready === 0 && (
                  <Chip tone="idle">All quiet</Chip>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};

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

/* ============ Tables Grid ============ */
const TablesGrid = ({ tables, sessions, orders, calls, bills, waiterById, tableWaiter, now, large }: any) => {
  if (tables.length === 0) {
    return <p className="text-center text-muted-foreground font-sans py-20">No tables.</p>;
  }
  const cols = large
    ? 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5'
    : 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6';
  return (
    <div className={`grid ${cols} gap-3`}>
      {tables.map((t: TableRow) => {
        const sess = sessions.find((s: Session) => s.table_id === t.id);
        const tOrders = sess ? orders.filter((o: Order) => o.table_session_id === sess.id) : [];
        const hasCall = sess ? calls.some((c: Call) => c.table_session_id === sess.id) : false;
        const hasBill = sess ? bills.some((b: BillReq) => b.table_session_id === sess.id) : false;
        const readyOrders = tOrders.filter((o: Order) => o.status === 'ready').length;
        const oldestMs = tOrders.reduce((acc: number, o: Order) => Math.max(acc, now.getTime() - new Date(o.created_at).getTime()), 0);
        const wId = tableWaiter(t);
        const wName = wId ? waiterById[wId]?.display_name : null;
        return (
          <TableCard
            key={t.id}
            table={t}
            session={sess}
            ordersCount={tOrders.length}
            readyCount={readyOrders}
            oldestMs={oldestMs}
            hasCall={hasCall}
            hasBill={hasBill}
            waiterName={wName}
          />
        );
      })}
    </div>
  );
};

const StatPill = ({
  icon, label, value, tone = 'idle',
}: { icon: React.ReactNode; label: string; value: React.ReactNode; tone?: 'idle' | 'active' | 'warn' | 'urgent' }) => {
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
  table, session, ordersCount, readyCount, oldestMs, hasCall, hasBill, waiterName,
}: any) => {
  const elapsed = useElapsed(session?.opened_at);
  const occupied = !!session;

  let state: 'free' | 'occupied' | 'ready' | 'call' | 'bill' = 'free';
  if (hasBill) state = 'bill';
  else if (hasCall) state = 'call';
  else if (readyCount > 0) state = 'ready';
  else if (occupied) state = 'occupied';

  const palette: Record<typeof state, { ring: string; bg: string; chip: string; label: string }> = {
    free:     { ring: 'border-border',          bg: 'bg-card',                 chip: 'bg-muted text-muted-foreground',          label: 'Free' },
    occupied: { ring: 'border-primary/30',      bg: 'bg-primary/5',             chip: 'bg-primary/15 text-primary',              label: 'Seated' },
    ready:    { ring: 'border-accent/40',       bg: 'bg-accent/5',              chip: 'bg-accent/20 text-accent',                label: 'Ready' },
    call:     { ring: 'border-accent/60 animate-pulse', bg: 'bg-accent/10',     chip: 'bg-accent text-accent-foreground',        label: 'Calling' },
    bill:     { ring: 'border-destructive/60 animate-pulse', bg: 'bg-destructive/10', chip: 'bg-destructive text-destructive-foreground', label: 'Bill' },
  };
  const p = palette[state];

  return (
    <Card className={`border-2 ${p.ring} ${p.bg} transition-colors`}>
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
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-sans font-semibold uppercase tracking-wide ${p.chip}`}>
            {p.label}
          </span>
        </div>

        {occupied ? (
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
            👤 {waiterName}
          </p>
        )}
      </CardContent>
    </Card>
  );
};

export default WaiterMonitor;
