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

/* ---- Reduced motion ---------------------------------------------------- */
/**
 * True when the guest has asked their device for less motion.
 *
 * CSS-driven motion is already neutralised globally in index.css; use this for
 * framer-motion entrances that would otherwise still play, and never gate
 * information behind an animation that this disables.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/* ---- Easings ---------------------------------------------------------- */
/** Things arriving: fast out of the gate, long gentle settle. */
export const easeEnter = [0.16, 1, 0.3, 1] as const;
/** Things leaving: slow start, accelerating out of the way. */
export const easeExit = [0.3, 0, 0.8, 0.15] as const;
/** Things moving from one place on screen to another. */
export const easeStandard = [0.2, 0, 0, 1] as const;
/** The original name of `easeEnter`, kept for existing imports. */
export const easeLux = easeEnter;

/* ---- Durations (seconds) --------------------------------------------- */
export const duration = {
  /** Press feedback (scale on tap). */
  press: 0.1,
  fast: 0.15,
  /** A number rolling in a stepper. */
  roll: 0.16,
  /** Route-level page fade. */
  page: 0.18,
  /** Anything leaving the screen. Exits are always quicker than entrances. */
  exit: 0.2,
  base: 0.25,
  /** An SVG stroke drawing itself (the order-sent check). */
  draw: 0.3,
  slow: 0.36,
  /** The one moment per flow that deserves attention (order sent, add-to-cart flight). */
  emphasis: 0.45,
} as const;

/* ---- Stagger ---------------------------------------------------------- */
/** Delay between list items. */
export const STAGGER = 0.03;
/** Only the first few items of a list animate; the rest are simply there. */
export const STAGGER_MAX = 6;

/* ---- Springs ---------------------------------------------------------- */
// visualDuration + bounce: the time the eye perceives, independent of mass.
/** Bottom sheets and modal surfaces. */
export const springSheet: Transition = { type: 'spring', visualDuration: 0.35, bounce: 0.1 };
/** Floating bars, badges, small things that should settle quickly. */
export const springSnappy: Transition = { type: 'spring', visualDuration: 0.25, bounce: 0.12 };
/** Layout-shared active indicators (tabs, section pills). */
export const springPill: Transition = { type: 'spring', visualDuration: 0.2, bounce: 0 };
/** Success confirmations: the only place a visible bounce is welcome. */
export const springSuccess: Transition = { type: 'spring', visualDuration: 0.4, bounce: 0.3 };
/** The original name of `springSheet`, kept for existing imports. */
export const springSoft = springSheet;

/* ---- Exit / press helpers -------------------------------------------- */
export const exitTransition: Transition = { duration: duration.exit, ease: easeExit };
/** Press scale for cards and full-width bars. */
export const PRESS_SCALE = 0.97;
/** Press scale for icon buttons. */
export const PRESS_SCALE_ICON = 0.92;

/**
 * Whether a sheet dragged down by `offsetY` px at `velocityY` px/s should
 * close: past a quarter of its height, or flicked.
 */
export function shouldDismissSheet(offsetY: number, velocityY: number, sheetHeight: number): boolean {
  if (velocityY > 500) return true;
  return sheetHeight > 0 && offsetY > sheetHeight * 0.25;
}

/* ---- Reusable variants ----------------------------------------------- */
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: duration.base, ease: easeEnter } },
};

/**
 * `fadeUp` for long lists: pass the index as `custom`. Items past
 * STAGGER_MAX start visible, so a 40-line tab never takes a second to appear.
 * Use without a stagger container (the delay is computed here).
 */
export const fadeUpCapped: Variants = {
  hidden: (i: number = 0) => (i >= STAGGER_MAX ? { opacity: 1, y: 0 } : { opacity: 0, y: 8 }),
  show: (i: number = 0) => ({
    opacity: 1,
    y: 0,
    transition: { duration: duration.base, ease: easeEnter, delay: Math.min(i, STAGGER_MAX - 1) * STAGGER },
  }),
};

export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.96 },
  show: { opacity: 1, scale: 1, transition: { duration: duration.base, ease: easeEnter } },
};

export const sheetUp: Variants = {
  hidden: { y: '100%' },
  show: { y: 0, transition: springSheet },
  exit: { y: '100%', transition: exitTransition },
};

export const fade: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: duration.base, ease: easeEnter } },
  exit: { opacity: 0, transition: exitTransition },
};

/**
 * Container that staggers its direct `fadeUp`/`scaleIn` children.
 * Pair with `variants={staggerContainer()}` + `initial="hidden" animate="show"`.
 * For lists longer than STAGGER_MAX use `fadeUpCapped` instead.
 */
export const staggerContainer = (stagger = STAGGER, delayChildren = 0): Variants => ({
  hidden: {},
  show: { transition: { staggerChildren: stagger, delayChildren } },
});

/* ---- useCountUp ------------------------------------------------------- */
/**
 * Animate a number from its previous value to `value` over `ms`.
 * Refined, not gimmicky — used for totals and admin stats. Honors
 * `prefers-reduced-motion` by snapping straight to the target.
 */
export function useCountUp(value: number, ms = 300): number {
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
