/**
 * Sound on a waiter's screen is on unless someone muted it, and a mute ends
 * by itself.
 *
 * A mute used to be stored for good: one tap during a staff meeting left a
 * phone silent for every service after it. A mute now lasts MUTE_MS at most,
 * so the next shift always starts with sound on. Vibration is not muted at
 * all — the screens buzz for calls, bills and food whatever this says.
 */
import { useCallback, useEffect, useState } from 'react';

/** How long a mute lasts: about one shift. */
export const MUTE_MS = 4 * 60 * 60_000;

/** Where each screen keeps the time its mute ends. */
export const MUTE_KEYS = {
  waiter: 'waiter-sound-muted-until',
  floor: 'floor-sound-muted-until',
} as const;

export type SoundScreen = keyof typeof MUTE_KEYS;

/** The old keys kept "muted" forever; they are dropped, so every phone starts with sound on. */
export const LEGACY_SOUND_KEYS = ['waiter-sound-on', 'monitor:sound'] as const;

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** When this screen's mute ends, or null while its sound is on. */
export function mutedUntil(screen: SoundScreen, now = Date.now()): number | null {
  const store = storage();
  if (!store) return null;
  try {
    for (const key of LEGACY_SOUND_KEYS) store.removeItem(key);
    const until = Number(store.getItem(MUTE_KEYS[screen]));
    if (Number.isFinite(until) && until > now) return until;
    store.removeItem(MUTE_KEYS[screen]);
  } catch {
    // Storage blocked (a private window): sound stays on.
  }
  return null;
}

/** Mute this screen for MUTE_MS. Returns when the mute ends. */
export function muteSound(screen: SoundScreen, now = Date.now()): number {
  const until = now + MUTE_MS;
  try {
    storage()?.setItem(MUTE_KEYS[screen], String(until));
  } catch {
    // Not remembered across a reload; the mute still holds while the screen is open.
  }
  return until;
}

export function unmuteSound(screen: SoundScreen): void {
  try {
    storage()?.removeItem(MUTE_KEYS[screen]);
  } catch {
    // Nothing stored, nothing to clear.
  }
}

/** "21:40": when a mute ends, the way the restaurant reads a clock. */
export function soundBackAt(until: number): string {
  return new Date(until).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
}

/**
 * Sound on or off for a waiter's screen. A mute switches itself off on time,
 * even while the screen stays open all evening.
 */
export function useStaffSound(screen: SoundScreen): {
  soundOn: boolean;
  /** When the mute ends; null while sound is on. */
  mutedUntil: number | null;
  setSoundOn: (on: boolean) => void;
} {
  const [until, setUntil] = useState<number | null>(() => mutedUntil(screen));

  useEffect(() => {
    if (until === null) return;
    let id = 0;
    const check = () => {
      const next = mutedUntil(screen) ?? (until > Date.now() ? until : null);
      if (next === null) setUntil(null);
      else id = window.setTimeout(check, Math.max(1_000, next - Date.now()));
    };
    id = window.setTimeout(check, Math.max(0, until - Date.now()));
    return () => window.clearTimeout(id);
  }, [screen, until]);

  const setSoundOn = useCallback((on: boolean) => {
    if (on) {
      unmuteSound(screen);
      setUntil(null);
    } else {
      setUntil(muteSound(screen));
    }
  }, [screen]);

  return { soundOn: until === null, mutedUntil: until, setSoundOn };
}
