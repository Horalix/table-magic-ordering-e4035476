import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CalendarDays, Check, ChevronRight, Layers, Loader2, MapPin, Plus, UserPlus, Users } from 'lucide-react';
import { toast } from 'sonner';
import { AdminPageHeader, AdminToolbar } from '@/components/admin/AdminPage';
import { AdminCard, AdminCardContent, AdminCardHeader, EmptyState, Stagger } from '@/components/admin/AdminCard';
import { TONE, type StaffTone } from '@/components/staff/status-tone';
import { cn } from '@/lib/utils';
import { addSectionWaiter, removeSectionAssignment, todayISO, type SectionAssignment } from '@/lib/assignments';
import { useStaffTables } from '@/lib/realtime';
import { isKitchenUsername } from '@/lib/staff-accounts';

interface Section { id: string; name: string; color: string; sort_order: number; }
interface Waiter { id: string; display_name: string; }
interface Table { id: string; section_id: string | null; }

const initials = (name: string) => name.split(' ').map((s) => s[0]).join('').slice(0, 2).toUpperCase();
const firstName = (name: string) => name.split(' ')[0];
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A state as a word with a dot, in the staff screens' colours. */
const Pill = ({ tone, children, className }: { tone: StaffTone; children: React.ReactNode; className?: string }) => (
  <span className={cn('inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-sans font-medium', TONE[tone].chip, className)}>
    <span className={cn('h-1.5 w-1.5 rounded-full', TONE[tone].dot)} aria-hidden />
    {children}
  </span>
);

/** A waiter's initials in a circle: the section's colour when they cover it, quiet otherwise. */
const Avatar = ({ name, color, className }: { name: string; color?: string; className?: string }) => (
  <span
    className={cn(
      'grid shrink-0 place-items-center rounded-full font-sans font-semibold',
      color ? 'text-white' : 'bg-muted text-muted-foreground',
      className,
    )}
    style={color ? { background: color } : undefined}
    aria-hidden
  >
    {initials(name)}
  </span>
);

const AdminFloorTonight = () => {
  const [sections, setSections] = useState<Section[]>([]);
  const [waiters, setWaiters] = useState<Waiter[]>([]);
  const [assignments, setAssignments] = useState<SectionAssignment[]>([]);
  const [tables, setTables] = useState<Table[]>([]);
  const [date, setDate] = useState(todayISO());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [picking, setPicking] = useState<Section | null>(null);
  /** Taps still on their way to the server, as `section:waiter`. */
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());

  const isToday = date === todayISO();

  const fetchAll = useCallback(async () => {
    const [s, w, a, t] = await Promise.all([
      supabase.from('sections').select('*').order('sort_order'),
      supabase.from('waiters').select('id, display_name, username').eq('is_active', true).order('display_name'),
      supabase.from('section_assignments').select('*').eq('shift_date', date),
      supabase.from('tables').select('id, section_id'),
    ]);
    // A failed load must not render as "you have no sections". That empty
    // state invites a manager to recreate sections that already exist, and the
    // duplicates then have to be untangled table by table.
    if (s.error || w.error || a.error || t.error) {
      setLoadError(true);
      setLoading(false);
      return;
    }
    setLoadError(false);
    setSections(s.data || []);
    // A kitchen tablet's sign-in is a waiter's row, but it takes no section.
    setWaiters(((w.data as (Waiter & { username: string | null })[]) || []).filter((x) => !isKitchenUsername(x.username)));
    setAssignments((a.data as SectionAssignment[]) || []);
    setTables(t.data || []);
    setLoading(false);
  }, [date]);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);
  // The tab's shared channel: only the restaurant shown, and polled where the
  // socket cannot see it (the owner looking at Vera Italia). The rota is not
  // on the live feed (lib/realtime.ts), so no table to hear: the page reloads
  // on the channel's ticks — every minute, and on coming back to the tab.
  useStaffTables([], useCallback(() => { void fetchAll(); }, [fetchAll]));

  const tableCount = useMemo(() => {
    const m = new Map<string, number>();
    tables.forEach((t) => { if (t.section_id) m.set(t.section_id, (m.get(t.section_id) || 0) + 1); });
    return m;
  }, [tables]);

  const waiterById = useMemo(() => Object.fromEntries(waiters.map((w) => [w.id, w])), [waiters]);
  const sectionById = useMemo(() => Object.fromEntries(sections.map((s) => [s.id, s])), [sections]);

  /** Each waiter's sections tonight, in the floor's order. */
  const sectionsOf = useMemo(() => {
    const m = new Map<string, Section[]>();
    assignments.forEach((a) => {
      const s = sectionById[a.section_id];
      if (!s) return;
      m.set(a.waiter_id, [...(m.get(a.waiter_id) ?? []), s]);
    });
    m.forEach((list) => list.sort((x, y) => x.sort_order - y.sort_order));
    return m;
  }, [assignments, sectionById]);

  const covering = (sectionId: string) => assignments
    .filter((x) => x.section_id === sectionId)
    .map((x) => waiterById[x.waiter_id])
    .filter(Boolean);

  // Toggle a waiter on/off for a section (multiple allowed). Keeps the picker open.
  const toggleWaiter = async (sectionId: string, waiterId: string) => {
    const key = `${sectionId}:${waiterId}`;
    // A second tap before the first is saved would undo a row that does not exist yet.
    if (pending.has(key)) return;
    setPending((p) => new Set(p).add(key));
    const existing = assignments.find((a) => a.section_id === sectionId && a.waiter_id === waiterId) ?? null;
    setAssignments((prev) => existing
      ? prev.filter((a) => a.id !== existing.id)
      : [...prev, { id: `tmp-${sectionId}-${waiterId}`, section_id: sectionId, waiter_id: waiterId, shift_date: date }]);
    const { error } = existing
      ? await removeSectionAssignment(existing.id)
      : await addSectionWaiter(sectionId, waiterId, date);
    if (error) toast.error(error);
    await fetchAll();
    setPending((p) => { const next = new Set(p); next.delete(key); return next; });
  };

  const needing = sections.filter((s) => (tableCount.get(s.id) || 0) > 0 && covering(s.id).length === 0);
  const withTables = sections.filter((s) => (tableCount.get(s.id) || 0) > 0);
  const onFloor = waiters.filter((w) => (sectionsOf.get(w.id) ?? []).length > 0);
  const offFloor = waiters.filter((w) => (sectionsOf.get(w.id) ?? []).length === 0);
  const dateWords = new Date(date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

  const facts = !loading && !loadError && sections.length > 0 && (
    <AdminToolbar className="gap-x-3 gap-y-2 text-sm font-sans text-muted-foreground">
      <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
        <CalendarDays className="h-4 w-4 text-muted-foreground" aria-hidden />
        {isToday ? 'Tonight' : 'Shift of'}, {dateWords}
      </span>
      {needing.length > 0 ? (
        <Pill tone="preparing">{needing.length === 1 ? '1 section needs a waiter' : `${needing.length} sections need a waiter`}</Pill>
      ) : withTables.length > 0 ? (
        <Pill tone="ready">{withTables.length === 1 ? 'The section is covered' : `All ${withTables.length} sections covered`}</Pill>
      ) : null}
      {waiters.length > 0 && (
        <span className="tabular-nums">{onFloor.length} of {plural(waiters.length, 'waiter')} on the floor</span>
      )}
    </AdminToolbar>
  );

  return (
    <div className="mx-auto w-full max-w-6xl">
      <AdminPageHeader
        title="Tonight’s waiters"
        description="Who covers each section tonight. Tap a section to choose its waiters; its tables go to them automatically."
        actions={(
          <>
            {!isToday && (
              <Button variant="outline" onClick={() => setDate(todayISO())} className="h-11 gap-2 sm:h-10">
                <CalendarDays className="h-4 w-4" aria-hidden /> Back to today
              </Button>
            )}
            <Button variant="outline" asChild className="h-11 gap-2 sm:h-10">
              <Link to="/admin/sections"><Layers className="h-4 w-4" aria-hidden /> Edit sections</Link>
            </Button>
          </>
        )}
      >
        {facts}
      </AdminPageHeader>

      {loading ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]" aria-busy="true" aria-label="Loading tonight’s waiters">
          <div className="grid gap-4 sm:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[132px] rounded-2xl" />)}
          </div>
          <Skeleton className="h-64 rounded-2xl" />
        </div>
      ) : loadError ? (
        <AdminCard>
          <AdminCardContent className="pt-5 sm:pt-6">
            <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm font-sans">
              <p className="font-medium text-destructive">Could not load the floor plan</p>
              <p className="mt-0.5 text-muted-foreground">
                This is a connection problem, not an empty restaurant — nothing has been deleted.
              </p>
            </div>
            <Button variant="outline" className="mt-4 h-11 sm:h-10" onClick={() => { setLoading(true); void fetchAll(); }}>
              Try again
            </Button>
          </AdminCardContent>
        </AdminCard>
      ) : sections.length === 0 ? (
        <AdminCard>
          <EmptyState
            icon={MapPin}
            tone="primary"
            title="No sections to assign yet"
            hint="Create sections and group your tables first. Then come back here to choose who covers each one."
            className="pb-6"
          />
          <div className="flex justify-center pb-8">
            <Button asChild className="h-11 gap-2 sm:h-10"><Link to="/admin/sections"><Plus className="h-4 w-4" aria-hidden /> Set up sections</Link></Button>
          </div>
        </AdminCard>
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <Stagger className="grid gap-4 sm:grid-cols-2" aria-label="Sections">
            {sections.map((s) => {
              const sectionWaiters = covering(s.id);
              const count = tableCount.get(s.id) || 0;
              const needsWaiter = count > 0 && sectionWaiters.length === 0;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setPicking(s)}
                  className={cn(
                    'group relative flex h-full w-full flex-col overflow-hidden rounded-2xl border bg-card p-4 ps-5 text-left shadow-lux transition',
                    'hover:border-foreground/20 hover:shadow-md active:scale-[0.99] motion-reduce:transition-none motion-reduce:active:scale-100',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:p-5 sm:ps-6',
                    needsWaiter ? TONE.preparing.border : 'border-border/80',
                  )}
                >
                  <span className="absolute inset-y-0 start-0 w-1.5" style={{ background: s.color }} aria-hidden />
                  <span className="flex items-start justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block truncate font-serif text-lg font-semibold leading-snug text-foreground">{s.name}</span>
                      <span className="mt-0.5 block text-xs font-sans text-muted-foreground tabular-nums">
                        {count === 0 ? 'No tables yet' : plural(count, 'table')}
                      </span>
                    </span>
                    {needsWaiter ? (
                      <Pill tone="preparing">Needs a waiter</Pill>
                    ) : sectionWaiters.length > 0 ? (
                      <Pill tone="ready">Covered</Pill>
                    ) : null}
                  </span>

                  <span className="mt-4 flex min-h-11 items-center gap-3">
                    {sectionWaiters.length > 0 ? (
                      <>
                        <span className="flex shrink-0 -space-x-2">
                          {sectionWaiters.slice(0, 3).map((w) => (
                            <Avatar key={w.id} name={w.display_name} color={s.color} className="h-10 w-10 text-sm ring-2 ring-card" />
                          ))}
                          {sectionWaiters.length > 3 && (
                            <span className="grid h-10 w-10 place-items-center rounded-full bg-muted text-xs font-sans font-semibold text-muted-foreground ring-2 ring-card tabular-nums" aria-hidden>
                              +{sectionWaiters.length - 3}
                            </span>
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-sans font-semibold text-foreground">
                            {sectionWaiters.map((w) => firstName(w.display_name)).join(', ')}
                          </span>
                          <span className="block text-xs font-sans text-muted-foreground">
                            {sectionWaiters.length === 1 ? 'Covering this section' : `${sectionWaiters.length} waiters covering`}
                          </span>
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-dashed border-muted-foreground/40 text-muted-foreground" aria-hidden>
                          <UserPlus className="h-4 w-4" />
                        </span>
                        <span className={cn('min-w-0 flex-1 text-sm font-sans font-medium', needsWaiter ? TONE.preparing.text : 'text-muted-foreground')}>
                          Tap to choose a waiter
                        </span>
                      </>
                    )}
                    <ChevronRight className="ms-auto h-5 w-5 shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden />
                  </span>
                </button>
              );
            })}
          </Stagger>

          <AdminCard className="lg:sticky lg:top-6">
            <AdminCardHeader
              icon={Users}
              title="On the floor"
              description={waiters.length > 0 ? `Every active waiter and where they are ${isToday ? 'tonight' : 'on this shift'}.` : undefined}
            />
            <AdminCardContent>
              {waiters.length === 0 ? (
                <EmptyState
                  icon={Users}
                  title="No active waiters"
                  hint={<>Add them under <Link to="/admin/waiters" className="font-medium text-primary underline-offset-4 hover:underline">Waiters</Link>, then choose their sections here.</>}
                  className="py-6"
                />
              ) : (
                <ul className="-my-1 divide-y divide-border/70">
                  {[...onFloor, ...offFloor].map((w) => {
                    const theirs = sectionsOf.get(w.id) ?? [];
                    return (
                      <li key={w.id} className="flex items-center gap-3 py-2.5">
                        <Avatar name={w.display_name} color={theirs[0]?.color} className="h-8 w-8 text-[11px]" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-sans font-medium text-foreground">{w.display_name}</span>
                          <span className="block truncate text-xs font-sans text-muted-foreground">
                            {theirs.length > 0 ? theirs.map((s) => s.name).join(' · ') : 'Not on a section'}
                          </span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </AdminCardContent>
          </AdminCard>
        </div>
      )}

      {/* Quick picker */}
      <Dialog open={!!picking} onOpenChange={(o) => { if (!o) setPicking(null); }}>
        <DialogContent className="max-w-[calc(100vw-2rem)] gap-5 rounded-2xl sm:max-w-md">
          <DialogHeader className="pe-8 text-start">
            <DialogTitle className="flex items-center gap-2.5 font-serif text-xl">
              {picking && <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: picking.color }} aria-hidden />}
              <span className="min-w-0 truncate">{picking?.name}</span>
            </DialogTitle>
            <DialogDescription className="font-sans">
              {picking && `${plural(tableCount.get(picking.id) || 0, 'table')}. `}
              Tap everyone covering it {isToday ? 'tonight' : 'on this shift'}; tap again to take them off.
            </DialogDescription>
          </DialogHeader>
          {waiters.length === 0 ? (
            <p className="text-sm text-muted-foreground font-sans">
              No active waiters. Add them under <Link to="/admin/waiters" className="font-medium text-primary underline-offset-4 hover:underline">Waiters</Link>.
            </p>
          ) : (
            <>
              <div className="-mx-1 max-h-[55vh] space-y-2 overflow-y-auto px-1 py-0.5">
                {picking && waiters.map((w) => {
                  const active = assignments.some((x) => x.section_id === picking.id && x.waiter_id === w.id);
                  const elsewhere = (sectionsOf.get(w.id) ?? []).filter((s) => s.id !== picking.id);
                  const busy = pending.has(`${picking.id}:${w.id}`);
                  return (
                    <button
                      key={w.id}
                      type="button"
                      aria-pressed={active}
                      aria-busy={busy || undefined}
                      onClick={() => { void toggleWaiter(picking.id, w.id); }}
                      className={cn(
                        'flex min-h-[60px] w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition',
                        'active:scale-[0.99] motion-reduce:transition-none motion-reduce:active:scale-100',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        active ? 'border-primary/60 bg-primary/5' : 'border-border hover:bg-muted/50',
                      )}
                    >
                      <Avatar name={w.display_name} color={active ? picking.color : undefined} className="h-10 w-10 text-xs" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-sans font-medium text-foreground">{w.display_name}</span>
                        {elsewhere.length > 0 && (
                          <span className="block truncate text-xs font-sans text-muted-foreground">Also on {elsewhere.map((s) => s.name).join(', ')}</span>
                        )}
                      </span>
                      <span
                        className={cn(
                          'grid h-6 w-6 shrink-0 place-items-center rounded-full border transition-colors',
                          active ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40 text-transparent',
                        )}
                        aria-hidden
                      >
                        {busy ? <Loader2 className={cn('h-3.5 w-3.5 animate-spin motion-reduce:animate-none', !active && 'text-muted-foreground')} /> : <Check className="h-3.5 w-3.5" />}
                      </span>
                    </button>
                  );
                })}
              </div>
              <Button onClick={() => setPicking(null)} className="h-11 w-full">Done</Button>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AdminFloorTonight;
