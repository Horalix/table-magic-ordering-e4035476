import React from 'react';
import { motion } from 'framer-motion';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { UtensilsCrossed, Wine, Cake, Phone, MapPin } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import CallWaiterButton from '@/components/guest/CallWaiterButton';
import CartBar from '@/components/guest/CartBar';

const iconMap: Record<string, any> = {
  Drinks: Wine,
  Food: UtensilsCrossed,
  Desserts: Cake,
};

const pathMap: Record<string, string> = {
  Drinks: '/menu/drinks',
  Food: '/menu/food',
  Desserts: '/menu/desserts',
};

const descMap: Record<string, string> = {
  Drinks: 'Cocktails, wine, coffee & more',
  Food: 'Starters, mains, burgers & pizza',
  Desserts: 'Sweet endings',
};

const GuestMenu = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const table = searchParams.get('table');
  const token = searchParams.get('token');
  const hasSession = !!(table && token);

  const { data: categories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('categories')
        .select('*')
        .order('sort_order');
      if (error) throw error;
      return data;
    },
  });

  const handleCategoryClick = (path: string) => {
    const params = new URLSearchParams();
    if (table) params.set('table', table);
    if (token) params.set('token', token);
    navigate(`${path}?${params.toString()}`);
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Hero Section */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 1.2 }}
        className="relative flex flex-col items-center justify-center px-6 pt-12 pb-6"
      >
        {/* Decorative top accent */}
        <motion.div
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ delay: 0.3, duration: 0.8, ease: 'easeOut' }}
          className="w-16 h-px bg-accent mb-8"
        />

        {/* La Soul Arch Logo */}
        <motion.div
          initial={{ opacity: 0, scale: 0.8, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ delay: 0.4, duration: 1, ease: [0.16, 1, 0.3, 1] }}
          className="mb-4"
        >
          <img
            src="/lasoul-logo.svg"
            alt="La Soul"
            className="w-40 h-40 object-contain"
          />
        </motion.div>

        {/* LA SOUL staggered text */}
        <div className="flex items-center gap-[0.12em] mb-1">
          {'LA SOUL'.split('').map((letter, i) => (
            <motion.span
              key={i}
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.8 + i * 0.06, duration: 0.5 }}
              className="font-serif text-3xl font-bold text-foreground tracking-[0.1em]"
            >
              {letter === ' ' ? '\u00A0' : letter}
            </motion.span>
          ))}
        </div>

        {/* Divider with Menu label */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.3, duration: 0.6 }}
          className="mt-3 flex items-center gap-4"
        >
          <div className="h-px w-10 bg-accent/40" />
          <p className="text-[11px] font-sans text-accent tracking-[0.3em] uppercase font-medium">Menu</p>
          <div className="h-px w-10 bg-accent/40" />
        </motion.div>

        {/* Table badge + Call Waiter */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.5, duration: 0.5 }}
          className="mt-5 flex items-center gap-3"
        >
          {table && (
            <span className="px-4 py-1.5 rounded-full border border-accent/25 bg-accent/5 text-xs font-sans font-medium text-accent tracking-wider">
              Table {table}
            </span>
          )}
          <CallWaiterButton />
        </motion.div>

        {/* Scan prompt for visitors */}
        {!hasSession && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.5, duration: 0.6 }}
            className="mt-4 text-xs font-sans text-muted-foreground text-center leading-relaxed"
          >
            Scan the QR code at your table to place an order
          </motion.p>
        )}
      </motion.div>

      {/* Categories */}
      <div className="px-5 pb-36 space-y-3">
        {categories.map((cat, i) => {
          const Icon = iconMap[cat.name] || UtensilsCrossed;
          const path = pathMap[cat.name] || `/menu/${cat.name.toLowerCase()}`;
          return (
            <motion.button
              key={cat.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 1.5 + i * 0.12, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
              whileTap={{ scale: 0.98 }}
              onClick={() => handleCategoryClick(path)}
              className="w-full group"
            >
              <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-6 transition-all duration-300 hover:shadow-md hover:border-accent/25 hover:-translate-y-0.5 active:scale-[0.99]">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-11 h-11 rounded-xl bg-primary/8 flex items-center justify-center group-hover:bg-primary/15 transition-colors duration-300">
                      <Icon className="w-5 h-5 text-primary" />
                    </div>
                    <div className="text-left">
                      <h2 className="font-serif text-xl font-semibold text-foreground">{cat.name}</h2>
                      <p className="text-[13px] text-muted-foreground font-sans mt-0.5">
                        {descMap[cat.name] || ''}
                      </p>
                    </div>
                  </div>
                  <div className="text-muted-foreground/50 group-hover:text-accent group-hover:translate-x-0.5 transition-all duration-300">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </div>
              </div>
            </motion.button>
          );
        })}
      </div>

      {/* Restaurant Info Footer */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 2, duration: 0.8 }}
        className="px-6 pb-10 -mt-28"
      >
        <div className="flex flex-col items-center gap-2.5 pt-6 border-t border-border/40">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Phone className="w-3 h-3" />
            <span className="text-[11px] font-sans tracking-wide">+387 33 844 334</span>
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            <MapPin className="w-3 h-3" />
            <span className="text-[11px] font-sans tracking-wide">Maršala Tita 7, Sarajevo</span>
          </div>
        </div>
      </motion.div>

      {/* Cart Bar (only shows with session) */}
      {hasSession && <CartBar />}
    </div>
  );
};

export default GuestMenu;
