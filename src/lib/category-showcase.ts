/**
 * Which dishes a category shows on the menu home: up to three photographs,
 * chosen by the restaurant (GuestMenu's SHOWCASE for La Soul, COURSES in
 * src/components/vera/copy.ts for Vera Italia).
 *
 * A chosen dish is left out when it is sold out, has no photograph, or is no
 * longer on the menu; its place goes to the first photographed dish of each
 * of the category's sections in the menu's order, so a new category, or one
 * nobody chose for, still shows its dishes and never a sold-out one. Until the
 * menu has loaded, the chosen dishes are shown as they are.
 */

export interface ShowcaseItem {
  id: string;
  subcategory_id: string;
  image_url: string | null;
  is_available: boolean;
}

export interface ShowcasePhoto {
  id: string;
  src: string;
}

export const SHOWCASE_SIZE = 3;

const photo = (id: string, src?: string | null): ShowcasePhoto => ({ id, src: src || `/menu/${id}/768.webp` });

/**
 * @param chosen   the dishes the restaurant chose, the large one first
 * @param sections the category's sections, in the menu's order
 * @param items    every dish on the menu, in the menu's order (empty until loaded)
 */
export function pickShowcase(chosen: readonly string[], sections: readonly string[], items: readonly ShowcaseItem[]): ShowcasePhoto[] {
  if (!items.length) return chosen.slice(0, SHOWCASE_SIZE).map((id) => photo(id));

  const inCategory = new Set(sections);
  const shown = items.filter((i) => inCategory.has(i.subcategory_id) && i.is_available && i.image_url);
  const byId = new Map(shown.map((i) => [i.id, i]));
  const picked: ShowcaseItem[] = chosen.map((id) => byId.get(id)).filter((i): i is ShowcaseItem => !!i);

  // Then one from each section in turn, so the photographs show the category's range.
  const queues = sections.map((s) => shown.filter((i) => i.subcategory_id === s && !picked.includes(i)));
  while (picked.length < SHOWCASE_SIZE && queues.some((q) => q.length)) {
    for (const q of queues) {
      const next = q.shift();
      if (next && picked.length < SHOWCASE_SIZE) picked.push(next);
    }
  }
  return picked.slice(0, SHOWCASE_SIZE).map((i) => photo(i.id, i.image_url));
}
