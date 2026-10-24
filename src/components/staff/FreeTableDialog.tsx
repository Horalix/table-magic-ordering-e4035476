import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { closeTableSession, km } from '@/lib/staff-api';

/**
 * "The guests have gone — free the table", from any screen.
 *
 * The kitchen tick, the waiter phone and the admin Tables page each used to
 * free a table with a bare UPDATE and a toast, and none of them looked at the
 * bill. This goes through `staff_close_session`, which refuses while money is
 * owed and says how much. The refusal stays on screen inside the dialog rather
 * than in a toast, because it is the thing the person has to act on.
 *
 * `knownOwed` is what this screen believes is outstanding. It is shown up front
 * so nobody has to tap to find out — but the server's answer is the one that
 * counts, since the screen may be a few seconds stale.
 */
const FreeTableDialog = ({
  open,
  onOpenChange,
  sessionId,
  tableNumber,
  knownOwed = 0,
  onFreed,
  extraAction,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: string | null;
  tableNumber: number | string;
  knownOwed?: number;
  onFreed?: () => void;
  /** e.g. "Just clear the request" on the kitchen's bill-request tick. */
  extraAction?: { label: string; run: () => Promise<void> | void };
}) => {
  const [busy, setBusy] = useState(false);
  const [refusedFor, setRefusedFor] = useState<number | null>(null);

  // A dialog reused for another table must not carry the last refusal over.
  useEffect(() => { if (open) setRefusedFor(null); }, [open, sessionId]);

  const owed = refusedFor ?? knownOwed;

  const free = async () => {
    if (!sessionId || busy) return;
    setBusy(true);
    try {
      const result = await closeTableSession(sessionId);
      if (!result.closed) {
        setRefusedFor(result.outstanding);
        return;
      }
      toast.success(result.already_closed ? `Table ${tableNumber} was already free` : `Table ${tableNumber} is free`);
      onOpenChange(false);
      onFreed?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not free the table');
    } finally {
      setBusy(false);
    }
  };

  const runExtra = async () => {
    if (!extraAction || busy) return;
    setBusy(true);
    try {
      await extraAction.run();
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-serif text-xl">Free table {tableNumber}?</DialogTitle>
          <DialogDescription className="text-sm">
            This ends the guests' session. Anyone still at the table will need to scan the QR again to order.
          </DialogDescription>
        </DialogHeader>

        {owed > 0 && (
          <div role="alert" className="rounded-xl border-2 border-destructive/50 bg-destructive/10 p-3">
            <p className="text-base font-sans font-bold text-destructive">
              Table {tableNumber} still owes {km(owed)}
            </p>
            <p className="text-sm font-sans text-foreground mt-1">
              {refusedFor !== null
                ? 'Not freed. Record the payment first — a freed table with an unpaid order is money nobody will come back for.'
                : 'Record the payment first. The table cannot be freed while money is owed.'}
            </p>
          </div>
        )}

        <DialogFooter className="gap-2 flex-col sm:flex-row">
          <Button variant="outline" className="min-h-[44px]" onClick={() => onOpenChange(false)} disabled={busy}>
            Keep table open
          </Button>
          {extraAction && (
            <Button variant="outline" className="min-h-[44px]" onClick={runExtra} disabled={busy}>
              {extraAction.label}
            </Button>
          )}
          <Button
            variant="destructive"
            className="min-h-[44px]"
            onClick={free}
            disabled={busy || !sessionId || refusedFor !== null}
          >
            {busy ? 'Freeing…' : 'Free table'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default FreeTableDialog;
