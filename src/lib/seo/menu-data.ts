/**
 * The live menu, read once at build time for the pages crawlers see without
 * running JavaScript (scripts/seo-prerender.ts) and for llms.txt.
 *
 * Read-only, anonymous, and the same rows a guest's phone reads. If the
 * database cannot be reached the build still succeeds — the menu pages are
 * then prerendered without their dishes — because a deploy must never fail
 * on a search-engine extra.
 *
 * Relative imports only: the build imports this module outside the app.
 */
import type { Locale } from '../i18n';

type Names = Record<Locale, string>;

export interface SeoMenuItem {
  id: string;
  /** Its page: /menu/<venue>/dish/<slug>. Readable, stable, unique (see assignDishSlugs). */
  slug: string;
  names: Names;
  descriptions: Record<Locale, string | null>;
  price: number;
  /** Site-relative image path when the dish has a local photo. */
  image: string | null;
  /** Allergen codes as the menu stores them: gluten, dairy, eggs… */
  allergens: string[];
  dietaryTags: string[];
  portionNote: string | null;
  prepMinutes: number | null;
}

export interface SeoMenuSection { id: string; names: Names; items: SeoMenuItem[] }
export interface SeoMenuCategory { id: string; slug: string; names: Names; sections: SeoMenuSection[] }
export interface SeoMenu { categories: SeoMenuCategory[] }

interface CategoryRow { id: string; name: string; name_bs: string | null; name_ar: string | null; sort_order: number | null }
interface SubcategoryRow extends CategoryRow { category_id: string }
interface ItemRow {
  id: string; subcategory_id: string; name: string; name_bs: string | null; name_ar: string | null;
  description: string | null; description_bs: string | null; description_ar: string | null;
  price: number | string; sort_order: number | null;
  allergens?: string[] | null; dietary_tags?: string[] | null; portion_note?: string | null; prep_minutes?: number | null;
}

const names = (r: { name: string; name_bs: string | null; name_ar: string | null }): Names =>
  ({ en: r.name, bs: r.name_bs || r.name, ar: r.name_ar || r.name });

const bySort = <T extends { sort_order: number | null }>(a: T, b: T) => (a.sort_order ?? 0) - (b.sort_order ?? 0);

export const slug = (name: string) => name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/**
 * A page address for every dish: its name, slugged, with -2, -3… for names
 * that collide. Decided by id order, not menu order, so reordering the menu
 * never moves a dish to another dish's address. The app's deep link
 * (/menu/<venue>/dish/<slug>) uses this same function.
 */
export function assignDishSlugs(items: { id: string; name: string }[]): Map<string, string> {
  const groups = new Map<string, string[]>();
  for (const i of items) {
    const base = slug(i.name) || 'dish';
    groups.set(base, [...(groups.get(base) ?? []), i.id]);
  }
  const out = new Map<string, string>();
  for (const [base, ids] of groups) {
    [...ids].sort().forEach((id, n) => out.set(id, n === 0 ? base : `${base}-${n + 1}`));
  }
  return out;
}

/** Group the three tables into categories → sections → dishes, in menu order, available dishes only. */
export function buildSeoMenu(
  categories: CategoryRow[], subcategories: SubcategoryRow[], items: ItemRow[],
  imageFor: (id: string) => string | null = () => null,
): SeoMenu {
  const slugs = assignDishSlugs(items);
  return {
    categories: [...categories].sort(bySort).map((c) => ({
      id: c.id,
      slug: slug(c.name),
      names: names(c),
      sections: subcategories.filter((s) => s.category_id === c.id).sort(bySort).map((s) => ({
        id: s.id,
        names: names(s),
        items: items.filter((i) => i.subcategory_id === s.id).sort(bySort).map((i) => ({
          id: i.id,
          slug: slugs.get(i.id) ?? slug(i.name),
          names: names(i),
          descriptions: { en: i.description, bs: i.description_bs || i.description, ar: i.description_ar || i.description },
          price: Number(i.price),
          image: imageFor(i.id),
          allergens: i.allergens ?? [],
          dietaryTags: i.dietary_tags ?? [],
          portionNote: i.portion_note ?? null,
          prepMinutes: i.prep_minutes ?? null,
        })),
      })).filter((s) => s.items.length > 0),
    })).filter((c) => c.sections.length > 0),
  };
}

/** Fetch the menu from the database's public API; null when it cannot be had in time. */
export async function fetchSeoMenu(
  url: string, key: string, imageFor?: (id: string) => string | null, timeoutMs = 10_000,
): Promise<SeoMenu | null> {
  const headers: Record<string, string> = { apikey: key };
  if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`;
  const get = async <T>(path: string): Promise<T> => {
    const res = await fetch(`${url.replace(/\/+$/, '')}/rest/v1/${path}`, { headers, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
    return res.json() as Promise<T>;
  };
  try {
    const [cats, subs, items] = await Promise.all([
      get<CategoryRow[]>('categories?select=id,name,name_bs,name_ar,sort_order'),
      get<SubcategoryRow[]>('subcategories?select=id,category_id,name,name_bs,name_ar,sort_order'),
      get<ItemRow[]>('menu_items?select=id,subcategory_id,name,name_bs,name_ar,description,description_bs,description_ar,price,sort_order,allergens,dietary_tags,portion_note,prep_minutes&is_available=eq.true'),
    ]);
    const menu = buildSeoMenu(cats, subs, items, imageFor);
    return menu.categories.length ? menu : null;
  } catch {
    return null;
  }
}
