import React, { useEffect, useState, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { motion, AnimatePresence } from 'framer-motion';
import { Bell, Clock, ChefHat, Check, Utensils, Hand, X, CreditCard, Volume2, VolumeX } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { playOrderAlert, playWaiterCallAlert, playBillRequestAlert } from '@/lib/kitchen-sounds';

interface OrderWithItems {
  id: string;
  status: string;
  total: number;
  notes: string | null;
  created_at: string;
  table_number: number;
  guest_name: string | null;
  section_id: string | null;
  section_name: string | null;
  section_color: string | null;
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

// Active-view kanban columns — the line cook reads order state by position.
const KANBAN: { status: string; label: string; dot: string }[] = [
  { status: 'pending', label: 'New', dot: 'bg-destructive' },
  { status: 'confirmed', label: 'Confirmed', dot: 'bg-accent' },
  { status: 'preparing', label: 'Preparing', dot: 'bg-accent' },
  { status: 'ready', label: 'Ready', dot: 'bg-primary' },
];

const KitchenDisplay = () => {
  const [orders, setOrders] = useState<OrderWithItems[]>([]);
  const [waiterCalls, setWaiterCalls] = useState<WaiterCall[]>([]);
  const [billRequests, setBillRequests] = useState<BillRequest[]>([]);
  const [filter, setFilter] = useState<string>('active');
  const [sectionFilter, setSectionFilter] = useState<string>('all');
  const [sections, setSections] = useState<{ id: string; name: string; color: string }[]>([]);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const soundEnabledRef = useRef(true);
  const initialLoadDone = useRef(false);

  // Keep ref in sync with state
  useEffect(() => {
    soundEnabledRef.current = soundEnabled;
  }, [soundEnabled]);

  const fetchOrders = useCallback(async () => {
    const { data: ordersData, error } = await supabase
      .from('orders')
      .select(`
        *,
        table_sessions!inner(
          tables!inner(table_number, section_id, sections(name, color))
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
      guest_name: o.guest_name || null,
      section_id: o.table_sessions?.tables?.section_id || null,
      section_name: o.table_sessions?.tables?.sections?.name || null,
      section_color: o.table_sessions?.tables?.sections?.color || null,
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
  }, [filter]);

  const fetchWaiterCalls = async () => {
    const { data, error } = await supabase
      .from('waiter_calls')
      .select(`*, table_sessions!inner(tables!inner(table_number))`)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (error) { console.error('Error fetching waiter calls:', error); return; }

    setWaiterCalls((data || []).map((c: any) => ({
      id: c.id,
      table_session_id: c.table_session_id,
      status: c.status,
      created_at: c.created_at,
      table_number: c.table_sessions?.tables?.table_number || 0,
    })));
  };

  const fetchBillRequests = async () => {
    const { data, error } = await supabase
      .from('bill_requests')
      .select(`*, table_sessions!inner(tables!inner(table_number))`)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (error) { console.error('Error fetching bill requests:', error); return; }

    setBillRequests((data || []).map((b: any) => ({
      id: b.id,
      table_session_id: b.table_session_id,
      status: b.status,
      created_at: b.created_at,
      table_number: b.table_sessions?.tables?.table_number || 0,
    })));
  };

  useEffect(() => {
    supabase.from('sections').select('id, name, color').order('sort_order').then(({ data }) => {
      setSections(data || []);
    });

    Promise.all([fetchOrders(), fetchWaiterCalls(), fetchBillRequests()]).then(() => {
      initialLoadDone.current = true;
    });

    const channel = supabase
      .channel('kitchen-all')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' }, () => {
        fetchOrders();
        if (initialLoadDone.current && soundEnabledRef.current) playOrderAlert();
        if (Notification.permission === 'granted') {
          new Notification('New Order!', { body: 'A new order has been placed.' });
        }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders' }, () => {
        fetchOrders();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_items' }, () => {
        fetchOrders();
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'waiter_calls' }, () => {
        fetchWaiterCalls();
        if (initialLoadDone.current && soundEnabledRef.current) playWaiterCallAlert();
        if (Notification.permission === 'granted') {
          new Notification('🔔 Waiter Call!', { body: 'A table is requesting assistance.' });
        }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'waiter_calls' }, () => {
        fetchWaiterCalls();
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'bill_requests' }, () => {
        fetchBillRequests();
        if (initialLoadDone.current && soundEnabledRef.current) playBillRequestAlert();
        if (Notification.permission === 'granted') {
          new Notification('💳 Bill Requested!', { body: 'A table is ready to pay.' });
        }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'bill_requests' }, () => {
        fetchBillRequests();
      })
      .subscribe();

    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }

    return () => { supabase.removeChannel(channel); };
  }, [filter, fetchOrders]);

  const updateOrderStatus = async (orderId: string, newStatus: string) => {
    const { error } = await supabase.from('orders').update({ status: newStatus as any }).eq('id', orderId);
    if (error) toast.error('Failed to update order status');
    else { toast.success(`Order marked as ${newStatus}`); fetchOrders(); }
  };

  const resolveWaiterCall = async (callId: string) => {
    const { error } = await supabase.from('waiter_calls').update({ status: 'resolved', resolved_at: new Date().toISOString() } as any).eq('id', callId);
    if (error) toast.error('Failed to resolve call');
    else { toast.success('Waiter call resolved'); fetchWaiterCalls(); }
  };

  const resolveBillRequest = async (request: BillRequest) => {
    const { error } = await supabase.from('bill_requests').update({ status: 'resolved', resolved_at: new Date().toISOString() }).eq('id', request.id);
    if (error) { toast.error('Failed to resolve bill request'); return; }

    // Auto-close the table session
    await supabase
      .from('table_sessions')
      .update({ is_active: false, closed_at: new Date().toISOString() })
      .eq('id', request.table_session_id);

    toast.success('Bill resolved & table freed');
    fetchBillRequests();
    fetchOrders();
  };

  const getNextStatus = (current: string) => {
    const flow: Record<string, string> = { pending: 'confirmed', confirmed: 'preparing', preparing: 'ready', ready: 'served' };
    return flow[current];
  };

  const timeSince = (dateStr: string) => {
    const mins = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    return `${Math.floor(mins / 60)}h ${mins % 60}m ago`;
  };

  const isUrgent = (order: OrderWithItems) => {
    if (order.status !== 'pending') return false;
    return Math.floor((Date.now() - new Date(order.created_at).getTime()) / 60000) >= 5;
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 z-30 glass border-b border-border">
        <div className="flex items-center justify-between px-6 py-4">
          <div>
            <h1 className="font-serif text-2xl font-bold text-foreground">Kitchen Display</h1>
            <p className="text-sm text-muted-foreground font-sans">{orders.length} orders</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            {sections.length > 0 && (
              <select
                value={sectionFilter}
                onChange={(e) => setSectionFilter(e.target.value)}
                className="rounded-full border border-border bg-card px-3 text-sm font-sans min-h-[44px]"
                aria-label="Filter by section"
              >
                <option value="all">All sections</option>
                {sections.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            )}
            <Button variant="ghost" size="icon" onClick={() => setSoundEnabled(!soundEnabled)} className="rounded-full min-h-[44px] min-w-[44px]" aria-label={soundEnabled ? 'Mute alerts' : 'Enable alerts'}>
              {soundEnabled ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5 text-muted-foreground" />}
            </Button>
            <Button variant={filter === 'active' ? 'default' : 'outline'} size="sm" onClick={() => setFilter('active')} className="rounded-full font-sans min-h-[44px]">Active</Button>
            <Button variant={filter === 'history' ? 'default' : 'outline'} size="sm" onClick={() => setFilter('history')} className="rounded-full font-sans min-h-[44px]">History</Button>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {waiterCalls.length > 0 && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="bg-accent/10 border-b border-accent/20 overflow-hidden">
            <div className="px-6 py-3 space-y-2">
              <p className="text-xs font-sans font-semibold text-accent uppercase tracking-wider flex items-center gap-2">
                <Hand className="w-4 h-4" /> Waiter Calls ({waiterCalls.length})
              </p>
              <div className="flex flex-wrap gap-2">
                {waiterCalls.map((call) => (
                  <motion.div key={call.id} initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="flex items-center gap-2 px-3 py-2 rounded-full bg-accent/15 border border-accent/25 min-h-[44px]">
                    <span className="text-sm font-sans font-semibold text-accent">Table {call.table_number}</span>
                    <span className="text-xs text-accent/70 font-sans">{timeSince(call.created_at)}</span>
                    <button onClick={() => resolveWaiterCall(call.id)} className="w-6 h-6 rounded-full bg-accent/20 flex items-center justify-center hover:bg-accent/40 transition-colors" aria-label="Resolve call">
                      <X className="w-3 h-3 text-accent" />
                    </button>
                  </motion.div>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {billRequests.length > 0 && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="bg-primary/10 border-b border-primary/20 overflow-hidden">
            <div className="px-6 py-3 space-y-2">
              <p className="text-xs font-sans font-semibold text-primary uppercase tracking-wider flex items-center gap-2">
                <CreditCard className="w-4 h-4" /> Bill Requests ({billRequests.length})
              </p>
              <div className="flex flex-wrap gap-2">
                {billRequests.map((req) => (
                  <motion.div key={req.id} initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="flex items-center gap-2 px-3 py-2 rounded-full bg-primary/15 border border-primary/25 min-h-[44px]">
                    <span className="text-sm font-sans font-semibold text-primary">Table {req.table_number}</span>
                    <span className="text-xs text-primary/70 font-sans">{timeSince(req.created_at)}</span>
                    <button onClick={() => resolveBillRequest(req)} className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center hover:bg-primary/40 transition-colors" aria-label="Resolve bill request">
                      <Check className="w-3 h-3 text-primary" />
                    </button>
                  </motion.div>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {(() => {
        const visible = orders.filter(o => sectionFilter === 'all' || o.section_id === sectionFilter);

        const renderCard = (order: OrderWithItems, showStatus: boolean) => (
          <motion.div
            key={order.id}
            layout
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
            className={`rounded-xl border bg-card overflow-hidden shadow-lux ${isUrgent(order) ? 'border-destructive/50 breathe' : 'border-border'}`}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <div className="flex items-center gap-2 flex-wrap">
                {order.section_name && (
                  <span className="inline-flex items-center gap-1 text-[10px] uppercase font-sans px-1.5 py-0.5 rounded" style={{ background: `${order.section_color}33`, color: order.section_color || undefined }}>
                    {order.section_name}
                  </span>
                )}
                <span className="font-serif text-lg font-bold text-foreground">Table {order.table_number}</span>
                {order.guest_name && <span className="text-xs text-muted-foreground font-sans">({order.guest_name})</span>}
                {showStatus && (
                  <Badge className={`text-[11px] font-sans ${statusColors[order.status]}`}>
                    <span className="flex items-center gap-1">{statusIcons[order.status]}{order.status}</span>
                  </Badge>
                )}
              </div>
              <span className={`text-xs font-sans tabular-nums ${isUrgent(order) ? 'text-destructive font-semibold' : 'text-muted-foreground'}`}>{timeSince(order.created_at)}</span>
            </div>

            <div className="px-4 py-3 space-y-2">
              {order.items.map((item) => (
                <div key={item.id} className="flex justify-between items-start">
                  <div>
                    <p className="text-sm font-sans font-medium text-foreground">{item.quantity}× {item.menu_item_name}</p>
                    {item.notes && <p className="text-xs text-accent italic mt-0.5">⚠ {item.notes}</p>}
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
                <Button onClick={() => updateOrderStatus(order.id, getNextStatus(order.status)!)} className="w-full rounded-lg bg-primary text-primary-foreground font-sans text-sm min-h-[44px]" size="sm">
                  Mark as {getNextStatus(order.status)}
                </Button>
              </div>
            )}
          </motion.div>
        );

        if (orders.length === 0) {
          return (
            <div className="flex flex-col items-center justify-center py-20">
              <ChefHat className="w-12 h-12 text-muted-foreground mb-4" />
              <p className="text-muted-foreground font-sans">No {filter} orders</p>
            </div>
          );
        }

        // History → flat grid. Active → status kanban columns.
        if (filter === 'history') {
          return (
            <div className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              <AnimatePresence>{visible.map((o) => renderCard(o, true))}</AnimatePresence>
            </div>
          );
        }

        return (
          <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-start">
            {KANBAN.map((col) => {
              const colOrders = visible.filter((o) => o.status === col.status);
              return (
                <div key={col.status} className="min-w-0">
                  <div className="flex items-center gap-2 mb-3 px-1">
                    <span className={`w-2 h-2 rounded-full ${col.dot}`} />
                    <h2 className="font-serif text-sm font-bold uppercase tracking-wide text-foreground/80">{col.label}</h2>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground tabular-nums">{colOrders.length}</span>
                  </div>
                  <div className="space-y-3">
                    <AnimatePresence>{colOrders.map((o) => renderCard(o, false))}</AnimatePresence>
                    {colOrders.length === 0 && (
                      <div className="rounded-xl border border-dashed border-border/50 py-8 text-center text-xs text-muted-foreground/60 font-sans">
                        Empty
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })()}
    </div>
  );
};

export default KitchenDisplay;
