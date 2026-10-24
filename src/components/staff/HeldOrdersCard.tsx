import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Ban, Check, X } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { blockSession, cancelOrder, km, releaseHeldOrder } from '@/lib/staff-api';
import { heldReasonIsSuspicious, heldReasonLabel } from '@/lib/held-orders';
import { playWaiterCallAlert, useReminderChime, vibrate } from '@/lib/kitchen-sounds';
import { useCoalesced, useLatestRequest, useStaffRealtimeEvent, useStaffRefresh } from '@/lib/realtime';
import { formatMinutes, useElapsedMinutes } from '@/lib/timing';

/**
 * "Needs confirming": pay-at-table orders the database held back instead of
 * printing, because they looked like they might not come from someone sitting
 * at the table (see 20261024190000_order_abuse_guards.sql).
 *
 * The same card is pinned on the kitchen display, the waiter phone and the
 * floor monitor, because whoever is nearest the table is the one who can tell.
 * It owns its own query and realtime wiring so the three screens cannot drift
 * apart in what they consider held.
 *
 * Held orders arrive as plain INSERTs on `orders`, which the shared realtime
 * channel already listens to unfiltered, so they appear without a reload; the
 * polling fallback covers a dead socket.
 */

export interface HeldOrder {
  id: string;
  order_code: string | null;
  total: number;
  guest_name: string | null;
  created_at: string;
  held_reason: string | null;
  table_session_id: string;
  table_number: number;
  items: { quantity: number; name: string; notes: string | null }[];
}

interface HeldOrderRow {
  id: string;
  order_code: string | null;
  total: number;
  guest_name: string | null;
  created_at: string;
  held_reason: string | null;
  table_session_id: string;
  table_sessions?: { tables?: { table_number?: number | null } | null } | null;
  order_items?: { quantity: number; notes: string | null; menu_items?: { name?: string | null } | null }[] | null;
}

const toHeld = (o: HeldOrderRow): HeldOrder => ({
  id: o.id,
  order_code: o.order_code,
  total: Number(o.total ?? 0),
  guest_name: o.guest_name,
  created_at: o.created_at,
  held_reason: o.held_reason,
  table_session_id: o.table_session_id,
  table_number: o.table_sessions?.tables?.table_number ?? 0,
  items: (o.order_items ?? []).map((i) => ({
    quantity: i.quantity, name: i.menu_items?.name ?? 'Item', notes: i.notes,
  })),
});

/** Held orders, live. `held` is null until the first load answers. */
function useHeldOrders(soundEnabled: boolean) {
  const [held, setHeld] = useState<HeldOrder[] | null>(null);
  const known = useRef<Set<string> | null>(null);
  const soundRef = useRef(soundEnabled);
  useEffect(() => { soundRef.current = soundEnabled; }, [soundEnabled]);
  const begin = useLatestRequest();

  const fetchHeld = useCallback(async () => {
    const isLatest = begin();
    const { data, error } = await supabase
      .from('orders')
      .select(`
        id, order_code, total, guest_name, created_at, held_reason, table_session_id,
        table_sessions!inner(tables!inner(table_number)),
        order_items(quantity, notes, menu_items(name))
      `)
      .eq('status', 'pending')
      .is('released_to_kitchen_at', null)
      .not('held_reason', 'is', null)
      // Oldest first: the guest who has waited longest is the one to go to.
      .order('created_at', { ascending: true })
      .limit(50);
    if (!isLatest()) return;
    if (error) { console.error('Error fetching held orders:', error); return; }

    const rows = ((data ?? []) as unknown as HeldOrderRow[]).map(toHeld);
    // A chime means "new", not "refetched" — and never on the first load,
    // or every screen beeps when someone opens it.
    const seen = known.current;
    if (seen !== null && rows.some((o) => !seen.has(o.id)) && soundRef.current) {
      playWaiterCallAlert();
      vibrate();
    }
    known.current = new Set([...(seen ?? []), ...rows.map((o) => o.id)]);
    setHeld(rows);
  }, [begin]);

  useEffect(() => { void fetchHeld(); }, [fetchHeld]);
  const refetch = useCoalesced(useCallback(() => { void fetchHeld(); }, [fetchHeld]));
  // Not table_sessions: every guest phone heartbeats it twice a minute, and
  // anything that changes a hold (release, reject, block) writes to orders.
  useStaffRealtimeEvent(useCallback((table: string) => {
    if (table === 'orders' || table === 'order_items') refetch();
  }, [refetch]));
  useStaffRefresh(useCallback(() => { refetch(); }, [refetch]));

  // Someone is standing at a table waiting for food that has not been made.
  useReminderChime(soundEnabled && (held?.length ?? 0) > 0, playWaiterCallAlert);

  return { held: held ?? [], refetch: fetchHeld };
}

const Waiting = ({ since }: { since: string }) => {
  const ms = useElapsedMinutes(since);
  return <>{ms < 60_000 ? 'just now' : `${formatMinutes(ms)} ago`}</>;
};

const HeldOrdersCard = ({
  soundEnabled = true,
  className = '',
  onChanged,
}: {
  soundEnabled?: boolean;
  className?: string;
  /** The host screen's own refetch, so a confirmed order shows up on its board at once. */
  onChanged?: () => void;
}) => {
  const { held, refetch } = useHeldOrders(soundEnabled);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [rejecting, setRejecting] = useState<HeldOrder | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [blocking, setBlocking] = useState<HeldOrder | null>(null);

  const run = async (id: string, work: () => Promise<void>) => {
    if (busy.has(id)) return;
    setBusy((s) => new Set(s).add(id));
    try {
      await work();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'That did not work — try again');
    } finally {
      setBusy((s) => { const next = new Set(s); next.delete(id); return next; });
      await refetch();
      onChanged?.();
    }
  };

  const confirm = (o: HeldOrder) => run(o.id, async () => {
    const r = await releaseHeldOrder(o.id);
    toast.success(r?.status === 'already_released'
      ? `Table ${o.table_number} was already confirmed`
      : `Table ${o.table_number} confirmed — sent to the kitchen`);
  });

  const reject = () => {
    const o = rejecting;
    if (!o || rejectReason.trim().length < 3) return;
    void run(o.id, async () => {
      await cancelOrder(o.id, rejectReason.trim());
      toast.success(`Order for table ${o.table_number} rejected`);
      setRejecting(null);
      setRejectReason('');
    });
  };

  const block = () => {
    const o = blocking;
    if (!o) return;
    void run(o.id, async () => {
      const r = await blockSession(o.table_session_id, heldReasonLabel(o.held_reason, o.table_number));
      const left = r?.orders_left ?? 0;
      toast.success(left > 0
        ? `Table ${o.table_number} blocked — ${left} order(s) had already printed, check them`
        : `Table ${o.table_number} blocked`);
      setBlocking(null);
    });
  };

  if (held.length === 0 && !rejecting && !blocking) return null;

  return (
    <section
      aria-label="Needs confirming"
      className={`border-2 border-amber-500/60 bg-amber-50 dark:bg-amber-950/30 rounded-xl p-3 sm:p-4 space-y-3 ${className}`}
    >
      <h2 className="text-sm font-sans font-semibold uppercase tracking-wider text-amber-800 dark:text-amber-300 flex items-center gap-2">
        <AlertTriangle className="w-4 h-4" aria-hidden /> Needs confirming ({held.length})
      </h2>
      <p className="text-xs font-sans text-amber-900/80 dark:text-amber-200/80 -mt-2">
        Not printed yet. Check someone is at the table, then confirm.
      </p>

      <ul className="space-y-3">
        {held.map((o) => {
          const suspicious = heldReasonIsSuspicious(o.held_reason);
          const working = busy.has(o.id);
          return (
            <li key={o.id} className="rounded-lg bg-card border border-border p-3 space-y-2" data-testid="held-order">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-lg font-sans font-bold text-foreground">Table {o.table_number}</span>
                {o.guest_name && <span className="text-sm font-sans text-foreground">{o.guest_name}</span>}
                {o.order_code && <span className="text-xs font-mono text-muted-foreground">#{o.order_code}</span>}
                <span className="text-xs font-sans text-muted-foreground"><Waiting since={o.created_at} /></span>
                <span className="ml-auto text-base font-sans font-semibold text-foreground">{km(o.total)}</span>
              </div>
              <p className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 dark:bg-amber-900/50 text-amber-900 dark:text-amber-200 px-2.5 py-1 text-xs font-sans font-semibold">
                {heldReasonLabel(o.held_reason, o.table_number)}
              </p>
              <ul className="text-sm font-sans text-foreground">
                {o.items.map((i, n) => (
                  <li key={n}>
                    {i.quantity}× {i.name}
                    {i.notes && <span className="text-muted-foreground"> — {i.notes}</span>}
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-2 pt-1">
                <Button
                  onClick={() => void confirm(o)}
                  disabled={working}
                  className="min-h-[44px] flex-1 sm:flex-none gap-1.5"
                  aria-label={`Confirm order for table ${o.table_number}`}
                >
                  <Check className="w-4 h-4" aria-hidden /> Confirm
                </Button>
                <Button
                  variant="outline"
                  onClick={() => { setRejecting(o); setRejectReason(''); }}
                  disabled={working}
                  className="min-h-[44px] flex-1 sm:flex-none gap-1.5"
                  aria-label={`Reject order for table ${o.table_number}`}
                >
                  <X className="w-4 h-4" aria-hidden /> Reject
                </Button>
                {suspicious && (
                  <Button
                    variant="destructive"
                    onClick={() => setBlocking(o)}
                    disabled={working}
                    className="min-h-[44px] flex-1 sm:flex-none gap-1.5"
                    aria-label={`Block table ${o.table_number}`}
                  >
                    <Ban className="w-4 h-4" aria-hidden /> Block table
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {/* Same shape as the kitchen's void dialog: a reject is a void, and is recorded against you. */}
      <Dialog open={rejecting !== null} onOpenChange={(open) => { if (!open) { setRejecting(null); setRejectReason(''); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-serif">
              Reject order {rejecting?.order_code ? `#${rejecting.order_code}` : ''} — table {rejecting?.table_number}
            </DialogTitle>
            <DialogDescription>
              It never reaches the kitchen. The guest sees it as cancelled, and the reason is recorded against you.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="Why? e.g. nobody at the table"
            className="min-h-[88px] font-sans"
            aria-label="Reason for rejecting"
          />
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setRejecting(null); setRejectReason(''); }} className="min-h-[44px]">
              Keep it
            </Button>
            <Button
              variant="destructive"
              disabled={!rejecting || busy.has(rejecting.id) || rejectReason.trim().length < 3}
              onClick={reject}
              className="min-h-[44px]"
            >
              Reject order
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={blocking !== null} onOpenChange={(open) => { if (!open) setBlocking(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-serif">Block table {blocking?.table_number}?</AlertDialogTitle>
            <AlertDialogDescription>
              Every order from this session that has not printed is cancelled, the session ends, and
              those phones cannot order again. Anything already printed or paid stays for you to check.
              Only do this if nobody real is sitting there.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel className="min-h-[44px]">Keep table</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); block(); }}
              className="min-h-[44px] bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Block table
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
};

export default HeldOrdersCard;
