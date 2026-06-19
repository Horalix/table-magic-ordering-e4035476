import React, { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, Clock, CheckCircle, ChefHat, Utensils, Receipt, CreditCard, Loader2, Users } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useCartStore } from '@/lib/cart-store';
import { supabase } from '@/integrations/supabase/client';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { useT, useLanguageStore, getLocalizedName } from '@/lib/i18n';
import ReviewPrompt from '@/components/guest/ReviewPrompt';
import { useSessionHeartbeat } from '@/hooks/useSessionHeartbeat';
import { staggerContainer, fadeUp, useCountUp } from '@/lib/motion';

const RunningTabPage = () => {
  const navigate = useNavigate();
  useSessionHeartbeat();
  const [searchParams] = useSearchParams();
  const { sessionId } = useCartStore();
  const [requestingBill, setRequestingBill] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const billRequestRef = useRef(false);
  const t = useT();
  const locale = useLanguageStore((s) => s.locale);

  const table = searchParams.get('table');
  const token = searchParams.get('token');

  const statusConfig: Record<string, { icon: React.ReactNode; label: string; color: string }> = {
    pending: { icon: <Clock className="w-3.5 h-3.5" />, label: t('status_pending'), color: 'bg-accent/10 text-accent border-accent/20' },
    confirmed: { icon: <CheckCircle className="w-3.5 h-3.5" />, label: t('status_confirmed'), color: 'bg-primary/10 text-primary border-primary/20' },
    preparing: { icon: <ChefHat className="w-3.5 h-3.5" />, label: t('status_preparing'), color: 'bg-accent/10 text-accent border-accent/20' },
    ready: { icon: <CheckCircle className="w-3.5 h-3.5" />, label: t('status_ready'), color: 'bg-primary/10 text-primary border-primary/20' },
    served: { icon: <Utensils className="w-3.5 h-3.5" />, label: t('status_served'), color: 'bg-muted text-muted-foreground border-border' },
    cancelled: { icon: <Clock className="w-3.5 h-3.5" />, label: t('status_cancelled'), color: 'bg-destructive/10 text-destructive border-destructive/20' },
  };

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ['session-orders', sessionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select(`*, order_items(*, menu_items(name, name_ar, name_bs))`)
        .eq('table_session_id', sessionId!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!sessionId,
    refetchInterval: 10000,
  });

  const { data: existingBillRequest } = useQuery({
    queryKey: ['bill-request', sessionId],
    queryFn: async () => {
      const { data } = await supabase
        .from('bill_requests')
        .select('*')
        .eq('table_session_id', sessionId!)
        .eq('status', 'pending')
        .maybeSingle();
      return data;
    },
    enabled: !!sessionId,
    refetchInterval: 10000,
  });

  const { data: members = [] } = useQuery({
    queryKey: ['session-members', sessionId],
    queryFn: async () => {
      const [{ data: sess }, { data: joiners }] = await Promise.all([
        supabase.from('table_sessions').select('guest_name').eq('id', sessionId).maybeSingle(),
        supabase.from('session_join_requests').select('guest_name').eq('table_session_id', sessionId).eq('status', 'approved'),
      ]);
      const names: string[] = [];
      if (sess?.guest_name) names.push(sess.guest_name);
      (joiners || []).forEach((j) => { if (j.guest_name) names.push(j.guest_name); });
      return Array.from(new Set(names));
    },
    enabled: !!sessionId,
    refetchInterval: 15000,
  });

  const grandTotal = orders.reduce((sum, o) => sum + Number(o.total), 0);
  const displayGrandTotal = useCountUp(grandTotal);

  const goBack = () => {
    const params = new URLSearchParams();
    if (table) params.set('table', table);
    if (token) params.set('token', token);
    navigate(`/menu?${params.toString()}`);
  };

  const formatTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const getWaitTime = (createdAt: string, status: string) => {
    if (status === 'served' || status === 'cancelled') return null;
    const mins = Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000);
    if (mins < 1) return t('just_now');
    if (mins < 60) return `${mins} min`;
    return `${Math.floor(mins / 60)}h ${mins % 60}m`;
  };

  const requestBill = async () => {
    if (!sessionId || billRequestRef.current || existingBillRequest) return;
    billRequestRef.current = true;
    setRequestingBill(true);
    try {
      const { error } = await supabase
        .from('bill_requests')
        .insert({ table_session_id: sessionId });
      if (error) throw error;
      // Show review prompt after successful bill request
      setShowReview(true);
    } catch {
      toast.error('Could not request bill. Please try again.');
    } finally {
      billRequestRef.current = false;
      setRequestingBill(false);
    }
  };

  const billRequested = !!existingBillRequest;

  return (
    <div className="min-h-screen bg-background pb-32">
      <div className="sticky top-0 z-30 glass">
        <div className="flex items-center gap-3 px-4 py-4">
          <button onClick={goBack} aria-label={t('back_to_menu')} className="p-2.5 -ml-2 rounded-full hover:bg-muted transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center">
            <ArrowLeft className={`w-5 h-5 text-foreground ${locale === 'ar' ? 'rotate-180' : ''}`} />
          </button>
          <div className="flex items-center gap-2">
            <Receipt className="w-5 h-5 text-primary" />
            <h1 className="font-serif text-xl font-semibold text-foreground">{t('your_tab')}</h1>
          </div>
          {table && (
            <span className="ml-auto text-xs font-sans px-3 py-1 rounded-full bg-primary/10 text-primary font-medium">
              {t('table')} {table}
            </span>
          )}
        </div>
        <div className="h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent" />
      </div>

      {!sessionId ? (
        <div className="flex flex-col items-center justify-center py-20 px-6">
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
            <Receipt className="w-7 h-7 text-muted-foreground" />
          </div>
          <p className="text-foreground font-serif text-lg font-semibold">{t('no_active_session')}</p>
          <p className="text-muted-foreground font-sans text-sm mt-1 text-center">{t('scan_qr_tab')}</p>
        </div>
      ) : isLoading ? (
        <div className="px-4 pt-4 space-y-4">
          <Skeleton className="h-24 w-full rounded-2xl" />
          <Skeleton className="h-32 w-full rounded-xl" />
        </div>
      ) : orders.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 px-6">
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
            <Receipt className="w-7 h-7 text-muted-foreground" />
          </div>
          <p className="text-foreground font-serif text-lg font-semibold">{t('no_orders_yet')}</p>
          <p className="text-muted-foreground font-sans text-sm mt-1 text-center">{t('browse_menu_start')}</p>
        </div>
      ) : (
        <>
          <div className="px-4 pt-4">
            <motion.div variants={fadeUp} initial="hidden" animate="show" className="hero-depth p-5 rounded-2xl text-white relative overflow-hidden bg-primary shadow-lux-lg">
              <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent" />
              <div className="relative z-10 flex justify-between items-center">
                <div>
                  <p className="text-[11px] font-sans text-white/60 uppercase tracking-wider">{t('running_total')}</p>
                  <p className="font-serif text-3xl font-bold text-white mt-1 tabular-nums">{displayGrandTotal.toFixed(2)} KM</p>
                </div>
                <div className="text-right">
                  <p className="text-xs font-sans text-white/60">{orders.length} order{orders.length !== 1 ? 's' : ''}</p>
                </div>
              </div>
            </motion.div>
          </div>

          {members.length > 0 && (
            <div className="px-4 pt-3">
              <div className="flex items-center gap-1.5 flex-wrap text-xs font-sans">
                <span className="inline-flex items-center gap-1 text-muted-foreground">
                  <Users className="w-3.5 h-3.5" />{t('at_this_table')}:
                </span>
                {members.map((n, i) => (
                  <span key={i} className="px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">{n}</span>
                ))}
              </div>
            </div>
          )}

          <div className="px-4 pt-3">
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
              {billRequested ? (
                <div className="flex items-center gap-3 p-4 rounded-xl border border-primary/20 bg-primary/5">
                  <CheckCircle className="w-5 h-5 text-primary shrink-0" />
                  <div>
                    <p className="text-sm font-sans font-semibold text-foreground">{t('bill_requested')}</p>
                    <p className="text-xs font-sans text-muted-foreground">{t('server_notified')}</p>
                  </div>
                </div>
              ) : (
                <Button onClick={requestBill} disabled={requestingBill} className="w-full rounded-xl min-h-[48px] font-sans text-sm gap-2" variant="outline">
                  {requestingBill ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />}
                  {requestingBill ? t('requesting') : t('request_bill')}
                </Button>
              )}
            </motion.div>
          </div>

          <motion.div
            variants={staggerContainer(0.05)}
            initial="hidden"
            animate="show"
            className="px-4 pt-4 space-y-4"
          >
            {orders.map((order) => {
              const status = statusConfig[order.status] || statusConfig.pending;
              const items = order.order_items || [];
              const waitTime = getWaitTime(order.created_at, order.status);

              return (
                <motion.div
                  key={order.id}
                  variants={fadeUp}
                  className="card-lux overflow-hidden"
                >
                  <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-sans text-muted-foreground">{formatTime(order.created_at)}</span>
                      <span className={`inline-flex items-center gap-1 text-[11px] font-sans font-medium px-2.5 py-1 rounded-full border ${status.color}`}>
                        {status.icon}
                        {status.label}
                      </span>
                      {waitTime && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-sans text-muted-foreground">
                          <Clock className="w-3 h-3" />
                          {waitTime}
                        </span>
                      )}
                    </div>
                    <span className="text-sm font-sans font-bold text-foreground">{Number(order.total).toFixed(2)} KM</span>
                  </div>
                  <div className="px-4 py-3 space-y-2">
                    {items.map((oi) => (
                      <div key={oi.id} className="flex justify-between items-center">
                        <span className="text-sm font-sans text-foreground">{oi.quantity}× {oi.menu_items ? getLocalizedName(oi.menu_items, locale) : 'Item'}</span>
                        <span className="text-xs font-sans text-muted-foreground">{(oi.quantity * Number(oi.unit_price)).toFixed(2)} KM</span>
                      </div>
                    ))}
                  </div>
                </motion.div>
              );
            })}
          </motion.div>
        </>
      )}

      {sessionId && (
        <ReviewPrompt
          open={showReview}
          onClose={() => {
            setShowReview(false);
            toast.success(t('server_notified'));
          }}
          sessionId={sessionId}
        />
      )}
    </div>
  );
};

export default RunningTabPage;
