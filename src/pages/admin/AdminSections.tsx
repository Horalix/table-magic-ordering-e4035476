import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { CalendarDays, Check, ChevronDown, Loader2, MapPin, Plus, Trash2 } from 'lucide-react';
import { AdminPageHeader, AdminToolbar } from '@/components/admin/AdminPage';
import { AdminCard, AdminCardContent, AdminCardHeader, EmptyState } from '@/components/admin/AdminCard';
import { TONE, type StaffTone } from '@/components/staff/status-tone';
import { cn } from '@/lib/utils';
import { addSectionWaiter, removeSectionAssignment, todayISO, type SectionAssignment } from '@/lib/assignments';

interface Section { id: string; name: string; color: string; sort_order: number; }
interface Waiter { id: string; display_name: string; is_active: boolean; }
interface Table { id: string; table_number: number; section_id: string | null; }

const PRESET_COLORS = ['#8FAE8B', '#D4A574', '#B85C57', '#6B8CAE', '#A87BA0', '#E0B45C', '#5C8A8A', '#C97B63'];
/** What each preset is called, for a screen reader. */
const COLOR_NAMES: Record<string, string> = {
  '#8FAE8B': 'Sage', '#D4A574': 'Sand', '#B85C57': 'Brick', '#6B8CAE': 'Blue',
  '#A87BA0': 'Mauve', '#E0B45C': 'Mustard', '#5C8A8A': 'Teal', '#C97B63': 'Terracotta',
};

const initials = (name: string) => name.split(' ').map((s) => s[0]).join('').slice(0, 2).toUpperCase();
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A state as a word with a dot, in the staff screens' colours. */
const Pill = ({ tone, children }: { tone: StaffTone; children: React.ReactNode }) => (
  <span className={cn('inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-sans font-medium', TONE[tone].chip)}>
    <span className={cn('h-1.5 w-1.5 rounded-full', TONE[tone].dot)} aria-hidden />
    {children}
  </span>
);

/** A small heading inside a section card, with a hint after it. */
const Caption = ({ children, hint }: { children: React.ReactNode; hint?: React.ReactNode }) => (
  <p className="mb-2 text-[11px] font-sans font-semibold uppercase tracking-[0.12em] text-muted-foreground">
    {children}
    {hint && <span className="ms-1.5 font-normal normal-case tracking-normal">{hint}</span>}
  </p>
);

const WaiterChip = ({ name, active, color, onClick }: { name: string; active: boolean; color: string; onClick: () => void }) => (
  <button
    type="button"
    onClick={onClick}
    className={cn(
      'inline-flex min-h-11 items-center gap-2 rounded-full border py-1 pe-3.5 ps-1 text-sm font-sans transition sm:min-h-9',
      'active:scale-95 motion-reduce:transition-none motion-reduce:active:scale-100',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card',
      active ? 'border-transparent font-medium text-white shadow-sm' : 'border-border bg-card text-foreground hover:border-foreground/30',
    )}
    style={active ? { background: color } : undefined}
    aria-pressed={active}
  >
    <span className={cn('grid h-7 w-7 place-items-center rounded-full text-[10px] font-bold', active ? 'bg-white/25 text-white' : 'bg-muted text-muted-foreground')} aria-hidden>
      {active ? <Check className="h-3.5 w-3.5" /> : initials(name)}
    </span>
    {name}
  </button>
);

const AdminSections = () => {
  const [sections, setSections] = useState<Section[]>([]);
  const [waiters, setWaiters] = useState<Waiter[]>([]);
  const [assignments, setAssignments] = useState<SectionAssignment[]>([]);
  const [tables, setTables] = useState<Table[]>([]);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(PRESET_COLORS[0]);
  const [adding, setAdding] = useState(false);
  const [date, setDate] = useState(todayISO());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const nameField = useRef<HTMLInputElement>(null);
  const formCard = useRef<HTMLDivElement>(null);

  const isToday = date === todayISO();

  const fetchAll = useCallback(async () => {
    const [s, w, a, t] = await Promise.all([
      supabase.from('sections').select('*').order('sort_order'),
      supabase.from('waiters').select('id, display_name, is_active').eq('is_active', true).order('display_name'),
      supabase.from('section_assignments').select('*').eq('shift_date', date),
      supabase.from('tables').select('id, table_number, section_id').order('table_number'),
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
    setWaiters((w.data as Waiter[]) || []);
    setAssignments((a.data as SectionAssignment[]) || []);
    setTables(t.data || []);
    setLoading(false);
  }, [date]);

  useEffect(() => { void fetchAll(); }, [fetchAll]);

  const tablesBySection = useMemo(() => {
    const map = new Map<string | 'unassigned', Table[]>();
    map.set('unassigned', []);
    sections.forEach((s) => map.set(s.id, []));
    tables.forEach((t) => {
      const key = t.section_id && map.has(t.section_id) ? t.section_id : 'unassigned';
      map.get(key)!.push(t);
    });
    return map;
  }, [sections, tables]);

  const addSection = async () => {
    if (!newName.trim()) { toast.error('Name required'); return; }
    setAdding(true);
    const { error } = await supabase.from('sections').insert({ name: newName.trim(), color: newColor, sort_order: sections.length });
    setAdding(false);
    if (error) toast.error(error.message);
    else { setNewName(''); void fetchAll(); toast.success('Section added'); }
  };

  const deleteSection = async (id: string) => {
    const { error } = await supabase.from('sections').delete().eq('id', id);
    if (error) toast.error(error.message); else { void fetchAll(); toast.success('Section deleted'); }
  };

  const setTableSection = async (tableId: string, sectionId: string | null) => {
    setTables((prev) => prev.map((t) => t.id === tableId ? { ...t, section_id: sectionId } : t));
    const { error } = await supabase.from('tables').update({ section_id: sectionId }).eq('id', tableId);
    if (error) { toast.error(error.message); void fetchAll(); }
  };

  // One tap toggles a waiter on/off for the section (multiple allowed).
  const toggleWaiter = async (sectionId: string, waiterId: string) => {
    const existing = assignments.find((a) => a.section_id === sectionId && a.waiter_id === waiterId) ?? null;
    setAssignments((prev) => existing
      ? prev.filter((a) => a.id !== existing.id)
      : [...prev, { id: `tmp-${sectionId}-${waiterId}`, section_id: sectionId, waiter_id: waiterId, shift_date: date }]);
    const { error } = existing
      ? await removeSectionAssignment(existing.id)
      : await addSectionWaiter(sectionId, waiterId, date);
    if (error) toast.error(error);
    void fetchAll();
  };

  /** On a phone the form is under the sections: take them to it, ready to type. */
  const goToForm = () => {
    formCard.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    nameField.current?.focus({ preventScroll: true });
  };

  const TableChip = ({ table }: { table: Table }) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Move table ${table.table_number}`}
          className={cn(
            'group inline-flex min-h-11 min-w-[3.25rem] items-center justify-center gap-1 rounded-xl border border-border bg-card px-3 text-sm font-sans transition sm:min-h-10',
            'hover:border-foreground/30 hover:bg-muted/40 active:scale-95 motion-reduce:transition-none motion-reduce:active:scale-100',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:border-primary data-[state=open]:bg-primary/5',
          )}
        >
          <span className="font-serif text-base font-bold tabular-nums text-foreground">{table.table_number}</span>
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground transition-colors group-hover:text-foreground" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>Move table {table.table_number} to…</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {sections.map((s) => (
          <DropdownMenuItem key={s.id} disabled={s.id === table.section_id} onClick={() => setTableSection(table.id, s.id)} className="min-h-11 gap-2 sm:min-h-9">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: s.color }} aria-hidden />
            <span className="flex-1 truncate">{s.name}</span>
            {s.id === table.section_id && <span className="text-xs text-muted-foreground">current</span>}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={!table.section_id} onClick={() => setTableSection(table.id, null)} className="min-h-11 sm:min-h-9">
          Unassign
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const unassigned = tablesBySection.get('unassigned') ?? [];
  const unassignedCount = unassigned.length;
  const ready = !loading && !loadError;
  const dayWords = isToday
    ? 'today'
    : new Date(date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

  const facts = ready && sections.length > 0 && (
    <AdminToolbar className="gap-x-3 gap-y-2 text-sm font-sans text-muted-foreground">
      <span className="tabular-nums">{plural(sections.length, 'section')} · {plural(tables.length, 'table')}</span>
      {unassignedCount > 0 ? (
        <Pill tone="preparing">{unassignedCount === 1 ? '1 table is not in a section' : `${unassignedCount} tables are not in a section`}</Pill>
      ) : tables.length > 0 ? (
        <Pill tone="ready">Every table is in a section</Pill>
      ) : null}
    </AdminToolbar>
  );

  const addForm = (
    <AdminCard ref={formCard} className="scroll-mt-20">
      <AdminCardHeader icon={Plus} title="Add a section" description="An area of the floor, like Terrace or Bar. Its colour shows on the waiter’s phone and the floor monitor." />
      <AdminCardContent>
        <form onSubmit={(e) => { e.preventDefault(); void addSection(); }} className="space-y-4">
          <div>
            <Label htmlFor="section-name" className="font-sans text-sm">Name</Label>
            <div className="relative mt-1.5">
              <span className="pointer-events-none absolute start-3 top-1/2 h-3 w-3 -translate-y-1/2 rounded-full" style={{ background: newColor }} aria-hidden />
              <Input
                id="section-name"
                ref={nameField}
                placeholder="e.g. Terrace, Bar, Garden"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                autoComplete="off"
                className="h-11 ps-8"
              />
            </div>
          </div>
          <div>
            <p id="section-colour" className="font-sans text-sm font-medium">Colour</p>
            <div role="radiogroup" aria-labelledby="section-colour" className="mt-1.5 grid grid-cols-4 gap-1 sm:grid-cols-8">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={newColor === c}
                  aria-label={COLOR_NAMES[c] ?? c}
                  onClick={() => setNewColor(c)}
                  className={cn(
                    'grid h-11 w-full place-items-center rounded-xl transition sm:h-10',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card',
                    newColor === c ? 'bg-muted' : 'hover:bg-muted/60',
                  )}
                >
                  <span
                    className={cn('grid h-8 w-8 place-items-center rounded-full text-white sm:h-7 sm:w-7', newColor === c && 'ring-2 ring-foreground/60 ring-offset-2 ring-offset-muted')}
                    style={{ background: c }}
                    aria-hidden
                  >
                    {newColor === c && <Check className="h-4 w-4" />}
                  </span>
                </button>
              ))}
            </div>
          </div>
          <Button type="submit" disabled={adding} className="h-11 w-full gap-2 sm:w-auto lg:w-full">
            {adding ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />}
            Add section
          </Button>
        </form>
      </AdminCardContent>
    </AdminCard>
  );

  return (
    <div className="mx-auto w-full max-w-6xl">
      <AdminPageHeader
        title="Floor sections"
        description="Group your tables into areas of the floor, and choose who covers each one. Tables go to that area’s waiter when guests sit down."
        actions={(
          <>
            {!isToday && (
              <Button variant="outline" onClick={() => setDate(todayISO())} className="h-11 sm:h-10">
                Back to today
              </Button>
            )}
            <label className="flex items-center gap-2 text-sm font-sans text-muted-foreground">
              <CalendarDays className="hidden h-4 w-4 sm:block" aria-hidden />
              <span className="hidden sm:inline">Waiters for</span>
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="h-11 w-auto min-w-[10rem] text-foreground sm:h-10"
                aria-label="Shift date"
              />
            </label>
            <Button onClick={goToForm} className="h-11 gap-2 lg:hidden">
              <Plus className="h-4 w-4" aria-hidden /> Add section
            </Button>
          </>
        )}
      >
        {facts}
      </AdminPageHeader>

      {loading ? (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]" aria-busy="true" aria-label="Loading the floor plan">
          <div className="space-y-4">{[1, 2].map((i) => <Skeleton key={i} className="h-52 w-full rounded-2xl" />)}</div>
          <Skeleton className="h-72 w-full rounded-2xl" />
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
      ) : (
        // auto then 1fr: the sections' height goes to the second row, so the
        // form sits right under the unassigned tables, not a screen below.
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:grid-rows-[auto_1fr]">
          {/* Tables in no section: what needs doing, so first on a phone and
              top right on a laptop. */}
          {sections.length > 0 && unassignedCount > 0 && (
            <AdminCard className={cn('min-w-0 lg:col-start-2 lg:row-start-1', TONE.preparing.border)}>
              <AdminCardHeader
                title="Unassigned tables"
                description={`${plural(unassignedCount, 'table')} in no section. Tap one to move it into a section.`}
              />
              <AdminCardContent>
                <div className="flex flex-wrap gap-2">{unassigned.map((t) => <TableChip key={t.id} table={t} />)}</div>
              </AdminCardContent>
            </AdminCard>
          )}

          <div className="min-w-0 space-y-4 lg:col-start-1 lg:row-span-2 lg:row-start-1">
            {sections.length === 0 ? (
              <AdminCard>
                <EmptyState
                  icon={MapPin}
                  tone="primary"
                  title="No sections yet"
                  hint="Sections group your tables so each waiter can cover an area. Add the first one to get started."
                />
              </AdminCard>
            ) : sections.map((s) => {
              const sectionTables = tablesBySection.get(s.id) || [];
              const covering = waiters.filter((w) => assignments.some((x) => x.section_id === s.id && x.waiter_id === w.id));
              const needsWaiter = sectionTables.length > 0 && covering.length === 0;
              return (
                <AdminCard key={s.id} className="relative overflow-hidden">
                  <span className="absolute inset-y-0 start-0 w-1.5" style={{ background: s.color }} aria-hidden />
                  <div className="flex items-start gap-3 px-5 pt-4 ps-6 sm:px-6 sm:pt-5 sm:ps-7">
                    <div className="min-w-0 flex-1 pt-1">
                      <h2 className="truncate font-serif text-lg font-semibold leading-snug text-foreground">{s.name}</h2>
                      <p className="mt-0.5 text-xs font-sans text-muted-foreground tabular-nums">
                        {plural(sectionTables.length, 'table')}
                        {covering.length > 0 && <> · {covering.map((w) => w.display_name.split(' ')[0]).join(', ')} {dayWords}</>}
                      </p>
                    </div>
                    {needsWaiter && <span className="pt-1.5"><Pill tone="preparing">Needs a waiter</Pill></span>}
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Delete section ${s.name}`}
                          className="-me-2 h-11 w-11 shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive sm:h-10 sm:w-10"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent className="max-w-[calc(100vw-2rem)] rounded-2xl sm:max-w-md">
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete “{s.name}”?</AlertDialogTitle>
                          <AlertDialogDescription>
                            {sectionTables.length > 0
                              ? `Its ${plural(sectionTables.length, 'table')} (${sectionTables.map((t) => t.table_number).join(', ')}) become unassigned; they are not deleted.`
                              : 'Its tables become unassigned (they are not deleted).'}
                            {' '}This cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => deleteSection(s.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>

                  <div className="space-y-5 px-5 pb-5 pt-4 ps-6 sm:px-6 sm:pb-6 sm:ps-7">
                    {/* Tables in this section */}
                    <div>
                      <Caption hint="tap one to move it">Tables</Caption>
                      {sectionTables.length === 0 ? (
                        <p className="rounded-xl bg-muted/50 px-4 py-3 text-sm font-sans text-muted-foreground">No tables here yet — move some from Unassigned tables or another section.</p>
                      ) : (
                        <div className="flex flex-wrap gap-2">{sectionTables.map((t) => <TableChip key={t.id} table={t} />)}</div>
                      )}
                    </div>

                    {/* Waiter chips — tap to add/remove (multiple allowed) */}
                    <div>
                      <Caption hint="tap to add one or more">Waiters {dayWords}</Caption>
                      {waiters.length === 0 ? (
                        <p className="text-sm text-muted-foreground font-sans">No active waiters. Add them under <span className="font-medium">Waiters</span>.</p>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {waiters.map((w) => (
                            <WaiterChip key={w.id} name={w.display_name} color={s.color} active={assignments.some((x) => x.section_id === s.id && x.waiter_id === w.id)} onClick={() => toggleWaiter(s.id, w.id)} />
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </AdminCard>
              );
            })}
          </div>

          <div className={cn('min-w-0 lg:col-start-2', sections.length > 0 && unassignedCount > 0 ? 'lg:row-start-2' : 'lg:row-start-1')}>
            {addForm}
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminSections;
