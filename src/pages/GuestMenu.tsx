import React from 'react';
import { motion } from 'framer-motion';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { UtensilsCrossed, Wine, Cake } from 'lucide-react';

const categories = [
  { name: 'Drinks', icon: Wine, path: '/menu/drinks', color: 'from-sage-dark to-sage' },
  { name: 'Food', icon: UtensilsCrossed, path: '/menu/food', color: 'from-accent to-gold-light' },
  { name: 'Desserts', icon: Cake, path: '/menu/dessert', color: 'from-sage to-sage-light' },
];

const GuestMenu = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const table = searchParams.get('table');
  const token = searchParams.get('token');

  const handleCategoryClick = (path: string) => {
    const params = new URLSearchParams();
    if (table) params.set('table', table);
    if (token) params.set('token', token);
    navigate(`${path}?${params.toString()}`);
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Hero */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8 }}
        className="relative flex flex-col items-center justify-center px-6 pt-16 pb-10"
      >
        {/* Logo area */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.6 }}
          className="mb-2"
        >
          <div className="w-20 h-20 rounded-full border-2 border-primary flex items-center justify-center">
            <span className="font-serif text-2xl font-bold text-primary">LS</span>
          </div>
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4, duration: 0.6 }}
          className="font-serif text-4xl font-bold text-foreground tracking-tight"
        >
          La Soul
        </motion.h1>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6, duration: 0.6 }}
          className="mt-1 flex items-center gap-3"
        >
          <div className="h-px w-8 bg-primary/40" />
          <p className="text-sm font-sans text-muted-foreground tracking-[0.2em] uppercase">Menu</p>
          <div className="h-px w-8 bg-primary/40" />
        </motion.div>

        {table && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.8, duration: 0.4 }}
            className="mt-4 px-4 py-1.5 rounded-full bg-primary/10 border border-primary/20"
          >
            <span className="text-xs font-sans font-medium text-primary">Table {table}</span>
          </motion.div>
        )}
      </motion.div>

      {/* Categories */}
      <div className="px-6 pb-32 space-y-4">
        {categories.map((cat, i) => (
          <motion.button
            key={cat.name}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.8 + i * 0.15, duration: 0.5 }}
            onClick={() => handleCategoryClick(cat.path)}
            className="w-full group"
          >
            <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-8 transition-all duration-300 hover:shadow-lg hover:border-primary/30 hover:-translate-y-0.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                    <cat.icon className="w-6 h-6 text-primary" />
                  </div>
                  <div className="text-left">
                    <h2 className="font-serif text-2xl font-semibold text-foreground">{cat.name}</h2>
                    <p className="text-sm text-muted-foreground font-sans mt-0.5">
                      {cat.name === 'Drinks' && 'Cocktails, wine, coffee & more'}
                      {cat.name === 'Food' && 'Starters, mains, burgers & pizza'}
                      {cat.name === 'Desserts' && 'Sweet endings'}
                    </p>
                  </div>
                </div>
                <div className="text-muted-foreground group-hover:text-primary transition-colors">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </div>
            </div>
          </motion.button>
        ))}
      </div>
    </div>
  );
};

export default GuestMenu;
