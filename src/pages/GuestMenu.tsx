import React from 'react';
import { motion } from 'framer-motion';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { UtensilsCrossed, Wine, Cake, Phone, MapPin, ChevronRight } from 'lucide-react';
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
    <div className="min-h-screen flex flex-col">
      {/* [ART] Full-screen sage green hero — matching menu.lasoul.net */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 1 }}
        className="relative flex flex-col items-center justify-center px-6 pt-16 pb-10"
        style={{ backgroundColor: 'hsl(140, 12%, 53%)' }}
      >
        {/* [ART] Decorative top line */}
        <motion.div
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ delay: 0.3, duration: 0.8, ease: 'easeOut' }}
          className="w-12 h-px bg-white/30 mb-10"
        />

        {/* [ART] La Soul arch logo — white on sage */}
        <motion.div
          initial={{ opacity: 0, scale: 0.85 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.4, duration: 1, ease: [0.16, 1, 0.3, 1] }}
          className="mb-6"
        >
          <img
            src="/lasoul-logo.svg"
            alt="La Soul"
            className="w-36 h-36 object-contain brightness-0 invert"
          />
        </motion.div>

        {/* [ART] LA SOUL staggered text */}
        <div className="flex items-center gap-[0.12em] mb-1">
          {'LA SOUL'.split('').map((letter, i) => (
            <motion.span
              key={i}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.8 + i * 0.06, duration: 0.5 }}
              className="font-serif text-[28px] font-bold text-white tracking-[0.15em]"
            >
              {letter === ' ' ? '\u00A0' : letter}
            </motion.span>
          ))}
        </div>

        {/* [ART] Menu divider */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.3, duration: 0.6 }}
          className="mt-4 flex items-center gap-4"
        >
          <div className="h-px w-10 bg-white/25" />
          <p className="text-[11px] font-sans text-white/70 tracking-[0.3em] uppercase font-medium">Menu</p>
          <div className="h-px w-10 bg-white/25" />
        </motion.div>

        {/* [UX] Table badge + Call Waiter */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.5, duration: 0.5 }}
          className="mt-6 flex items-center gap-3"
        >
          {table && (
            <span className="px-4 py-1.5 rounded-full border border-white/20 bg-white/10 text-xs font-sans font-medium text-white tracking-wider">
              Table {table}
            </span>
          )}
          <CallWaiterButton variant="hero" />
        </motion.div>

        {/* [UX] Scan prompt */}
        {!hasSession && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.6, duration: 0.6 }}
            className="mt-4 text-[11px] font-sans text-white/50 text-center leading-relaxed"
          >
            Scan the QR code at your table to place an order
          </motion.p>
        )}

        {/* [ART] Bottom contact info */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.8, duration: 0.8 }}
          className="mt-8 flex flex-col items-center gap-2"
        >
          <div className="flex items-center gap-2 text-white/40">
            <Phone className="w-3 h-3" />
            <span className="text-[11px] font-sans tracking-wide">+387 33 844 334</span>
          </div>
          <div className="flex items-center gap-2 text-white/40">
            <MapPin className="w-3 h-3" />
            <span className="text-[11px] font-sans tracking-wide">Maršala Tita 7, Sarajevo</span>
          </div>
        </motion.div>
      </motion.div>

      {/* [ART] Category cards section */}
      <div className="flex-1 bg-background px-5 py-6 pb-36 space-y-3 -mt-3 rounded-t-3xl relative z-10">
        {categories.map((cat, i) => {
          const Icon = iconMap[cat.name] || UtensilsCrossed;
          const path = pathMap[cat.name] || `/menu/${cat.name.toLowerCase()}`;
          return (
            <motion.button
              key={cat.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 1.8 + i * 0.1, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
              whileTap={{ scale: 0.98 }}
              onClick={() => handleCategoryClick(path)}
              className="w-full group"
            >
              <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-5 transition-all duration-300 hover:shadow-md hover:border-primary/30 hover:-translate-y-0.5 active:scale-[0.99]">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    {/* [ART] Icon container with sage accent */}
                    <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors duration-300">
                      <Icon className="w-5 h-5 text-primary" />
                    </div>
                    <div className="text-left">
                      <h2 className="font-serif text-lg font-semibold text-foreground">{cat.name}</h2>
                      <p className="text-[13px] text-muted-foreground font-sans mt-0.5">
                        {descMap[cat.name] || ''}
                      </p>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground/40 group-hover:text-primary group-hover:translate-x-0.5 transition-all duration-300" />
                </div>
              </div>
            </motion.button>
          );
        })}
      </div>

      {/* [UX] Cart Bar */}
      {hasSession && <CartBar />}
    </div>
  );
};

export default GuestMenu;
