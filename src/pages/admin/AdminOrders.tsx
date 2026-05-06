import React, { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';

const AdminOrders = () => {
  const [orders, setOrders] = useState<any[]>([]);
  const [filter, setFilter] = useState('all');

  const fetchOrders = async () => {
    let query = supabase
      .from('orders')
      .select(`*, table_sessions!inner(tables!inner(table_number)), order_items(*, menu_items(name))`)
      .order('created_at', { ascending: false })
      .limit(100);

    if (filter !== 'all') {
      query = query.eq('status', filter as any);
    }

    const { data } = await query;
    setOrders(data || []);
  };

  useEffect(() => {
    fetchOrders();
    const channel = supabase
      .channel('admin-orders')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, fetchOrders)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [filter]);

  const updateStatus = async (orderId: string, status: string) => {
    await supabase.from('orders').update({ status: status as any }).eq('id', orderId);
    fetchOrders();
  };

  const deleteOrder = async (orderId: string) => {
    const { error: e1 } = await supabase.from('order_items').delete().eq('order_id', orderId);
    if (e1) { toast.error(e1.message); return; }
    const { error: e2 } = await supabase.from('orders').delete().eq('id', orderId);
    if (e2) { toast.error(e2.message); return; }
    toast.success('Order deleted');
    fetchOrders();
  };

  const statusColors: Record<string, string> = {
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
        <Select value={filter} onValueChange={setFilter}>
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

      <div className="space-y-3">
        {orders.map((order: any) => (
          <Card key={order.id} className="border-border">
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-serif font-bold text-foreground">
                      Table {order.table_sessions?.tables?.table_number}
                    </span>
                    {order.guest_name && (
                      <span className="text-sm font-sans text-muted-foreground">— {order.guest_name}</span>
                    )}
                    <Badge className={`text-xs ${statusColors[order.status]}`}>{order.status}</Badge>
                    {!['served', 'cancelled'].includes(order.status) && (() => {
                      const mins = Math.floor((Date.now() - new Date(order.created_at).getTime()) / 60000);
                      const label = mins < 1 ? 'Just now' : mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`;
                      return (
                        <span className={`text-xs font-sans flex items-center gap-1 ${mins >= 10 ? 'text-destructive font-semibold' : 'text-muted-foreground'}`}>
                          ⏱ {label}
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
                      <Button variant="ghost" size="icon" className="h-7 w-7"><Trash2 className="w-4 h-4 text-destructive" /></Button>
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
                {order.order_items?.map((item: any) => (
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
          <p className="text-center text-muted-foreground font-sans py-10">No orders found</p>
        )}
      </div>
    </div>
  );
};

export default AdminOrders;
