/** "Order again" — remembers recently ordered items on the device (no backend). */
export interface RecentItem {
  id: string;
  name: string;
  price: number;
  image_url?: string;
}

const KEY = 'lasoul-recent-items';
const MAX = 8;

export const getRecentItems = (): RecentItem[] => {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
};

/** Prepend just-ordered items (most recent first, deduped, capped). */
export const addRecentItems = (items: RecentItem[]): void => {
  try {
    const seen = new Set<string>();
    const merged: RecentItem[] = [];
    for (const it of [...items, ...getRecentItems()]) {
      if (!it?.id || seen.has(it.id)) continue;
      seen.add(it.id);
      merged.push({ id: it.id, name: it.name, price: Number(it.price), image_url: it.image_url });
      if (merged.length >= MAX) break;
    }
    localStorage.setItem(KEY, JSON.stringify(merged));
  } catch {
    /* storage unavailable — non-critical */
  }
};
