/**
 * Whether a guest can order this right now.
 *
 * Mirrors `menu_item_orderable()` in 20260731090300_merchandising_and_analytics.sql.
 * The server is the authority — `guest_place_order` re-checks — but the menu has
 * to agree, because an item a guest can tap and then cannot buy is worse than
 * one that was never offered.
 *
 * Two separate reasons an item is not orderable, deliberately distinguished:
 *
 *   `sold_out`   — 86'd by the kitchen. Show it, greyed, so a guest who came
 *                  for it learns that today rather than concluding the
 *                  restaurant stopped making it.
 *   `off_hours`  — outside its window. Say WHEN, so "breakfast until 11:30"
 *                  is information rather than a dead card.
 */

export type Unorderable = 'sold_out' | 'off_hours';

export interface OrderableItem {
  is_available?: boolean | null;
  available_from?: string | null;
  available_to?: string | null;
}

/** Minutes since midnight for an `HH:MM[:SS]` time column. */
const toMinutes = (value: string | null | undefined): number | null => {
  if (!value) return null;
  const [h, m] = value.split(':');
  const hours = Number(h);
  const mins = Number(m ?? 0);
  if (!Number.isFinite(hours) || !Number.isFinite(mins)) return null;
  return hours * 60 + mins;
};

const nowMinutes = (at: Date) => at.getHours() * 60 + at.getMinutes();

/** Why this cannot be ordered, or null if it can. */
export function unorderableReason(item: OrderableItem, at: Date = new Date()): Unorderable | null {
  if (item.is_available === false) return 'sold_out';

  const from = toMinutes(item.available_from);
  const to = toMinutes(item.available_to);
  if (from === null && to === null) return null;

  const now = nowMinutes(at);
  if (from !== null && now < from) return 'off_hours';
  if (to !== null && now > to) return 'off_hours';
  return null;
}

export const isOrderable = (item: OrderableItem, at: Date = new Date()) =>
  unorderableReason(item, at) === null;

/** "from 07:00", "until 11:30", "07:00–11:30" — whichever bounds exist. */
export function windowLabel(item: OrderableItem): string | null {
  const from = item.available_from?.slice(0, 5);
  const to = item.available_to?.slice(0, 5);
  if (from && to) return `${from}–${to}`;
  if (from) return `from ${from}`;
  if (to) return `until ${to}`;
  return null;
}

/** Guest-facing badges. Internal weights like margin_score are never here. */
export const MERCH_LABELS: Record<string, string> = {
  signature: 'Signature',
  chef_pick: "Chef's pick",
  popular: 'Popular',
  new: 'New',
  seasonal: 'Seasonal',
  house_favourite: 'House favourite',
};

export const merchBadges = (item: { merchandising_tags?: string[] | null }): string[] =>
  (item.merchandising_tags ?? []).map((tag) => MERCH_LABELS[tag]).filter(Boolean);
