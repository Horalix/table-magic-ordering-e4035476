import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Ban, Check, Banknote, Smartphone } from 'lucide-react';
import PaymentBadge from '@/components/PaymentBadge';
import RefundDialog from '@/components/admin/RefundDialog';
import { toast } from 'sonner';
import { cancelOrder, recordTablePayment, setFiscalization, updateOrderStatus } from '@/lib/staff-api';
import { Undo2 } from 'lucide-react';
import type { Database } from '@/integrations/supabase/types';

type OrderStatus = Database['public']['Enums']['order_status'];
type OrderFilter = OrderStatus | 'all';
type AdminOrder = Database['public']['Tables']['orders']['Row'] & {
  fiscalized?: boolean | null;
  fiscalization_status?: string | null;
  fiscal_receipt_number?: string | null;
  order_code?: string | null;
  table_sessions?: { tables?: { table_number?: number | null } | null } | null;
  order_items?: (Database['public']['Tables']['order_items']['Row'] & { menu_items?: { name?: string | null } | null })[] | null;
};

const AdminOrders = () => {
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [filter, setFilter] = useState<OrderFilter>('all');
  const [loading, setLoading] = useState(true);
  const [refunding, setRefunding] = useState<AdminOrder | null>(null);

  const fetchOrders = useCallback(async () => {
    let query = supabase
      .from('orders')
      .select(`*, table_sessions!inner(tables!inner(table_number)), order_items(*, menu_items(name))`)
      .order('created_at', { ascending: false })
      .limit(100);

    if (filter !== 'all') {
      query = query.eq('status', filter);
    }

    const { data } = await query;
    setOrders(data || []);
    setLoading(false);
  }, [filter]);

  useEffect(() => {
    void fetchOrders();
    const channel = supabase
      .channel('admin-orders')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => { void fetchOrders(); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchOrders]);

  const run = async (action: () => Promise<unknown>, success: string) => {
    try {
      await action();
      toast.success(success);
      await fetchOrders();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Action failed');
      await fetchOrders();
    }
  };

  const updateStatus = (orderId: string, status: OrderStatus) =>
    run(() => updateOrderStatus(orderId, status), `Marked ${status}`);

  /** Record that the guest settled in the room — cash and POS stay distinct. */
  const markPaid = (order: AdminOrder, method: 'cash' | 'pos_terminal') =>
    run(() => recordTablePayment(order.id, method),
      method === 'cash' ? 'Recorded as paid in cash' : 'Recorded as paid on the terminal');

  /**
   * Record that the order was rung into the certified fiscal POS.
   *
   * The app is not a fiscal device and does not issue receipts — it records the
   * receipt NUMBER from the certified device, which is the thing that makes an
   * end-of-day reconciliation against the fiscal report possible. Without a
   * number, "fiscalized" is an unverifiable tick.
   * See docs/fiscalization-workflow.md.
   */
  const toggleFiscalized = (order: AdminOrder) => {
    const fiscalized = (order.fiscalization_status ?? (order.fiscalized ? 'fiscalized' : 'not_fiscalized')) === 'fiscalized';

    if (fiscalized) {
      return run(() => setFiscalization(order.id, 'not_fiscalized'), 'Fiscalization cleared');
    }

    const receipt = window.prompt(
      'Fiscal receipt number from the POS device (leave blank if not to hand):',
      order.fiscal_receipt_number ?? '',
    );
    // Cancel means cancel — do not silently mark it done.
    if (receipt === null) return Promise.resolve();

    return run(
      () => setFiscalization(order.id, 'fiscalized', receipt.trim() || undefined),
      receipt.trim() ? `Recorded receipt ${receipt.trim()}` : 'Marked fiscalized (no receipt number)',
    );
  };

  /**
   * Orders are never deleted. A cancelled order with a reason keeps the
   * financial record intact for reconciliation and for the audit log.
   */
  const voidOrder = (orderId: string, reason: string) =>
    run(() => cancelOrder(orderId, reason), 'Order cancelled');

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
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-serif text-3xl font-bold text-foreground">Orders</h1>
        <Select value={filter} onValueChange={(value) => setFilter(value as OrderFilter)}>
          <SelectTrigger className="w-[150px] font-sans"><SelectValue /></SelectTrigger>
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

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-28 w-full rounded-xl" />)}
        </div>
      ) : (
      <div className="space-y-3">
        {orders.map((order) => (
          <Card key={order.id} className="border-border card-lux-hover">
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-serif font-bold text-foreground">
                      Table {order.table_sessions?.tables?.table_number}
                    </span>
                    {order.order_code && (
                      <span className="text-xs font-sans font-semibold tabular-nums tracking-wider px-2 py-0.5 rounded-full bg-muted text-foreground">
                        #{order.order_code}
                      </span>
                    )}
                    {order.guest_name && (
                      <span className="text-sm font-sans text-muted-foreground">- {order.guest_name}</span>
                    )}
                    <Badge className={`text-xs ${statusColors[order.status]}`}>{statusLabels[order.status]}</Badge>
                    <PaymentBadge method={order.payment_method} status={order.payment_status} />
                    {order.status !== 'cancelled' && (
                      <button
                        onClick={() => toggleFiscalized(order)}
                        title="Mark as rung into the certified fiscal POS"
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-sans font-medium transition-colors ${order.fiscalized ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground hover:bg-muted/70 border border-dashed border-border'}`}
                      >
                        {order.fiscalized
                          ? <><Check className="w-3 h-3" /> {order.fiscal_receipt_number ? `Fiscal ${order.fiscal_receipt_number}` : 'Fiscalized'}</>
                          : 'Mark fiscalized'}
                      </button>
                    )}
                    {!['served', 'cancelled'].includes(order.status) && (() => {
                      const mins = Math.floor((Date.now() - new Date(order.created_at).getTime()) / 60000);
                      const label = mins < 1 ? 'Just now' : mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`;
                      return (
                        <span className={`text-xs font-sans flex items-center gap-1 ${mins >= 10 ? 'text-destructive font-semibold' : 'text-muted-foreground'}`}>
                          Wait {label}
                        </span>
                      );
                    })()}
                  </div>
                  <p className="text-xs text-muted-foreground font-sans mt-1">{new Date(order.created_at).toLocaleString()}</p>
                </div>
                <div className="flex items-start gap-2">
                  <p className="font-serif font-bold text-foreground">{Number(order.total).toFixed(2)} KM</p>
                  {order.status !== 'cancelled' && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`Cancel order ${order.order_code ?? order.id}`}>
                          <Ban className="w-4 h-4 text-destructive" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Cancel this order?</AlertDialogTitle>
                          <AlertDialogDescription>
                            The order stays in the records as cancelled so the day still reconciles.
                            {order.payment_status === 'paid' && ' This order is paid — you will need to refund it separately.'}
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Keep order</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => voidOrder(order.id, 'Cancelled by manager from Orders')}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          >
                            Cancel order
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                </div>
              </div>

              <div className="mt-3 space-y-1">
                {order.order_items?.map((item) => (
                  <div key={item.id} className="flex justify-between text-sm font-sans">
                    <span className="text-foreground">{item.quantity}x {item.menu_items?.name}</span>
                    <span className="text-muted-foreground">{(item.quantity * Number(item.unit_price)).toFixed(2)} KM</span>
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
                  {order.status === 'pending' && (
                    <Button size="sm" className="font-sans text-xs" onClick={() => updateStatus(order.id, 'confirmed')}>Confirm</Button>
                  )}
                  {order.status === 'confirmed' && (
                    <Button size="sm" className="font-sans text-xs" onClick={() => updateStatus(order.id, 'preparing')}>Start Preparing</Button>
                  )}
                  {order.status === 'preparing' && (
                    <Button size="sm" className="font-sans text-xs" onClick={() => updateStatus(order.id, 'ready')}>Mark Ready</Button>
                  )}
                  {order.status === 'ready' && (
                    <Button size="sm" className="font-sans text-xs" onClick={() => updateStatus(order.id, 'served')}>Mark Served</Button>
                  )}
                </div>
              )}

              {/* Settling in the room. Two distinct buttons, because the cash
                  drawer and the POS terminal reconcile against different things. */}
              {order.payment_status !== 'paid' && !['cancelled', 'awaiting_payment'].includes(order.status) && (
                <div className="flex gap-2 mt-2 flex-wrap">
                  <Button size="sm" variant="outline" className="font-sans text-xs gap-1.5" onClick={() => markPaid(order, 'cash')}>
                    <Banknote className="w-3.5 h-3.5" /> Paid cash
                  </Button>
                  <Button size="sm" variant="outline" className="font-sans text-xs gap-1.5" onClick={() => markPaid(order, 'pos_terminal')}>
                    <Smartphone className="w-3.5 h-3.5" /> Paid on terminal
                  </Button>
                </div>
              )}

              {/* Money that has been taken can now be given back IN THE BOOKS.
                  It used to leave the building with no record: the page said
                  "you will need to refund it separately" and stopped there. */}
              {order.payment_status === 'paid' && Number(order.refunded_amount ?? 0) < Number(order.total) && (
                <div className="flex gap-2 mt-2 flex-wrap">
                  <Button size="sm" variant="outline" className="font-sans text-xs gap-1.5" onClick={() => setRefunding(order)}>
                    <Undo2 className="w-3.5 h-3.5" /> Refund
                  </Button>
                  {Number(order.refunded_amount ?? 0) > 0 && (
                    <span className="text-xs font-sans text-muted-foreground self-center tabular-nums">
                      {Number(order.refunded_amount).toFixed(2)} KM already refunded
                    </span>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        ))}

        {orders.length === 0 && (
          <p className="text-center text-muted-foreground font-sans py-10">
            {filter === 'all' ? 'No orders yet — they’ll appear here as guests order.' : `No ${filter} orders.`}
          </p>
        )}
      </div>
      )}

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
