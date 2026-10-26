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
 *   La Soul.
 *
 * A database from before the two restaurants ignores the header, and one
 * that does not know a slug answers for La Soul, so this is safe to ship
 * ahead of it. (No import of src/lib/venues.ts here: it imports this.)
 */
const GUEST_KEY = 'lasoul.guest-venue';
const STAFF_KEY = 'lasoul.staff-venue';

const SLUG = /^[a-z0-9-]{1,40}$/;
const GUEST_PATHS = /^\/(cart|tab|table|start)(\/|$)/;
const STAFF_PATHS = /^\/(admin|kitchen|waiter)(\/|$)/;

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
  if (GUEST_PATHS.test(pathname)) return read(GUEST_KEY);
  if (STAFF_PATHS.test(pathname)) return read(STAFF_KEY);
  return null;
}

/** The restaurant of the page open right now. */
export function currentVenueSlug(): string | null {
  return typeof location === 'undefined' ? null : venueForPath(location.pathname);
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
