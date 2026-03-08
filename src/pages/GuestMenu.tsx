import React from 'react';
import { motion } from 'framer-motion';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { UtensilsCrossed, Wine, Cake, Phone, MapPin } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

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
        className="relative flex flex-col items-center justify-center px-6 pt-12 pb-8"
      >
        {/* Decorative top line */}
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
          className="mb-6"
        >
          <img
            src="/lasoul-logo.svg"
            alt="La Soul"
            className="w-44 h-44 object-contain"
          />
        </motion.div>

        {/* LA SOUL text with staggered letters */}
        <div className="flex items-center gap-[0.15em] mb-2">
          {'LA SOUL'.split('').map((letter, i) => (
            <motion.span
              key={i}
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.8 + i * 0.07, duration: 0.5 }}
              className="font-serif text-4xl font-bold text-foreground tracking-[0.08em]"
            >
              {letter === ' ' ? '\u00A0' : letter}
            </motion.span>
          ))}
        </div>

        {/* Divider with Menu label */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.4, duration: 0.6 }}
          className="mt-3 flex items-center gap-4"
        >
          <div className="h-px w-12 bg-accent/50" />
          <p className="text-xs font-sans text-accent tracking-[0.3em] uppercase font-medium">Menu</p>
          <div className="h-px w-12 bg-accent/50" />
        </motion.div>

        {/* Table badge */}
        {table && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 1.6, duration: 0.4 }}
            className="mt-5 px-5 py-1.5 rounded-full border border-accent/30 bg-accent/5"
          >
            <span className="text-xs font-sans font-medium text-accent tracking-wider">Table {table}</span>
          </motion.div>
        )}

        {/* Scan QR prompt for visitors without a table */}
        {!hasSession && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.6, duration: 0.6 }}
            className="mt-5 text-xs font-sans text-muted-foreground text-center"
          >
            Scan the QR code at your table to place an order
          </motion.p>
        )}
      </motion.div>

      {/* Categories */}
      <div className="px-6 pb-10 space-y-4">
        {categories.map((cat, i) => {
          const Icon = iconMap[cat.name] || UtensilsCrossed;
          const path = pathMap[cat.name] || `/menu/${cat.name.toLowerCase()}`;
          return (
            <motion.button
              key={cat.id}
              initial={{ opacity: 0, y: 25 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 1.6 + i * 0.15, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
              onClick={() => handleCategoryClick(path)}
              className="w-full group"
            >
              <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-8 transition-all duration-300 hover:shadow-lg hover:border-accent/30 hover:-translate-y-1 group-hover:shadow-accent/5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                      <Icon className="w-6 h-6 text-primary" />
                    </div>
                    <div className="text-left">
                      <h2 className="font-serif text-2xl font-semibold text-foreground">{cat.name}</h2>
                      <p className="text-sm text-muted-foreground font-sans mt-0.5">
                        {descMap[cat.name] || ''}
                      </p>
                    </div>
                  </div>
                  <div className="text-muted-foreground group-hover:text-accent transition-colors">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
        transition={{ delay: 2.2, duration: 0.8 }}
        className="px-6 pb-12"
      >
        <div className="flex flex-col items-center gap-3 pt-6 border-t border-border/50">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Phone className="w-3.5 h-3.5" />
            <span className="text-xs font-sans">+387 33 844 334</span>
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            <MapPin className="w-3.5 h-3.5" />
            <span className="text-xs font-sans">Maršala Tita 7, Sarajevo</span>
          </div>
          <p className="text-[10px] font-sans text-muted-foreground/50 mt-2 tracking-wider uppercase">
            Est. Sarajevo
          </p>
        </div>
      </motion.div>
    </div>
  );
};

export default GuestMenu;
