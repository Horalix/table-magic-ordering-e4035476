/**
 * The restaurants this app serves, by the slug in their menu's address.
 *
 * Each venue's menu lives at /menu/<slug>, so a second restaurant (Vera
 * Italia is next) is one entry here plus its own menu data. Everything that
 * links into a menu asks `menuPath()` or `menuBase()` rather than writing
 * "/menu", which is what lets the bare /menu and the old /menu/drinks-style
 * addresses keep working as redirects.
 *
 * Facts the website shows publicly are kept here, not invented: a field that
 * is not known yet is null and its part of the site stays hidden.
 */
import { guestVenue } from './current-venue';

export type Weekday = 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday' | 'Sunday';
export const EVERY_DAY: Weekday[] = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** One run of opening hours: these days, from `opens` to `closes` (24-hour, local time). */
export interface OpeningHours {
  days: Weekday[];
  opens: string;
  closes: string;
}

export interface Venue {
  slug: string;
  /** Its row in the database's `venues` table; fixed, it never changes. */
  dbId: string;
  name: string;
  /** Other names people and maps know it by — the Google Maps listing, the old site. */
  alternateNames: string[];
  /** Shown under the name, e.g. on the website hero. */
  tagline: string;
  phone: string;
  /** For a tel: link — digits and +. */
  phoneHref: string;
  address: string;
  city: string;
  /** ISO 3166-1 alpha-2. */
  country: string;
  /** The pin on its Google Maps listing. */
  geo: { lat: number; lng: number } | null;
  /** Opens directions in the guest's maps app — the venue's own listing. */
  mapsUrl: string;
  /** Null until confirmed; the website then shows none. */
  hours: OpeningHours[] | null;
  instagram: string | null;
  facebook: string | null;
  /** Where a guest who enjoyed the visit can review it (its Google listing); null skips that step. */
  reviewUrl: string | null;
  /** Live: has a menu and takes orders. Not live: the address answers "not found". */
  live: boolean;
}

/*
 * La Soul's facts are from its own site (lasoul.net, October 2026) and its
 * Google Maps listing, "La Soul Cafe & Burger Boutique": hours 11:00–21:00,
 * Instagram @lasoul.bih, the pin below. Change them here and the website,
 * its structured data, the sitemap and llms.txt all follow.
 */
export const VENUES: Record<string, Venue> = {
  lasoul: {
    slug: 'lasoul',
    dbId: 'a5000000-0000-4000-8000-000000000001',
    name: 'La Soul',
    alternateNames: ['La Soul Cafe & Burger Boutique', 'La Soul Cake & Burger Boutique', 'LASOUL'],
    tagline: 'Cake & Burger Boutique',
    phone: '+387 33 877 779',
    phoneHref: '+38733877779',
    address: 'Butmirska cesta 16A | 16B',
    city: 'Sarajevo',
    country: 'BA',
    geo: { lat: 43.827548, lng: 18.3103156 },
    mapsUrl: 'https://maps.app.goo.gl/UrsoG5vew2FfwMt66',
    hours: [{ days: EVERY_DAY, opens: '11:00', closes: '21:00' }],
    instagram: 'https://www.instagram.com/lasoul.bih',
    facebook: null,
    reviewUrl: 'https://share.google/al1h37etpg3lpIXGn',
    live: true,
  },
  /*
   * Same owner, its own restaurant (docs/two-restaurants.md). Its menu and
   * photographs arrived on 30 October 2026; its address, phone, hours and
   * listings have not, so they are empty and the website shows none of them.
   * Not live until its menu is in the database: until then its addresses
   * answer "not found".
   */
  veraitalia: {
    slug: 'veraitalia',
    dbId: 'a5000000-0000-4000-8000-000000000002',
    name: 'Vera Italia',
    alternateNames: [],
    tagline: 'Cucina Italiana',
    phone: '',
    phoneHref: '',
    address: '',
    city: '',
    country: '',
    geo: null,
    mapsUrl: '',
    hours: null,
    instagram: null,
    facebook: null,
    reviewUrl: null,
    live: liveFromEnv('veraitalia'),
  },
};

/**
 * A restaurant switched on for this build only (VITE_PREVIEW_VENUES, a
 * comma list): the browser tests and a preview deploy show Vera Italia
 * before the database has its menu; production does not.
 */
function liveFromEnv(slug: string): boolean {
  // import.meta.env exists in the app build; the build scripts read this file without it.
  const list = (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_PREVIEW_VENUES ?? '';
  return String(list).split(',').map((s) => s.trim()).includes(slug);
}

/** The restaurant whose row in the database has this id. */
export function venueByDbId(id: string | null | undefined): Venue | null {
  return Object.values(VENUES).find((v) => v.dbId === id) ?? null;
}

/** The venue a table QR code, a bare /menu or an old link belongs to. */
export const DEFAULT_VENUE = 'lasoul';

export function venueBySlug(slug: string | undefined): Venue | null {
  const venue = slug ? VENUES[slug] : undefined;
  return venue && venue.live ? venue : null;
}

/**
 * The restaurant a guest is in right now: the menu being browsed, else the
 * table they last sat down at, else La Soul. Every menu address below
 * defaults to it, so "back to the menu" from the cart, the tab or a page
 * that was not found returns a Vera Italia guest to Vera Italia's menu.
 */
export function activeVenue(): string {
  const path = typeof location === 'undefined' ? '' : location.pathname;
  const browsing = /^\/menu\/([^/]+)/.exec(path)?.[1];
  if (browsing && VENUES[browsing]) return browsing;
  const sat = guestVenue();
  return sat && VENUES[sat] ? sat : DEFAULT_VENUE;
}

/** "/menu/lasoul" — the prefix every address in a venue's menu starts with. */
export function menuBase(slug: string = activeVenue()): string {
  return `/menu/${slug}`;
}

/*
 * Page addresses end in "/". Every public page is prerendered as a folder
 * (…/index.html), and the host serves a folder at its slash address and
 * redirects the slash-less one there; links that already end in "/" never
 * cost a redirect, and search engines see one address per page.
 */

/** "/menu/lasoul/" — the menu's own page. */
export function menuPath(slug: string = activeVenue()): string {
  return `${menuBase(slug)}/`;
}

/** "/menu/lasoul/food/" — one category's page. */
export function menuCategoryPath(categorySlug: string, slug: string = activeVenue()): string {
  return `${menuBase(slug)}/${categorySlug}/`;
}

/** The menu page with a query string, or without one when it is empty. */
export function menuHome(query?: string | URLSearchParams | null, slug: string = activeVenue()): string {
  const qs = typeof query === 'string' ? query.replace(/^\?/, '') : query?.toString() ?? '';
  return qs ? `${menuPath(slug)}?${qs}` : menuPath(slug);
}
