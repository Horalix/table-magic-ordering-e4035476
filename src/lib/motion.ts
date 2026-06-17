/**
 * La Soul motion system — the single source of truth for the app's
 * "refined & restrained" feel (calm, fast, premium). Import these tokens
 * instead of hand-typing durations / easings / springs so every surface
 * animates with one consistent vocabulary.
 *
 * All consumers still inherit the global `prefers-reduced-motion` guard in
 * index.css, which neutralizes CSS-driven motion; framer-motion variants
 * below are intentionally subtle so reduced-motion users lose nothing
 * essential.
 */
import { useEffect, useRef, useState } from 'react';
import type { Transition, Variants } from 'framer-motion';

/* ---- Easings ---------------------------------------------------------- */
// The signature ease already used ad-hoc across the app (decelerate-out).
export const easeLux = [0.16, 1, 0.3, 1] as const;
export const easeOutSoft = [0.22, 0.61, 0.36, 1] as const;

/* ---- Durations (seconds) --------------------------------------------- */
export const duration = {
  fast: 0.16,
  base: 0.24,
  slow: 0.36,
} as const;

/* ---- Springs ---------------------------------------------------------- */
// Soft: bottom sheets / modal surfaces (matches MenuItemDetail today).
export const springSoft: Transition = { type: 'spring', damping: 28, stiffness: 300 };
// Snappy: floating bars / pills that should settle quickly (CartBar today).
export const springSnappy: Transition = { type: 'spring', damping: 22, stiffness: 320 };
// Pill: layout-shared active indicators (tabs, nav).
export const springPill: Transition = { type: 'spring', stiffness: 500, damping: 38 };

/* ---- Reusable variants ----------------------------------------------- */
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: duration.base, ease: easeLux } },
};

export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.96 },
  show: { opacity: 1, scale: 1, transition: { duration: duration.base, ease: easeLux } },
};

export const sheetUp: Variants = {
  hidden: { y: '100%' },
  show: { y: 0, transition: springSoft },
  exit: { y: '100%', transition: { duration: duration.base, ease: easeLux } },
};

export const fade: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: duration.base, ease: easeLux } },
  exit: { opacity: 0, transition: { duration: duration.fast, ease: easeLux } },
};

/**
 * Container that staggers its direct `fadeUp`/`scaleIn` children.
 * Pair with `variants={staggerContainer()}` + `initial="hidden" animate="show"`.
 */
export const staggerContainer = (stagger = 0.04, delayChildren = 0): Variants => ({
  hidden: {},
  show: { transition: { staggerChildren: stagger, delayChildren } },
});

/* ---- useCountUp ------------------------------------------------------- */
/**
 * Animate a number from its previous value to `value` over `ms`.
 * Refined, not gimmicky — used for totals and admin stats. Honors
 * `prefers-reduced-motion` by snapping straight to the target.
 */
export function useCountUp(value: number, ms = 600): number {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);
  const rafRef = useRef<number>();

  useEffect(() => {
    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    const from = fromRef.current;
    const to = value;
    if (prefersReduced || from === to || ms <= 0) {
      fromRef.current = to;
      setDisplay(to);
      return;
    }

    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      // easeOutCubic — quick start, gentle settle.
      const eased = 1 - Math.pow(1 - t, 3);
      const current = from + (to - from) * eased;
      setDisplay(current);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = to;
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      fromRef.current = to;
    };
  }, [value, ms]);

  return display;
}
