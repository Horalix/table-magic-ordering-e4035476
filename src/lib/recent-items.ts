/**
 * What this device has ordered before.
 *
 * On-device only. No profile is sent anywhere, no account is required, and a
 * phone that never comes back leaves nothing behind — which is why this can
 * exist without a consent flow.
 *
 * It used to store a flat list of unique items, most recent first. That can
 * answer "what did you have last time" but NOT "what do you always have",
 * because once deduplicated the two look identical. A café runs on the second
 * question: the regular who orders the same flat white four mornings a week is
 * the most valuable guest in the room and the easiest to serve well.
 *
 * So each entry now carries how many orders have included it and when it was
 * last ordered, and a "usual" is something ordered often enough to be a habit
 * rather than a coincidence.
 */

export interface RecentItem {
  id: string;
  name: string;
  price: number;
  image_url?: string;
  /** How many separate orders have included this. */
  count: number;
  /** ISO timestamp of the most recent order containing it. */
  lastOrderedAt: string;
}

const KEY = 'lasoul-recent-items';
const MAX = 20;

/**
 * Below this it is a coincidence, not a habit.
 *
 * Two is deliberately low. A café guest orders a handful of things; requiring
 * five would mean the feature never fires for anyone but the daily regular,
 * and the cost of being wrong is a suggestion that gets ignored.
 */
const USUAL_MIN_COUNT = 2;

/** A device unseen for this long starts fresh rather than resurfacing 2024. */
const STALE_DAYS = 120;

const EPOCH = new Date(0).toISOString();

interface StoredItem {
  id?: string;
  name?: string;
  price?: number;
  image_url?: string;
  count?: number;
  lastOrderedAt?: string;
}

/**
 * Read, tolerating the older shape.
 *
 * Devices in the wild hold the previous format, which had no counts. Those
 * entries are treated as having been ordered once — which is true, and means
 * an existing guest's history survives the upgrade instead of being discarded.
 */
export const getRecentItems = (): RecentItem[] => {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
    if (!Array.isArray(raw)) return [];
    const cutoff = Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000;

    return (raw as StoredItem[])
      .filter((it): it is StoredItem & { id: string } => Boolean(it?.id))
      .map((it) => ({
        id: it.id,
        name: it.name ?? '',
        price: Number(it.price ?? 0),
        image_url: it.image_url,
        count: Number(it.count ?? 1),
        lastOrderedAt: it.lastOrderedAt ?? EPOCH,
      }))
      // Migrated entries have no date; keep them rather than silently drop a
      // returning guest's whole history on the first read after an upgrade.
      .filter((it) => it.lastOrderedAt === EPOCH
        || new Date(it.lastOrderedAt).getTime() > cutoff);
  } catch {
    return [];
  }
};

/** Record an order: increments counts, refreshes timestamps, keeps the newest. */
export const addRecentItems = (items: Omit<RecentItem, 'count' | 'lastOrderedAt'>[]): void => {
  try {
    const now = new Date().toISOString();
    const byId = new Map<string, RecentItem>();
    for (const existing of getRecentItems()) byId.set(existing.id, existing);

    /*
     * Deduplicate the incoming order first.
     *
     * Three flat whites in one round is ONE order containing the item. "I have
     * this every time" is a statement about visits, so counting the line
     * quantity would make a single large round look like loyalty.
     */
    const uniqueIds: string[] = [];
    const incoming = new Map<string, Omit<RecentItem, 'count' | 'lastOrderedAt'>>();
    for (const it of items) {
      if (!it?.id || incoming.has(it.id)) continue;
      incoming.set(it.id, it);
      uniqueIds.push(it.id);
    }

    for (const [id, it] of incoming) {
      const prev = byId.get(id);
      byId.set(id, {
        id,
        name: it.name,
        price: Number(it.price),
        image_url: it.image_url,
        count: (prev?.count ?? 0) + 1,
        lastOrderedAt: now,
      });
    }

    /*
     * Just-ordered items lead, then everything else by recency.
     *
     * Deliberately not a pure sort on the timestamp: several items written in
     * the same order share it to the millisecond, so a timestamp sort leaves
     * their relative order to chance. Explicit ordering makes "most recent
     * first" mean what it says.
     */
    const rest = [...byId.values()]
      .filter((it) => !incoming.has(it.id))
      .sort((a, b) => new Date(b.lastOrderedAt).getTime() - new Date(a.lastOrderedAt).getTime());

    const merged = [...uniqueIds.map((id) => byId.get(id)!), ...rest].slice(0, MAX);
    localStorage.setItem(KEY, JSON.stringify(merged));
  } catch {
    /* storage unavailable — non-critical */
  }
};

/**
 * The one thing this device orders more than anything else, if there is one.
 *
 * Ranked by count, ties broken by recency. Returns null rather than guessing:
 * a "usual" that is really a one-off reads as the app pretending to know
 * someone, which is worse than saying nothing.
 */
export const getUsualItem = (): RecentItem | null => {
  // getRecentItems() is already most-recent-first, so a stable sort on count
  // alone breaks ties by recency without depending on millisecond resolution.
  const ranked = getRecentItems()
    .filter((it) => it.count >= USUAL_MIN_COUNT)
    .sort((a, b) => b.count - a.count);
  return ranked[0] ?? null;
};

/** Wipe this device's history. Paired with server-side deletion. */
export const forgetRecentItems = (): void => {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
};
