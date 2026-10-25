import React, { useCallback, useEffect, useState } from 'react';
import { formatStamp } from '@/lib/timing';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { AlertTriangle, Ban, Banknote, CalendarDays, Check, RefreshCw, Smartphone, Undo2 } from 'lucide-react';
import PaymentBadge from '@/components/PaymentBadge';
import RefundDialog from '@/components/admin/RefundDialog';
import PaymentConfirm from '@/components/staff/PaymentConfirm';
import { toast } from 'sonner';
import {
  canTakePayment, cancelOrder, describePaymentResult, km, recordTablePayment, releaseHeldOrder, setFiscalization,
  updateOrderStatus, type TablePaymentMethod,
} from '@/lib/staff-api';
import { isHeld } from '@/components/staff/order-status';
import { heldReasonLabel } from '@/lib/held-orders';
import { businessDayISO, businessDayRange } from '@/lib/reporting';
import { useCoalesced, useLatestRequest } from '@/lib/realtime';
import type { Database } from '@/integrations/supabase/types';

type OrderStatus = Database['public']['Enums']['order_status'];
type OrderFilter = OrderStatus | 'all';
type AdminOrder = Database['public']['Tables']['orders']['Row'] & {
  held_reason?: string | null;
  fiscalized?: boolean | null;
  fiscalization_status?: string | null;
  fiscal_receipt_number?: string | null;
  order_code?: string | null;
  table_sessions?: { tables?: { table_number?: number | null } | null } | null;
  order_items?: (Database['public']['Tables']['order_items']['Row'] & { menu_items?: { name?: string | null } | null })[] | null;
};

/**
 * Orders per page.
 *
 * The page used to fetch the newest 100 orders of all time with no way to see
 * the 101st, so on a busy Saturday the start of the evening simply was not
 * there — and nothing said so. It now shows one trading day, in pages.
 */
const PAGE_SIZE = 50;

const tableOf = (order: AdminOrder) => order.table_sessions?.tables?.table_number ?? '?';

const AdminOrders = () => {
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [filter, setFilter] = useState<OrderFilter>('all');
  /** The trading day on screen — 05:00 to 05:00, the same day the reconciliation uses. */
  const [day, setDay] = useState(() => businessDayISO());
  const [pages, setPages] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refunding, setRefunding] = useState<AdminOrder | null>(null);

  /** Which actions are in flight, so a second tap cannot send the same thing twice. */
  const [busy, setBusy] = useState<Set<string>>(new Set());
  /** Money is a two-step tap; this is the first step. */
  const [paying, setPaying] = useState<{ order: AdminOrder; method: TablePaymentMethod } | null>(null);
  /** Cancelling needs a reason, so it needs a dialog. */
  const [cancelling, setCancelling] = useState<AdminOrder | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  /** Recording or clearing a fiscal receipt. */
  const [fiscal, setFiscal] = useState<{ order: AdminOrder; mode: 'set' | 'clear' } | null>(null);
  const [receipt, setReceipt] = useState('');

  const today = businessDayISO();
  const begin = useLatestRequest();

  const fetchOrders = useCallback(async () => {
    const isLatest = begin();
    const { start, end } = businessDayRange(day);
    let query = supabase
      .from('orders')
      .select(`*, table_sessions!inner(tables!inner(table_number)), order_items(*, menu_items(name))`)
      .gte('created_at', start)
      .lt('created_at', end)
      .order('created_at', { ascending: false })
      .range(0, pages * PAGE_SIZE - 1);

    if (filter !== 'all') {
      query = query.eq('status', filter);
    }

    const { data, error } = await query;
    // An older request that lands after a newer one must not put a stale list
    // back on screen — that is how a just-paid order showed as unpaid again.
    if (!isLatest()) return;

    setLoading(false);
    setLoadingMore(false);
    if (error) {
      // Silently showing an empty or stale list made "no orders" and "could
      // not load orders" look identical.
      setLoadError(error.message);
      return;
    }
    setLoadError(null);
    setOrders((data ?? []) as AdminOrder[]);
    setHasMore((data ?? []).length >= pages * PAGE_SIZE);
  }, [begin, day, filter, pages]);

  /** A six-item order is seven events; refetch once, after the burst. */
  const refetchSoon = useCoalesced(() => { void fetchOrders(); }, 300);

  useEffect(() => {
    void fetchOrders();
  }, [fetchOrders]);

  useEffect(() => {
    const channel = supabase
      .channel('admin-orders')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => { refetchSoon(); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [refetchSoon]);

  // A different day or filter starts again from the first page.
  useEffect(() => { setPages(1); }, [day, filter]);

  const run = async (key: string, action: () => Promise<void>) => {
    if (busy.has(key)) return;
    setBusy((prev) => new Set(prev).add(key));
    try {
      await action();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Action failed');
    } finally {
      setBusy((prev) => { const next = new Set(prev); next.delete(key); return next; });
      await fetchOrders();
    }
  };

  const updateStatus = (orderId: string, status: OrderStatus) =>
    run(`status:${orderId}`, async () => {
      await updateOrderStatus(orderId, status);
      toast.success(`Marked ${status}`);
    });

  /**
   * Record that the guest settled in the room — cash and POS stay distinct.
   *
   * The answer is read, not assumed: `already_paid` means the money arrived
   * another way (usually online) and the page must say "don't take money",
   * where it used to say "Recorded as paid in cash".
   */
  const confirmPaid = () => {
    if (!paying) return;
    const { order, method } = paying;
    void run(`pay:${order.id}`, async () => {
      const result = await recordTablePayment(order.id, method);
      const outcome = describePaymentResult(result, method);
      if (outcome.ok) toast.success(`Table ${tableOf(order)}: ${outcome.message}`);
      else toast.warning(`Table ${tableOf(order)}: ${outcome.message}`, { duration: 10_000 });
      setPaying(null);
    });
  };

  /**
   * Record that the order was rung into the certified fiscal POS.
   *
   * The app is not a fiscal device and does not issue receipts — it records the
   * receipt NUMBER from the certified device, which is the thing that makes an
   * end-of-day reconciliation against the fiscal report possible. Without a
   * number, "fiscalized" is an unverifiable tick.
   * See docs/fiscalization-workflow.md.
   *
   * Both directions go through a dialog. Recording used a `window.prompt`,
   * which phones render as an unlabeled system box, and clearing happened on a
   * single tap of a badge that looks like a label.
   */
  const openFiscal = (order: AdminOrder) => {
    const fiscalized = (order.fiscalization_status ?? (order.fiscalized ? 'fiscalized' : 'not_fiscalized')) === 'fiscalized';
    setReceipt(order.fiscal_receipt_number ?? '');
    setFiscal({ order, mode: fiscalized ? 'clear' : 'set' });
  };

  const saveFiscal = () => {
    if (!fiscal) return;
    const { order, mode } = fiscal;
    void run(`fiscal:${order.id}`, async () => {
      if (mode === 'clear') {
        await setFiscalization(order.id, 'not_fiscalized');
        toast.success('Fiscalization cleared');
      } else {
        const number = receipt.trim();
        await setFiscalization(order.id, 'fiscalized', number || undefined);
        toast.success(number ? `Recorded receipt ${number}` : 'Marked fiscalized (no receipt number)');
      }
      setFiscal(null);
    });
  };

  /**
   * Orders are never deleted. A cancelled order with a reason keeps the
   * financial record intact for reconciliation and for the audit log — which
   * is why the reason is typed by a person, not filled in as a constant that
   * says nothing about why.
   */
  const confirmCancel = () => {
    if (!cancelling || cancelReason.trim().length < 3) return;
    const order = cancelling;
    void run(`cancel:${order.id}`, async () => {
      const result = await cancelOrder(order.id, cancelReason.trim());
      if (result?.requires_refund) {
        toast.warning(`Cancelled — table ${tableOf(order)} had paid for this and needs a refund`, { duration: 10_000 });
      } else {
        toast.success('Order cancelled');
      }
      setCancelling(null);
      setCancelReason('');
    });
  };

  const statusColors: Record<OrderStatus, string> = {
    awaiting_payment: 'bg-accent/10 text-accent',
    payment_failed: 'bg-destructive/10 text-destructive',
    pending: 'bg-destructive/10 text-destructive',
    confirmed: 'bg-accent/10 text-accent',
    preparing: 'bg-gold/10 text-gold',
    ready: 'bg-primary/10 text-primary',
    served: 'bg-muted text-muted-foreground',
    cancelled: 'bg-muted text-muted-foreground line-through',
  };

  const statusLabels: Record<OrderStatus, string> = {
    awaiting_payment: 'Awaiting payment',
    payment_failed: 'Payment failed',
    pending: 'New',
    confirmed: 'Confirmed',
    preparing: 'Preparing',
    ready: 'Ready',
    served: 'Served',
    cancelled: 'Cancelled',
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h1 className="font-serif text-3xl font-bold text-foreground">Orders</h1>
        <div className="flex items-center gap-2 flex-wrap">
          {day !== today && (
            <Button variant="outline" size="sm" onClick={() => setDay(today)} className="gap-1.5 min-h-[44px]">
              <CalendarDays className="w-4 h-4" /> Today
            </Button>
          )}
          <Input
            type="date"
            value={day}
            max={today}
            onChange={(e) => { if (e.target.value) setDay(e.target.value); }}
            className="h-11 w-[160px]"
            aria-label="Trading day"
          />
          <Select value={filter} onValueChange={(value) => setFilter(value as OrderFilter)}>
            <SelectTrigger className="w-[170px] h-11 font-sans" aria-label="Filter by status"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Orders</SelectItem>
              <SelectItem value="awaiting_payment">Awaiting payment</SelectItem>
              <SelectItem value="payment_failed">Payment failed</SelectItem>
              <SelectItem value="pending">New</SelectItem>
              <SelectItem value="confirmed">Confirmed</SelectItem>
              <SelectItem value="preparing">Preparing</SelectItem>
              <SelectItem value="ready">Ready</SelectItem>
              <SelectItem value="served">Served</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* The trading day runs past midnight; say so, or 00:30 orders look misfiled. */}
      <p className="text-xs font-sans text-muted-foreground -mt-4 mb-4">
        {day === today ? 'Tonight' : new Date(`${day}T12:00:00`).toLocaleDateString()} · 05:00 to 05:00, the same day the daily report and close use
      </p>

      {loadError && (
        <div role="alert" className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm font-sans text-destructive">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span className="flex-1 min-w-[200px]">Could not load orders — what you see may be out of date. ({loadError})</span>
          <Button variant="outline" size="sm" className="min-h-[44px] gap-1.5" onClick={() => { void fetchOrders(); }}>
            <RefreshCw className="w-4 h-4" /> Try again
          </Button>
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-28 w-full rounded-xl" />)}
        </div>
      ) : (
      <div className="space-y-3">
        {orders.map((order) => {
          const refundable = ['paid', 'partially_refunded'].includes(order.payment_status)
            && Number(order.refunded_amount ?? 0) < Number(order.total);
          const isFiscalized = (order.fiscalization_status ?? (order.fiscalized ? 'fiscalized' : 'not_fiscalized')) === 'fiscalized';
          return (
          <Card key={order.id} className="border-border card-lux-hover">
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-serif font-bold text-foreground">
                      Table {tableOf(order)}
                    </span>
                    {order.order_code && (
                      <span className="text-xs font-sans font-semibold tabular-nums tracking-wider px-2 py-0.5 rounded-full bg-muted text-foreground">
                        #{order.order_code}
                      </span>
                    )}
                    {order.guest_name && (
                      <span className="text-sm font-sans text-muted-foreground">- {order.guest_name}</span>
                    )}
                    {/* A held order is "pending" in the enum but has not
                        reached the kitchen; calling it New hid it in the list. */}
                    {isHeld(order)
                      ? <Badge className="text-xs bg-amber-100 text-amber-900 border-amber-300" title={heldReasonLabel(order.held_reason)}>Needs confirming</Badge>
                      : <Badge className={`text-xs ${statusColors[order.status]}`}>{statusLabels[order.status]}</Badge>}
                    <PaymentBadge method={order.payment_method} status={order.payment_status} />
                    {order.status !== 'cancelled' && (
                      <button
                        onClick={() => openFiscal(order)}
                        disabled={busy.has(`fiscal:${order.id}`)}
                        title={isFiscalized ? 'Fiscal receipt recorded — tap to correct' : 'Mark as rung into the certified fiscal POS'}
                        className={`inline-flex items-center gap-1 px-2.5 min-h-[32px] rounded-full text-xs font-sans font-medium transition-colors disabled:opacity-50 ${isFiscalized ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground hover:bg-muted/70 border border-dashed border-border'}`}
                      >
                        {isFiscalized
                          ? <><Check className="w-3 h-3" /> {order.fiscal_receipt_number ? `Fiscal ${order.fiscal_receipt_number}` : 'Fiscalized'}</>
                          : 'Mark fiscalized'}
                      </button>
                    )}
                    {!['served', 'cancelled'].includes(order.status) && (() => {
                      const mins = Math.floor((Date.now() - new Date(order.released_to_kitchen_at ?? order.created_at).getTime()) / 60000);
                      const label = mins < 1 ? 'Just now' : mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`;
                      return (
                        <span className={`text-xs font-sans flex items-center gap-1 ${mins >= 10 ? 'text-destructive font-semibold' : 'text-muted-foreground'}`}>
                          Wait {label}
                        </span>
                      );
                    })()}
                  </div>
                  <p className="text-xs text-muted-foreground font-sans mt-1">{formatStamp(order.created_at)}</p>
                </div>
                <div className="flex items-start gap-1 shrink-0">
                  <p className="font-sans font-semibold text-foreground tabular-nums pt-2">{km(order.total)}</p>
                  {order.status !== 'cancelled' && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-11 w-11"
                      disabled={busy.has(`cancel:${order.id}`)}
                      onClick={() => { setCancelReason(''); setCancelling(order); }}
                      aria-label={`Cancel order ${order.order_code ?? order.id}`}
                    >
                      <Ban className="w-4 h-4 text-destructive" />
                    </Button>
                  )}
                </div>
              </div>

              <div className="mt-3 space-y-1">
                {order.order_items?.map((item) => (
                  <div key={item.id} className="flex justify-between text-sm font-sans">
                    <span className="text-foreground">{item.quantity}x {item.menu_items?.name}</span>
                    <span className="text-muted-foreground">{km(item.quantity * Number(item.unit_price))}</span>
                  </div>
                ))}
              </div>

              {order.status === 'awaiting_payment' && (
                <p className="mt-3 text-xs font-sans text-accent">
                  Held for online payment — not sent to the kitchen. It is released automatically when the
                  payment is confirmed, or when a waiter records payment at the table.
                </p>
              )}
              {order.status === 'payment_failed' && (
                <p className="mt-3 text-xs font-sans text-destructive">
                  The card was not charged and the kitchen has not seen this order.
                </p>
              )}

              {!['served', 'cancelled', 'awaiting_payment', 'payment_failed'].includes(order.status) && (
                <div className="flex gap-2 mt-3 flex-wrap">
                  {order.status === 'pending' && isHeld(order) && (
                    <Button
                      size="sm"
                      className="font-sans text-sm min-h-[44px]"
                      disabled={busy.has(`status:${order.id}`)}
                      onClick={async () => {
                        try {
                          await releaseHeldOrder(order.id);
                          toast.success('Sent to the kitchen');
                          void fetchOrders();
                        } catch (e) {
                          toast.error(e instanceof Error ? e.message : 'Could not confirm the order');
                        }
                      }}
                    >
                      Confirm &amp; send to kitchen
                    </Button>
                  )}
                  {order.status === 'pending' && !isHeld(order) && (
                    <Button size="sm" className="font-sans text-sm min-h-[44px]" disabled={busy.has(`status:${order.id}`)} onClick={() => updateStatus(order.id, 'confirmed')}>Confirm</Button>
                  )}
                  {order.status === 'confirmed' && (
                    <Button size="sm" className="font-sans text-sm min-h-[44px]" disabled={busy.has(`status:${order.id}`)} onClick={() => updateStatus(order.id, 'preparing')}>Start Preparing</Button>
                  )}
                  {order.status === 'preparing' && (
                    <Button size="sm" className="font-sans text-sm min-h-[44px]" disabled={busy.has(`status:${order.id}`)} onClick={() => updateStatus(order.id, 'ready')}>Mark Ready</Button>
                  )}
                  {order.status === 'ready' && (
                    <Button size="sm" className="font-sans text-sm min-h-[44px]" disabled={busy.has(`status:${order.id}`)} onClick={() => updateStatus(order.id, 'served')}>Mark Served</Button>
                  )}
                </div>
              )}

              {/* Settling in the room. Two distinct buttons, because the cash
                  drawer and the POS terminal reconcile against different things.
                  Never offered on a refunded order: that is how the same money
                  got recorded twice. */}
              {canTakePayment(order) && paying?.order.id !== order.id && (
                <div className="flex gap-2 mt-2 flex-wrap">
                  <Button size="sm" variant="outline" className="font-sans text-sm gap-1.5 min-h-[44px]" onClick={() => setPaying({ order, method: 'cash' })}>
                    <Banknote className="w-4 h-4" /> Paid cash
                  </Button>
                  <Button size="sm" variant="outline" className="font-sans text-sm gap-1.5 min-h-[44px]" onClick={() => setPaying({ order, method: 'pos_terminal' })}>
                    <Smartphone className="w-4 h-4" /> Paid on terminal
                  </Button>
                </div>
              )}

              {paying?.order.id === order.id && (
                <div className="mt-2">
                  <PaymentConfirm
                    tableNumber={tableOf(order)}
                    amount={Number(order.total)}
                    method={paying.method}
                    busy={busy.has(`pay:${order.id}`)}
                    detail={order.order_code ? `Order #${order.order_code}` : undefined}
                    onCancel={() => setPaying(null)}
                    onConfirm={confirmPaid}
                  />
                </div>
              )}

              {/* Money that has been taken can now be given back IN THE BOOKS.
                  It used to leave the building with no record: the page said
                  "you will need to refund it separately" and stopped there.
                  A partly refunded order can still be refunded the rest. */}
              {refundable && (
                <div className="flex gap-2 mt-2 flex-wrap">
                  <Button size="sm" variant="outline" className="font-sans text-sm gap-1.5 min-h-[44px]" onClick={() => setRefunding(order)}>
                    <Undo2 className="w-4 h-4" /> Refund
                  </Button>
                  {Number(order.refunded_amount ?? 0) > 0 && (
                    <span className="text-xs font-sans text-muted-foreground self-center tabular-nums">
                      {km(order.refunded_amount)} already refunded
                    </span>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
          );
        })}

        {orders.length === 0 && !loadError && (
          <p className="text-center text-muted-foreground font-sans py-10">
            {filter === 'all'
              ? (day === today ? 'No orders yet tonight — they’ll appear here as guests order.' : 'No orders on this day.')
              : `No ${statusLabels[filter as OrderStatus].toLowerCase()} orders on this day.`}
          </p>
        )}

        {hasMore && (
          <div className="flex justify-center pt-2">
            <Button
              variant="outline"
              className="min-h-[44px]"
              disabled={loadingMore}
              onClick={() => { setLoadingMore(true); setPages((p) => p + 1); }}
            >
              {loadingMore ? 'Loading…' : `Load ${PAGE_SIZE} more`}
            </Button>
          </div>
        )}
      </div>
      )}

      <Dialog open={cancelling !== null} onOpenChange={(open) => { if (!open) { setCancelling(null); setCancelReason(''); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-serif">
              Cancel order {cancelling?.order_code ? `#${cancelling.order_code}` : ''} — table {cancelling ? tableOf(cancelling) : ''}
            </DialogTitle>
            <DialogDescription>
              The order stays in the records as cancelled so the day still reconciles, and the reason is
              recorded against you.
              {cancelling && ['paid', 'partially_refunded'].includes(cancelling.payment_status)
                && ' This order has been paid for — it will still need a refund.'}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            placeholder="Why? e.g. guest left before it was made, entered twice"
            className="min-h-[88px] font-sans"
            aria-label="Reason for cancelling"
          />
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setCancelling(null); setCancelReason(''); }} className="min-h-[44px]">
              Keep order
            </Button>
            <Button
              variant="destructive"
              disabled={!cancelling || busy.has(`cancel:${cancelling.id}`) || cancelReason.trim().length < 3}
              onClick={confirmCancel}
              className="min-h-[44px]"
            >
              {cancelling && busy.has(`cancel:${cancelling.id}`) ? 'Cancelling…' : 'Cancel order'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={fiscal !== null} onOpenChange={(open) => { if (!open) setFiscal(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-serif">
              {fiscal?.mode === 'clear' ? 'Clear the fiscal record?' : 'Mark as fiscalized'}
              {fiscal ? ` — table ${tableOf(fiscal.order)}` : ''}
            </DialogTitle>
            <DialogDescription>
              {fiscal?.mode === 'clear'
                ? `This order will count as NOT rung into the fiscal POS${fiscal.order.fiscal_receipt_number ? ` (receipt ${fiscal.order.fiscal_receipt_number} is removed)` : ''}. Only do this if it was marked by mistake.`
                : 'Enter the receipt number from the certified POS device. Leave it blank only if it is not to hand — the number is what lets the day be checked against the fiscal report.'}
            </DialogDescription>
          </DialogHeader>
          {fiscal?.mode === 'set' && (
            <Input
              value={receipt}
              onChange={(e) => setReceipt(e.target.value)}
              placeholder="Fiscal receipt number"
              className="h-11"
              autoFocus
              aria-label="Fiscal receipt number"
              onKeyDown={(e) => { if (e.key === 'Enter') saveFiscal(); }}
            />
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setFiscal(null)} className="min-h-[44px]">
              Cancel
            </Button>
            <Button
              variant={fiscal?.mode === 'clear' ? 'destructive' : 'default'}
              disabled={!fiscal || busy.has(`fiscal:${fiscal.order.id}`)}
              onClick={saveFiscal}
              className="min-h-[44px]"
            >
              {fiscal?.mode === 'clear' ? 'Clear fiscalization' : receipt.trim() ? 'Record receipt' : 'Mark without a number'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <RefundDialog
        open={refunding !== null}
        onOpenChange={(open) => { if (!open) setRefunding(null); }}
        order={refunding}
        onDone={() => { setRefunding(null); void fetchOrders(); }}
      />
    </div>
  );
};

export default AdminOrders;
