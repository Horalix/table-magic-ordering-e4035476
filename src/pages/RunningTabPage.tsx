import React from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, Clock, CheckCircle, ChefHat, Utensils, Receipt } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useCartStore } from '@/lib/cart-store';
import { supabase } from '@/integrations/supabase/client';

const statusConfig: Record<string, { icon: React.ReactNode; label: string; color: string }> = {
  pending: { icon: <Clock className="w-3.5 h-3.5" />, label: 'Pending', color: 'bg-accent/10 text-accent border-accent/20' },
  confirmed: { icon: <CheckCircle className="w-3.5 h-3.5" />, label: 'Confirmed', color: 'bg-primary/10 text-primary border-primary/20' },
  preparing: { icon: <ChefHat className="w-3.5 h-3.5" />, label: 'Preparing', color: 'bg-accent/10 text-accent border-accent/20' },
  ready: { icon: <CheckCircle className="w-3.5 h-3.5" />, label: 'Ready', color: 'bg-primary/10 text-primary border-primary/20' },
  served: { icon: <Utensils className="w-3.5 h-3.5" />, label: 'Served', color: 'bg-muted text-muted-foreground border-border' },
  cancelled: { icon: <Clock className="w-3.5 h-3.5" />, label: 'Cancelled', color: 'bg-destructive/10 text-destructive border-destructive/20' },
};

const RunningTabPage = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { sessionId } = useCartStore();

  const table = searchParams.get('table');
  const token = searchParams.get('token');

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ['session-orders', sessionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select(`
          *,
          order_items(
            *,
            menu_items(name)
          )
        `)
        .eq('table_session_id', sessionId!)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data;
    },
    enabled: !!sessionId,
    refetchInterval: 10000, // [UX] Auto-refresh every 10s for live updates
  });

  const grandTotal = orders.reduce((sum, o) => sum + Number(o.total), 0);

  const goBack = () => {
    const params = new URLSearchParams();
    if (table) params.set('table', table);
    if (token) params.set('token', token);
    navigate(`/menu?${params.toString()}`);
  };

  const formatTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="min-h-screen bg-background pb-32">
      {/* Header */}
      <div className="sticky top-0 z-30 glass">
        <div className="flex items-center gap-3 px-4 py-4">
          <button onClick={goBack} className="p-2 -ml-2 rounded-full hover:bg-muted transition-colors">
            <ArrowLeft className="w-5 h-5 text-foreground" />
          </button>
          <div className="flex items-center gap-2">
            <Receipt className="w-5 h-5 text-primary" />
            <h1 className="font-serif text-xl font-semibold text-foreground">Your Tab</h1>
          </div>
          {table && (
            <span className="ml-auto text-xs font-sans px-3 py-1 rounded-full bg-primary/10 text-primary">
              Table {table}
            </span>
          )}
        </div>
      </div>

      {!sessionId ? (
        <div className="flex flex-col items-center justify-center py-20 px-6">
          <Receipt className="w-12 h-12 text-muted-foreground mb-4" />
          <p className="text-muted-foreground font-sans text-center">
            Scan the QR code at your table to see your tab.
          </p>
        </div>
      ) : isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : orders.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 px-6">
          <Receipt className="w-12 h-12 text-muted-foreground mb-4" />
          <p className="text-muted-foreground font-sans text-center">
            No orders yet.<br />Browse the menu to get started.
          </p>
        </div>
      ) : (
        <>
          {/* Grand Total Card */}
          <div className="px-4 pt-4">
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-5 rounded-2xl bg-primary/5 border border-primary/15"
            >
              <div className="flex justify-between items-center">
                <div>
                  <p className="text-xs font-sans text-muted-foreground uppercase tracking-wider">Running Total</p>
                  <p className="font-serif text-3xl font-bold text-foreground mt-1">{grandTotal.toFixed(2)} KM</p>
                </div>
                <div className="text-right">
                  <p className="text-xs font-sans text-muted-foreground">{orders.length} order{orders.length !== 1 ? 's' : ''}</p>
                </div>
              </div>
            </motion.div>
          </div>

          {/* Orders List */}
          <div className="px-4 pt-4 space-y-4">
            {orders.map((order, idx) => {
              const status = statusConfig[order.status] || statusConfig.pending;
              const items = (order as any).order_items || [];

              return (
                <motion.div
                  key={order.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.05 }}
                  className="rounded-xl border border-border bg-card overflow-hidden"
                >
                  {/* Order Header */}
                  <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-sans text-muted-foreground">
                        {formatTime(order.created_at)}
                      </span>
                      <span className={`inline-flex items-center gap-1 text-[11px] font-sans font-medium px-2 py-0.5 rounded-full border ${status.color}`}>
                        {status.icon}
                        {status.label}
                      </span>
                    </div>
                    <span className="text-sm font-sans font-semibold text-foreground">
                      {Number(order.total).toFixed(2)} KM
                    </span>
                  </div>

                  {/* Items */}
                  <div className="px-4 py-3 space-y-1.5">
                    {items.map((oi: any) => (
                      <div key={oi.id} className="flex justify-between items-center">
                        <span className="text-sm font-sans text-foreground">
                          {oi.quantity}× {oi.menu_items?.name || 'Item'}
                        </span>
                        <span className="text-xs font-sans text-muted-foreground">
                          {(oi.quantity * Number(oi.unit_price)).toFixed(2)} KM
                        </span>
                      </div>
                    ))}
                  </div>
                </motion.div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
};

export default RunningTabPage;
