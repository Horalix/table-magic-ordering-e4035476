/**
 * Guest haptics: four patterns, one call site each.
 *
 * Only Android browsers implement `navigator.vibrate`; iOS Safari has no web
 * haptics at all, and nothing here tries to fake them. Haptics confirm
 * something the guest just did with their finger — never scrolling, never a
 * background update — and there is no sound: a café, phones on silent.
 *
 *   tick     10 ms         section pill tap, stepper + / −
 *   add      15 ms         a dish went into the order
 *   success  20·60·30 ms   the order reached the restaurant
 *   error    40·60·40 ms   it did not (payment declined)
 */
export const HAPTICS = {
  tick: 10,
  add: 15,
  success: [20, 60, 30],
  error: [40, 60, 40],
} as const;

export type HapticKind = keyof typeof HAPTICS;

/** The pattern for a kind, as `navigator.vibrate` takes it. */
export function hapticPattern(kind: HapticKind): number | number[] {
  const p = HAPTICS[kind];
  return typeof p === 'number' ? p : [...p];
}

/**
 * Play a haptic. Returns whether the device accepted it; false where the API
 * does not exist (iOS, desktop) or the browser refuses (no user gesture yet).
 */
export function haptic(kind: HapticKind): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return false;
  try {
    return navigator.vibrate(hapticPattern(kind));
  } catch {
    // Some browsers throw instead of returning false before a gesture.
    return false;
  }
}
