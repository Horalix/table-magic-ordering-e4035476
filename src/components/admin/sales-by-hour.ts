import { BUSINESS_DAY_CUTOFF_HOUR } from '@/lib/reporting';

/**
 * The Daily Report's "Sales by hour", as data.
 *
 * Two things were wrong with the chart this replaces. The bars were drawn as
 * a percentage of a column with no height of its own, so CSS resolved every
 * one to its 2px minimum and the chart was a row of flat dashes whatever was
 * sold. And the hours ran 00:00 to 23:00, so the 00:30 sale of a late service
 * — which belongs to this trading day (05:00 to 05:00, see
 * `businessDayRange()`) — was drawn at the far left, before breakfast.
 *
 * Hours are the device's wall clock, the same assumption `businessDayRange()`
 * makes: every device in the restaurant is on Sarajevo time.
 */

export interface HourSales {
  /** Local hour, 0–23. */
  hour: number;
  /** `HH:00`. */
  label: string;
  /** Sum of the orders' totals, rounded to the cent. */
  sales: number;
  orders: number;
}

export interface SaleAtTime {
  created_at: string;
  total: number | string | null;
}

/** Every hour of one trading day, in the order the day ran: the cutoff hour first. */
export function salesByHour(orders: SaleAtTime[], cutoff: number = BUSINESS_DAY_CUTOFF_HOUR): HourSales[] {
  const buckets: HourSales[] = Array.from({ length: 24 }, (_, i) => {
    const hour = (cutoff + i) % 24;
    return { hour, label: `${String(hour).padStart(2, '0')}:00`, sales: 0, orders: 0 };
  });
  for (const order of orders) {
    const hour = new Date(order.created_at).getHours();
    const bucket = buckets[(hour - cutoff + 24) % 24];
    bucket.sales += Number(order.total ?? 0);
    bucket.orders += 1;
  }
  for (const bucket of buckets) bucket.sales = Math.round(bucket.sales * 100) / 100;
  return buckets;
}

/**
 * Drop the empty hours at either end, keeping `pad` quiet hours each side, so
 * the service fills the chart instead of a 05:00–09:00 desert. Empty in, empty out.
 */
export function trimQuietHours<T extends { orders: number }>(hours: T[], pad = 1): T[] {
  const first = hours.findIndex((h) => h.orders > 0);
  if (first === -1) return [];
  let last = hours.length - 1;
  while (hours[last].orders === 0) last -= 1;
  return hours.slice(Math.max(0, first - pad), Math.min(hours.length, last + pad + 1));
}

/** Index of the hour that took the most, or -1 if nothing sold. The first one wins a tie. */
export function busiestIndex(hours: { sales: number }[]): number {
  let best = -1;
  hours.forEach((h, i) => { if (h.sales > 0 && (best === -1 || h.sales > hours[best].sales)) best = i; });
  return best;
}
