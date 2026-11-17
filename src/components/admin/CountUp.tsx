import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { cn } from '@/lib/utils';

/**
 * A figure that counts up from zero the first time it appears (~0.95 s,
 * ease-out), then glides to each new value when live data moves it (a
 * shorter 0.5 s). Tabular figures, so the width does not jitter while it
 * runs. With reduced motion it is simply the number.
 *
 * Only the display moves: `format` receives the in-between values, so a
 * whole-number figure should round in its format.
 */

const FIRST_MS = 950;
const UPDATE_MS = 500;
/** Ease-out quart: quick off the mark, long soft landing. */
const easeOut = (t: number) => 1 - Math.pow(1 - t, 4);

interface CountUpProps {
  value: number;
  format?: (n: number) => string;
  className?: string;
}

const CountUp = ({ value, format = (n) => String(Math.round(n)), className }: CountUpProps) => {
  const reduce = useReducedMotion();
  const target = Number.isFinite(value) ? value : 0;
  const [shown, setShown] = useState(() => (reduce ? target : 0));
  /** What is on screen right now, so an update starts from there. */
  const current = useRef(reduce ? target : 0);
  /** Whether the first count-up has finished; later changes use the shorter glide. */
  const settled = useRef(false);

  useEffect(() => {
    if (reduce) {
      current.current = target;
      settled.current = true;
      setShown(target);
      return;
    }
    const from = current.current;
    if (from === target) { settled.current = true; return; }
    const ms = settled.current ? UPDATE_MS : FIRST_MS;
    const start = performance.now();
    let frame = 0;
    // One clock for start and progress: a frame's own timestamp can be a
    // touch earlier than `start`, which would dip below zero ("-0.00").
    const tick = () => {
      const t = Math.min(1, Math.max(0, (performance.now() - start) / ms));
      const v = t >= 1 ? target : from + (target - from) * easeOut(t);
      current.current = v;
      setShown(v);
      if (t < 1) frame = requestAnimationFrame(tick);
      else settled.current = true;
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, reduce]);

  return <span className={cn('tabular-nums', className)}>{format(shown)}</span>;
};

export default CountUp;
