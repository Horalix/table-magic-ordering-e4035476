export const TIP_PRESETS = [0, 5, 10, 15] as const;

/**
 * Compute a tip in KM. `preset` is a percentage (0/5/10/15) of the items
 * total, or 'custom' to use a flat `customKm` amount. Result is non-negative
 * and rounded to 2 decimals. The server independently re-validates/caps it.
 */
export function computeTip(itemsTotal: number, preset: number | 'custom', customKm: number): number {
  if (preset === 'custom') {
    return Math.max(0, Math.round((customKm || 0) * 100) / 100);
  }
  return Math.round(Math.max(0, itemsTotal) * preset) / 100;
}
