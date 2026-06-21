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
