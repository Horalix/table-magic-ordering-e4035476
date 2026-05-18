import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { useElapsed, formatDuration, formatMinutes } from '@/lib/timing';
import { Bell, Receipt, Clock, Users, CheckCircle2, ChefHat, LogIn } from 'lucide-react';

type Section = { id: string; name: string; color: string };
type Waiter = { id: string; display_name: string; is_active: boolean };
type TableRow = {
  id: string;
  table_number: number;
  section_id: string | null;
  sections?: Section | null;
};
type Session = {
  id: string;
  table_id: string;
  is_active: boolean;
  opened_at: string;
  guest_name: string | null;
  assigned_waiter_id: string | null;
};
type Order = {
  id: string;
  table_session_id: string;
  status: string;
  created_at: string;
  assigned_waiter_id: string | null;
};
type Call = { id: string; table_session_id: string; status: string; created_at: string };
type BillReq = { id: string; table_session_id: string; status: string; created_at: string };
type Assignment = { section_id: string; waiter_id: string; shift_date: string };

const FILTER_KEY = 'monitor:waiterFilter';

const WaiterMonitor = () => {
  const [tables, setTables] = useState<TableRow[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [calls, setCalls] = useState<Call[]>([]);
  const [bills, setBills] = useState<BillReq[]>([]);
  const [waiters, setWaiters] = useState<Waiter[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [filter, setFilter] = useState<string>(() => localStorage.getItem(FILTER_KEY) || 'all');
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const fetchAll = async () => {
    const today = new Date().toISOString().slice(0, 10);
    const [t, s, o, c, b, w, a] = await Promise.all([
      supabase.from('tables').select('id, table_number, section_id, sections(id, name, color)').order('table_number'),
      supabase.from('table_sessions').select('id, table_id, is_active, opened_at, guest_name, assigned_waiter_id').eq('is_active', true),
      supabase.from('orders').select('id, table_session_id, status, created_at, assigned_waiter_id').not('status', 'in', '("served","cancelled")'),
      supabase.from('waiter_calls').select('id, table_session_id, status, created_at').eq('status', 'pending'),
      supabase.from('bill_requests').select('id, table_session_id, status, created_at').eq('status', 'pending'),
      supabase.from('waiters').select('id, display_name, is_active').eq('is_active', true).order('display_name'),
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

  const setFilterPersist = (v: string) => {
    setFilter(v);
    localStorage.setItem(FILTER_KEY, v);
  };

  // Map: section_id -> waiter_id for today
  const sectionWaiter = useMemo(() => {
    const m = new Map<string, string>();
    assignments.forEach((a) => m.set(a.section_id, a.waiter_id));
    return m;
  }, [assignments]);

  // For each table, derive its "owning waiter" — session.assigned_waiter || section assignment
  const tableWaiter = (t: TableRow): string | null => {
    const sess = sessions.find((s) => s.table_id === t.id);
    if (sess?.assigned_waiter_id) return sess.assigned_waiter_id;
    if (t.section_id) return sectionWaiter.get(t.section_id) || null;
    return null;
  };

  const filteredTables = useMemo(() => {
    if (filter === 'all') return tables;
    return tables.filter((t) => tableWaiter(t) === filter);
  }, [tables, filter, sessions, sectionWaiter]);

  // Stats
  const occupied = sessions.length;
  const free = tables.length - occupied;
  const pendingAlerts = calls.length + bills.length;
  const oldestOrderMs = orders.reduce((acc, o) => Math.max(acc, now.getTime() - new Date(o.created_at).getTime()), 0);

  const waiterById = useMemo(() => Object.fromEntries(waiters.map((w) => [w.id, w])), [waiters]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-card/95 backdrop-blur border-b border-border">
        <div className="px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div>
              <h1 className="font-serif text-xl sm:text-2xl font-bold">La Soul — Floor</h1>
              <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-sans">
                {now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · {now.toLocaleDateString()}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <StatPill icon={<Users className="w-3.5 h-3.5" />} label="Occupied" value={`${occupied}/${tables.length}`} tone="active" />
            <StatPill icon={<ChefHat className="w-3.5 h-3.5" />} label="Active orders" value={orders.length} tone={orders.length ? 'active' : 'idle'} />
            <StatPill icon={<Bell className="w-3.5 h-3.5" />} label="Alerts" value={pendingAlerts} tone={pendingAlerts ? 'urgent' : 'idle'} />
            <StatPill icon={<Clock className="w-3.5 h-3.5" />} label="Oldest wait" value={oldestOrderMs ? formatMinutes(oldestOrderMs) : '—'} tone={oldestOrderMs > 20 * 60_000 ? 'urgent' : oldestOrderMs > 10 * 60_000 ? 'warn' : 'idle'} />
            <Link to="/waiter/login" className="ml-2 inline-flex items-center gap-1.5 text-xs font-sans px-3 py-1.5 rounded-md border border-border hover:bg-accent/10">
              <LogIn className="w-3.5 h-3.5" /> Waiter sign in
            </Link>
          </div>
        </div>

        {/* Waiter filter pills */}
        <div className="px-4 sm:px-6 pb-3 flex flex-wrap items-center gap-2">
          <FilterPill active={filter === 'all'} onClick={() => setFilterPersist('all')}>
            All tables · {tables.length}
          </FilterPill>
          {waiters.map((w) => {
            const count = tables.filter((t) => tableWaiter(t) === w.id).length;
            return (
              <FilterPill key={w.id} active={filter === w.id} onClick={() => setFilterPersist(w.id)}>
                {w.display_name} · {count}
              </FilterPill>
            );
          })}
        </div>
      </header>

      {/* Tables grid */}
      <main className="p-4 sm:p-6">
        {filteredTables.length === 0 ? (
          <div className="text-center text-muted-foreground font-sans py-20">
            No tables match this filter.
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
            {filteredTables.map((t) => {
              const sess = sessions.find((s) => s.table_id === t.id);
              const tOrders = sess ? orders.filter((o) => o.table_session_id === sess.id) : [];
              const hasCall = sess ? calls.some((c) => c.table_session_id === sess.id) : false;
              const hasBill = sess ? bills.some((b) => b.table_session_id === sess.id) : false;
              const readyOrders = tOrders.filter((o) => o.status === 'ready').length;
              const oldestMs = tOrders.reduce((acc, o) => Math.max(acc, now.getTime() - new Date(o.created_at).getTime()), 0);
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
        )}
      </main>
    </div>
  );
};

/* ---------- subcomponents ---------- */

const FilterPill = ({ active, onClick, children }: any) => (
  <button
    onClick={onClick}
    className={`px-3 py-1.5 rounded-full text-xs font-sans border transition-colors ${
      active
        ? 'bg-primary text-primary-foreground border-primary'
        : 'bg-card text-foreground border-border hover:bg-accent/10'
    }`}
  >
    {children}
  </button>
);

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
            <div className="flex items-center gap-2 mt-2 text-[11px] font-sans">
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
