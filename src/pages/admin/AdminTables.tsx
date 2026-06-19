import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Plus, QrCode, PowerOff, Clock, Trash2, LayoutGrid } from 'lucide-react';
import { toast } from 'sonner';
import { QRCodeSVG } from 'qrcode.react';
import { useElapsed, formatDuration } from '@/lib/timing';
import type { Database } from '@/integrations/supabase/types';

type Section = Pick<Database['public']['Tables']['sections']['Row'], 'id' | 'name' | 'color'>;
type TableRow = Database['public']['Tables']['tables']['Row'] & {
  sections?: Pick<Database['public']['Tables']['sections']['Row'], 'name' | 'color'> | null;
  table_sessions?: Pick<Database['public']['Tables']['table_sessions']['Row'], 'id' | 'is_active' | 'opened_at' | 'guest_name'>[] | null;
};

const AdminTables = () => {
  const [tables, setTables] = useState<TableRow[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [loading, setLoading] = useState(true);
  const [count, setCount] = useState('');
  const [showQR, setShowQR] = useState<string | null>(null);

  const fetchTables = useCallback(async () => {
    const [{ data: t }, { data: s }] = await Promise.all([
      supabase.from('tables').select(`*, sections(name, color), table_sessions(id, is_active, opened_at, guest_name)`).order('table_number'),
      supabase.from('sections').select('id, name, color').order('sort_order'),
    ]);
    setTables(t || []);
    setSections(s || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void fetchTables();
    const channel = supabase
      .channel('admin-tables')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'table_sessions' }, () => { void fetchTables(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tables' }, () => { void fetchTables(); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchTables]);

  const generateTables = async () => {
    const n = parseInt(count);
    if (isNaN(n) || n < 1 || n > 100) { toast.error('Enter a number between 1 and 100'); return; }
    const existing = new Set(tables.map((t) => t.table_number));
    const toAdd = [];
    for (let i = 1; i <= n; i++) if (!existing.has(i)) toAdd.push({ table_number: i });
    if (toAdd.length === 0) { toast.info('All those tables already exist'); return; }
    const { error } = await supabase.from('tables').insert(toAdd);
    if (error) { toast.error(error.message); return; }
    toast.success(`${toAdd.length} table${toAdd.length === 1 ? '' : 's'} added`); setCount(''); await fetchTables();
  };

  const addOne = async () => {
    const max = tables.reduce((m, t) => Math.max(m, t.table_number), 0);
    const { error } = await supabase.from('tables').insert({ table_number: max + 1 });
    if (error) { toast.error(error.message); return; }
    toast.success(`Table ${max + 1} added`); await fetchTables();
  };

  const deleteTable = async (table: TableRow) => {
    const { error } = await supabase.from('tables').delete().eq('id', table.id);
    if (error) { toast.error(error.message); return; }
    toast.success(`Table ${table.table_number} removed`); await fetchTables();
  };

  const setSection = async (tableId: string, sectionId: string | null) => {
    setTables((prev) => prev.map((t) => t.id === tableId ? { ...t, section_id: sectionId, sections: sectionId ? (sections.find(s => s.id === sectionId) ?? null) : null } : t));
    const { error } = await supabase.from('tables').update({ section_id: sectionId }).eq('id', tableId);
    if (error) { toast.error(error.message); void fetchTables(); }
  };

  const closeSession = async (sessionId: string) => {
    const { error } = await supabase.from('table_sessions').update({ is_active: false, closed_at: new Date().toISOString() }).eq('id', sessionId);
    if (error) { toast.error('Failed to close session'); return; }
    toast.success('Session closed — table is now free'); await fetchTables();
  };

  const getQRUrl = (table: TableRow) => `${window.location.origin}/table/${table.table_number}?token=${table.qr_token}`;

  return (
    <div>
      <h1 className="font-serif text-3xl font-bold text-foreground mb-6">Table Management</h1>

      <Card className="mb-6 border-border">
        <CardContent className="p-4 flex flex-wrap items-center gap-2">
          <Input placeholder="How many tables do you have?" value={count} onChange={(e) => setCount(e.target.value)} type="number" min="1" max="100" className="max-w-[240px]" onKeyDown={(e) => e.key === 'Enter' && generateTables()} />
          <Button onClick={generateTables} className="font-sans" size="sm"><LayoutGrid className="w-4 h-4 mr-1" /> Generate tables</Button>
          <span className="text-xs text-muted-foreground font-sans">creates tables 1…N, skipping any that exist</span>
          <div className="ml-auto">
            <Button onClick={addOne} variant="outline" className="font-sans" size="sm"><Plus className="w-4 h-4 mr-1" /> Add one</Button>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-xl" />)}
        </div>
      ) : tables.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-14 text-center">
            <LayoutGrid className="w-10 h-10 mx-auto text-muted-foreground/40 mb-3" />
            <p className="font-serif text-lg font-semibold text-foreground">No tables yet</p>
            <p className="text-sm font-sans text-muted-foreground mt-1">Enter how many tables your restaurant has above to generate them, then group them into sections.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {tables.map((table) => {
            const activeSession = table.table_sessions?.find((s) => s.is_active);
            return (
              <Card key={table.id} className={`border-border card-lux-hover ${activeSession ? 'border-primary/30 bg-primary/5' : ''}`}>
                <CardContent className="p-4 text-center">
                  <div className="flex items-start justify-between">
                    <span className="w-6" />
                    <p className="font-serif text-2xl font-bold text-foreground">{table.table_number}</p>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-6 w-6 -mr-1 -mt-1" aria-label={`Delete table ${table.table_number}`}>
                          <Trash2 className="w-3.5 h-3.5 text-muted-foreground hover:text-destructive" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete table {table.table_number}?</AlertDialogTitle>
                          <AlertDialogDescription>
                            {activeSession
                              ? 'This table is currently occupied. Deleting it will end the guests’ session and remove its orders. This cannot be undone.'
                              : 'This permanently removes the table and its QR code. This cannot be undone.'}
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => deleteTable(table)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>

                  <Badge variant="outline" className={`mt-1 text-xs ${activeSession ? 'border-primary text-primary' : 'border-muted-foreground text-muted-foreground'}`}>
                    {activeSession ? 'Occupied' : 'Available'}
                  </Badge>
                  {activeSession && (
                    <p className="text-[11px] text-muted-foreground font-sans mt-1 flex items-center justify-center gap-1">
                      <Clock className="w-3 h-3" /> <OccupancyTimer since={activeSession.opened_at} />
                    </p>
                  )}
                  {activeSession?.guest_name && <p className="text-xs text-muted-foreground font-sans mt-1 truncate">{activeSession.guest_name}</p>}

                  {/* Section picker */}
                  <Select value={table.section_id ?? 'none'} onValueChange={(v) => setSection(table.id, v === 'none' ? null : v)}>
                    <SelectTrigger className="h-8 mt-3 text-xs">
                      <SelectValue placeholder="Section">
                        {table.sections ? (
                          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: table.sections.color }} />{table.sections.name}</span>
                        ) : <span className="text-muted-foreground">No section</span>}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No section</SelectItem>
                      {sections.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: s.color }} />{s.name}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <div className="flex gap-1 mt-2 justify-center">
                    <Button variant="outline" size="icon" className="h-8 w-8" aria-label="Show QR" onClick={() => setShowQR(showQR === table.id ? null : table.id)}><QrCode className="w-3.5 h-3.5" /></Button>
                    {activeSession && (
                      <Button variant="outline" size="sm" className="h-8 text-xs gap-1" onClick={() => closeSession(activeSession.id)}>
                        <PowerOff className="w-3 h-3 text-destructive" /> Free
                      </Button>
                    )}
                  </div>

                  {showQR === table.id && (
                    <div className="mt-3 p-3 bg-card rounded-lg border border-border">
                      <QRCodeSVG value={getQRUrl(table)} size={120} className="mx-auto" />
                      <p className="text-[10px] text-muted-foreground mt-2 break-all">{getQRUrl(table)}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {sections.length === 0 && tables.length > 0 && (
        <p className="text-xs text-muted-foreground font-sans mt-4">
          Tip: create sections under <span className="font-medium">Sections</span> first, then group tables here so waiters can be assigned.
        </p>
      )}
    </div>
  );
};

const OccupancyTimer = ({ since }: { since: string }) => {
  const ms = useElapsed(since);
  return <>{formatDuration(ms)}</>;
};

export default AdminTables;
