import React, { useEffect, useRef } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { easeEnter } from '@/lib/motion';
import { TONE, type StaffTone } from '@/components/staff/status-tone';

/**
 * A ring of light around a card that has just arrived, in its state's colour.
 *
 * Two soft pulses in under three seconds, then gone: enough to pull an eye
 * across a kitchen to the new thing, not a light show for the rest of the
 * shift. The card's border and its word ("New", "Ready to run") carry the
 * state after that. Drawn just outside the card, so the card must not clip it.
 */
export function ArrivalGlow({ tone, className = 'rounded-[inherit]' }: { tone: StaffTone; className?: string }) {
  const reduced = useReducedMotion();
  if (reduced) return null;
  const c = TONE[tone].hsl;
  return (
    <motion.span
      aria-hidden
      className={`pointer-events-none absolute -inset-px z-10 ${className}`}
      style={{ boxShadow: `0 0 0 2px hsl(${c}), 0 0 0 6px hsl(${c} / 0.16), 0 10px 34px -6px hsl(${c} / 0.5)` }}
      initial={{ opacity: 0 }}
      animate={{ opacity: [0, 1, 0.45, 0.9, 0] }}
      transition={{ duration: 2.8, times: [0, 0.1, 0.42, 0.58, 1], ease: 'easeInOut' }}
    />
  );
}

/**
 * A count that ticks: the new number slides in from the side it came from
 * (up for more, down for fewer). The first number is simply there; with
 * reduce motion every number is.
 */
export function TickingCount({ value, className = '' }: { value: number; className?: string }) {
  const reduced = useReducedMotion();
  const mounted = useRef(false);
  const prev = useRef(value);
  const dir = useRef(1);
  if (value !== prev.current) {
    dir.current = value > prev.current ? 1 : -1;
    prev.current = value;
  }
  useEffect(() => { mounted.current = true; }, []);
  const d = dir.current;
  return (
    <span className={`relative inline-flex justify-center overflow-hidden tabular-nums ${className}`}>
      <motion.span
        key={value}
        className="inline-block"
        initial={mounted.current && !reduced ? { y: 9 * d, opacity: 0 } : false}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.24, ease: easeEnter }}
      >
        {value}
      </motion.span>
    </span>
  );
}
