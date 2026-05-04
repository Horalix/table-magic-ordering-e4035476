import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, Minus, Plus, Trash2, Send, CheckCircle, ShoppingBag, UtensilsCrossed } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useCartStore } from '@/lib/cart-store';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { useT, useLanguageStore } from '@/lib/i18n';
import SmartImage from '@/components/ui/SmartImage';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

const ORDER_COOLDOWN_MS = 30000; // 30 seconds
const LARGE_ORDER_THRESHOLD = 20;

const OrderSuccess = ({ table, onContinue }: { table: string | null; onContinue: () => void }) => {
  const t = useT();
  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-6">
      <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="text-center">
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', damping: 12, stiffness: 200, delay: 0.2 }}
          className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-6"
        >
          <CheckCircle className="w-10 h-10 text-primary" />
        </motion.div>
        <h2 className="font-serif text-2xl font-bold text-foreground">{t('order_confirmed')}</h2>
        <p className="text-muted-foreground font-sans mt-2 text-sm">{t('order_sent_kitchen')}</p>
        {table && <p className="text-sm text-primary font-sans mt-1 font-medium">{t('table')} {table}</p>}
        <Button
          onClick={onContinue}
          className="mt-8 rounded-full px-8 h-12 bg-primary text-primary-foreground hover:bg-sage-dark font-sans font-semibold"
        >
          {t('order_more')}
        </Button>
      </motion.div>
    </div>
  );
};

const CartPage = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { items, total, updateQuantity, removeItem, clearCart, sessionId, guestName, lastOrderTime, setLastOrderTime, itemCount } = useCartStore();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [orderPlaced, setOrderPlaced] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const t = useT();
  const locale = useLanguageStore((s) => s.locale);

  const table = searchParams.get('table');
  const token = searchParams.get('token');

  const buildMenuUrl = () => {
    const params = new URLSearchParams();
    if (table) params.set('table', table);
    if (token) params.set('token', token);
    return `/menu?${params.toString()}`;
  };

  const isLargeOrder = itemCount() > LARGE_ORDER_THRESHOLD;

  const handlePlaceOrderClick = () => {
    // Anti-spam: check cooldown
    if (lastOrderTime && Date.now() - lastOrderTime < ORDER_COOLDOWN_MS) {
      toast.error(t('order_cooldown'));
      return;
    }
    setShowConfirm(true);
  };

  const placeOrder = async () => {
    if (!sessionId) {
      toast.error(t('scan_qr_again'));
      return;
    }

    setIsSubmitting(true);
    try {
      const { data: session, error: sessionError } = await supabase
        .from('table_sessions')
        .select('id, is_active')
        .eq('id', sessionId)
        .eq('is_active', true)
        .single();

      if (sessionError || !session) {
        toast.error(t('session_expired'));
        setIsSubmitting(false);
        return;
      }

      // Anti-spam: check total orders for this session (max 10)
      const { count } = await supabase
        .from('orders')
        .select('id', { count: 'exact', head: true })
        .eq('table_session_id', sessionId)
        .neq('status', 'cancelled');

      if (count !== null && count >= 10) {
        toast.error('Maximum orders reached for this session.');
        setIsSubmitting(false);
        return;
      }

      const orderTotal = total();

      const { data: order, error: orderError } = await supabase
        .from('orders')
        .insert({
          table_session_id: sessionId,
          total: orderTotal,
          status: 'pending' as any,
          guest_name: guestName || null,
        } as any)
        .select()
        .single();

      if (orderError) throw orderError;

      const orderItems = items.map((item) => ({
        order_id: order.id,
        menu_item_id: item.id,
        quantity: item.quantity,
        unit_price: item.price,
        notes: item.notes || null,
        status: 'pending' as any,
      }));

      const { error: itemsError } = await supabase.from('order_items').insert(orderItems);
      if (itemsError) throw itemsError;

      setLastOrderTime();
      setOrderPlaced(true);
      clearCart();
      toast.success(t('order_confirmed'));
    } catch (err: any) {
      console.error('Order error:', err);
      toast.error('Failed to place order. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (orderPlaced) {
    return (
      <OrderSuccess
        table={table}
        onContinue={() => {
          setOrderPlaced(false);
          navigate(buildMenuUrl());
        }}
      />
    );
  }

  return (
    <div className="min-h-screen bg-background pb-32">
      <div className="sticky top-0 z-30 glass">
        <div className="flex items-center gap-3 px-4 py-4">
          <button onClick={() => navigate(-1)} className="p-2.5 -ml-2 rounded-full hover:bg-muted transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center">
            <ArrowLeft className={`w-5 h-5 text-foreground ${locale === 'ar' ? 'rotate-180' : ''}`} />
          </button>
          <h1 className="font-serif text-xl font-semibold text-foreground">{t('your_order')}</h1>
          {table && (
            <span className="ml-auto text-xs font-sans px-3 py-1 rounded-full bg-primary/10 text-primary font-medium">
              {t('table')} {table}
            </span>
          )}
        </div>
        <div className="h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent" />
      </div>

      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 px-6">
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
            <ShoppingBag className="w-7 h-7 text-muted-foreground" />
          </div>
          <p className="text-foreground font-serif text-lg font-semibold">{t('order_empty')}</p>
          <p className="text-muted-foreground font-sans text-sm mt-1 text-center">{t('browse_menu_to_add')}</p>
          <Button onClick={() => navigate(-1)} variant="outline" className="mt-6 rounded-full px-6 font-sans">
            {t('back_to_menu')}
          </Button>
        </div>
      ) : (
        <>
          <div className="px-4 pt-4 space-y-3">
            {items.map((item, i) => (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05 }}
                className="flex gap-4 p-4 rounded-xl border border-border bg-card"
              >
                {item.image_url && (
                  <SmartImage
                    src={item.image_url}
                    alt={item.name}
                    width={64}
                    height={64}
                    wrapperClassName="w-16 h-16 rounded-lg flex-shrink-0"
                  />
                )}
                <div className="flex-1 min-w-0">
                  <h3 className="font-serif text-base font-semibold text-foreground">{item.name}</h3>
                  {item.notes && (
                    <p className="text-xs text-muted-foreground mt-0.5 italic">"{item.notes}"</p>
                  )}
                  <p className="text-sm font-sans font-bold text-primary mt-1">
                    {(item.price * item.quantity).toFixed(2)} KM
                  </p>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <button
                    onClick={() => removeItem(item.id)}
                    className="text-muted-foreground hover:text-destructive transition-colors p-1.5 min-w-[44px] min-h-[44px] flex items-center justify-center"
                    aria-label={`Remove ${item.name}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                  <div className="flex items-center gap-2 bg-muted rounded-full px-1.5 py-0.5">
                    <button
                      onClick={() => updateQuantity(item.id, item.quantity - 1)}
                      className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-card transition-colors"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <span className="text-sm font-sans font-semibold w-5 text-center">{item.quantity}</span>
                    <button
                      onClick={() => updateQuantity(item.id, item.quantity + 1)}
                      className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-card transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>

          <div className="px-4 mt-6 space-y-3">
            {isLargeOrder && (
              <div className="p-3 rounded-xl border border-accent/20 bg-accent/5 flex items-center gap-3">
                <UtensilsCrossed className="w-4 h-4 text-accent flex-shrink-0" />
                <p className="text-xs font-sans text-accent">{t('large_order_suggestion')}</p>
              </div>
            )}
            <div className="p-4 rounded-xl border border-border bg-card">
              <div className="flex justify-between items-center">
                <span className="font-sans text-sm text-muted-foreground">{t('total')}</span>
                <span className="font-serif text-xl font-bold text-foreground">{total().toFixed(2)} KM</span>
              </div>
            </div>
          </div>

          <div className="fixed bottom-0 left-0 right-0 z-40 p-4 pb-6 bg-background/80 backdrop-blur-xl border-t border-border/50">
            <Button
              onClick={handlePlaceOrderClick}
              disabled={isSubmitting || !sessionId}
              className="w-full h-14 rounded-2xl bg-primary text-primary-foreground font-sans font-semibold text-base hover:bg-sage-dark disabled:opacity-50 transition-colors"
            >
              {isSubmitting ? (
                <span className="flex items-center gap-2">
                  <div className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                  {t('placing_order')}
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <Send className="w-4 h-4" />
                  {t('place_order')} · {total().toFixed(2)} KM
                </span>
              )}
            </Button>
            {!sessionId && (
              <p className="text-xs text-destructive text-center mt-2 font-sans">{t('scan_qr_again')}</p>
            )}
          </div>

          {/* No-Refund Confirmation Dialog */}
          <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle className="font-serif">{t('confirm_order')}</AlertDialogTitle>
                <AlertDialogDescription className="font-sans">
                  {t('no_refund_message')}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="font-sans">{t('go_back')}</AlertDialogCancel>
                <AlertDialogAction
                  onClick={placeOrder}
                  className="bg-primary text-primary-foreground font-sans"
                >
                  {t('confirm_and_order')}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
    </div>
  );
};

export default CartPage;
