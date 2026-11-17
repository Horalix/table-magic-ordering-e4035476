import { useReducedMotion } from 'framer-motion';

/**
 * One chart style for the owner's screens (recharts).
 *
 * Colour comes from the theme tokens, so a chart follows the app's palette
 * rather than carrying its own: one series is the primary green; the single
 * mark a chart is about (the busiest hour) is the accent. Gridlines are solid
 * hairlines one step off the card, horizontal only; axes have no rules and
 * muted 11px ticks; bars are at most 28px wide with 4px rounded tops, and grow
 * in once (recharts' own animation, off under reduced motion).
 */

export const CHART = {
  series: 'hsl(var(--primary))',
  highlight: 'hsl(var(--accent))',
  /** The empty part of a ranked bar: a light step of the series hue. */
  track: 'hsl(var(--primary) / 0.1)',
  grid: 'hsl(var(--border))',
  ink: 'hsl(var(--muted-foreground))',
  cursor: 'hsl(var(--muted))',
} as const;

export const CHART_HEIGHT = 260;

export const chartMargin = { top: 20, right: 8, bottom: 0, left: 0 } as const;

export const gridProps = { vertical: false, stroke: CHART.grid } as const;

const tick = { fill: CHART.ink, fontSize: 11, fontFamily: 'Inter, system-ui, sans-serif' } as const;

export const xAxisProps = {
  axisLine: false, tickLine: false, tick, tickMargin: 8, minTickGap: 12, interval: 'preserveStartEnd',
} as const;

export const yAxisProps = {
  axisLine: false, tickLine: false, tick, tickMargin: 4, width: 40,
} as const;

export const barProps = { radius: [4, 4, 0, 0] as [number, number, number, number], maxBarSize: 28 };

export const cursorProps = { fill: CHART.cursor, fillOpacity: 0.55, radius: 6 } as const;

/** recharts' own entrance, once, eased out; nothing at all under reduced motion. */
export function useChartMotion() {
  const reduce = useReducedMotion();
  return {
    isAnimationActive: !reduce,
    animationBegin: 60,
    animationDuration: 750,
    animationEasing: 'ease-out' as const,
  };
}
