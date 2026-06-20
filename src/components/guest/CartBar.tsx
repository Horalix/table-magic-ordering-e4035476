import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ShoppingBag, Receipt } from 'lucide-react';
import { useCartStore } from '@/lib/cart-store';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useT } from '@/lib/i18n';
import { springSnappy, useCountUp } from '@/lib/motion';

const CartBar = () => {
  const { total, itemCount, sessionId } = useCartStore();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const count = itemCount();
  const t = useT();
  const displayTotal = useCountUp(total());

  const table = searchParams.get('table');
  const token = searchParams.get('token');
  const hasSession = !!(table && token);

  const [bounce, setBounce] = useState(0);
  useEffect(() => {
    if (count > 0) setBounce((b) => b + 1);
  }, [count]);

  if (!hasSession) return null;

  const buildParams = () => {
    const params = new URLSearchParams();
    if (table) params.set('table', table);
    if (token) params.set('token', token);
    return params.toString();
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 p-4 pb-safe space-y-2 pointer-events-none">
      {sessionId && (
        <motion.button
          initial={{ y: 50, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={springSnappy}
          onClick={() => navigate(`/tab?${buildParams()}`)}
          className="pointer-events-auto w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-card/90 backdrop-blur-lg border border-border text-foreground font-sans text-sm font-medium hover:bg-muted transition-colors min-h-[44px] tap"
        >
          <Receipt className="w-4 h-4 text-primary" />
          {t('view_your_tab')}
        </motion.button>
      )}

      <AnimatePresence>
        {count > 0 && (
          <motion.button
            initial={{ y: 100, opacity: 0, scale: 0.95 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 100, opacity: 0, scale: 0.95 }}
            transition={springSnappy}
            onClick={() => navigate(`/cart?${buildParams()}`)}
            className="pointer-events-auto w-full flex items-center justify-between px-6 py-4 rounded-2xl text-white shadow-xl shadow-primary/30 hover:shadow-primary/40 transition-shadow min-h-[56px] tap"
            style={{ backgroundColor: 'hsl(140, 12%, 53%)' }}
          >
            <div className="flex items-center gap-3">
              <div className="relative">
                <ShoppingBag className="w-5 h-5" />
                <motion.span
                  key={bounce}
                  initial={{ scale: 0.6 }}
                  animate={{ scale: [0.6, 1.25, 1] }}
                  transition={{ duration: 0.35, ease: 'easeOut' }}
                  className="absolute -top-1.5 -right-1.5 min-w-4 h-4 px-1 rounded-full bg-accent text-accent-foreground text-[10px] font-bold flex items-center justify-center tabular-nums"
                >
                  {count}
                </motion.span>
              </div>
              <span className="font-sans font-semibold text-sm">
                {t('view_order')}
                <span className="opacity-70 font-medium"> · {count} {count === 1 ? t('items_count_one') : t('items_count_other')}</span>
              </span>
            </div>
            <span className="font-sans font-bold text-base tabular-nums">
              {displayTotal.toFixed(2)} KM
            </span>
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
};

export default CartBar;
