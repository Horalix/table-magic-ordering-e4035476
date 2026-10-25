import React, { useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { duration, easeEnter, easeExit } from '@/lib/motion';

/**
 * A stepper quantity that rolls: the new digit slides 8px in the direction
 * of change (up for more, down for fewer) while the old one leaves the other
 * way. Small enough to read as "it counted", not as decoration.
 *
 * Reduced motion: MotionConfig drops the slide and leaves the crossfade.
 */
const RollingNumber = ({ value, className }: { value: number; className?: string }) => {
  const prev = useRef(value);
  const dir = useRef(1);
  if (value !== prev.current) {
    dir.current = value > prev.current ? 1 : -1;
    prev.current = value;
  }
  const d = dir.current;

  return (
    <span className={`relative inline-flex justify-center overflow-hidden ${className ?? ''}`}>
      <AnimatePresence mode="popLayout" initial={false} custom={d}>
        <motion.span
          key={value}
          custom={d}
          variants={{
            enter: (k: number) => ({ y: 8 * k, opacity: 0 }),
            center: { y: 0, opacity: 1, transition: { duration: duration.roll, ease: easeEnter } },
            leave: (k: number) => ({ y: -8 * k, opacity: 0, transition: { duration: duration.roll, ease: easeExit } }),
          }}
          initial="enter"
          animate="center"
          exit="leave"
          className="inline-block"
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </span>
  );
};

export default RollingNumber;
