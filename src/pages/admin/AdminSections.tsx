import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import { Plus, Trash2, ChevronDown, MapPin, Users2, AlertTriangle, CalendarDays } from 'lucide-react';
import { setSectionWaiter, todayISO, type SectionAssignment } from '@/lib/assignments';

interface Section { id: string; name: string; color: string; sort_order: number; }
interface Waiter { id: string; display_name: string; is_active: boolean; }
interface Table { id: string; table_number: number; section_id: string | null; }

const PRESET_COLORS = ['#8FAE8B', '#D4A574', '#B85C57', '#6B8CAE', '#A87BA0', '#E0B45C', '#5C8A8A', '#C97B63'];

const initials = (name: string) => name.split(' ').map((s) => s[0]).join('').slice(0, 2).toUpperCase();

const WaiterChip = ({ name, active, color, onClick }: { name: string; active: boolean; color: string; onClick: () => void }) => (
  <button
    type="button"
    onClick={onClick}
    className={`inline-flex items-center gap-1.5 pl-1 pr-3 py-1 rounded-full border text-sm font-sans transition-all active:scale-95 ${
      active ? 'text-white border-transparent shadow-sm' : 'bg-card border-border hover:border-primary text-foreground'
    }`}
    style={active ? { background: color } : undefined}
    aria-pressed={active}
  >
    <span className={`w-5 h-5 rounded-full grid place-items-center text-[10px] font-bold ${active ? 'bg-white/25 text-white' : 'bg-primary/10 text-primary'}`}>
      {initials(name)}
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
  const [date, setDate] = useState(todayISO());
  const [loading, setLoading] = useState(true);

  const isToday = date === todayISO();

  const fetchAll = useCallback(async () => {
    const [s, w, a, t] = await Promise.all([
      supabase.from('sections').select('*').order('sort_order'),
      supabase.from('waiters').select('id, display_name, is_active').eq('is_active', true).order('display_name'),
      supabase.from('section_assignments').select('*').eq('shift_date', date),
      supabase.from('tables').select('id, table_number, section_id').order('table_number'),
    ]);
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
    const { error } = await supabase.from('sections').insert({ name: newName.trim(), color: newColor, sort_order: sections.length });
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

  // One tap: assign / reassign / clear the section's waiter.
  const assign = async (sectionId: string, waiterId: string | null) => {
    const existing = assignments.find((a) => a.section_id === sectionId) ?? null;
    setAssignments((prev) => {
      const others = prev.filter((a) => a.section_id !== sectionId);
      return waiterId ? [...others, { id: existing?.id ?? `tmp-${sectionId}`, section_id: sectionId, waiter_id: waiterId, shift_date: date }] : others;
    });
    const { error } = await setSectionWaiter(sectionId, waiterId, date, existing);
    if (error) toast.error(error);
    void fetchAll();
  };

  const TableChip = ({ table }: { table: Table }) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="group inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-card border border-border hover:border-primary hover:bg-accent/30 transition-all text-sm font-sans active:scale-95">
          <span className="font-serif font-bold text-foreground">{table.table_number}</span>
          <ChevronDown className="w-3 h-3 text-muted-foreground group-hover:text-foreground transition-colors" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        <DropdownMenuLabel>Move table {table.table_number} to…</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {sections.map((s) => (
          <DropdownMenuItem key={s.id} disabled={s.id === table.section_id} onClick={() => setTableSection(table.id, s.id)} className="gap-2">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: s.color }} />
            <span className="flex-1">{s.name}</span>
            {s.id === table.section_id && <span className="text-xs text-muted-foreground">current</span>}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={!table.section_id} onClick={() => setTableSection(table.id, null)} className="text-destructive focus:text-destructive">
          Unassign
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const unassignedCount = tablesBySection.get('unassigned')?.length || 0;

  return (
    <div className="max-w-5xl">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
        <div>
          <h1 className="font-serif text-3xl font-bold text-foreground">Sections & Waiters</h1>
          <p className="text-sm font-sans text-muted-foreground mt-1">Group tables into sections, then tap a waiter to assign them. Tables auto-route to the assigned waiter when guests sit down.</p>
        </div>
        {/* Shift control — today by default, other days tucked away */}
        <div className="flex items-center gap-2">
          {isToday ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary/10 text-primary text-sm font-sans font-medium">
              <CalendarDays className="w-4 h-4" /> Today
            </span>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setDate(todayISO())} className="gap-1.5">
              <CalendarDays className="w-4 h-4" /> Back to today
            </Button>
          )}
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-9 w-[150px]" aria-label="Shift date" />
        </div>
      </div>

      {/* Create section */}
      <Card className="mb-6 border-dashed">
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-3 items-center">
            <Input placeholder="New section name (e.g. Terrace, Bar, Garden)" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addSection()} className="flex-1 min-w-[220px]" />
            <div className="flex items-center gap-1 p-1 rounded-md border border-border bg-background">
              {PRESET_COLORS.map((c) => (
                <button key={c} onClick={() => setNewColor(c)} className={`w-6 h-6 rounded transition-transform ${newColor === c ? 'ring-2 ring-foreground ring-offset-1 ring-offset-background scale-110' : 'hover:scale-110'}`} style={{ background: c }} aria-label={`Color ${c}`} />
              ))}
            </div>
            <Button onClick={addSection}><Plus className="w-4 h-4 mr-1" /> Add section</Button>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <div className="space-y-4">{[1, 2].map((i) => <Skeleton key={i} className="h-44 w-full rounded-xl" />)}</div>
      ) : sections.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center">
            <MapPin className="w-10 h-10 mx-auto text-muted-foreground/40 mb-3" />
            <p className="font-serif text-lg font-semibold text-foreground">No sections yet</p>
            <p className="font-sans text-muted-foreground text-sm mt-1">Sections group your tables so each waiter can cover an area. Create one above to get started.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {sections.map((s) => {
            const a = assignments.find((x) => x.section_id === s.id);
            const sectionTables = tablesBySection.get(s.id) || [];
            const needsWaiter = sectionTables.length > 0 && !a;
            return (
              <Card key={s.id} className="overflow-hidden card-lux-hover">
                <div className="h-1.5" style={{ background: s.color }} />
                <CardContent className="p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="w-9 h-9 rounded-lg shrink-0 grid place-items-center text-white font-serif font-bold" style={{ background: s.color }}>{s.name.charAt(0).toUpperCase()}</span>
                      <div className="min-w-0">
                        <h3 className="font-serif text-lg font-bold text-foreground truncate">{s.name}</h3>
                        <div className="flex items-center gap-3 text-xs font-sans text-muted-foreground">
                          <span className="flex items-center gap-1"><Users2 className="w-3 h-3" />{sectionTables.length} {sectionTables.length === 1 ? 'table' : 'tables'}</span>
                          {needsWaiter && <span className="flex items-center gap-1 text-amber-600"><AlertTriangle className="w-3 h-3" />Needs a waiter</span>}
                        </div>
                      </div>
                    </div>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="icon" aria-label={`Delete section ${s.name}`}><Trash2 className="w-4 h-4 text-destructive" /></Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete “{s.name}”?</AlertDialogTitle>
                          <AlertDialogDescription>Its tables become unassigned (they are not deleted). This cannot be undone.</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => deleteSection(s.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>

                  {/* Waiter chips — one tap to assign */}
                  <div className="mb-4">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-sans mb-2">Waiter {isToday ? 'today' : `· ${date}`}</p>
                    {waiters.length === 0 ? (
                      <p className="text-sm text-muted-foreground font-sans">No active waiters. Add them under <span className="font-medium">Waiters</span>.</p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {waiters.map((w) => (
                          <WaiterChip key={w.id} name={w.display_name} color={s.color} active={a?.waiter_id === w.id} onClick={() => assign(s.id, a?.waiter_id === w.id ? null : w.id)} />
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Tables in this section */}
                  {sectionTables.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">No tables here yet — move some from the pool below.</div>
                  ) : (
                    <div className="flex flex-wrap gap-2">{sectionTables.map((t) => <TableChip key={t.id} table={t} />)}</div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {sections.length > 0 && (
        <Card className="mt-6 bg-muted/30">
          <CardContent className="p-5">
            <div className="flex items-center gap-2 mb-3">
              <h3 className="font-serif text-base font-bold text-foreground">Unassigned tables</h3>
              <span className="text-xs font-sans text-muted-foreground">{unassignedCount} {unassignedCount === 1 ? 'table' : 'tables'}</span>
            </div>
            {unassignedCount === 0 ? (
              <p className="text-sm font-sans text-muted-foreground">All tables are assigned to a section.</p>
            ) : (
              <div className="flex flex-wrap gap-2">{tablesBySection.get('unassigned')!.map((t) => <TableChip key={t.id} table={t} />)}</div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default AdminSections;
