/**
 * Tip choices, offered only with online card payment.
 *
 * Paying at the table (cash or the card terminal) shows no tip row at all:
 * tipping before the food has arrived asks the guest to rate a service that
 * has not happened yet, and the waiter can be tipped in person at the end.
 *
 * "No tip" is the neutral default — no percentage is ever preselected.
 */
export const TIP_CHOICES = [0, 'round', 5, 10] as const;
export type TipChoice = (typeof TIP_CHOICES)[number] | 'custom';

/** Rounds the bill up to the next whole KM (a whole bill goes up by one). */
export function roundUpTip(itemsTotal: number): number {
  const cents = Math.round(Math.max(0, itemsTotal) * 100);
  if (cents === 0) return 0;
  let next = Math.ceil(cents / 100) * 100;
  if (next === cents) next += 100;
  return (next - cents) / 100;
}

/**
 * Compute a tip in KM. `preset` is a percentage (0/5/10) of the items total,
 * 'round' to round the bill up, or 'custom' to use a flat `customKm` amount.
 * Result is non-negative and rounded to 2 decimals. The server independently
 * re-validates/caps it.
 */
export function computeTip(itemsTotal: number, preset: number | 'custom' | 'round', customKm: number): number {
  if (preset === 'custom') {
    return Math.max(0, Math.round((customKm || 0) * 100) / 100);
  }
  if (preset === 'round') return roundUpTip(itemsTotal);
  return Math.round(Math.max(0, itemsTotal) * preset) / 100;
}
