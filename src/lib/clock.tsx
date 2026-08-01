import React, { createContext, useContext, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';

/**
 * One clock for every staff screen.
 *
 * `useElapsed` used to create a `setInterval(1000)` per call site, so a floor
 * monitor with forty table cards owned forty independent timers and re-rendered
 * forty components every second — on top of the page's own per-second tick. Two
 * separate 1 Hz re-render sources for the same data.
 *
 * Two things make this cheap:
 *
 *  - **One interval, many subscribers.** The provider ticks; components read.
 *  - **Buckets.** Most consumers render whole minutes, so they only need to
 *    re-render when the minute changes, not sixty times within it. Forty cards
 *    go from ~2400 renders a minute to ~40.
 *
 * It also stops while the tab is hidden. A kitchen tablet on a background tab
 * was re-rendering the whole board once a second for nobody.
 */

type Listener = () => void;

class ClockStore {
  private now = Date.now();
  private listeners = new Set<Listener>();
  private timer: ReturnType<typeof setInterval> | undefined;

  getSnapshot = () => this.now;

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    this.start();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.stop();
    };
  };

  /** Force a value — used when returning from a hidden tab. */
  sync = () => {
    this.now = Date.now();
    this.listeners.forEach((l) => l());
  };

  private start() {
    if (this.timer !== undefined) return;
    this.timer = setInterval(() => {
      this.now = Date.now();
      this.listeners.forEach((l) => l());
    }, 1000);
  }

  private stop() {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  pause() { this.stop(); }
  resume() { if (this.listeners.size > 0) { this.sync(); this.start(); } }
}

const store = new ClockStore();
const ClockContext = createContext(store);

export const ClockProvider = ({ children }: { children: React.ReactNode }) => {
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') store.pause();
      else store.resume();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  return <ClockContext.Provider value={store}>{children}</ClockContext.Provider>;
};

/** Current time, updating once a second. Prefer `useNowBucketed` where possible. */
export function useNow(): number {
  const clock = useContext(ClockContext);
  return useSyncExternalStore(clock.subscribe, clock.getSnapshot, clock.getSnapshot);
}

/**
 * Current time, rounded down to `bucketMs`.
 *
 * A component showing "14 min" only needs to re-render when that number
 * changes. Passing 60_000 turns sixty re-renders a minute into one.
 */
export function useNowBucketed(bucketMs: number): number {
  const clock = useContext(ClockContext);
  const lastRef = useRef(Math.floor(Date.now() / bucketMs) * bucketMs);

  const subscribe = useMemo(() => (listener: Listener) => clock.subscribe(() => {
    const bucket = Math.floor(clock.getSnapshot() / bucketMs) * bucketMs;
    if (bucket !== lastRef.current) {
      lastRef.current = bucket;
      listener();
    }
  }), [clock, bucketMs]);

  const getSnapshot = useMemo(() => () => lastRef.current, []);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Test seam — advance the clock without waiting. */
export const __clockForTests = store;
