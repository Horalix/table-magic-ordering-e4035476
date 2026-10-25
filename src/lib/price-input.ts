/**
 * A typed price, as a manager types it on a phone: "18", "18.5", "18,50".
 *
 * Returns null for anything that should not reach the menu — empty, zero,
 * negative, or over 1000 KM (one slipped zero turns 18 into 180, two into
 * 1800). Rounded to the fening.
 */
export const parsePrice = (raw: string): number | null => {
  const cleaned = raw.trim().replace(',', '.').replace(/\s*KM$/i, '');
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value <= 0 || value > 1000) return null;
  return Math.round(value * 100) / 100;
};
