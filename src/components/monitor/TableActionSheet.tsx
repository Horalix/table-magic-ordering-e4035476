import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Banknote, Bell, ChefHat, CreditCard, Hand, Minus, Plus, PowerOff, Receipt, Users, X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { formatDuration, formatMinutes, orderUrgency, urgencyText, urgencyMark } from '@/lib/timing';
import { useNow } from '@/lib/clock';
import {
  ackBillRequest, ackWaiterCall, canTakePayment, describePaymentResult, km, outstandingFor,
  recordTablePayment, resolveBillRequest, resolveWaiterCall, setCovers, type TablePaymentMethod,
} from '@/lib/staff-api';
import PaymentConfirm from '@/components/staff/PaymentConfirm';
import FreeTableDialog from '@/components/staff/FreeTableDialog';
import {
  isHeld, isInKitchen, kitchenStart, orderStatusLabel, paymentStatusLabel,
} from '@/components/staff/order-status';

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
  refunded_amount: number | null;
  notes: string | null;
  created_at: string;
  released_to_kitchen_at: string | null;
  /** Set while the order waits for staff to confirm it; see `isHeld`. */
  held_reason?: string | null;
}

export interface SheetTable {
  /** The table's own id — what this sheet's local state is keyed on. */
  tableId: string;
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
  callHeldSince: string | null;
  billId: string | null;
  billHeldBy: string | null;
  billHeldByName: string | null;
  billHeldSince: string | null;
  orders: SheetOrder[];
}

interface Props {
  table: SheetTable | null;
  /** Current staff user, so "you have this" reads differently from "Marko has this". */
  meId: string | null;
  onClose: () => void;
  onChanged: () => void;
}

/** "Marko is going (3m)". */
const heldText = (heldBy: string | null, meId: string | null, name: string | null, since: string | null, now: number) => {
  const who = heldBy === meId ? 'You are going' : `${name ?? 'Someone'} is going`;
  if (!since) return who;
  return `${who} (${Math.max(0, Math.floor((now - new Date(since).getTime()) / 60_000))}m)`;
};

/**
 * The sheet's working state belongs to ONE table.
 *
 * It used to live for as long as the monitor did, so a payment confirmation
 * opened on table 4 was still armed when the sheet was reopened on table 9 —
 * and "Yes, record it" then recorded table 4's order from table 9's sheet.
 * The parent keys this component on the table id, and the state is reset here
 * too, so nothing can carry across.
 */
const TableActionSheet = ({ table, meId, onClose, onChanged }: Props) => {
  const now = useNow();
  const [busy, setBusy] = useState<string | null>(null);
  /** Money taps are two-step. There is no undo on a recorded payment. */
  const [confirmPay, setConfirmPay] = useState<{ orderId: string; method: TablePaymentMethod; amount: number } | null>(null);
  const [coversDraft, setCoversDraft] = useState<number | null>(null);
  /** Paid here, before the refetch lands — so the buttons cannot be tapped twice. */
  const [paidHere, setPaidHere] = useState<Set<string>>(new Set());
  const [freeOpen, setFreeOpen] = useState(false);

  const tableId = table?.tableId ?? null;
  useEffect(() => {
    setConfirmPay(null);
    setCoversDraft(null);
    setPaidHere(new Set());
    setFreeOpen(false);
    setBusy(null);
  }, [tableId]);

  if (!table) return null;

  const covers = coversDraft ?? table.covers;
  const seatedMs = table.openedAt ? Math.max(0, now - new Date(table.openedAt).getTime()) : 0;
  const payable = table.orders.filter((o) => !paidHere.has(o.id));
  const outstanding = outstandingFor(payable);

  const run = async (key: string, fn: () => Promise<void>) => {
    if (busy) return;
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

  const applyCovers = (next: number | null) => {
    setCoversDraft(next);
    void run('covers', async () => { await setCovers(table.sessionId!, next); });
  };

  const takePayment = () => confirmPay && run('pay', async () => {
    const { orderId, method } = confirmPay;
    const result = await recordTablePayment(orderId, method);
    const said = describePaymentResult(result, method);
    setPaidHere((prev) => new Set(prev).add(orderId));
    setConfirmPay(null);
    if (said.ok) toast.success(`Table ${table.tableNumber}: ${said.message}`);
    // Not a success: the guest already paid some other way. Loud and lasting,
    // because the money may be in the waiter's hand right now.
    else toast.warning(`Table ${table.tableNumber}: ${said.message}`, { duration: 10_000 });
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
          <DialogDescription className="text-sm">
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
                  <p className="text-sm font-sans text-muted-foreground mt-0.5">
                    {heldText(table.callHeldBy, meId, table.callHeldByName, table.callHeldSince, now)}
                  </p>
                )}
                <div className="flex gap-2 mt-2">
                  <Button size="sm" variant="outline" disabled={busy !== null} onClick={claimCall} className="min-h-[44px] flex-1 text-sm">
                    I'll go
                  </Button>
                  <Button
                    size="sm"
                    disabled={busy !== null}
                    onClick={() => run('call-done', async () => { await resolveWaiterCall(table.callId!); toast.success('Call cleared'); })}
                    className="min-h-[44px] flex-1 text-sm"
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
                  {outstanding > 0 && <span className="ml-auto tabular-nums text-foreground">Owes {km(outstanding)}</span>}
                </p>
                {table.billHeldBy && (
                  <p className="text-sm font-sans text-muted-foreground mt-0.5">
                    {heldText(table.billHeldBy, meId, table.billHeldByName, table.billHeldSince, now)}
                  </p>
                )}
                <div className="flex gap-2 mt-2 flex-wrap">
                  <Button size="sm" variant="outline" disabled={busy !== null} onClick={claimBill} className="min-h-[44px] flex-1 text-sm">
                    I'll go
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy !== null}
                    onClick={() => run('bill-done', async () => { await resolveBillRequest(table.billId!, false); toast.success('Bill cleared'); })}
                    className="min-h-[44px] flex-1 text-sm"
                  >
                    Bill given
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
                <p className="text-sm text-muted-foreground font-sans">
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
              const held = isHeld(order);
              const inKitchen = isInKitchen(order.status) && !held;
              const ageMs = Math.max(0, now - new Date(kitchenStart(order)).getTime());
              const urgency = order.status === 'served' || !inKitchen ? 'fresh' : orderUrgency(ageMs);
              const payLabel = paidHere.has(order.id) ? 'Recorded just now' : paymentStatusLabel(order.payment_status, order.payment_method);
              const payable = !paidHere.has(order.id) && canTakePayment(order);
              return (
                <div key={order.id} className="rounded-xl border border-border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-sans text-sm font-medium">
                      {order.order_code ? `#${order.order_code}` : order.id.slice(0, 6)} · {held ? 'Needs confirming' : orderStatusLabel(order.status)}
                    </span>
                    {inKitchen && (
                      <span className={`text-sm font-sans tabular-nums ${urgencyText(urgency)}`}>
                        {urgencyMark(urgency)} {formatMinutes(ageMs)}
                      </span>
                    )}
                  </div>
                  {/* A card order whose payment has not cleared is not in the
                      kitchen. Without saying so it looks like a brand-new order,
                      and the waiter chases food nobody is cooking. */}
                  {!inKitchen && order.status !== 'cancelled' && (
                    <p className="text-sm font-sans text-accent mt-1">
                      {held ? 'Not in kitchen — confirm it in “Needs confirming”' : 'Not in kitchen — online payment pending'}
                    </p>
                  )}
                  {/* The runner has never had the allergy note the kitchen printed. */}
                  {order.notes && <p className="text-sm text-accent font-semibold mt-1">Note: {order.notes}</p>}
                  <div className="flex items-center justify-between gap-2 mt-2">
                    <span className="font-sans text-sm tabular-nums">
                      {km(order.total)}
                      {payLabel && <span className="text-muted-foreground"> · {payLabel}</span>}
                    </span>
                    {payable && (
                      <div className="flex gap-2">
                        <Button
                          size="sm" variant="outline" className="min-h-[44px] text-sm"
                          disabled={busy !== null}
                          onClick={() => setConfirmPay({ orderId: order.id, method: 'cash', amount: Number(order.total) })}
                        >
                          <Banknote className="w-4 h-4 mr-1" /> Cash
                        </Button>
                        <Button
                          size="sm" variant="outline" className="min-h-[44px] text-sm"
                          disabled={busy !== null}
                          onClick={() => setConfirmPay({ orderId: order.id, method: 'pos_terminal', amount: Number(order.total) })}
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
              <p className="text-base font-sans text-foreground">
                Outstanding: <span className="font-semibold tabular-nums">{km(outstanding)}</span>
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

        {confirmPay && (
          <PaymentConfirm
            tableNumber={table.tableNumber}
            amount={confirmPay.amount}
            method={confirmPay.method}
            busy={busy === 'pay'}
            onCancel={() => setConfirmPay(null)}
            onConfirm={takePayment}
          />
        )}

        {table.sessionId && (
          <Button
            variant="outline"
            className="min-h-[44px] w-full text-sm text-muted-foreground hover:text-destructive"
            disabled={busy !== null}
            onClick={() => setFreeOpen(true)}
          >
            <PowerOff className="w-4 h-4 mr-1.5" /> Guests have gone — free the table
          </Button>
        )}

        <FreeTableDialog
          open={freeOpen}
          onOpenChange={setFreeOpen}
          sessionId={table.sessionId}
          tableNumber={table.tableNumber}
          knownOwed={outstanding}
          onFreed={() => { onChanged(); onClose(); }}
        />
      </DialogContent>
    </Dialog>
  );
};

export default TableActionSheet;
