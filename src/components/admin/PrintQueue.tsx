import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { CheckCircle2, ListChecks, Loader2, ReceiptText, RefreshCw, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { AdminCard, AdminCardContent, AdminCardHeader, EmptyState } from '@/components/admin/AdminCard';
import { Segmented } from '@/components/admin/CloudPrinters';
import { TONE, type StaffTone } from '@/components/staff/status-tone';
import { cn } from '@/lib/utils';
import { printQueue, type QueueTicket } from '@/lib/printers-api';
import { needsAttention, ticketStateLabel, type Tone } from '@/lib/print-routing';
import { requeueTicketPrint, type TicketType } from '@/lib/staff-api';
import { formatClock } from '@/lib/timing';

/**
 * Every ticket of the last twelve hours and what happened to it.
 *
 * The question this answers is the one a manager is asked mid-service: "did
 * table 7's order print?". Problems first, each with one Retry — which puts
 * the ticket back in the queue for whichever printer serves the station.
 */

const TYPE_LABEL: Record<string, string> = { kitchen: 'Kitchen', bar: 'Bar' };

/** A ticket's state in the staff screens' colours, as on the printers above. */
const PRINT_TONE: Record<Tone, StaffTone> = { ok: 'ready', busy: 'preparing', bad: 'late', idle: 'served' };

const PrintQueue = () => {
  const [tickets, setTickets] = useState<QueueTicket[] | null>(null);
  const [onlyProblems, setOnlyProblems] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setTickets(await printQueue(new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString()));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the print queue');
      setTickets((prev) => prev ?? []);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => { void load(); }, 10_000);
    return () => clearInterval(id);
  }, [load]);

  const problems = useMemo(() => (tickets ?? []).filter((t) => needsAttention(t)), [tickets]);
  const shown = onlyProblems ? problems : (tickets ?? []);

  const retry = async (t: QueueTicket) => {
    if (t.ticket_type !== 'kitchen' && t.ticket_type !== 'bar') return;
    setBusy(t.id);
    try {
      await requeueTicketPrint(t.order_id, t.ticket_type as TicketType);
      toast.success(`Table ${t.orders?.table_sessions?.tables?.table_number ?? '?'} (${t.ticket_type}) is back in the queue`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not retry');
    } finally { setBusy(null); }
  };

  return (
    <AdminCard>
      <AdminCardHeader
        icon={ListChecks}
        tone={problems.length > 0 ? 'destructive' : 'primary'}
        title="Print queue"
        description="Last 12 hours. Retry sends a ticket back to the printer for its station."
      />
      <AdminCardContent className="space-y-3">
        <Segmented
          label="Show"
          value={onlyProblems ? 'problems' : 'all'}
          onChange={(v) => setOnlyProblems(v === 'problems')}
          options={[
            { value: 'problems', label: <>Problems{problems.length > 0 ? ` (${problems.length})` : ''}</> },
            { value: 'all', label: 'All' },
          ]}
          className="min-w-[200px]"
        />
        {error && (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm font-sans text-destructive">
            <span className="min-w-0">{error}</span>
            <Button variant="outline" className="h-11 gap-1.5 sm:h-9" onClick={() => { void load(); }}>
              <RefreshCw className="h-4 w-4" /> Try again
            </Button>
          </div>
        )}

        {tickets === null ? (
          <div className="space-y-2" aria-hidden>{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-full rounded-xl" />)}</div>
        ) : shown.length === 0 ? (
          onlyProblems ? (
            <EmptyState
              icon={CheckCircle2} tone="primary" className="py-5"
              title="Every ticket printed. Nothing to retry."
              hint="A ticket that does not print shows here, with a Retry button."
            />
          ) : (
            <EmptyState
              icon={ReceiptText} className="py-5"
              title="No tickets in the last 12 hours."
              hint="Each order’s kitchen and bar tickets show here as they print."
            />
          )
        ) : (
          <ul className="divide-y divide-border/70" aria-label="Tickets">
            {shown.map((t) => {
              const state = ticketStateLabel(t);
              const tone = PRINT_TONE[state.tone];
              const table = t.orders?.table_sessions?.tables?.table_number;
              return (
                <li key={t.id} className="flex items-center gap-3 py-3">
                  <span className="w-11 shrink-0 self-start pt-0.5 text-xs tabular-nums text-muted-foreground">{formatClock(t.created_at)}</span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm font-sans font-semibold text-foreground">
                      Table {table ?? '?'}
                      {t.orders?.order_code && <span className="text-xs font-normal tabular-nums text-muted-foreground">#{t.orders.order_code}</span>}
                      <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium leading-4 text-muted-foreground">{TYPE_LABEL[t.ticket_type] ?? t.ticket_type}</span>
                    </p>
                    {/* Wraps: cut to one line, the reason ("Printer offline (Bar
                        printer)") was the part that did not fit. */}
                    <p className={cn('mt-0.5 flex items-start gap-1.5 text-xs font-sans break-words', tone === 'served' ? 'text-muted-foreground' : TONE[tone].text, tone === 'late' && 'font-medium')}>
                      <span className={cn('mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full', TONE[tone].dot)} aria-hidden />
                      <span className="min-w-0">{state.label}{t.attempts > 1 ? ` · ${t.attempts} attempts` : ''}</span>
                    </p>
                  </div>
                  {t.status !== 'cancelled' && (
                    <Button
                      variant={t.status === 'printed' ? 'ghost' : 'outline'} className="h-11 shrink-0 gap-1.5 px-3 sm:h-9"
                      disabled={busy === t.id} onClick={() => retry(t)}
                      aria-label={`${t.status === 'printed' ? 'Reprint' : 'Retry'} table ${table ?? '?'} ${t.ticket_type}`}
                    >
                      {busy === t.id ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <RotateCcw className="h-4 w-4" />}
                      {t.status === 'printed' ? 'Reprint' : 'Retry'}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </AdminCardContent>
    </AdminCard>
  );
};

export default PrintQueue;
