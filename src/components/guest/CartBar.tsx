import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ShoppingBag, Receipt } from 'lucide-react';
import { useCartStore } from '@/lib/cart-store';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useT } from '@/lib/i18n';

const CartBar = () => {
  const { items, total, itemCount, sessionId } = useCartStore();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const count = itemCount();
  const t = useT();

  const table = searchParams.get('table');
  const token = searchParams.get('token');
  const hasSession = !!(table && token);

  if (!hasSession) return null;

  const buildParams = () => {
    const params = new URLSearchParams();
    if (table) params.set('table', table);
    if (token) params.set('token', token);
    return params.toString();
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 p-4 pb-6 space-y-2">
      {sessionId && (
        <motion.button
          initial={{ y: 50, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          onClick={() => navigate(`/tab?${buildParams()}`)}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-card/90 backdrop-blur-lg border border-border text-foreground font-sans text-sm font-medium hover:bg-muted transition-colors min-h-[44px]"
        >
          <Receipt className="w-4 h-4 text-primary" />
          {t('view_your_tab')}
        </motion.button>
      )}

      <AnimatePresence>
        {count > 0 && (
          <motion.button
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            onClick={() => navigate(`/cart?${buildParams()}`)}
            className="w-full flex items-center justify-between px-6 py-4 rounded-2xl text-white shadow-lg hover:opacity-95 transition-opacity min-h-[56px]"
            style={{ backgroundColor: 'hsl(140, 12%, 53%)' }}
          >
            <div className="flex items-center gap-3">
              <div className="relative">
                <ShoppingBag className="w-5 h-5" />
                <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-accent text-accent-foreground text-[10px] font-bold flex items-center justify-center">
                  {count}
                </span>
              </div>
              <span className="font-sans font-semibold text-sm">{t('view_order')}</span>
            </div>
            <span className="font-sans font-bold text-base">{total().toFixed(2)} KM</span>
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
};

export default CartBar;
