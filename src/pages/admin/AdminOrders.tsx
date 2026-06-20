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
import { Trash2, Check } from 'lucide-react';
import PaymentBadge from '@/components/PaymentBadge';
import { toast } from 'sonner';
import type { Database } from '@/integrations/supabase/types';

type OrderStatus = Database['public']['Enums']['order_status'];
type OrderFilter = OrderStatus | 'all';
type AdminOrder = Database['public']['Tables']['orders']['Row'] & {
  fiscalized?: boolean | null;
  table_sessions?: { tables?: { table_number?: number | null } | null } | null;
  order_items?: (Database['public']['Tables']['order_items']['Row'] & { menu_items?: { name?: string | null } | null })[] | null;
};

const AdminOrders = () => {
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [filter, setFilter] = useState<OrderFilter>('all');
  const [loading, setLoading] = useState(true);

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

  const updateStatus = async (orderId: string, status: OrderStatus) => {
    await supabase.from('orders').update({ status }).eq('id', orderId);
    await fetchOrders();
  };

  // Mark an order as rung into the certified fiscal POS (reconciliation).
  const toggleFiscalized = async (order: AdminOrder) => {
    const next = !order.fiscalized;
    setOrders((prev) => prev.map((o) => o.id === order.id ? { ...o, fiscalized: next } : o)); // optimistic
    const { error } = await supabase.from('orders')
      .update({ fiscalized: next, fiscalized_at: next ? new Date().toISOString() : null } as never)
      .eq('id', order.id);
    if (error) { toast.error(error.message); void fetchOrders(); }
  };

  const deleteOrder = async (orderId: string) => {
    const { error: e1 } = await supabase.from('order_items').delete().eq('order_id', orderId);
    if (e1) { toast.error(e1.message); return; }
    const { error: e2 } = await supabase.from('orders').delete().eq('id', orderId);
    if (e2) { toast.error(e2.message); return; }
    toast.success('Order deleted');
    await fetchOrders();
  };

  const statusColors: Record<OrderStatus, string> = {
    pending: 'bg-destructive/10 text-destructive',
    confirmed: 'bg-accent/10 text-accent',
    preparing: 'bg-gold/10 text-gold',
    ready: 'bg-primary/10 text-primary',
    served: 'bg-muted text-muted-foreground',
    cancelled: 'bg-muted text-muted-foreground line-through',
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-serif text-3xl font-bold text-foreground">Orders</h1>
        <Select value={filter} onValueChange={(value) => setFilter(value as OrderFilter)}>
          <SelectTrigger className="w-[150px] font-sans"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Orders</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
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
                    {order.guest_name && (
                      <span className="text-sm font-sans text-muted-foreground">- {order.guest_name}</span>
                    )}
                    <Badge className={`text-xs ${statusColors[order.status]}`}>{order.status}</Badge>
                    <PaymentBadge method={order.payment_method} status={order.payment_status} />
                    {order.status !== 'cancelled' && (
                      <button
                        onClick={() => toggleFiscalized(order)}
                        title="Mark as rung into the fiscal POS"
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-sans font-medium transition-colors ${order.fiscalized ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground hover:bg-muted/70 border border-dashed border-border'}`}
                      >
                        {order.fiscalized ? <><Check className="w-3 h-3" /> Fiscalized</> : 'Mark fiscalized'}
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
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`Delete order ${order.id}`}>
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete this order?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Permanently removes the order and its items. This cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => deleteOrder(order.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
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

              {order.status !== 'served' && order.status !== 'cancelled' && (
                <div className="flex gap-2 mt-3">
                  {order.status === 'pending' && (
                    <>
                      <Button size="sm" className="font-sans text-xs" onClick={() => updateStatus(order.id, 'confirmed')}>Confirm</Button>
                      <Button size="sm" variant="destructive" className="font-sans text-xs" onClick={() => updateStatus(order.id, 'cancelled')}>Cancel</Button>
                    </>
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
    </div>
  );
};

export default AdminOrders;
