import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { MoonStar } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { OPEN_TABLES_KEY, useOpenTables } from '@/hooks/useOpenTables';
import { closeAllTables, endOfDay, tableList, type EndOfDay } from '@/lib/end-of-day';
import { km } from '@/lib/staff-api';
import type { OpeningHours } from '@/lib/venues';

/**
 * "The work day is over — these tables are still open", on the waiter's
 * phone, the floor and the admin, with Close all tables.
 *
 * Waiters do not always free their tables when the guests leave, and a table
 * left open is still "seated" the next morning. From the end of the work day
 * (Admin → Ordering & service, else half an hour after the doors close), or
 * at any hour for a table left from an earlier day, this says how many are
 * open and closes them at a tap (src/lib/end-of-day.ts).
 *
 * A table that owes money is never closed that way: it is named with what it
 * owes, as the single-table Free does, because a freed table with an unpaid
 * order is money nobody comes back for.
 *
 * Nothing shows on a database from before 20261110120000_close_all_tables.sql.
 */

/** "Not yet" puts the notice away for this long: the last guests are still sitting. */
const SNOOZE_MS = 30 * 60_000;
const SNOOZE_KEY = 'lasoul.end-of-day-snoozed-until';

const owesWords = (owing: EndOfDay['owing']) =>
  owing.length === 1
    ? `Table ${owing[0].table_number} still owes ${km(owing[0].outstanding)}`
    : `${tableList(owing)} still owe ${km(owing.reduce((sum, t) => sum + t.outstanding, 0))}`;

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: EndOfDay;
}

/** Asks once, says which tables go and which stay, then closes them. */
export const CloseAllTablesDialog = ({ open, onOpenChange, state }: DialogProps) => {
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const { closable, owing } = state;

  const run = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await closeAllTables();
      if (result.closed > 0) toast.success(result.closed === 1 ? '1 table closed' : `${result.closed} tables closed`);
      else toast.message('No table could be closed');
      if (result.kept.length) toast.warning(`${owesWords(result.kept.map((t) => ({ ...t, opened_at: '', overnight: false })))}: left open`);
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not close the tables');
    } finally {
      setBusy(false);
      void client.invalidateQueries({ queryKey: OPEN_TABLES_KEY });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-serif text-xl">Close all tables?</DialogTitle>
          <DialogDescription className="text-sm">
            {closable.length > 0
              ? <>{tableList(closable)} {closable.length === 1 ? 'is' : 'are'} paid up and will be freed. Anyone still sitting there scans the code again to order.</>
              : 'Every open table still owes money, so none can be closed yet.'}
          </DialogDescription>
        </DialogHeader>

        {owing.length > 0 && (
          <div role="alert" className="rounded-xl border-2 border-destructive/50 bg-destructive/10 p-3">
            <p className="text-base font-sans font-bold text-destructive">{owesWords(owing)}</p>
            <p className="text-sm font-sans text-foreground mt-1">
              {owing.length === 1 ? 'It stays' : 'They stay'} open. Record the payment first: a closed table with an unpaid order is money nobody comes back for.
            </p>
          </div>
        )}

        <DialogFooter className="gap-2 flex-col sm:flex-row">
          <Button variant="outline" className="min-h-[44px]" onClick={() => onOpenChange(false)} disabled={busy}>
            Keep them open
          </Button>
          <Button variant="destructive" className="min-h-[44px]" onClick={run} disabled={busy || closable.length === 0}>
            {busy ? 'Closing…' : closable.length === 0 ? 'Nothing to close' : closable.length === 1 ? 'Close 1 table' : `Close ${closable.length} tables`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const snoozedUntil = (): number => {
  try { return Number(sessionStorage.getItem(SNOOZE_KEY)) || 0; } catch { return 0; }
};

interface Props {
  /** The restaurant's opening hours (src/lib/venues.ts), for when no end of day is set. */
  hours: OpeningHours[] | null | undefined;
  /** A wrapper to lay it out in, rendered only with the notice. */
  outerClassName?: string;
}

const EndOfDayTables = ({ hours, outerClassName }: Props) => {
  const open = useOpenTables();
  const [asking, setAsking] = useState(false);
  const [snoozed, setSnoozed] = useState(() => snoozedUntil() > Date.now());
  const state = endOfDay(open, hours);

  if (!state.due || (snoozed && snoozedUntil() > Date.now())) {
    return <CloseAllTablesDialog open={asking} onOpenChange={setAsking} state={state} />;
  }

  const total = state.closable.length + state.owing.length;
  const overnight = open?.tables.filter((t) => t.overnight).length ?? 0;
  const snooze = () => {
    try { sessionStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_MS)); } catch { /* not remembered */ }
    setSnoozed(true);
  };

  const notice = (
    <div
      role="status"
      data-testid="end-of-day"
      className="flex flex-wrap items-center gap-x-4 gap-y-2.5 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3.5 py-3 text-sm font-sans text-foreground"
    >
      <MoonStar className="w-5 h-5 shrink-0 text-amber-600" aria-hidden />
      <p className="min-w-0 flex-1 basis-56 leading-snug">
        <span className="font-semibold">
          {state.over
            ? `The work day is over. ${total === 1 ? '1 table is' : `${total} tables are`} still open.`
            : `${overnight === 1 ? '1 table was' : `${overnight} tables were`} left open from an earlier day.`}
        </span>{' '}
        {state.owing.length > 0 && <>{owesWords(state.owing)}. </>}
        {state.closable.length > 0 && open?.closes_overnight && 'Any left open that owe nothing are closed automatically overnight.'}
      </p>
      <div className="flex shrink-0 gap-2">
        {state.over && (
          <Button type="button" variant="ghost" className="min-h-[44px]" onClick={snooze}>Not yet</Button>
        )}
        <Button type="button" className="min-h-[44px]" onClick={() => setAsking(true)}>
          {state.closable.length > 0 ? 'Close all tables' : 'See tables'}
        </Button>
      </div>
      <CloseAllTablesDialog open={asking} onOpenChange={setAsking} state={state} />
    </div>
  );
  return outerClassName ? <div className={outerClassName}>{notice}</div> : notice;
};

export default EndOfDayTables;
