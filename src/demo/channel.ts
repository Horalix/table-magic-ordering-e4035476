/**
 * How the demo's tabs and its database worker talk to each other
 * (demo mode only): one BroadcastChannel, a few plain messages.
 */
export const DEMO_CHANNEL = 'tableflow-demo';

export type DemoMessage =
  /** The database worker, while it builds a new database. */
  | { type: 'progress'; step: 'schema' | 'seed' | 'ready' }
  | { type: 'failed'; message: string }
  /** Someone reset the demo: every tab starts again on the new database. */
  | { type: 'reset' };

/** Which database this browser's tabs share. A reset moves everyone to the next one. */
const EPOCH_KEY = 'tableflow-demo.epoch';

export function currentEpoch(): number {
  try {
    const stored = Number(localStorage.getItem(EPOCH_KEY));
    return Number.isInteger(stored) && stored > 0 ? stored : 1;
  } catch {
    return 1;
  }
}

export function setEpoch(epoch: number): void {
  try { localStorage.setItem(EPOCH_KEY, String(epoch)); } catch { /* storage off: the database is rebuilt each visit */ }
}

export const databaseName = (epoch: number) => `tableflow-demo-${epoch}`;
