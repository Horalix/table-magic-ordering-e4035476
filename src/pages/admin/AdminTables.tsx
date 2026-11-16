import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { ArrowRight, Clock, LayoutGrid, Layers, Plus, PowerOff, QrCode, RefreshCw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { QRCodeSVG } from 'qrcode.react';
import { AdminPageHeader } from '@/components/admin/AdminPage';
import { AdminCard, AdminCardContent, AdminCardHeader, EmptyState, Stagger } from '@/components/admin/AdminCard';
import { TONE } from '@/components/staff/status-tone';
import { cn } from '@/lib/utils';
import { useElapsed, formatDuration } from '@/lib/timing';
import { outstandingFor } from '@/lib/staff-api';
import { CloseAllTablesDialog } from '@/components/staff/EndOfDayTables';
import { useOpenTables } from '@/hooks/useOpenTables';
import FreeTableDialog from '@/components/staff/FreeTableDialog';
import { endOfDay } from '@/lib/end-of-day';
import type { Database } from '@/integrations/supabase/types';
import { HOME_VENUE } from '@/lib/home-venue';
import { qrOrigin, venueByDbId } from '@/lib/venues';
import { useStaffTables } from '@/lib/realtime';

type Section = Pick<Database['public']['Tables']['sections']['Row'], 'id' | 'name' | 'color'>;
type TableRow = Database['public']['Tables']['tables']['Row'] & {
  sections?: Pick<Database['public']['Tables']['sections']['Row'], 'name' | 'color'> | null;
  table_sessions?: Pick<Database['public']['Tables']['table_sessions']['Row'], 'id' | 'is_active' | 'opened_at' | 'guest_name'>[] | null;
};

const TABLE_TABLES = ['table_sessions', 'tables'] as const;

/** Tap targets: 44 px on a phone, 40 on a desktop. */
const TAP = 'h-11 sm:h-10';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

const AdminTables = () => {
  const [tables, setTables] = useState<TableRow[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [loading, setLoading] = useState(true);
  const [count, setCount] = useState('');
  const [showQR, setShowQR] = useState<string | null>(null);

  const [loadError, setLoadError] = useState(false);
  /** The table whose "Free" was tapped, with what it is believed to owe. */
  const [freeing, setFreeing] = useState<{ sessionId: string; tableNumber: number; owed: number } | null>(null);
  // Close all tables, at any hour: every open table that owes nothing (null before the database knows how).
  const openTables = useOpenTables();
  const [closingAll, setClosingAll] = useState(false);

  const fetchTables = useCallback(async () => {
    const [{ data: t, error: tErr }, { data: s, error: sErr }] = await Promise.all([
      supabase
        .from('tables')
        .select('*, sections(name, color), table_sessions(id, is_active, opened_at, guest_name)')
        // Only the newest session per table. Without these two the embed pulled
        // every session a table has EVER had — tens of thousands of rows after
        // a few months — and re-pulled them every time any guest sat down or
        // left, because the realtime handler refetches on table_sessions.
        .order('opened_at', { referencedTable: 'table_sessions', ascending: false })
        .limit(1, { referencedTable: 'table_sessions' })
        .order('table_number'),
      supabase.from('sections').select('id, name, color').order('sort_order'),
    ]);

    // A failed load used to fall through to the "No tables yet" empty state,
    // which invites a manager to recreate tables that already exist.
    setLoadError(Boolean(tErr || sErr));
    if (t) setTables(t);
    if (s) setSections(s);
    setLoading(false);
  }, []);

  useEffect(() => {
    void fetchTables();
  }, [fetchTables]);
  // The tab's shared channel: only the restaurant shown, and polled where the
  // socket cannot see it (the owner looking at Vera Italia).
  useStaffTables(TABLE_TABLES, useCallback(() => { void fetchTables(); }, [fetchTables]));

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

  /**
   * Open the free-table confirmation with the bill already on it.
   *
   * This used to be a bare UPDATE on one tap, with no look at the bill, so an
   * unpaid order could vanish behind a closed session. The close itself now
   * goes through `staff_close_session`, which refuses while money is owed; the
   * amount is fetched here only so the manager sees it before tapping, not
   * after being refused.
   */
  const askToFree = async (sessionId: string, tableNumber: number) => {
    const { data } = await supabase
      .from('orders')
      .select('status, payment_status, total, refunded_amount')
      .eq('table_session_id', sessionId);
    setFreeing({ sessionId, tableNumber, owed: outstandingFor(data ?? []) });
  };

  // Its own restaurant's address, as in Admin → QR Codes.
  const getQRUrl = (table: TableRow) =>
    `${qrOrigin(venueByDbId((table as { venue_id?: string | null }).venue_id)?.slug ?? HOME_VENUE)}/table/${table.table_number}?token=${table.qr_token}`;

  /* ---- What the page already knows, said once at the top ---- */
  const seatedCount = useMemo(() => tables.filter((t) => t.table_sessions?.some((s) => s.is_active)).length, [tables]);
  const unsectioned = useMemo(() => tables.filter((t) => !t.section_id).length, [tables]);
  const bySection = useMemo(
    () => sections.map((s) => ({ ...s, count: tables.filter((t) => t.section_id === s.id).length })),
    [sections, tables],
  );
  const nextNumber = tables.reduce((m, t) => Math.max(m, t.table_number), 0) + 1;
  const ready = !loading && !loadError;

  const generator = (prominent: boolean) => (
    <div className="space-y-2">
      <form
        className={cn('flex flex-col gap-2', prominent && 'sm:flex-row')}
        // The toast says what is wrong, as before; no browser bubble instead of it.
        noValidate
        onSubmit={(e) => { e.preventDefault(); void generateTables(); }}
      >
        <Input
          placeholder="How many tables do you have?" value={count} onChange={(e) => setCount(e.target.value)}
          type="number" inputMode="numeric" min="1" max="100" aria-label="How many tables do you have?"
          className="h-11 min-w-0 flex-1"
        />
        <Button type="submit" variant={prominent ? 'default' : 'outline'} className={cn(TAP, 'shrink-0 gap-1.5')}>
          <LayoutGrid className="h-4 w-4" /> Generate tables
        </Button>
      </form>
      <p className="text-xs font-sans text-muted-foreground">Creates tables 1 to N, skipping any that exist.</p>
    </div>
  );

  return (
    <div className="mx-auto w-full max-w-5xl">
      <AdminPageHeader
        title="Tables"
        description="Every table in the restaurant: its number, its section, and whether guests are sitting at it now."
        actions={openTables && openTables.tables.length > 0 ? (
          <Button variant="outline" className={cn(TAP, 'gap-1.5')} onClick={() => setClosingAll(true)}>
            Close all tables ({openTables.tables.length} open)
          </Button>
        ) : undefined}
      >
        {ready && tables.length > 0 && (
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm font-sans text-muted-foreground">
            <span><span className="font-semibold tabular-nums text-foreground">{tables.length}</span> {tables.length === 1 ? 'table' : 'tables'}</span>
            <span><span className="font-semibold tabular-nums text-foreground">{seatedCount}</span> seated</span>
            <span><span className="font-semibold tabular-nums text-foreground">{tables.length - seatedCount}</span> free</span>
            {unsectioned > 0 && sections.length > 0 && (
              <span className={TONE.preparing.text}><span className="font-semibold tabular-nums">{unsectioned}</span> without a section</span>
            )}
          </p>
        )}
      </AdminPageHeader>
      <CloseAllTablesDialog open={closingAll} onOpenChange={setClosingAll} state={endOfDay(openTables, null)} />

      {loading ? (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_300px]" aria-hidden>
          <AdminCard className="space-y-1 p-5 sm:p-6">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 py-2">
                <Skeleton className="h-11 w-11 rounded-xl" />
                <div className="flex-1 space-y-2"><Skeleton className="h-4 w-24" /><Skeleton className="h-3 w-36" /></div>
                <Skeleton className="hidden h-10 w-44 rounded-md sm:block" />
              </div>
            ))}
          </AdminCard>
          <Skeleton className="h-48 rounded-2xl" />
        </div>
      ) : loadError ? (
        <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-4 text-sm font-sans">
          <p className="font-semibold text-destructive">Could not load your tables</p>
          <p className="mt-1 text-muted-foreground">
            This is a loading problem, not an empty restaurant — do not recreate them. Check the connection and try again.
          </p>
          <Button type="button" variant="outline" className="mt-3 h-11 gap-1.5 sm:h-9" onClick={() => { void fetchTables(); }}>
            <RefreshCw className="h-4 w-4" /> Try again
          </Button>
        </div>
      ) : tables.length === 0 ? (
        <AdminCard>
          <EmptyState
            icon={LayoutGrid}
            tone="primary"
            className="pb-6"
            title="No tables yet"
            hint="Type how many tables your restaurant has. Each gets a number and its own QR code; group them into sections after."
          />
          <AdminCardContent className="mx-auto max-w-lg">
            {generator(true)}
          </AdminCardContent>
        </AdminCard>
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
          <Stagger className="min-w-0">
            <AdminCard>
              <AdminCardHeader
                title="All tables"
                description={sections.length > 0 ? 'Pick each table’s section, so its waiter sees it.' : 'Create sections first, then put each table in one so waiters can be assigned.'}
              />
              <AdminCardContent>
                <ul className="divide-y divide-border/70" aria-label="Tables">
                  {tables.map((table) => {
                    const activeSession = table.table_sessions?.find((s) => s.is_active);
                    const qrOpen = showQR === table.id;
                    return (
                      <li key={table.id} className="py-3 first:pt-0 last:pb-0">
                        <div className="grid grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 sm:grid-cols-[44px_minmax(0,1fr)_auto_auto]">
                          <span
                            className={cn(
                              'grid h-11 w-11 place-items-center rounded-xl font-serif text-lg font-bold tabular-nums',
                              activeSession ? 'bg-foreground/[0.07] text-foreground' : 'bg-muted/60 text-foreground/50',
                            )}
                            aria-hidden
                          >
                            {table.table_number}
                          </span>

                          <div className="min-w-0">
                            <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                              {/* The number is in the tile; said here for screen readers. */}
                              <span className="sr-only">Table {table.table_number}</span>
                              <span
                                className={cn(
                                  'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-sans font-medium leading-5',
                                  activeSession ? 'bg-foreground/[0.07] text-foreground' : TONE.served.chip,
                                )}
                              >
                                <span className={cn('h-1.5 w-1.5 rounded-full', activeSession ? 'bg-foreground/70' : TONE.served.dot)} aria-hidden />
                                {activeSession ? 'Seated' : 'Free'}
                              </span>
                            </p>
                            {activeSession && (
                              <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs font-sans text-muted-foreground">
                                <Clock className="h-3 w-3 shrink-0" aria-hidden />
                                <span className="tabular-nums"><OccupancyTimer since={activeSession.opened_at} /></span>
                                {activeSession.guest_name && <span className="truncate">· {activeSession.guest_name}</span>}
                              </p>
                            )}
                          </div>

                          {/* Phone: under the number, full width. Desktop: on the row. */}
                          <div className="col-span-3 row-start-2 flex items-center gap-2 sm:col-span-1 sm:col-start-3 sm:row-start-1">
                            <Select value={table.section_id ?? 'none'} onValueChange={(v) => setSection(table.id, v === 'none' ? null : v)}>
                              <SelectTrigger className={cn(TAP, 'min-w-0 flex-1 text-base sm:w-44 sm:flex-none sm:text-sm')} aria-label={`Section for table ${table.table_number}`}>
                                <SelectValue placeholder="Section">
                                  {table.sections ? (
                                    <span className="flex min-w-0 items-center gap-2"><span className="h-2 w-2 shrink-0 rounded-full" style={{ background: table.sections.color }} /><span className="truncate">{table.sections.name}</span></span>
                                  ) : <span className="text-muted-foreground">No section</span>}
                                </SelectValue>
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">No section</SelectItem>
                                {sections.map((s) => (
                                  <SelectItem key={s.id} value={s.id}>
                                    <span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full" style={{ background: s.color }} />{s.name}</span>
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Button
                              variant="outline" size="icon" className="h-11 w-11 shrink-0 sm:h-10 sm:w-10"
                              aria-label="Show QR" aria-expanded={qrOpen}
                              onClick={() => setShowQR(qrOpen ? null : table.id)}
                            >
                              <QrCode className="h-4 w-4" />
                            </Button>
                            {activeSession ? (
                              <Button variant="outline" className={cn(TAP, 'shrink-0 gap-1.5 px-3')} onClick={() => { void askToFree(activeSession.id, table.table_number); }}>
                                <PowerOff className="h-4 w-4" /> Free
                              </Button>
                            ) : (
                              // Keeps the column straight on a desktop when there is nothing to free.
                              <span className="hidden w-[78px] shrink-0 sm:block" aria-hidden />
                            )}
                          </div>

                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                variant="ghost" size="icon"
                                className="col-start-3 row-start-1 h-11 w-11 text-muted-foreground hover:bg-destructive/5 hover:text-destructive sm:col-start-4 sm:h-10 sm:w-10"
                                aria-label={`Delete table ${table.table_number}`}
                              >
                                <Trash2 className="h-4 w-4" />
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
                                <AlertDialogCancel className="min-h-[44px]">Cancel</AlertDialogCancel>
                                <AlertDialogAction onClick={() => deleteTable(table)} className="min-h-[44px] bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>

                        {qrOpen && (
                          <div className="mt-3 flex flex-col items-center gap-3 rounded-xl bg-muted/40 p-4 sm:ms-[56px] sm:flex-row sm:items-center">
                            <div className="shrink-0 rounded-lg bg-white p-2">
                              <QRCodeSVG value={getQRUrl(table)} size={120} />
                            </div>
                            <div className="min-w-0 space-y-2 text-center sm:text-start">
                              <p className="break-all font-mono text-[11px] leading-relaxed text-muted-foreground">{getQRUrl(table)}</p>
                              <Link to="/admin/qr-codes" className="inline-flex min-h-[44px] items-center gap-1 text-sm font-medium text-primary hover:underline sm:min-h-0">
                                Print table codes <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                              </Link>
                            </div>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </AdminCardContent>
            </AdminCard>
          </Stagger>

          <Stagger className="space-y-6 lg:sticky lg:top-6">
            <AdminCard>
              <AdminCardHeader icon={Plus} title="Add tables" />
              <AdminCardContent className="space-y-4">
                {generator(false)}
                <div className="border-t border-border/70 pt-4">
                  <Button onClick={addOne} variant="outline" className={cn(TAP, 'w-full gap-1.5')}>
                    <Plus className="h-4 w-4" /> Add table {nextNumber}
                  </Button>
                </div>
              </AdminCardContent>
            </AdminCard>

            <AdminCard>
              <AdminCardHeader
                icon={Layers}
                title="Sections"
                action={(
                  <Link to="/admin/sections" className="inline-flex min-h-[44px] items-center gap-1 text-sm font-sans font-medium text-primary hover:underline sm:min-h-0">
                    {sections.length > 0 ? 'Edit' : 'Create'} <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                  </Link>
                )}
              />
              <AdminCardContent>
                {sections.length === 0 ? (
                  <p className="text-[13px] font-sans leading-relaxed text-muted-foreground">
                    No sections yet. Create them under Floor sections first, then group the tables here so waiters can be assigned.
                  </p>
                ) : (
                  <ul className="space-y-2 text-sm font-sans">
                    {bySection.map((s) => (
                      <li key={s.id} className="flex items-center justify-between gap-3">
                        <span className="flex min-w-0 items-center gap-2"><span className="h-2 w-2 shrink-0 rounded-full" style={{ background: s.color }} aria-hidden /><span className="truncate text-foreground">{s.name}</span></span>
                        <span className="shrink-0 tabular-nums text-muted-foreground">{plural(s.count, 'table')}</span>
                      </li>
                    ))}
                    {unsectioned > 0 && (
                      <li className={cn('flex items-center justify-between gap-3', TONE.preparing.text)}>
                        <span>No section</span>
                        <span className="shrink-0 font-medium tabular-nums">{plural(unsectioned, 'table')}</span>
                      </li>
                    )}
                  </ul>
                )}
              </AdminCardContent>
            </AdminCard>

            <Link
              to="/admin/qr-codes"
              className="group flex min-h-[44px] items-center justify-between gap-3 rounded-2xl border border-border/80 bg-card px-5 py-4 text-sm font-sans shadow-lux transition-colors hover:bg-muted/30"
            >
              <span className="flex items-center gap-3">
                <QrCode className="h-4 w-4 text-primary" aria-hidden />
                <span><span className="font-medium text-foreground">Next: print the QR codes</span><span className="block text-xs text-muted-foreground">One per table, or one for the room</span></span>
              </span>
              <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden />
            </Link>
          </Stagger>
        </div>
      )}

      <FreeTableDialog
        open={freeing !== null}
        onOpenChange={(open) => { if (!open) setFreeing(null); }}
        sessionId={freeing?.sessionId ?? null}
        tableNumber={freeing?.tableNumber ?? ''}
        knownOwed={freeing?.owed ?? 0}
        onFreed={() => { void fetchTables(); }}
      />
    </div>
  );
};

const OccupancyTimer = ({ since }: { since: string }) => {
  const ms = useElapsed(since);
  return <>{formatDuration(ms)}</>;
};

export default AdminTables;
