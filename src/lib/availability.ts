/**
 * Whether a guest can order this right now.
 *
 * Mirrors `menu_item_orderable()` (redefined in 20261024160000_guest_ordering_safety.sql).
 * The server is the authority — `guest_place_order` re-checks — but the menu has
 * to agree, because an item a guest can tap and then cannot buy is worse than
 * one that was never offered. Both read the clock in Sarajevo, whatever time
 * zone the guest's phone is set to, and both let a window cross midnight.
 *
 * Two separate reasons an item is not orderable, deliberately distinguished:
 *
 *   `sold_out`   — 86'd by the kitchen. Show it, greyed, so a guest who came
 *                  for it learns that today rather than concluding the
 *                  restaurant stopped making it.
 *   `off_hours`  — outside its window. Say WHEN, so "breakfast until 11:30"
 *                  is information rather than a dead card.
 */

import { t } from '@/lib/i18n';

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

const SARAJEVO_CLOCK = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Sarajevo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

/** Minutes since midnight on the restaurant's wall clock. */
const nowMinutes = (at: Date) => {
  const parts = SARAJEVO_CLOCK.formatToParts(at);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? at.getHours());
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? at.getMinutes());
  return hour * 60 + minute;
};

/** Why this cannot be ordered, or null if it can. */
export function unorderableReason(item: OrderableItem, at: Date = new Date()): Unorderable | null {
  if (item.is_available === false) return 'sold_out';

  const from = toMinutes(item.available_from);
  const to = toMinutes(item.available_to);
  if (from === null && to === null) return null;

  const now = nowMinutes(at);
  if (from !== null && to !== null && from > to) {
    // Crosses midnight: 22:00–02:00 is open after ten OR before two.
    return now >= from || now <= to ? null : 'off_hours';
  }
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
  if (from) return `${t('available_from_time')} ${from}`;
  if (to) return `${t('available_until_time')} ${to}`;
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

/** In the guest's language when a translation exists, English otherwise. */
export const merchBadges = (item: { merchandising_tags?: string[] | null }): string[] =>
  (item.merchandising_tags ?? [])
    .filter((tag) => MERCH_LABELS[tag])
    .map((tag) => {
      const label = t(`badge_${tag}`);
      return label === `badge_${tag}` ? MERCH_LABELS[tag] : label;
    });
