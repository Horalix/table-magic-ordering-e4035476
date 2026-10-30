import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page, Route } from '@playwright/test';

/**
 * Vera Italia's menu, served the way PostgREST would serve it to a page that
 * names Vera Italia in its x-venue header — straight from the file the
 * database migration is generated from (scripts/vera-italia/menu.json).
 */
type Item = Record<string, unknown> & { id: string };
type Menu = {
  venue_id: string;
  categories: (Item & { sections: (Item & { items: Item[] })[] })[];
};

const HERE = dirname(fileURLToPath(import.meta.url));
const menu = JSON.parse(readFileSync(join(HERE, '..', 'scripts', 'vera-italia', 'menu.json'), 'utf8')) as Menu;

export const VERA_CATEGORIES = menu.categories.map(({ sections: _s, ...c }) => ({ ...c, image_url: null, venue_id: menu.venue_id }));
export const VERA_SECTIONS = menu.categories.flatMap((c) =>
  c.sections.map(({ items: _i, ...s }) => ({ ...s, category_id: c.id })));
export const VERA_ITEMS = menu.categories.flatMap((c) => c.sections.flatMap((s) => s.items.map((it, i) => ({
  id: it.id,
  subcategory_id: s.id,
  name: it.name, name_bs: it.name_bs, name_ar: it.name_ar,
  description: it.description, description_bs: it.description_bs, description_ar: it.description_ar,
  price: it.price,
  is_available: true,
  station: 'kitchen',
  allergens: it.allergens,
  dietary_tags: it.dietary_tags,
  merchandising_tags: [],
  meal_role: it.meal_role,
  sort_order: i + 1,
  image_url: it.no_photo ? null : `/menu/${it.id}/1152.webp`,
  featured_rank: it.featured_rank ?? null,
  featured_note: it.featured_note ?? null,
  featured_note_bs: it.featured_note_bs ?? null,
  featured_note_ar: it.featured_note_ar ?? null,
  portion_note: null, prep_minutes: null, new_until: null,
  sale_kind: null, sale_value: null, sale_label: null, sale_starts_at: null, sale_ends_at: null,
  available_from: null, available_to: null,
}))));

/** The PostgREST filters the app uses: col=eq.x, col=in.(a,b), col=not.is.null, and the promotions `or`. */
function filter<T extends Record<string, unknown>>(rows: T[], url: URL): T[] {
  let out = rows;
  for (const [key, value] of url.searchParams) {
    if (['select', 'order', 'limit', 'offset'].includes(key)) continue;
    if (key === 'or') { out = out.filter((r) => r.featured_rank != null); continue; }
    if (value.startsWith('eq.')) out = out.filter((r) => String(r[key]) === value.slice(3));
    else if (value.startsWith('in.(')) {
      const set = new Set(value.slice(4, -1).split(',').map((v) => v.replace(/^"|"$/g, '')));
      out = out.filter((r) => set.has(String(r[key])));
    } else if (value === 'not.is.null') out = out.filter((r) => r[key] != null);
    else if (value === 'is.null') out = out.filter((r) => r[key] == null);
  }
  return out;
}

const json = (route: Route, body: unknown) =>
  route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });

/** Every x-venue header the page sent with a database request. */
export async function installVeraStubs(page: Page, seen: (string | undefined)[] = []) {
  const table = (rows: Record<string, unknown>[]) => (route: Route) => {
    seen.push(route.request().headers()['x-venue']);
    const url = new URL(route.request().url());
    const found = filter(rows, url);
    const one = (route.request().headers()['accept'] ?? '').includes('vnd.pgrst.object');
    return json(route, one ? (found[0] ?? null) : found);
  };
  await page.route('**/rest/v1/categories**', table(VERA_CATEGORIES));
  await page.route('**/rest/v1/subcategories**', table(VERA_SECTIONS));
  await page.route('**/rest/v1/menu_items**', table(VERA_ITEMS));
}

/** A guest seated at Vera Italia's table 7. */
export async function seatAtVera(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('lasoul.guest-venue', 'veraitalia');
    if (localStorage.getItem('lasoul-cart')) return;
    localStorage.setItem('lasoul-cart', JSON.stringify({
      state: {
        items: [], tableNumber: 7, qrToken: 'qr-token-7', sessionToken: 'sess-token-7', sessionId: 'session-1',
        guestName: 'Marco', lastOrderTime: null, pendingPayment: null, tableSeenAt: Date.now(), clientId: 'e2e-device',
      },
      version: 0,
    }));
  });
}
