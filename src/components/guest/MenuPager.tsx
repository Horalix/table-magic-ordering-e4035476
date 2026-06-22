import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion, useMotionValue, animate, type PanInfo } from 'framer-motion';

/**
 * Controlled horizontal pager — the track follows the finger but snaps to
 * exactly ONE adjacent page with a crisp, overdamped spring (no native momentum
 * drift). Each page scrolls vertically on its own; drag="x" keeps touch-action
 * pan-y so vertical scrolling is untouched.
 */

// Overdamped → fast settle, zero overshoot = the "clean" feel.
const SNAP = { type: 'spring', stiffness: 520, damping: 44, mass: 0.7 } as const;
const FLICK_VELOCITY = 350; // px/s to count a light flick as a page change
const COMMIT_RATIO = 0.18;  // fraction of width dragged to commit without a flick

interface Props {
  index: number;
  count: number;
  onIndexChange: (i: number) => void;
  children: React.ReactNode[];
}

const MenuPager = ({ index, count, onIndexChange, children }: Props) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const x = useMotionValue(0);
  const dragging = useRef(false);
  const skipSync = useRef(false); // drag already animated x → don't re-animate

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Keep the track aligned to the active page (pill taps, resize) unless the
  // user is actively dragging.
  useEffect(() => {
    if (skipSync.current) { skipSync.current = false; return; }
    if (dragging.current || !width) { if (width) x.set(-index * width); return; }
    const controls = animate(x, -index * width, SNAP);
    return () => controls.stop();
  }, [index, width, x]);

  const handleDragEnd = useCallback((_: unknown, info: PanInfo) => {
    dragging.current = false;
    if (!width) return;
    const current = -x.get() / width;
    let target = Math.round(current);
    if (info.velocity.x < -FLICK_VELOCITY || info.offset.x < -width * COMMIT_RATIO) target = index + 1;
    else if (info.velocity.x > FLICK_VELOCITY || info.offset.x > width * COMMIT_RATIO) target = index - 1;
    target = Math.max(0, Math.min(count - 1, Math.max(index - 1, Math.min(index + 1, target))));
    if (target !== index) { skipSync.current = true; onIndexChange(target); }
    animate(x, -target * width, SNAP);
  }, [width, x, index, count, onIndexChange]);

  return (
    <div ref={containerRef} className="flex-1 overflow-hidden">
      <motion.div
        className="flex h-full"
        style={{ x }}
        drag="x"
        dragDirectionLock
        dragConstraints={{ left: -Math.min(index + 1, count - 1) * width, right: -Math.max(index - 1, 0) * width }}
        dragElastic={0.1}
        onDragStart={() => { dragging.current = true; }}
        onDragEnd={handleDragEnd}
      >
        {children.map((child, i) => (
          <div key={i} style={{ width: width || undefined }} className="h-full shrink-0 overflow-y-auto overscroll-y-contain">
            {/* Only mount the active page + its neighbours; far pages stay empty
                spacers (geometry preserved) so toggling view re-lays-out ~3
                pages instead of all of them. */}
            {Math.abs(i - index) <= 1 ? child : null}
          </div>
        ))}
      </motion.div>
    </div>
  );
};

export default MenuPager;
