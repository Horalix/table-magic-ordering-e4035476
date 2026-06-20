import React from 'react';
import { motion } from 'framer-motion';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { UtensilsCrossed, Wine, Cake, Phone, MapPin, ChevronRight } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import CallWaiterButton from '@/components/guest/CallWaiterButton';
import CartBar from '@/components/guest/CartBar';
import LanguageSelector from '@/components/guest/LanguageSelector';
import { useT, useLanguageStore, getLocalizedName } from '@/lib/i18n';
import { useSessionHeartbeat } from '@/hooks/useSessionHeartbeat';
import { staggerContainer, fadeUp } from '@/lib/motion';
import type { LucideIcon } from 'lucide-react';
import type { Database } from '@/integrations/supabase/types';

type CategoryRow = Database['public']['Tables']['categories']['Row'];

const iconMap: Record<string, LucideIcon> = {
  Drinks: Wine,
  Food: UtensilsCrossed,
  Desserts: Cake,
};

const pathMap: Record<string, string> = {
  Drinks: '/menu/drinks',
  Food: '/menu/food',
  Desserts: '/menu/desserts',
};

const descKeyMap: Record<string, string> = {
  Drinks: 'drinks_desc',
  Food: 'food_desc',
  Desserts: 'desserts_desc',
};

const GuestMenu = () => {
  const navigate = useNavigate();
  useSessionHeartbeat();
  const [searchParams] = useSearchParams();
  const t = useT();
  const locale = useLanguageStore((s) => s.locale);
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
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4 }}
        className="hero-depth relative overflow-hidden flex flex-col items-center justify-center px-6 pt-16 pb-10"
        style={{ backgroundColor: 'hsl(140, 12%, 53%)' }}
      >
       <div className="relative z-10 flex flex-col items-center w-full">
        <motion.div
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ delay: 0.05, duration: 0.3, ease: 'easeOut' }}
          className="w-12 h-px bg-white/30 mb-10"
        />

        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.08, duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
          className="mb-6"
        >
          <img src="/lasoul-logo.svg" alt="La Soul" className="w-36 h-36 object-contain brightness-0 invert" />
        </motion.div>

        <div dir="ltr" className="flex items-center gap-[0.12em] mb-1">
          {'LA SOUL'.split('').map((letter, i) => (
            <motion.span
              key={i}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 + i * 0.025, duration: 0.25 }}
              className="font-serif text-[28px] font-bold text-white tracking-[0.15em]"
            >
              {letter === ' ' ? '\u00A0' : letter}
            </motion.span>
          ))}
        </div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3, duration: 0.25 }}
          className="mt-4 flex items-center gap-4"
        >
          <div className="h-px w-10 bg-white/25" />
          <p className="text-[11px] font-sans text-white/70 tracking-[0.3em] uppercase font-medium">{t('menu')}</p>
          <div className="h-px w-10 bg-white/25" />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35, duration: 0.25 }}
          className="mt-6 flex items-center gap-3"
        >
          {table && (
            <span className="px-4 py-1.5 rounded-full border border-white/20 bg-white/10 text-xs font-sans font-medium text-white tracking-wider">
              {t('table')} {table}
            </span>
          )}
          <CallWaiterButton variant="hero" />
          <LanguageSelector variant="hero" />
        </motion.div>

        {!hasSession && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4, duration: 0.25 }}
            className="mt-4 text-[11px] font-sans text-white/50 text-center leading-relaxed"
          >
            {t('scan_qr_order')}
          </motion.p>
        )}

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.45, duration: 0.3 }}
          className="mt-8 flex flex-col items-center gap-2"
        >
          <div className="flex items-center gap-2 text-white/40">
            <Phone className="w-3 h-3" />
            <span className="text-[11px] font-sans tracking-wide">{t('phone')}</span>
          </div>
          <div className="flex items-center gap-2 text-white/40">
            <MapPin className="w-3 h-3" />
            <span className="text-[11px] font-sans tracking-wide">{t('address')}</span>
          </div>
        </motion.div>
       </div>
      </motion.div>

      <motion.div
        variants={staggerContainer(0.06, 0.2)}
        initial="hidden"
        animate="show"
        className="flex-1 bg-background px-5 py-6 pb-36 space-y-3 -mt-3 rounded-t-3xl relative z-10"
      >
        {categories.map((cat) => {
          const Icon = iconMap[cat.name] || UtensilsCrossed;
          const path = pathMap[cat.name] || `/menu/${cat.name.toLowerCase()}`;
          const localizedName = getLocalizedName(cat as CategoryRow, locale);
          return (
            <motion.button
              key={cat.id}
              variants={fadeUp}
              whileTap={{ scale: 0.97 }}
              onClick={() => handleCategoryClick(path)}
              className="w-full group tap"
            >
              <div className="card-lux card-lux-hover relative overflow-hidden p-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors duration-300">
                      <Icon className="w-5 h-5 text-primary" />
                    </div>
                    <div className="text-left">
                      <h2 className="font-serif text-lg font-semibold text-foreground">{localizedName}</h2>
                      <p className="text-[13px] text-muted-foreground font-sans mt-0.5">
                        {descKeyMap[cat.name] ? t(descKeyMap[cat.name]) : ''}
                      </p>
                    </div>
                  </div>
                  <ChevronRight className={`w-4 h-4 text-muted-foreground/40 group-hover:text-primary group-hover:translate-x-0.5 transition-all duration-300 ${locale === 'ar' ? 'rotate-180' : ''}`} />
                </div>
              </div>
            </motion.button>
          );
        })}

        <Link to="/privacy" className="block text-center text-[11px] text-muted-foreground/70 font-sans hover:text-primary transition-colors pt-2">
          {t('privacy_security')}
        </Link>
      </motion.div>

      {hasSession && <CartBar />}
    </div>
  );
};

export default GuestMenu;
