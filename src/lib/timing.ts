import { useEffect, useState } from 'react';

export function formatDuration(ms: number): string {
  if (ms < 0) ms = 0;
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function formatMinutes(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** Re-renders consumer every `intervalMs` ms */
export function useTick(intervalMs = 1000): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return tick;
}

/** Returns elapsed ms since `since` and refreshes every second */
export function useElapsed(since: string | Date | null | undefined): number {
  useTick(1000);
  if (!since) return 0;
  const ts = typeof since === 'string' ? new Date(since).getTime() : since.getTime();
  return Date.now() - ts;
}

/** Color class based on elapsed minutes (for order wait escalation) */
export function waitColor(ms: number): string {
  const mins = ms / 60000;
  if (mins < 10) return 'text-primary';
  if (mins < 20) return 'text-accent';
  return 'text-destructive';
}

export function waitBg(ms: number): string {
  const mins = ms / 60000;
  if (mins < 10) return 'bg-primary/10 text-primary border-primary/20';
  if (mins < 20) return 'bg-accent/10 text-accent border-accent/20';
  return 'bg-destructive/10 text-destructive border-destructive/20';
}
