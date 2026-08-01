import React, { useState } from 'react';
import { toast } from 'sonner';
import {
  Banknote, Bell, ChefHat, CreditCard, Hand, Minus, Plus, Receipt, Users, X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { useElapsed } from '@/lib/timing';
import { formatDuration, formatMinutes, orderUrgency, urgencyText, urgencyMark } from '@/lib/timing';
import { useNow } from '@/lib/clock';
import {
  ackBillRequest, ackWaiterCall, recordTablePayment, resolveBillRequest, resolveWaiterCall, setCovers,
} from '@/lib/staff-api';

/**
 * What a waiter can actually DO about a table.
 *
 * The floor monitor was entirely read-only: it said "Table 7 wants the bill"
 * and offered no way to say you were going, no way to clear it, and no way to
 * take the money. It is the device staff physically stand in front of, so
 * every one of those actions had to be done on a different screen — or, in
 * practice, not recorded at all.
 */

export interface SheetOrder {
  id: string;
  order_code: string | null;
  status: string;
  total: number;
  payment_status: string | null;
  payment_method: string | null;
  notes: string | null;
  created_at: string;
}

export interface SheetTable {
  tableNumber: number;
  sectionName: string | null;
  sessionId: string | null;
  guestName: string | null;
  openedAt: string | null;
  covers: number | null;
  waiterName: string | null;
  callId: string | null;
  callHeldBy: string | null;
  callHeldByName: string | null;
  billId: string | null;
  billHeldBy: string | null;
  billHeldByName: string | null;
  orders: SheetOrder[];
}

interface Props {
  table: SheetTable | null;
  /** Current staff user, so "you have this" reads differently from "Marko has this". */
  meId: string | null;
  onClose: () => void;
  onChanged: () => void;
}

const TableActionSheet = ({ table, meId, onClose, onChanged }: Props) => {
  const now = useNow();
  const [busy, setBusy] = useState<string | null>(null);
  /** Money taps are two-step. There is no undo on a recorded payment. */
  const [confirmPay, setConfirmPay] = useState<{ orderId: string; method: 'cash' | 'pos_terminal' } | null>(null);
  const [coversDraft, setCoversDraft] = useState<number | null>(null);

  if (!table) return null;

  const covers = coversDraft ?? table.covers;
  const seatedMs = table.openedAt ? Math.max(0, now - new Date(table.openedAt).getTime()) : 0;
  const unpaid = table.orders.filter((o) => o.payment_status !== 'paid'
    && !['cancelled', 'awaiting_payment', 'payment_failed'].includes(o.status));
  const outstanding = unpaid.reduce((sum, o) => sum + Number(o.total ?? 0), 0);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try { await fn(); onChanged(); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'That did not work'); }
    finally { setBusy(null); }
  };

  const claimCall = () => table.callId && run('call-ack', async () => {
    const result = await ackWaiterCall(table.callId!);
    if (result.mine) toast.success(`You are going to table ${table.tableNumber}`);
    else toast.info(`${table.callHeldByName ?? 'Someone else'} is already going`);
  });

  const claimBill = () => table.billId && run('bill-ack', async () => {
    const result = await ackBillRequest(table.billId!);
    if (result.mine) toast.success(`You are taking the bill to table ${table.tableNumber}`);
    else toast.info(`${table.billHeldByName ?? 'Someone else'} is already going`);
  });

  const freeTable = () => table.billId && run('bill-free', async () => {
    const result = await resolveBillRequest(table.billId!, true);
    if (!result.closed) {
      // Not a failure — a refusal, and the reason is the whole point.
      toast.warning(`Bill cleared, but table ${table.tableNumber} still owes ${Number(result.outstanding).toFixed(2)} KM`);
    } else {
      toast.success(`Table ${table.tableNumber} is free`);
      onClose();
    }
  });

  const applyCovers = (next: number | null) => {
    setCoversDraft(next);
    void run('covers', async () => { await setCovers(table.sessionId!, next); });
  };

  const takePayment = () => confirmPay && run('pay', async () => {
    await recordTablePayment(confirmPay.orderId, confirmPay.method);
    toast.success(confirmPay.method === 'cash' ? 'Cash recorded' : 'Card terminal recorded');
    setConfirmPay(null);
  });

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-serif text-2xl flex items-center gap-2">
            Table {table.tableNumber}
            {table.sectionName && (
              <span className="text-xs uppercase tracking-wide text-muted-foreground font-sans">{table.sectionName}</span>
            )}
          </DialogTitle>
          <DialogDescription>
            {table.openedAt
              ? <>Seated {formatDuration(seatedMs)}{table.guestName ? ` · ${table.guestName}` : ''}{table.waiterName ? ` · ${table.waiterName}` : ''}</>
              : 'Nobody is sitting here.'}
          </DialogDescription>
        </DialogHeader>

        {/* ---- Alerts, first, because they are why anyone opened this ---- */}
        {(table.callId || table.billId) && (
          <div className="space-y-2">
            {table.callId && (
              <div className="rounded-xl border border-accent/40 bg-accent/5 p-3">
                <p className="text-sm font-sans font-semibold text-accent flex items-center gap-1.5">
                  <Hand className="w-4 h-4" /> Calling for a waiter
                </p>
                {table.callHeldBy && (
                  <p className="text-xs font-sans text-muted-foreground mt-0.5">
                    {table.callHeldBy === meId ? 'You are going' : `${table.callHeldByName ?? 'Someone'} is going`}
                  </p>
                )}
                <div className="flex gap-2 mt-2">
                  <Button size="sm" variant="outline" disabled={busy === 'call-ack'} onClick={claimCall} className="min-h-[44px] flex-1">
                    I'll go
                  </Button>
                  <Button
                    size="sm"
                    disabled={busy === 'call-done'}
                    onClick={() => run('call-done', async () => { await resolveWaiterCall(table.callId!); toast.success('Call cleared'); })}
                    className="min-h-[44px] flex-1"
                  >
                    Done
                  </Button>
                </div>
              </div>
            )}

            {table.billId && (
              <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-3">
                <p className="text-sm font-sans font-semibold text-destructive flex items-center gap-1.5">
                  <Receipt className="w-4 h-4" /> Asked for the bill
                </p>
                {table.billHeldBy && (
                  <p className="text-xs font-sans text-muted-foreground mt-0.5">
                    {table.billHeldBy === meId ? 'You are going' : `${table.billHeldByName ?? 'Someone'} is going`}
                  </p>
                )}
                <div className="flex gap-2 mt-2 flex-wrap">
                  <Button size="sm" variant="outline" disabled={busy === 'bill-ack'} onClick={claimBill} className="min-h-[44px] flex-1">
                    I'll go
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy === 'bill-done'}
                    onClick={() => run('bill-done', async () => { await resolveBillRequest(table.billId!, false); toast.success('Bill cleared'); })}
                    className="min-h-[44px] flex-1"
                  >
                    Bill given
                  </Button>
                  <Button size="sm" disabled={busy === 'bill-free'} onClick={freeTable} className="min-h-[44px] w-full">
                    Paid and gone — free the table
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ---- Covers ---- */}
        {table.sessionId && (
          <div className="rounded-xl border border-border p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-sans font-medium text-foreground flex items-center gap-1.5">
                  <Users className="w-4 h-4" /> People at the table
                </p>
                {/* Unknown is a real answer. A guess here quietly corrupts every
                    per-head number in the reports. */}
                <p className="text-xs text-muted-foreground font-sans">
                  {covers === null ? 'Not counted — leave it if you are not sure' : `${covers} covers`}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  size="icon" variant="outline" className="min-h-[44px] min-w-[44px]"
                  aria-label="One fewer"
                  disabled={busy === 'covers' || covers === null || covers <= 1}
                  onClick={() => applyCovers(covers !== null && covers > 1 ? covers - 1 : null)}
                >
                  <Minus className="w-4 h-4" />
                </Button>
                <span className="w-10 text-center font-serif text-xl tabular-nums">{covers ?? '—'}</span>
                <Button
                  size="icon" variant="outline" className="min-h-[44px] min-w-[44px]"
                  aria-label="One more"
                  disabled={busy === 'covers' || (covers ?? 0) >= 50}
                  onClick={() => applyCovers((covers ?? 0) + 1)}
                >
                  <Plus className="w-4 h-4" />
                </Button>
                {covers !== null && (
                  <Button
                    size="icon" variant="ghost" className="min-h-[44px] min-w-[44px]"
                    aria-label="Clear the count"
                    disabled={busy === 'covers'}
                    onClick={() => applyCovers(null)}
                  >
                    <X className="w-4 h-4" />
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ---- Orders ---- */}
        {table.orders.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-wide text-muted-foreground font-sans">Orders</p>
            {table.orders.map((order) => {
              const ageMs = Math.max(0, now - new Date(order.created_at).getTime());
              const urgency = order.status === 'served' ? 'fresh' : orderUrgency(ageMs);
              const paid = order.payment_status === 'paid';
              return (
                <div key={order.id} className="rounded-xl border border-border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-sans text-sm font-medium">
                      {order.order_code ? `#${order.order_code}` : order.id.slice(0, 6)} · {order.status}
                    </span>
                    <span className={`text-xs font-sans tabular-nums ${urgencyText(urgency)}`}>
                      {urgencyMark(urgency)} {formatMinutes(ageMs)}
                    </span>
                  </div>
                  {/* The runner has never had the allergy note the kitchen printed. */}
                  {order.notes && <p className="text-xs text-accent italic mt-1">Note: {order.notes}</p>}
                  <div className="flex items-center justify-between gap-2 mt-2">
                    <span className="font-sans text-sm tabular-nums">{Number(order.total).toFixed(2)} KM</span>
                    {paid ? (
                      <span className="text-xs font-sans text-primary">paid · {order.payment_method}</span>
                    ) : (
                      <div className="flex gap-2">
                        <Button
                          size="sm" variant="outline" className="min-h-[44px]"
                          onClick={() => setConfirmPay({ orderId: order.id, method: 'cash' })}
                        >
                          <Banknote className="w-4 h-4 mr-1" /> Cash
                        </Button>
                        <Button
                          size="sm" variant="outline" className="min-h-[44px]"
                          onClick={() => setConfirmPay({ orderId: order.id, method: 'pos_terminal' })}
                        >
                          <CreditCard className="w-4 h-4 mr-1" /> Terminal
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            {outstanding > 0 && (
              <p className="text-sm font-sans text-foreground">
                Outstanding: <span className="font-semibold tabular-nums">{outstanding.toFixed(2)} KM</span>
              </p>
            )}
          </div>
        )}

        {table.orders.length === 0 && table.sessionId && (
          <p className="text-sm text-muted-foreground font-sans flex items-center gap-1.5">
            <ChefHat className="w-4 h-4" /> Nothing ordered yet.
          </p>
        )}

        {!table.sessionId && (
          <p className="text-sm text-muted-foreground font-sans flex items-center gap-1.5">
            <Bell className="w-4 h-4" /> This table is free. Guests start a session by scanning the venue QR.
          </p>
        )}

        {/*
          Money is a two-step tap.
          Recording a payment cannot be undone from here — reversing it is a
          refund, which is a manager's decision — so the protection has to be
          before the fact, not after.
        */}
        {confirmPay && (
          <div className="rounded-xl border-2 border-destructive/50 bg-destructive/5 p-3">
            <p className="text-sm font-sans font-semibold text-foreground">
              Record {confirmPay.method === 'cash' ? 'cash' : 'card terminal'} payment?
            </p>
            <p className="text-xs text-muted-foreground font-sans mt-0.5">
              This goes into the end-of-day reconciliation and cannot be undone here.
            </p>
            <div className="flex gap-2 mt-2">
              <Button variant="outline" size="sm" className="min-h-[44px] flex-1" onClick={() => setConfirmPay(null)}>
                Cancel
              </Button>
              <Button size="sm" className="min-h-[44px] flex-1" disabled={busy === 'pay'} onClick={takePayment}>
                Yes, record it
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default TableActionSheet;
