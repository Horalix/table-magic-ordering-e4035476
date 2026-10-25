import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ListChecks, Loader2, RotateCcw } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
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

const TONE: Record<Tone, string> = {
  ok: 'text-primary', busy: 'text-accent', bad: 'text-destructive font-semibold', idle: 'text-muted-foreground',
};

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
    <Card>
      <CardContent className="p-4 sm:p-5 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="font-serif text-lg font-semibold text-foreground flex items-center gap-2">
              <ListChecks className="w-5 h-5 text-primary" /> Print queue
            </h2>
            <p className="text-xs text-muted-foreground font-sans mt-0.5">Last 12 hours. Retry sends a ticket back to the printer for its station.</p>
          </div>
          <div className="inline-flex rounded-full border border-border overflow-hidden" role="group" aria-label="Show">
            <button
              type="button" aria-pressed={onlyProblems} onClick={() => setOnlyProblems(true)}
              className={`px-3 min-h-[40px] text-sm font-sans ${onlyProblems ? 'bg-foreground text-background' : 'bg-card text-muted-foreground'}`}
            >
              Problems{problems.length > 0 ? ` (${problems.length})` : ''}
            </button>
            <button
              type="button" aria-pressed={!onlyProblems} onClick={() => setOnlyProblems(false)}
              className={`px-3 min-h-[40px] text-sm font-sans ${!onlyProblems ? 'bg-foreground text-background' : 'bg-card text-muted-foreground'}`}
            >
              All
            </button>
          </div>
        </div>

        {error && <p className="text-xs font-sans text-destructive" role="alert">{error}</p>}

        {tickets === null ? (
          <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}</div>
        ) : shown.length === 0 ? (
          <p className="text-sm text-muted-foreground font-sans py-4 text-center">
            {onlyProblems ? 'Every ticket printed. Nothing to retry.' : 'No tickets in the last 12 hours.'}
          </p>
        ) : (
          <ul className="divide-y divide-border" aria-label="Tickets">
            {shown.map((t) => {
              const state = ticketStateLabel(t);
              const table = t.orders?.table_sessions?.tables?.table_number;
              return (
                <li key={t.id} className="flex items-center gap-3 py-2">
                  <span className="text-xs tabular-nums text-muted-foreground w-11 shrink-0">{formatClock(t.created_at)}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-sans font-medium text-foreground">
                      Table {table ?? '?'}
                      {t.orders?.order_code && <span className="ml-1.5 text-xs tabular-nums text-muted-foreground">#{t.orders.order_code}</span>}
                      <span className="ml-1.5 text-[11px] uppercase px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{t.ticket_type}</span>
                    </p>
                    <p className={`text-xs font-sans truncate ${TONE[state.tone]}`}>
                      {state.label}{t.attempts > 1 ? ` · ${t.attempts} attempts` : ''}
                    </p>
                  </div>
                  {t.status !== 'cancelled' && (
                    <Button
                      variant={t.status === 'printed' ? 'ghost' : 'outline'} size="sm" className="min-h-[40px] gap-1.5 shrink-0"
                      disabled={busy === t.id} onClick={() => retry(t)}
                      aria-label={`${t.status === 'printed' ? 'Reprint' : 'Retry'} table ${table ?? '?'} ${t.ticket_type}`}
                    >
                      {busy === t.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
                      {t.status === 'printed' ? 'Reprint' : 'Retry'}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
};

export default PrintQueue;
