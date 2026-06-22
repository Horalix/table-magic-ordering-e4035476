import React from 'react';
import { motion, AnimatePresence, type PanInfo } from 'framer-motion';

/**
 * Paginated swipe view — the content follows the finger (drag) and snaps to the
 * next/previous page with a spring. Vertical scrolling is preserved (framer sets
 * touch-action: pan-y for a horizontal drag). Direction- and RTL-aware.
 */

const OFFSET = 70;          // px the incoming/outgoing page travels
const CONFIDENCE = 6000;    // |offset × velocity| needed to flip pages

const swipePower = (offset: number, velocity: number) => Math.abs(offset) * velocity;

type Custom = { dir: number; rtl: boolean };

const variants = {
  enter: ({ dir, rtl }: Custom) => ({ x: (dir > 0 ? OFFSET : -OFFSET) * (rtl ? -1 : 1), opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: ({ dir, rtl }: Custom) => ({ x: (dir > 0 ? -OFFSET : OFFSET) * (rtl ? -1 : 1), opacity: 0 }),
};

const spring = { type: 'spring', stiffness: 300, damping: 30, mass: 0.8 } as const;

interface Props {
  pageKey: string;
  direction: number;            // 1 = went next, -1 = went prev
  rtl?: boolean;
  canPrev: boolean;
  canNext: boolean;
  onPaginate: (dir: 1 | -1) => void;
  children: React.ReactNode;
}

const SwipeView = ({ pageKey, direction, rtl = false, canPrev, canNext, onPaginate, children }: Props) => {
  const custom: Custom = { dir: direction, rtl };

  const handleDragEnd = (_: unknown, info: PanInfo) => {
    if (Math.abs(swipePower(info.offset.x, info.velocity.x)) < CONFIDENCE) return;
    const forward = rtl ? info.offset.x > 0 : info.offset.x < 0;
    if (forward && canNext) onPaginate(1);
    else if (!forward && canPrev) onPaginate(-1);
  };

  return (
    <div className="overflow-x-clip">
      <AnimatePresence initial={false} custom={custom} mode="popLayout">
        <motion.div
          key={pageKey}
          custom={custom}
          variants={variants}
          initial="enter"
          animate="center"
          exit="exit"
          transition={{ x: spring, opacity: { duration: 0.18 } }}
          drag="x"
          dragConstraints={{ left: 0, right: 0 }}
          dragElastic={0.2}
          onDragEnd={handleDragEnd}
          className="will-change-transform"
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </div>
  );
};

export default SwipeView;
