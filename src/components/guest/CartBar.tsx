import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ShoppingBag } from 'lucide-react';
import { useCartStore } from '@/lib/cart-store';
import { useNavigate, useSearchParams } from 'react-router-dom';

const CartBar = () => {
  const { items, total, itemCount } = useCartStore();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const count = itemCount();

  const table = searchParams.get('table');
  const token = searchParams.get('token');
  const hasSession = !!(table && token);

  if (count === 0 || !hasSession) return null;

  const goToCart = () => {
    const params = new URLSearchParams();
    if (table) params.set('table', table);
    if (token) params.set('token', token);
    navigate(`/cart?${params.toString()}`);
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ y: 100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 100, opacity: 0 }}
        className="fixed bottom-0 left-0 right-0 z-40 p-4 pb-6"
      >
        <button
          onClick={goToCart}
          className="w-full flex items-center justify-between px-6 py-4 rounded-2xl bg-primary text-primary-foreground shadow-lg hover:bg-sage-dark transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="relative">
              <ShoppingBag className="w-5 h-5" />
              <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-accent text-accent-foreground text-[10px] font-bold flex items-center justify-center">
                {count}
              </span>
            </div>
            <span className="font-sans font-semibold text-sm">View Order</span>
          </div>
          <span className="font-sans font-bold text-base">{total().toFixed(2)} KM</span>
        </button>
      </motion.div>
    </AnimatePresence>
  );
};

export default CartBar;
