/**
 * Number formats for the owner's screens. Presentation only: every figure is
 * computed where it always was; these decide how it reads.
 */

/** `27,450.50` — grouped, always two decimals. */
export const money = (n: number) =>
  Number(n || 0).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** `27,450.50 KM`. */
export const moneyKM = (n: number) => `${money(n)} KM`;

/** A count, rounded and grouped: `1,204`. */
export const whole = (n: number) => Math.round(Number(n || 0)).toLocaleString('en');

/** Axis ticks: `0`, `800`, `1.5k`, `12k`. The unit is in the card's subtitle, not on every tick. */
export const compact = (n: number) => {
  const abs = Math.abs(n);
  if (abs >= 1000) {
    const k = n / 1000;
    return `${Number.isInteger(k) || abs >= 10_000 ? Math.round(k) : k.toFixed(1)}k`;
  }
  return String(Math.round(n));
};

