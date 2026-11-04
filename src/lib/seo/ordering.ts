/**
 * Whether the website may say that guests order from their table.
 *
 * Not while the restaurant shows its menu only (Admin → Service, "Menu
 * only"; src/hooks/useMenuOnly.ts): La Soul's own address went live before
 * the owner decided to take orders through the app, and its website, search
 * results and answer engines must not promise what the table cannot do. The
 * lines that do promise it have a "_menu" twin in site-copy.ts.
 *
 * The build sets this once, from the live database (scripts/seo-prerender.ts):
 * the pages, structured data and llms.txt it writes follow it. The live site
 * passes what the database says now. Switching "Menu only" changes the live
 * site at once; the prerendered pages follow at the next deploy.
 *
 * Relative imports only: the build imports this module outside the app.
 */
import type { SiteKey } from '../site-copy';

let offered = true;

/** What the build was told; true until it is told otherwise (an offline build). */
export const orderingOffered = (): boolean => offered;

export function offerOrdering(on: boolean): void {
  offered = on;
}

/** The lines that promise ordering from the table, and what each says instead. */
const MENU_ONLY: Partial<Record<SiteKey, SiteKey>> = {
  hero_sub: 'hero_sub_menu',
  faq_order_q: 'faq_order_q_menu',
  faq_order_a: 'faq_order_a_menu',
  seo_dish_description: 'seo_dish_description_menu',
  seo_description: 'seo_description_menu',
};

/** The key to say, given whether ordering is offered. */
export const orderingCopy = (key: SiteKey, on: boolean = offered): SiteKey => (on ? key : MENU_ONLY[key] ?? key);

/**
 * Ask the live database, as any guest's phone does, whether this restaurant
 * takes orders from the table. A database that cannot be asked is not taken
 * as a yes: the pages then promise nothing they might not keep.
 */
export async function fetchOrderingOffered(url: string, key: string, venue: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/rest/v1/rpc/guest_get_service_status`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'x-venue': venue },
      body: '{}',
    });
    if (!res.ok) return false;
    const status = (await res.json()) as { menu_only?: boolean } | null;
    return status?.menu_only === false || (status !== null && status.menu_only === undefined);
  } catch {
    return false;
  }
}
