import React, { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Plus, Trash2, Users } from 'lucide-react';

interface Section { id: string; name: string; color: string; sort_order: number; }
interface Waiter { id: string; display_name: string; is_active: boolean; }
interface Assignment { id: string; section_id: string; waiter_id: string; shift_date: string; }
interface Table { id: string; table_number: number; section_id: string | null; }

const today = () => new Date().toISOString().split('T')[0];

const AdminSections = () => {
  const [sections, setSections] = useState<Section[]>([]);
  const [waiters, setWaiters] = useState<Waiter[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [tables, setTables] = useState<Table[]>([]);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState('#8FAE8B');
  const [date, setDate] = useState(today());

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
  };

  useEffect(() => { fetchAll(); }, [date]);

  const addSection = async () => {
    if (!newName.trim()) return;
    const { error } = await supabase.from('sections').insert({
      name: newName.trim(),
      color: newColor,
      sort_order: sections.length,
    });
    if (error) toast.error(error.message);
    else { setNewName(''); fetchAll(); toast.success('Section added'); }
  };

  const deleteSection = async (id: string) => {
    if (!confirm('Delete this section? Tables in it will become unassigned.')) return;
    const { error } = await supabase.from('sections').delete().eq('id', id);
    if (error) toast.error(error.message); else fetchAll();
  };

  const setTableSection = async (tableId: string, sectionId: string | null) => {
    const { error } = await supabase.from('tables').update({ section_id: sectionId }).eq('id', tableId);
    if (error) toast.error(error.message); else fetchAll();
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

  return (
    <div>
      <h1 className="font-serif text-3xl font-bold text-foreground mb-6">Sections & Shifts</h1>

      <Card className="mb-6">
        <CardHeader><CardTitle className="font-serif text-lg">Create Section</CardTitle></CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2 items-center">
            <Input placeholder="Section name (e.g. Terrace)" value={newName} onChange={(e) => setNewName(e.target.value)} className="max-w-xs" />
            <input type="color" value={newColor} onChange={(e) => setNewColor(e.target.value)} className="h-10 w-14 rounded border border-border cursor-pointer" />
            <Button onClick={addSection}><Plus className="w-4 h-4 mr-1" /> Add</Button>
          </div>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="font-serif text-lg flex items-center gap-2">
            <Users className="w-5 h-5" />
            Shift Assignments
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3 mb-4">
            <label className="text-sm font-sans text-muted-foreground">Date</label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="max-w-[180px]" />
          </div>
          {sections.length === 0 ? (
            <p className="text-sm font-sans text-muted-foreground">Create a section first.</p>
          ) : (
            <div className="space-y-3">
              {sections.map((s) => {
                const a = assignments.find(x => x.section_id === s.id);
                return (
                  <div key={s.id} className="flex items-center gap-3 p-3 rounded-lg border border-border">
                    <span className="w-3 h-3 rounded-full" style={{ background: s.color }} />
                    <span className="font-sans font-medium flex-1">{s.name}</span>
                    <Select value={a?.waiter_id || 'none'} onValueChange={(v) => setSectionWaiter(s.id, v === 'none' ? null : v)}>
                      <SelectTrigger className="max-w-[220px]"><SelectValue placeholder="Assign waiter" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">— None —</SelectItem>
                        {waiters.map(w => <SelectItem key={w.id} value={w.id}>{w.display_name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Button variant="ghost" size="icon" onClick={() => deleteSection(s.id)}>
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="font-serif text-lg">Assign Tables to Sections</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
            {tables.map(tbl => (
              <div key={tbl.id} className="flex items-center gap-2 p-2 rounded border border-border">
                <span className="font-serif font-bold w-8">{tbl.table_number}</span>
                <Select value={tbl.section_id || 'none'} onValueChange={(v) => setTableSection(tbl.id, v === 'none' ? null : v)}>
                  <SelectTrigger className="flex-1 h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— None —</SelectItem>
                    {sections.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default AdminSections;
