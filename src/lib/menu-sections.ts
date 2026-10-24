/**
 * Stable, readable addresses for parts of the menu.
 *
 * Category pages scroll through every subcategory, and `?section=<slug>` jumps
 * to one of them. The slugs are derived from the English names so the
 * redirects from the old static site (public/_redirects) can be written by
 * hand, and so a link survives the restaurant reordering its menu.
 */

/** Route for a top-level category. Unknown names fall back to their lowercase form. */
const CATEGORY_PATHS: Record<string, string> = {
  Drinks: '/menu/drinks',
  Food: '/menu/food',
  Desserts: '/menu/desserts',
};

export function categoryPath(name: string): string {
  return CATEGORY_PATHS[name] ?? `/menu/${sectionSlug(name)}`;
}

/** "Kids Menu" -> "kids-menu", "Café & Tea" -> "cafe-tea". */
export function sectionSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Link to a category page, carrying the table and token the guest arrived with
 * and optionally a section to open at.
 */
export function menuHref(categoryName: string, opts: { section?: string; table?: string | null; token?: string | null } = {}): string {
  const params = new URLSearchParams();
  if (opts.section) params.set('section', sectionSlug(opts.section));
  if (opts.table) params.set('table', opts.table);
  if (opts.token) params.set('token', opts.token);
  const qs = params.toString();
  return qs ? `${categoryPath(categoryName)}?${qs}` : categoryPath(categoryName);
}
