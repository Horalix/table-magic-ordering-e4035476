import React from 'react';
import { motion } from 'framer-motion';
import { useLocation } from 'react-router-dom';
import { duration, easeEnter } from '@/lib/motion';

/**
 * Lightweight wrapper that fades + slides each route on mount.
 * Keyed on pathname so it animates when the user navigates.
 */
const PageTransition: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { pathname } = useLocation();
  return (
    <motion.div
      key={pathname}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: duration.page, ease: easeEnter }}
    >
      {children}
    </motion.div>
  );
};

export default PageTransition;
