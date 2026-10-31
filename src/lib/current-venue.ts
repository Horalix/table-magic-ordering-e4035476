/**
 * Which restaurant a request is about.
 *
 * La Soul and Vera Italia share one database, and the database answers every
 * request for one restaurant (`current_venue()`, docs/two-restaurants.md). The
 * app tells it which with an `x-venue` header on every database request:
 *
 * - A menu page names its restaurant in its address: /menu/<slug>/….
 * - The rest of a guest's visit (the order, the tab, the table code pages)
 *   is the restaurant of the table they last sat down at.
 * - Staff screens send the restaurant the owner picked in the admin. Nobody
 *   else needs one: the database knows where a waiter or a restaurant admin
 *   works, and ignores a header naming a restaurant they do not.
 * - The website and anything else send none, which the database reads as
 *   La Soul. On Vera Italia's own site (src/lib/home-venue.ts) they send
 *   Vera Italia, and so do a guest or staff page nothing else has placed.
 *
 * A database from before the two restaurants ignores the header, and one
 * that does not know a slug answers for La Soul, so this is safe to ship
 * ahead of it. (No import of src/lib/venues.ts here: it imports this.)
 */
import { HOME_VENUE } from './home-venue';

const GUEST_KEY = 'lasoul.guest-venue';
const STAFF_KEY = 'lasoul.staff-venue';

const SLUG = /^[a-z0-9-]{1,40}$/;
const GUEST_PATHS = /^\/(cart|tab|table|start)(\/|$)/;
const STAFF_PATHS = /^\/(admin|kitchen|waiter)(\/|$)/;
/** A restaurant's own website, /<slug>/ (La Soul's is the root). */
const SITE_PATHS = /^\/(veraitalia)(\/|$)/;
/** What an address that names no restaurant means here: nothing on La Soul's site, Vera Italia on its own. */
const HOME_SLUG = HOME_VENUE === 'lasoul' ? null : HOME_VENUE;

function read(key: string): string | null {
  try {
    const slug = localStorage.getItem(key);
    return slug && SLUG.test(slug) ? slug : null;
  } catch {
    return null;
  }
}

function write(key: string, slug: string | null): void {
  try {
    if (slug) localStorage.setItem(key, slug);
    else localStorage.removeItem(key);
  } catch {
    // Private mode or storage off: the header simply falls back.
  }
}

/** The restaurant a page at this address is about, or null for "let the database decide". */
export function venueForPath(pathname: string): string | null {
  const menu = /^\/menu\/([^/]+)/.exec(pathname);
  // An old /menu/drinks address names no restaurant; the database ignores it.
  if (menu && SLUG.test(menu[1])) return menu[1];
  const site = SITE_PATHS.exec(pathname);
  if (site) return site[1];
  if (GUEST_PATHS.test(pathname)) return read(GUEST_KEY) ?? HOME_SLUG;
  if (STAFF_PATHS.test(pathname)) return read(STAFF_KEY) ?? HOME_SLUG;
  return HOME_SLUG;
}

/** The restaurant of the page open right now. */
export function currentVenueSlug(): string | null {
  return typeof location === 'undefined' ? null : venueForPath(location.pathname);
}

/** What the database answers when a request names no restaurant: default_venue(), La Soul. */
const DATABASE_DEFAULT_SLUG = 'lasoul';

/**
 * The restaurant the database answers this page's requests for, for someone
 * it lets look at any restaurant (the owner, a guest): the one the page
 * names, else La Soul. On an admin page that is the restaurant the owner is
 * looking at — what the layout shows — even before they have picked one.
 */
export function shownVenueSlug(): string {
  return currentVenueSlug() ?? DATABASE_DEFAULT_SLUG;
}

/** One of the signed-in account's rows in user_roles. */
export interface StaffRoleRow {
  role: string;
  /** Absent on a database from before the second restaurant; null for the owner. */
  venue_id?: string | null;
}

const ROLE_ORDER = ['admin', 'staff'];
const roleRank = (role: string) => {
  const at = ROLE_ORDER.indexOf(role);
  return at === -1 ? ROLE_ORDER.length : at;
};

/**
 * Where the database places a signed-in account when a request names no
 * restaurant it works at — current_venue()'s last step
 * (20261028100000_two_restaurants_context.sql): the restaurant of its first
 * role, admin before staff (the app_role order), then by restaurant id. Null
 * for the owner, who works at none (the database then answers for La Soul).
 */
export function workplaceVenueId(rows: readonly StaffRoleRow[]): string | null {
  const placed = rows
    .filter((r): r is StaffRoleRow & { venue_id: string } => typeof r.venue_id === 'string' && r.venue_id !== '')
    .sort((a, b) => roleRank(a.role) - roleRank(b.role) || (a.venue_id < b.venue_id ? -1 : a.venue_id > b.venue_id ? 1 : 0));
  return placed[0]?.venue_id ?? null;
}

/**
 * The restaurant the database answers a signed-in account's request for
 * (current_venue()): the one asked for (`askedId`, from the x-venue header)
 * if the account may work there — the owner anywhere — else its workplace,
 * else `defaultId`. With no header at all, which is how realtime asks, it is
 * the workplace.
 */
export function answeredVenueId(rows: readonly StaffRoleRow[], askedId: string | null, defaultId: string): string {
  const owner = rows.some((r) => r.role === 'admin' && r.venue_id === null);
  if (askedId && (owner || rows.some((r) => r.venue_id === askedId))) return askedId;
  return workplaceVenueId(rows) ?? defaultId;
}

/**
 * The service worker's cache key for the menu tables (vite.config.ts, the
 * "menu-data" rule): the address, plus the restaurant the request named
 * (x-venue) and whose session asked (the token's subject; "anon" for a
 * guest). The database answers the same address with La Soul's menu or Vera
 * Italia's by that header, and a signed-in account's header only counts at a
 * restaurant it works at — so a key of the address alone could hand a guest
 * at Vera Italia La Soul's cached menu whenever the network was slow.
 *
 * The worker receives this function's source, not this module: it may use
 * nothing but its argument and the browser's globals.
 */
export async function menuDataCacheKey({ request }: { request: Request }): Promise<string> {
  const url = new URL(request.url);
  let who = 'anon';
  try {
    const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    const part = (token.split('.')[1] || '').replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(atob(part.padEnd(Math.ceil(part.length / 4) * 4, '=')));
    if (claims && typeof claims.sub === 'string' && claims.sub) who = claims.sub;
  } catch {
    who = 'anon';
  }
  url.searchParams.set('sw-venue', request.headers.get('x-venue') || '-');
  url.searchParams.set('sw-as', who);
  return url.href;
}

/** The restaurant of the table this guest sat down at; null if none yet. */
export function guestVenue(): string | null {
  return read(GUEST_KEY);
}

/** A guest sat down at a table of this restaurant. */
export function rememberGuestVenue(slug: string): void {
  write(GUEST_KEY, SLUG.test(slug) ? slug : null);
}

/** The restaurant the owner is looking at in the admin; null when they have not picked one. */
export function staffVenue(): string | null {
  return read(STAFF_KEY);
}

/** The owner picks a restaurant in the admin; null forgets the choice. */
export function chooseStaffVenue(slug: string | null): void {
  write(STAFF_KEY, slug && SLUG.test(slug) ? slug : null);
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/**
 * `fetch` for the Supabase client: database requests (PostgREST, /rest/v1/)
 * carry the restaurant. Edge functions and sign-in do not need it, and the
 * functions' cross-origin rules would refuse a header they do not know.
 */
export const venueFetch: typeof fetch = (input, init) => {
  const slug = currentVenueSlug();
  if (!slug || !requestUrl(input).includes('/rest/v1/')) return fetch(input, init);
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  headers.set('x-venue', slug);
  return fetch(input, { ...init, headers });
};
