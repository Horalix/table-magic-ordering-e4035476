import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { formatStamp } from '@/lib/timing';
import { supabase } from '@/integrations/supabase/client';
import { SHOW_DELETED } from '@/lib/menu-bin';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertTriangle, Ban, Banknote, CalendarDays, Check, Clock, Loader2, Receipt, ReceiptText, RefreshCw, Search, Smartphone, Undo2, X,
} from 'lucide-react';
import { AdminPageHeader } from '@/components/admin/AdminPage';
import { AdminCard, EmptyState } from '@/components/admin/AdminCard';
import { TONE, type StaffTone } from '@/components/staff/status-tone';
import { cn } from '@/lib/utils';
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
import { useCoalesced, useLatestRequest, useStaffTables } from '@/lib/realtime';
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
const ORDER_TABLES = ['orders'] as const;

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
  /** "#047", "7", "t7", a guest's name or a dish — whatever the person asking said. */
  const [query, setQuery] = useState('');

  const today = businessDayISO();
  const begin = useLatestRequest();

  /**
   * Find an order the way it is asked about: "table 7's order", "#047",
   * "the one with the risotto", "Amina's". Searches what is loaded for the
   * day; the list says when more is not loaded yet.
   */
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^#/, '');
    if (!q) return orders;
    // "table" before "t", or "table 7" loses only its first letter.
    const tableQ = q.replace(/^(table|t)\s*/, '');
    return orders.filter((o) => {
      if ((o.order_code ?? '').toLowerCase().includes(q)) return true;
      if (/^\d+$/.test(tableQ) && String(tableOf(o)) === tableQ) return true;
      if ((o.guest_name ?? '').toLowerCase().includes(q)) return true;
      return (o.order_items ?? []).some((i) => (i.menu_items?.name ?? '').toLowerCase().includes(q));
    });
  }, [orders, query]);

  const fetchOrders = useCallback(async () => {
    const isLatest = begin();
    const { start, end } = businessDayRange(day);
    let query = supabase
      .from('orders')
      .select(`*, table_sessions!inner(tables!inner(table_number)), order_items(*, menu_items(name))`)
      // Names of dishes deleted since (src/lib/menu-bin.ts).
      .setHeader(SHOW_DELETED[0], SHOW_DELETED[1])
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

  // The tab's shared channel: only the restaurant shown, and polled where the
  // socket cannot see it (the owner looking at Vera Italia).
  useStaffTables(ORDER_TABLES, refetchSoon);

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

  /** The shared staff colours (status-tone.ts); every state also has its own word. */
  const statusTone: Record<OrderStatus, StaffTone> = {
    awaiting_payment: 'bill',
    payment_failed: 'late',
    pending: 'new',
    confirmed: 'new',
    preparing: 'preparing',
    ready: 'ready',
    served: 'served',
    cancelled: 'served',
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

  /** The one next step for an order in the kitchen's flow: the filled button on its card. */
  const NEXT_STEP: Partial<Record<OrderStatus, { to: OrderStatus; label: string }>> = {
    pending: { to: 'confirmed', label: 'Confirm' },
    confirmed: { to: 'preparing', label: 'Start Preparing' },
    preparing: { to: 'ready', label: 'Mark Ready' },
    ready: { to: 'served', label: 'Mark Served' },
  };

  const dayLabel = day === today ? 'Tonight' : new Date(`${day}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div className="mx-auto w-full max-w-6xl">
      <AdminPageHeader
        title="Orders"
        description="One trading day of orders, newest first. Find one by its code, its table, a guest or a dish."
        actions={day !== today ? (
          <Button variant="outline" onClick={() => setDay(today)} className="h-11 gap-1.5 sm:h-10">
            <CalendarDays className="h-4 w-4" aria-hidden /> Back to today
          </Button>
        ) : undefined}
      >
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
          <div className="relative col-span-2 sm:min-w-[280px] sm:flex-1">
            <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="#047, table 7, a guest or a dish"
              className="h-11 ps-9 pe-11 [&::-webkit-search-cancel-button]:hidden"
              aria-label="Find an order"
            />
            {query && (
              <button
                type="button" onClick={() => setQuery('')} aria-label="Clear search"
                className="absolute end-0.5 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            )}
          </div>
          <Input
            type="date"
            value={day}
            max={today}
            onChange={(e) => { if (e.target.value) setDay(e.target.value); }}
            className="h-11 tabular-nums sm:w-[170px]"
            aria-label="Trading day"
          />
          <Select value={filter} onValueChange={(value) => setFilter(value as OrderFilter)}>
            <SelectTrigger className="h-11 font-sans text-base sm:w-[180px] sm:text-sm" aria-label="Filter by status"><SelectValue /></SelectTrigger>
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
        {/* The trading day runs past midnight; say so, or 00:30 orders look misfiled. */}
        <p className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-sans text-muted-foreground" aria-live="polite">
          <span className="font-medium text-foreground">{dayLabel}</span>
          <span aria-hidden>·</span>
          <span>trading day 05:00 to 05:00, as in the daily report</span>
          {!loading && !loadError && !query.trim() && orders.length > 0 && (
            <>
              <span aria-hidden>·</span>
              <span className="tabular-nums">
                {orders.length}{hasMore ? '+' : ''} {filter === 'all' ? (orders.length === 1 ? 'order' : 'orders') : statusLabels[filter as OrderStatus].toLowerCase()}
              </span>
            </>
          )}
          {query.trim() && !loading && (
            <>
              <span aria-hidden>·</span>
              <span className="tabular-nums">{shown.length} of {orders.length} loaded orders match{hasMore ? ' — load more below to search the rest of the day' : ''}</span>
            </>
          )}
        </p>
      </AdminPageHeader>

      {loadError && (
        <div role="alert" className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm font-sans text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
          <span className="min-w-[200px] flex-1">Could not load orders — what you see may be out of date. ({loadError})</span>
          <Button variant="outline" size="sm" className="h-11 gap-1.5 sm:h-9" onClick={() => { void fetchOrders(); }}>
            <RefreshCw className="h-4 w-4" aria-hidden /> Try again
          </Button>
        </div>
      )}

      {loading ? (
        <div className="grid gap-3 lg:grid-cols-2" aria-busy="true" aria-label="Loading orders">
          {Array.from({ length: 6 }).map((_, i) => (
            <AdminCard key={i} className="space-y-3 p-4 sm:p-5">
              <div className="flex justify-between"><Skeleton className="h-5 w-32 rounded" /><Skeleton className="h-5 w-20 rounded" /></div>
              <Skeleton className="h-4 w-48 rounded" />
              <Skeleton className="h-4 w-full rounded" />
              <Skeleton className="h-4 w-3/4 rounded" />
              <Skeleton className="h-11 w-full rounded-lg" />
            </AdminCard>
          ))}
        </div>
      ) : (
      <div className="space-y-4">
        {shown.length > 0 && (
        <div className="grid items-start gap-3 lg:grid-cols-2">
        {shown.map((order) => {
          const refundable = ['paid', 'partially_refunded'].includes(order.payment_status)
            && Number(order.refunded_amount ?? 0) < Number(order.total);
          const isFiscalized = (order.fiscalization_status ?? (order.fiscalized ? 'fiscalized' : 'not_fiscalized')) === 'fiscalized';
          const held = isHeld(order);
          const tone: StaffTone = held ? 'new' : statusTone[order.status];
          const cancelled = order.status === 'cancelled';
          const live = !['served', 'cancelled'].includes(order.status);
          const mins = Math.floor((Date.now() - new Date(order.released_to_kitchen_at ?? order.created_at).getTime()) / 60000);
          const waitLabel = mins < 1 ? 'Just in' : `Wait ${mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`}`;
          const next = order.status === 'pending' && held ? null : NEXT_STEP[order.status];
          const flowStep = !['served', 'cancelled', 'awaiting_payment', 'payment_failed'].includes(order.status);
          const canPay = canTakePayment(order) && paying?.order.id !== order.id;
          return (
          <AdminCard key={order.id} className={cn('relative overflow-hidden font-sans', !live && 'shadow-none', cancelled && 'bg-muted/20')}>
            {live && <span className={cn('absolute inset-y-0 start-0 w-1', TONE[tone].bar)} aria-hidden />}
            <div className="p-4 ps-5 sm:p-5 sm:ps-6">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span className="font-serif text-lg font-bold leading-tight text-foreground">Table {tableOf(order)}</span>
                    {order.order_code && (
                      <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs font-semibold tabular-nums tracking-wider text-foreground">
                        #{order.order_code}
                      </span>
                    )}
                    {order.guest_name && <span className="min-w-0 truncate text-sm text-muted-foreground">{order.guest_name}</span>}
                  </p>
                  <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">{formatStamp(order.created_at)}</p>
                </div>
                <p className={cn('shrink-0 pt-0.5 text-lg font-semibold tabular-nums text-foreground', cancelled && 'text-muted-foreground line-through')}>{km(order.total)}</p>
              </div>

              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                {/* A held order is "pending" in the enum but has not
                    reached the kitchen; calling it New hid it in the list. */}
                <span
                  className={cn('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium leading-4', TONE[tone].chip)}
                  title={held ? heldReasonLabel(order.held_reason) : undefined}
                >
                  <span className={cn('h-1.5 w-1.5 rounded-full', TONE[tone].dot)} aria-hidden />
                  {held ? 'Needs confirming' : statusLabels[order.status]}
                </span>
                <PaymentBadge method={order.payment_method} status={order.payment_status} />
                {live && (
                  <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium leading-4 tabular-nums', mins >= 10 ? TONE.late.chip : 'text-muted-foreground')}>
                    <Clock className="h-3 w-3" aria-hidden /> {waitLabel}
                  </span>
                )}
                {!cancelled && (
                  <button
                    type="button"
                    onClick={() => openFiscal(order)}
                    disabled={busy.has(`fiscal:${order.id}`)}
                    title={isFiscalized ? 'Fiscal receipt recorded — tap to correct' : 'Mark as rung into the certified fiscal POS'}
                    className={cn(
                      'relative inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium leading-4 transition-colors disabled:opacity-50',
                      // A 44 px target around a small chip.
                      'after:absolute after:-inset-x-1 after:-inset-y-3 after:content-[""] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      isFiscalized ? 'bg-primary/10 text-primary' : 'border border-dashed border-border text-muted-foreground hover:bg-muted',
                    )}
                  >
                    {isFiscalized
                      ? <><Check className="h-3 w-3" aria-hidden /> {order.fiscal_receipt_number ? `Fiscal ${order.fiscal_receipt_number}` : 'Fiscalized'}</>
                      : <><Receipt className="h-3 w-3" aria-hidden /> Mark fiscalized</>}
                  </button>
                )}
              </div>

              {(order.order_items?.length ?? 0) > 0 && (
                <ul className={cn('mt-3 space-y-1 border-t border-border/60 pt-3', cancelled && 'opacity-60')}>
                  {order.order_items?.map((item) => (
                    <li key={item.id} className="flex justify-between gap-3 text-sm">
                      <span className="min-w-0 text-foreground">
                        <span className="tabular-nums text-muted-foreground">{item.quantity}×</span> {item.menu_items?.name}
                      </span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">{km(item.quantity * Number(item.unit_price))}</span>
                    </li>
                  ))}
                </ul>
              )}

              {order.status === 'awaiting_payment' && (
                <p className={cn('mt-3 rounded-lg px-3 py-2 text-xs leading-relaxed', TONE.bill.surface)}>
                  Held for online payment — not sent to the kitchen. It is released automatically when the
                  payment is confirmed, or when a waiter records payment at the table.
                </p>
              )}
              {order.status === 'payment_failed' && (
                <p className={cn('mt-3 rounded-lg border px-3 py-2 text-xs leading-relaxed', TONE.late.surface, TONE.late.text)}>
                  The card was not charged and the kitchen has not seen this order.
                </p>
              )}
              {Number(order.refunded_amount ?? 0) > 0 && (
                <p className="mt-3 text-xs tabular-nums text-muted-foreground">{km(order.refunded_amount)} already refunded</p>
              )}

              {paying?.order.id === order.id && (
                <div className="mt-3">
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

              {/* One row of actions: the next step filled, money outlined, cancel quiet at the end. */}
              {(flowStep || canPay || refundable || !cancelled) && (
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {flowStep && order.status === 'pending' && held && (
                    <Button
                      className="h-11 font-semibold sm:h-10"
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
                  {flowStep && next && (
                    <Button className="h-11 font-semibold sm:h-10" disabled={busy.has(`status:${order.id}`)} onClick={() => updateStatus(order.id, next.to)}>
                      {next.label}
                    </Button>
                  )}
                  {/* Settling in the room. Two distinct buttons, because the cash
                      drawer and the POS terminal reconcile against different things.
                      Never offered on a refunded order: that is how the same money
                      got recorded twice. */}
                  {canPay && (
                    <>
                      <Button variant="outline" className="h-11 gap-1.5 sm:h-10" onClick={() => setPaying({ order, method: 'cash' })}>
                        <Banknote className="h-4 w-4" aria-hidden /> Paid cash
                      </Button>
                      <Button variant="outline" className="h-11 gap-1.5 sm:h-10" onClick={() => setPaying({ order, method: 'pos_terminal' })}>
                        <Smartphone className="h-4 w-4" aria-hidden /> Paid on terminal
                      </Button>
                    </>
                  )}
                  {/* Money that has been taken can now be given back IN THE BOOKS.
                      It used to leave the building with no record: the page said
                      "you will need to refund it separately" and stopped there.
                      A partly refunded order can still be refunded the rest. */}
                  {refundable && (
                    <Button variant="outline" className="h-11 gap-1.5 sm:h-10" onClick={() => setRefunding(order)}>
                      <Undo2 className="h-4 w-4" aria-hidden /> Refund
                    </Button>
                  )}
                  {!cancelled && (
                    <Button
                      variant="ghost"
                      className="ms-auto h-11 gap-1.5 px-3 text-muted-foreground hover:bg-destructive/10 hover:text-destructive sm:h-10"
                      disabled={busy.has(`cancel:${order.id}`)}
                      onClick={() => { setCancelReason(''); setCancelling(order); }}
                      aria-label={`Cancel order ${order.order_code ?? order.id}`}
                    >
                      <Ban className="h-4 w-4" aria-hidden /> Cancel
                    </Button>
                  )}
                </div>
              )}
            </div>
          </AdminCard>
          );
        })}
        </div>
        )}

        {!loadError && (orders.length === 0 || shown.length === 0) && (
          <AdminCard>
            {orders.length === 0 ? (
              <EmptyState
                icon={ReceiptText}
                title={filter === 'all'
                  ? (day === today ? 'No orders yet tonight — they’ll appear here as guests order.' : 'No orders on this day.')
                  : `No ${statusLabels[filter as OrderStatus].toLowerCase()} orders on this day.`}
                hint={filter !== 'all' ? 'Choose All Orders to see the rest of the day.' : day === today ? 'This list updates by itself.' : 'Pick another day above.'}
              />
            ) : (
              <EmptyState icon={Search} title={`Nothing loaded matches “${query.trim()}”.`}
                hint={hasMore ? 'Load more below to search the rest of the day, or try a table number or a dish.' : 'Try the order code without #, a table number or a dish.'} />
            )}
          </AdminCard>
        )}

        {hasMore && (
          <div className="flex justify-center pt-2">
            <Button
              variant="outline"
              className="h-11 gap-2 sm:h-10"
              disabled={loadingMore}
              onClick={() => { setLoadingMore(true); setPages((p) => p + 1); }}
            >
              {loadingMore && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />}
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
            <Button variant="outline" onClick={() => { setCancelling(null); setCancelReason(''); }} className="h-11 sm:h-10">
              Keep order
            </Button>
            <Button
              variant="destructive"
              disabled={!cancelling || busy.has(`cancel:${cancelling.id}`) || cancelReason.trim().length < 3}
              onClick={confirmCancel}
              className="h-11 sm:h-10"
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
            <Button variant="outline" onClick={() => setFiscal(null)} className="h-11 sm:h-10">
              Cancel
            </Button>
            <Button
              variant={fiscal?.mode === 'clear' ? 'destructive' : 'default'}
              disabled={!fiscal || busy.has(`fiscal:${fiscal.order.id}`)}
              onClick={saveFiscal}
              className="h-11 sm:h-10"
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
