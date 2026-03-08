import React, { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { motion, AnimatePresence } from 'framer-motion';
import { Bell, Clock, ChefHat, Check, Utensils } from 'lucide-react';
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

const statusColors: Record<string, string> = {
  pending: 'bg-destructive/10 text-destructive border-destructive/20',
  confirmed: 'bg-accent/10 text-accent border-accent/20',
  preparing: 'bg-gold/10 text-gold border-gold/20',
  ready: 'bg-primary/10 text-primary border-primary/20',
  served: 'bg-muted text-muted-foreground border-border',
};

const statusIcons: Record<string, React.ReactNode> = {
  pending: <Bell className="w-4 h-4" />,
  confirmed: <Clock className="w-4 h-4" />,
  preparing: <ChefHat className="w-4 h-4" />,
  ready: <Check className="w-4 h-4" />,
  served: <Utensils className="w-4 h-4" />,
};

const KitchenDisplay = () => {
  const [orders, setOrders] = useState<OrderWithItems[]>([]);
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

  useEffect(() => {
    fetchOrders();

    // Real-time subscription
    const channel = supabase
      .channel('kitchen-orders')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => {
        fetchOrders();
        // Play notification sound for new orders
        if (Notification.permission === 'granted') {
          new Notification('New Order!', { body: 'A new order has been placed.' });
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_items' }, () => {
        fetchOrders();
      })
      .subscribe();

    // Request notification permission
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
              className="rounded-full font-sans"
            >
              Active
            </Button>
            <Button
              variant={filter === 'history' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFilter('history')}
              className="rounded-full font-sans"
            >
              History
            </Button>
          </div>
        </div>
      </div>

      {/* Orders Grid */}
      <div className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        <AnimatePresence>
          {orders.map((order) => (
            <motion.div
              key={order.id}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="rounded-xl border border-border bg-card overflow-hidden"
            >
              {/* Order header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <div className="flex items-center gap-2">
                  <span className="font-serif text-lg font-bold text-foreground">Table {order.table_number}</span>
                  <Badge className={`text-xs font-sans ${statusColors[order.status]}`}>
                    <span className="flex items-center gap-1">
                      {statusIcons[order.status]}
                      {order.status}
                    </span>
                  </Badge>
                </div>
                <span className="text-xs text-muted-foreground font-sans">{timeSince(order.created_at)}</span>
              </div>

              {/* Items */}
              <div className="px-4 py-3 space-y-2">
                {order.items.map((item) => (
                  <div key={item.id} className="flex justify-between items-start">
                    <div>
                      <p className="text-sm font-sans font-medium text-foreground">
                        {item.quantity}x {item.menu_item_name}
                      </p>
                      {item.notes && (
                        <p className="text-xs text-accent italic">⚠ {item.notes}</p>
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

              {/* Actions */}
              {getNextStatus(order.status) && (
                <div className="px-4 pb-4">
                  <Button
                    onClick={() => updateOrderStatus(order.id, getNextStatus(order.status)!)}
                    className="w-full rounded-lg bg-primary text-primary-foreground font-sans text-sm"
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
