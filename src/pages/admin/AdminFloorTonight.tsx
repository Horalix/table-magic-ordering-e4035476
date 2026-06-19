import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CalendarDays, UserPlus, Check, Users2, MapPin, Plus, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { setSectionWaiter, todayISO, type SectionAssignment } from '@/lib/assignments';

interface Section { id: string; name: string; color: string; sort_order: number; }
interface Waiter { id: string; display_name: string; }
interface Table { id: string; section_id: string | null; }

const initials = (name: string) => name.split(' ').map((s) => s[0]).join('').slice(0, 2).toUpperCase();

const AdminFloorTonight = () => {
  const [sections, setSections] = useState<Section[]>([]);
  const [waiters, setWaiters] = useState<Waiter[]>([]);
  const [assignments, setAssignments] = useState<SectionAssignment[]>([]);
  const [tables, setTables] = useState<Table[]>([]);
  const [date, setDate] = useState(todayISO());
  const [loading, setLoading] = useState(true);
  const [picking, setPicking] = useState<Section | null>(null);

  const isToday = date === todayISO();

  const fetchAll = useCallback(async () => {
    const [s, w, a, t] = await Promise.all([
      supabase.from('sections').select('*').order('sort_order'),
      supabase.from('waiters').select('id, display_name').eq('is_active', true).order('display_name'),
      supabase.from('section_assignments').select('*').eq('shift_date', date),
      supabase.from('tables').select('id, section_id'),
    ]);
    setSections(s.data || []);
    setWaiters((w.data as Waiter[]) || []);
    setAssignments((a.data as SectionAssignment[]) || []);
    setTables(t.data || []);
    setLoading(false);
  }, [date]);

  useEffect(() => {
    void fetchAll();
    const ch = supabase
      .channel('tonight')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'section_assignments' }, () => { void fetchAll(); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [fetchAll]);

  const tableCount = useMemo(() => {
    const m = new Map<string, number>();
    tables.forEach((t) => { if (t.section_id) m.set(t.section_id, (m.get(t.section_id) || 0) + 1); });
    return m;
  }, [tables]);

  const waiterById = useMemo(() => Object.fromEntries(waiters.map((w) => [w.id, w])), [waiters]);

  const assign = async (section: Section, waiterId: string | null) => {
    const existing = assignments.find((a) => a.section_id === section.id) ?? null;
    setAssignments((prev) => {
      const others = prev.filter((a) => a.section_id !== section.id);
      return waiterId ? [...others, { id: existing?.id ?? `tmp-${section.id}`, section_id: section.id, waiter_id: waiterId, shift_date: date }] : others;
    });
    setPicking(null);
    const { error } = await setSectionWaiter(section.id, waiterId, date, existing);
    if (error) toast.error(error);
    void fetchAll();
  };

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <h1 className="font-serif text-3xl font-bold text-foreground">Tonight’s Floor</h1>
          <p className="text-sm font-sans text-muted-foreground mt-1">Tap a section to set who’s covering it. That’s it — tables route to that waiter automatically.</p>
        </div>
        <div className="flex items-center gap-2">
          {!isToday && <Button variant="outline" size="sm" onClick={() => setDate(todayISO())} className="gap-1.5"><CalendarDays className="w-4 h-4" /> Back to today</Button>}
          <span className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary/10 text-primary text-sm font-sans font-medium">
            <CalendarDays className="w-4 h-4" />
            {new Date(date + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}
          </span>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-36 rounded-2xl" />)}
        </div>
      ) : sections.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-14 text-center">
            <MapPin className="w-10 h-10 mx-auto text-muted-foreground/40 mb-3" />
            <p className="font-serif text-lg font-semibold text-foreground">No sections to assign yet</p>
            <p className="text-sm font-sans text-muted-foreground mt-1 mb-4">Create sections and group your tables first.</p>
            <Button asChild><Link to="/admin/sections"><Plus className="w-4 h-4 mr-1" /> Set up sections</Link></Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {sections.map((s) => {
            const a = assignments.find((x) => x.section_id === s.id);
            const waiter = a ? waiterById[a.waiter_id] : null;
            const count = tableCount.get(s.id) || 0;
            const needsWaiter = count > 0 && !waiter;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setPicking(s)}
                className="text-left rounded-2xl overflow-hidden border border-border bg-card shadow-lux card-lux-hover active:scale-[0.99] transition-all"
              >
                <div className="h-2" style={{ background: s.color }} />
                <div className="p-5">
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <h3 className="font-serif text-xl font-bold text-foreground truncate">{s.name}</h3>
                    <span className="text-xs font-sans text-muted-foreground flex items-center gap-1 shrink-0"><Users2 className="w-3.5 h-3.5" />{count}</span>
                  </div>
                  {waiter ? (
                    <div className="flex items-center gap-2.5">
                      <span className="w-10 h-10 rounded-full grid place-items-center text-white font-bold text-sm shrink-0" style={{ background: s.color }}>{initials(waiter.display_name)}</span>
                      <div className="min-w-0">
                        <p className="font-sans font-semibold text-foreground truncate">{waiter.display_name}</p>
                        <p className="text-xs text-muted-foreground font-sans">Covering this section</p>
                      </div>
                    </div>
                  ) : (
                    <div className={`flex items-center gap-2 text-sm font-sans ${needsWaiter ? 'text-amber-600' : 'text-muted-foreground'}`}>
                      {needsWaiter ? <AlertTriangle className="w-4 h-4" /> : <UserPlus className="w-4 h-4" />}
                      {needsWaiter ? 'Needs a waiter — tap to assign' : 'Tap to assign a waiter'}
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Quick picker */}
      <Dialog open={!!picking} onOpenChange={(o) => { if (!o) setPicking(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-serif flex items-center gap-2">
              {picking && <span className="w-3 h-3 rounded-full" style={{ background: picking.color }} />}
              {picking?.name}
            </DialogTitle>
          </DialogHeader>
          {waiters.length === 0 ? (
            <p className="text-sm text-muted-foreground font-sans py-2">No active waiters. Add them under <Link to="/admin/waiters" className="text-primary underline">Waiters</Link>.</p>
          ) : (
            <div className="space-y-2 max-h-[55vh] overflow-y-auto">
              {picking && waiters.map((w) => {
                const active = assignments.find((x) => x.section_id === picking.id)?.waiter_id === w.id;
                return (
                  <button
                    key={w.id}
                    type="button"
                    onClick={() => assign(picking, active ? null : w.id)}
                    className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl border transition-all active:scale-[0.98] min-h-[56px] ${active ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50'}`}
                  >
                    <span className="w-9 h-9 rounded-full grid place-items-center text-white font-bold text-xs shrink-0" style={{ background: picking.color }}>{initials(w.display_name)}</span>
                    <span className="flex-1 text-left font-sans font-medium text-foreground">{w.display_name}</span>
                    {active && <Check className="w-5 h-5 text-primary" />}
                  </button>
                );
              })}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AdminFloorTonight;
