import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import {
  Plus, Trash2, UserCircle2, Calendar, ChevronDown, MapPin, Users2,
} from 'lucide-react';

interface Section { id: string; name: string; color: string; sort_order: number; }
interface Waiter { id: string; display_name: string; is_active: boolean; }
interface Assignment { id: string; section_id: string; waiter_id: string; shift_date: string; }
interface Table { id: string; table_number: number; section_id: string | null; }

const today = () => new Date().toISOString().split('T')[0];

const PRESET_COLORS = [
  '#8FAE8B', '#D4A574', '#B85C57', '#6B8CAE',
  '#A87BA0', '#E0B45C', '#5C8A8A', '#C97B63',
];

const AdminSections = () => {
  const [sections, setSections] = useState<Section[]>([]);
  const [waiters, setWaiters] = useState<Waiter[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [tables, setTables] = useState<Table[]>([]);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(PRESET_COLORS[0]);
  const [date, setDate] = useState(today());
  const [loading, setLoading] = useState(true);

  const fetchAll = async () => {
    const [s, w, a, t] = await Promise.all([
      supabase.from('sections').select('*').order('sort_order'),
      supabase.from('waiters').select('*').eq('is_active', true).order('display_name'),
      supabase.from('section_assignments').select('*').eq('shift_date', date),
      supabase.from('tables').select('id, table_number, section_id').order('table_number'),
    ]);
    setSections(s.data || []);
    setWaiters(w.data || []);
    setAssignments(a.data || []);
    setTables(t.data || []);
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, [date]);

  const tablesBySection = useMemo(() => {
    const map = new Map<string | 'unassigned', Table[]>();
    map.set('unassigned', []);
    sections.forEach(s => map.set(s.id, []));
    tables.forEach(t => {
      const key = t.section_id && map.has(t.section_id) ? t.section_id : 'unassigned';
      map.get(key)!.push(t);
    });
    return map;
  }, [sections, tables]);

  const addSection = async () => {
    if (!newName.trim()) { toast.error('Name required'); return; }
    const { error } = await supabase.from('sections').insert({
      name: newName.trim(), color: newColor, sort_order: sections.length,
    });
    if (error) toast.error(error.message);
    else { setNewName(''); fetchAll(); toast.success('Section added'); }
  };

  const deleteSection = async (id: string, name: string) => {
    if (!confirm(`Delete "${name}"? Its tables will become unassigned.`)) return;
    const { error } = await supabase.from('sections').delete().eq('id', id);
    if (error) toast.error(error.message); else { fetchAll(); toast.success('Section deleted'); }
  };

  const setTableSection = async (tableId: string, sectionId: string | null) => {
    setTables(prev => prev.map(t => t.id === tableId ? { ...t, section_id: sectionId } : t));
    const { error } = await supabase.from('tables').update({ section_id: sectionId }).eq('id', tableId);
    if (error) { toast.error(error.message); fetchAll(); }
  };

  const setSectionWaiter = async (sectionId: string, waiterId: string | null) => {
    const existing = assignments.find(a => a.section_id === sectionId);
    if (!waiterId) {
      if (existing) await supabase.from('section_assignments').delete().eq('id', existing.id);
    } else if (existing) {
      await supabase.from('section_assignments').update({ waiter_id: waiterId }).eq('id', existing.id);
    } else {
      await supabase.from('section_assignments').insert({ section_id: sectionId, waiter_id: waiterId, shift_date: date });
    }
    fetchAll();
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
        {sections.map(s => (
          <DropdownMenuItem
            key={s.id}
            disabled={s.id === table.section_id}
            onClick={() => setTableSection(table.id, s.id)}
            className="gap-2"
          >
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: s.color }} />
            <span className="flex-1">{s.name}</span>
            {s.id === table.section_id && <span className="text-xs text-muted-foreground">current</span>}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={!table.section_id}
          onClick={() => setTableSection(table.id, null)}
          className="text-destructive focus:text-destructive"
        >
          Unassign
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const unassignedCount = tablesBySection.get('unassigned')?.length || 0;

  return (
    <div className="max-w-5xl">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
        <div>
          <h1 className="font-serif text-3xl font-bold text-foreground">Sections & Shifts</h1>
          <p className="text-sm font-sans text-muted-foreground mt-1">
            Group tables into sections, then assign a waiter per shift.
          </p>
        </div>
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-card border border-border">
          <Calendar className="w-4 h-4 text-muted-foreground" />
          <label className="text-xs font-sans text-muted-foreground uppercase tracking-wide">Shift</label>
          <Input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="border-0 h-7 px-1 w-[140px] focus-visible:ring-0"
          />
        </div>
      </div>

      {/* Create section */}
      <Card className="mb-6 border-dashed">
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-3 items-center">
            <Input
              placeholder="New section name (e.g. Terrace, Bar, Garden)"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addSection()}
              className="flex-1 min-w-[220px]"
            />
            <div className="flex items-center gap-1 p-1 rounded-md border border-border bg-background">
              {PRESET_COLORS.map(c => (
                <button
                  key={c}
                  onClick={() => setNewColor(c)}
                  className={`w-6 h-6 rounded transition-transform ${newColor === c ? 'ring-2 ring-foreground ring-offset-1 ring-offset-background scale-110' : 'hover:scale-110'}`}
                  style={{ background: c }}
                  aria-label={`Color ${c}`}
                />
              ))}
            </div>
            <Button onClick={addSection}><Plus className="w-4 h-4 mr-1" /> Add section</Button>
          </div>
        </CardContent>
      </Card>

      {/* Sections list */}
      {loading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : sections.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <MapPin className="w-10 h-10 mx-auto text-muted-foreground/40 mb-3" />
            <p className="font-sans text-muted-foreground">No sections yet. Create one above to get started.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {sections.map((s) => {
            const a = assignments.find(x => x.section_id === s.id);
            const waiter = waiters.find(w => w.id === a?.waiter_id);
            const sectionTables = tablesBySection.get(s.id) || [];
            return (
              <Card key={s.id} className="overflow-hidden">
                {/* Color stripe */}
                <div className="h-1.5" style={{ background: s.color }} />
                <CardContent className="p-5">
                  {/* Section header */}
                  <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <span
                        className="w-9 h-9 rounded-lg shrink-0 flex items-center justify-center text-white font-serif font-bold"
                        style={{ background: s.color }}
                      >
                        {s.name.charAt(0).toUpperCase()}
                      </span>
                      <div className="min-w-0">
                        <h3 className="font-serif text-lg font-bold text-foreground truncate">{s.name}</h3>
                        <div className="flex items-center gap-3 text-xs font-sans text-muted-foreground">
                          <span className="flex items-center gap-1"><Users2 className="w-3 h-3" />{sectionTables.length} {sectionTables.length === 1 ? 'table' : 'tables'}</span>
                          {waiter ? (
                            <span className="flex items-center gap-1 text-foreground/80"><UserCircle2 className="w-3 h-3" />{waiter.display_name}</span>
                          ) : (
                            <span className="flex items-center gap-1 text-amber-600"><UserCircle2 className="w-3 h-3" />No waiter assigned</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Select
                        value={a?.waiter_id || 'none'}
                        onValueChange={(v) => setSectionWaiter(s.id, v === 'none' ? null : v)}
                      >
                        <SelectTrigger className="h-9 w-[200px]"><SelectValue placeholder="Assign waiter" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">— No waiter —</SelectItem>
                          {waiters.map(w => <SelectItem key={w.id} value={w.id}>{w.display_name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <Button variant="ghost" size="icon" onClick={() => deleteSection(s.id, s.name)}>
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </div>
                  </div>

                  {/* Tables in this section */}
                  {sectionTables.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                      No tables here yet — assign some from below.
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {sectionTables.map(t => <TableChip key={t.id} table={t} />)}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Unassigned tables pool */}
      {sections.length > 0 && (
        <Card className="mt-6 bg-muted/30">
          <CardContent className="p-5">
            <div className="flex items-center gap-2 mb-3">
              <h3 className="font-serif text-base font-bold text-foreground">Unassigned tables</h3>
              <span className="text-xs font-sans text-muted-foreground">
                {unassignedCount} {unassignedCount === 1 ? 'table' : 'tables'}
              </span>
            </div>
            {unassignedCount === 0 ? (
              <p className="text-sm font-sans text-muted-foreground">All tables are assigned to a section. ✓</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {tablesBySection.get('unassigned')!.map(t => <TableChip key={t.id} table={t} />)}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default AdminSections;
