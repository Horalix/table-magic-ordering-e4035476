import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { easeEnter } from '@/lib/motion';

interface Props {
  children: ReactNode;
  className?: string;
  /** Seconds, for a gentle cascade within one section. */
  delay?: number;
  as?: 'div' | 'li' | 'section' | 'article';
}

/**
 * Content that settles into place as it scrolls into view — once, slowly,
 * and only a short distance. With "reduce motion" on (MotionConfig in App),
 * framer-motion drops the movement and only the fade remains.
 */
const Reveal = ({ children, className, delay = 0, as = 'div' }: Props) => {
  const Tag = motion[as];
  return (
    <Tag
      className={className}
      initial={{ opacity: 0, y: 22 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.15, margin: '0px 0px -8% 0px' }}
      transition={{ duration: 0.8, ease: easeEnter, delay }}
    >
      {children}
    </Tag>
  );
};

export default Reveal;
