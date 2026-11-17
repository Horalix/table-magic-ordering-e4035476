import type React from 'react';
import { motion, useReducedMotion } from 'framer-motion';

/**
 * A ranked list as thin horizontal bars: name and figure on one line, the bar
 * under it, longest first. For part-of-a-whole and "most ordered" lists,
 * where a pie or a squeezed category axis made close values unreadable and
 * wrapped the dish names.
 *
 * The track is a light step of the bar's own colour; bars grow in once, a
 * beat apart, and are simply there under reduced motion.
 */

export interface RankedRow {
  key: string;
  label: React.ReactNode;
  value: number;
  /** The figure printed at the right. */
  display: React.ReactNode;
  /** Muted text after the figure, e.g. a share. */
  aside?: React.ReactNode;
}

const RankedBars = ({ rows, label, max }: { rows: RankedRow[]; label: string; max?: number }) => {
  const reduce = useReducedMotion();
  const top = max ?? Math.max(...rows.map((r) => r.value), 1);
  return (
    <ol className="space-y-3.5" aria-label={label}>
      {rows.map((r, i) => {
        const width = `${Math.max(0, Math.min(100, (100 * r.value) / top))}%`;
        return (
          <li key={r.key}>
            <div className="flex items-baseline justify-between gap-3 text-sm font-sans">
              <span className="min-w-0 truncate text-foreground">{r.label}</span>
              <span className="shrink-0 tabular-nums font-medium text-foreground">
                {r.display}
                {r.aside && <span className="ml-1.5 font-normal text-muted-foreground">{r.aside}</span>}
              </span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-primary/10">
              <motion.div
                className="h-full rounded-full bg-primary"
                initial={reduce ? false : { width: 0 }}
                animate={{ width }}
                transition={{ duration: 0.75, delay: reduce ? 0 : Math.min(i, 10) * 0.04, ease: [0.16, 1, 0.3, 1] }}
                style={reduce ? { width } : undefined}
              />
            </div>
          </li>
        );
      })}
    </ol>
  );
};

export default RankedBars;
