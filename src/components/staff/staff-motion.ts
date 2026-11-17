import { useEffect, useRef } from 'react';
import type { Transition } from 'framer-motion';
import { easeEnter, easeExit, easeStandard } from '@/lib/motion';

/*
 * Motion for the staff screens: the kitchen board, the waiter's phone and the
 * floor monitor. Kitchens are busy and these screens are glanced at, so
 * everything is short, settles without a bounce, and stops by itself. With
 * "reduce motion" on nothing moves: things are simply in their new state
 * (MotionConfig in App drops transforms and layout moves; the components here
 * also skip their fades).
 */

/** Something arriving: quick out of the gate, gentle settle. */
export const staffEnter: Transition = { duration: 0.34, ease: easeEnter };
/** A card travelling to its new place (another column, a reordered list). */
export const staffMove: Transition = { duration: 0.42, ease: easeStandard };
/** Leaving: quicker than arriving. */
export const staffExit: Transition = { duration: 0.2, ease: easeExit };

/** Where an arriving card starts: a little above, a touch smaller, transparent. */
export const ARRIVE_FROM = { opacity: 0, y: -14, scale: 0.97 };
/** Where it settles. */
export const ARRIVED = { opacity: 1, y: 0, scale: 1 };

/**
 * Whether a screen's lists have painted once. Cards that mount after that
 * are arrivals (a call just came in, food just came up) and may glow; the
 * ones that were there when the screen opened are simply there. Read
 * `.current` while rendering a card and keep the answer from its first render.
 */
export function usePastFirstPaint(ready = true) {
  const past = useRef(false);
  useEffect(() => { if (ready) past.current = true; });
  return past;
}
