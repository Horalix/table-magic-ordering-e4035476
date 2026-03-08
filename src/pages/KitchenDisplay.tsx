import React, { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { motion, AnimatePresence } from 'framer-motion';
import { Bell, Clock, ChefHat, Check, Utensils, Hand, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface OrderWithItems {
  id: string;
  status: string;
  total: number;
  notes: string | null;
  created_at: string;
  table_number: number;
  items: {
    id: string;
    quantity: number;
    unit_price: number;
    notes: string | null;
    status: string;
    menu_item_name: string;
  }[];
}

interface WaiterCall {
  id: string;
  table_session_id: string;
  status: string;
  created_at: string;
  table_number: number;
}

interface BillRequest {
  id: string;
  table_session_id: string;
  status: string;
  created_at: string;
  table_number: number;
}

const statusColors: Record<string, string> = {
  pending: 'bg-destructive/10 text-destructive border-destructive/20',
  confirmed: 'bg-accent/10 text-accent border-accent/20',
  preparing: 'bg-accent/15 text-accent border-accent/25',
  ready: 'bg-primary/10 text-primary border-primary/20',
  served: 'bg-muted text-muted-foreground border-border',
};

const statusIcons: Record<string, React.ReactNode> = {
  pending: <Bell className="w-3.5 h-3.5" />,
  confirmed: <Clock className="w-3.5 h-3.5" />,
  preparing: <ChefHat className="w-3.5 h-3.5" />,
  ready: <Check className="w-3.5 h-3.5" />,
  served: <Utensils className="w-3.5 h-3.5" />,
};

const KitchenDisplay = () => {
  const [orders, setOrders] = useState<OrderWithItems[]>([]);
  const [waiterCalls, setWaiterCalls] = useState<WaiterCall[]>([]);
  const [billRequests, setBillRequests] = useState<BillRequest[]>([]);
  const [filter, setFilter] = useState<string>('active');

  const fetchOrders = async () => {
    const { data: ordersData, error } = await supabase
      .from('orders')
      .select(`
        *,
        table_sessions!inner(
          tables!inner(table_number)
        ),
        order_items(
          *,
          menu_items(name)
        )
      `)
      .in('status', filter === 'active' ? ['pending', 'confirmed', 'preparing', 'ready'] : ['served', 'cancelled'])
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      console.error('Error fetching orders:', error);
      return;
    }

    const mapped: OrderWithItems[] = (ordersData || []).map((o: any) => ({
      id: o.id,
      status: o.status,
      total: o.total,
      notes: o.notes,
      created_at: o.created_at,
      table_number: o.table_sessions?.tables?.table_number || 0,
      items: (o.order_items || []).map((oi: any) => ({
        id: oi.id,
        quantity: oi.quantity,
        unit_price: oi.unit_price,
        notes: oi.notes,
        status: oi.status,
        menu_item_name: oi.menu_items?.name || 'Unknown',
      })),
    }));

    setOrders(mapped);
  };

  const fetchWaiterCalls = async () => {
    const { data, error } = await supabase
      .from('waiter_calls')
      .select(`
        *,
        table_sessions!inner(
          tables!inner(table_number)
        )
      `)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching waiter calls:', error);
      return;
    }

    const mapped: WaiterCall[] = (data || []).map((c: any) => ({
      id: c.id,
      table_session_id: c.table_session_id,
      status: c.status,
      created_at: c.created_at,
      table_number: c.table_sessions?.tables?.table_number || 0,
    }));

    setWaiterCalls(mapped);
  };

  const fetchBillRequests = async () => {
    const { data, error } = await supabase
      .from('bill_requests')
      .select(`
        *,
        table_sessions!inner(
          tables!inner(table_number)
        )
      `)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching bill requests:', error);
      return;
    }

    const mapped: BillRequest[] = (data || []).map((b: any) => ({
      id: b.id,
      table_session_id: b.table_session_id,
      status: b.status,
      created_at: b.created_at,
      table_number: b.table_sessions?.tables?.table_number || 0,
    }));

    setBillRequests(mapped);
  };

  useEffect(() => {
    fetchOrders();
    fetchWaiterCalls();
    fetchBillRequests();

    const channel = supabase
      .channel('kitchen-all')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => {
        fetchOrders();
        if (Notification.permission === 'granted') {
          new Notification('New Order!', { body: 'A new order has been placed.' });
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_items' }, () => {
        fetchOrders();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'waiter_calls' }, () => {
        fetchWaiterCalls();
        if (Notification.permission === 'granted') {
          new Notification('🔔 Waiter Call!', { body: 'A table is requesting assistance.' });
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bill_requests' }, () => {
        fetchBillRequests();
        if (Notification.permission === 'granted') {
          new Notification('💳 Bill Requested!', { body: 'A table is ready to pay.' });
        }
      })
      .subscribe();

    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }

    return () => {
      supabase.removeChannel(channel);
    };
  }, [filter]);

  const updateOrderStatus = async (orderId: string, newStatus: string) => {
    const { error } = await supabase
      .from('orders')
      .update({ status: newStatus as any })
      .eq('id', orderId);

    if (error) {
      toast.error('Failed to update order status');
    } else {
      toast.success(`Order marked as ${newStatus}`);
      fetchOrders();
    }
  };

  const resolveWaiterCall = async (callId: string) => {
    const { error } = await supabase
      .from('waiter_calls')
      .update({ status: 'resolved', resolved_at: new Date().toISOString() } as any)
      .eq('id', callId);

    if (error) {
      toast.error('Failed to resolve call');
    } else {
      toast.success('Waiter call resolved');
      fetchWaiterCalls();
    }
  };

  const resolveBillRequest = async (requestId: string) => {
    const { error } = await supabase
      .from('bill_requests')
      .update({ status: 'resolved', resolved_at: new Date().toISOString() })
      .eq('id', requestId);

    if (error) {
      toast.error('Failed to resolve bill request');
    } else {
      toast.success('Bill request resolved');
      fetchBillRequests();
    }
  };

  const getNextStatus = (current: string) => {
    const flow: Record<string, string> = {
      pending: 'confirmed',
      confirmed: 'preparing',
      preparing: 'ready',
      ready: 'served',
    };
    return flow[current];
  };

  const timeSince = (dateStr: string) => {
    const mins = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    return `${Math.floor(mins / 60)}h ${mins % 60}m ago`;
  };

  // [UX] Check if order is urgent (pending > 5 mins)
  const isUrgent = (order: OrderWithItems) => {
    if (order.status !== 'pending') return false;
    const mins = Math.floor((Date.now() - new Date(order.created_at).getTime()) / 60000);
    return mins >= 5;
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="sticky top-0 z-30 glass border-b border-border">
        <div className="flex items-center justify-between px-6 py-4">
          <div>
            <h1 className="font-serif text-2xl font-bold text-foreground">Kitchen Display</h1>
            <p className="text-sm text-muted-foreground font-sans">{orders.length} orders</p>
          </div>
          <div className="flex gap-2">
            <Button
              variant={filter === 'active' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFilter('active')}
              className="rounded-full font-sans min-h-[44px]"
            >
              Active
            </Button>
            <Button
              variant={filter === 'history' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFilter('history')}
              className="rounded-full font-sans min-h-[44px]"
            >
              History
            </Button>
          </div>
        </div>
      </div>

      {/* Waiter Calls Banner */}
      <AnimatePresence>
        {waiterCalls.length > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="bg-accent/10 border-b border-accent/20 overflow-hidden"
          >
            <div className="px-6 py-3 space-y-2">
              <p className="text-xs font-sans font-semibold text-accent uppercase tracking-wider flex items-center gap-2">
                <Hand className="w-4 h-4" />
                Waiter Calls ({waiterCalls.length})
              </p>
              <div className="flex flex-wrap gap-2">
                {waiterCalls.map((call) => (
                  <motion.div
                    key={call.id}
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="flex items-center gap-2 px-3 py-2 rounded-full bg-accent/15 border border-accent/25 min-h-[44px]"
                  >
                    <span className="text-sm font-sans font-semibold text-accent">
                      Table {call.table_number}
                    </span>
                    <span className="text-xs text-accent/70 font-sans">{timeSince(call.created_at)}</span>
                    <button
                      onClick={() => resolveWaiterCall(call.id)}
                      className="w-6 h-6 rounded-full bg-accent/20 flex items-center justify-center hover:bg-accent/40 transition-colors"
                      aria-label="Resolve call"
                    >
                      <X className="w-3 h-3 text-accent" />
                    </button>
                  </motion.div>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Orders Grid */}
      <div className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        <AnimatePresence>
          {orders.map((order) => (
            <motion.div
              key={order.id}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className={`rounded-xl border bg-card overflow-hidden transition-all ${
                isUrgent(order)
                  ? 'border-destructive/50 shadow-[0_0_12px_-3px_hsl(var(--destructive)/0.3)] animate-pulse'
                  : 'border-border'
              }`}
            >
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <div className="flex items-center gap-2">
                  <span className="font-serif text-lg font-bold text-foreground">Table {order.table_number}</span>
                  <Badge className={`text-[11px] font-sans ${statusColors[order.status]}`}>
                    <span className="flex items-center gap-1">
                      {statusIcons[order.status]}
                      {order.status}
                    </span>
                  </Badge>
                </div>
                <span className={`text-xs font-sans ${isUrgent(order) ? 'text-destructive font-semibold' : 'text-muted-foreground'}`}>
                  {timeSince(order.created_at)}
                </span>
              </div>

              <div className="px-4 py-3 space-y-2">
                {order.items.map((item) => (
                  <div key={item.id} className="flex justify-between items-start">
                    <div>
                      <p className="text-sm font-sans font-medium text-foreground">
                        {item.quantity}× {item.menu_item_name}
                      </p>
                      {item.notes && (
                        <p className="text-xs text-accent italic mt-0.5">⚠ {item.notes}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {order.notes && (
                <div className="px-4 pb-2">
                  <p className="text-xs text-accent italic">Note: {order.notes}</p>
                </div>
              )}

              {getNextStatus(order.status) && (
                <div className="px-4 pb-4">
                  <Button
                    onClick={() => updateOrderStatus(order.id, getNextStatus(order.status)!)}
                    className="w-full rounded-lg bg-primary text-primary-foreground font-sans text-sm min-h-[44px]"
                    size="sm"
                  >
                    Mark as {getNextStatus(order.status)}
                  </Button>
                </div>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {orders.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20">
          <ChefHat className="w-12 h-12 text-muted-foreground mb-4" />
          <p className="text-muted-foreground font-sans">No {filter} orders</p>
        </div>
      )}
    </div>
  );
};

export default KitchenDisplay;
