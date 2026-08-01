import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** Dietary / allergen tags shown on menu items and used for guest filtering.
 * Stored on `menu_items.dietary_tags` (text[]). Frontend is resilient if the
 * column doesn't exist yet — items simply show no tags until the migration runs
 * and admins set them. */

export interface DietTag {
  key: string;
  labelKey: string; // i18n key
  emoji: string;
}

export const DIET_TAGS: DietTag[] = [
  { key: 'vegetarian', labelKey: 'diet_vegetarian', emoji: '🌱' },
  { key: 'vegan', labelKey: 'diet_vegan', emoji: '🌿' },
  { key: 'spicy', labelKey: 'diet_spicy', emoji: '🌶️' },
  { key: 'gluten_free', labelKey: 'diet_gluten_free', emoji: '🌾' },
  { key: 'dairy_free', labelKey: 'diet_dairy_free', emoji: '🥛' },
  { key: 'contains_nuts', labelKey: 'diet_contains_nuts', emoji: '🥜' },
  { key: 'halal', labelKey: 'diet_halal', emoji: '☪️' },
];

export const DIET_BY_KEY: Record<string, DietTag> = Object.fromEntries(DIET_TAGS.map((d) => [d.key, d]));

/** Safely read dietary_tags off a menu item row (column may not exist yet). */
export const getItemTags = (item: unknown): string[] => {
  const raw = (item as { dietary_tags?: unknown })?.dietary_tags;
  return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
};

/* ---- The guest's active filter -------------------------------------- */

/**
 * Which dietary filters the guest has switched on.
 *
 * Shared and persisted rather than local to the menu page, because the CART
 * needs it too: a guest who has filtered out gluten must not then be
 * *suggested* something containing gluten. Suggesting around a filter the guest
 * set two screens ago is the clearest possible way to look like nothing is
 * listening.
 */
export const useDietFilterStore = create<{
  activeDiets: string[];
  setActiveDiets: (next: string[] | ((prev: string[]) => string[])) => void;
}>()(persist((set) => ({
  activeDiets: [],
  setActiveDiets: (next) => set((state) => ({
    activeDiets: typeof next === 'function' ? next(state.activeDiets) : next,
  })),
}), { name: 'lasoul-diet-filter' }));

/**
 * Allergens implied by the active filters.
 *
 * Only the AVOIDANCE filters map to an allergen. "vegetarian" is a preference
 * the cart-diet rule already handles; "contains nuts" is a warning label, not
 * a request to be shown nut dishes.
 */
const DIET_TO_ALLERGEN: Record<string, string> = {
  gluten_free: 'gluten',
  dairy_free: 'dairy',
};

export const allergensToAvoid = (activeDiets: string[]): string[] =>
  activeDiets.map((d) => DIET_TO_ALLERGEN[d]).filter(Boolean);
