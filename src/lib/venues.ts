/**
 * The restaurants this app serves, by the slug in their menu's address.
 *
 * Each venue's menu lives at /menu/<slug>, so a second restaurant (Italia
 * Verde is next) is one entry here plus its own menu data. Everything that
 * links into a menu asks `menuPath()` or `menuBase()` rather than writing
 * "/menu", which is what lets the bare /menu and the old /menu/drinks-style
 * addresses keep working as redirects.
 *
 * Facts the website shows publicly are kept here, not invented: a field that
 * is not known yet is null and its part of the site stays hidden.
 */
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
    live: true,
  },
};

/** The venue a table QR code, a bare /menu or an old link belongs to. */
export const DEFAULT_VENUE = 'lasoul';

export function venueBySlug(slug: string | undefined): Venue | null {
  const venue = slug ? VENUES[slug] : undefined;
  return venue && venue.live ? venue : null;
}

/** "/menu/lasoul" — the prefix every address in a venue's menu starts with. */
export function menuBase(slug: string = DEFAULT_VENUE): string {
  return `/menu/${slug}`;
}

/*
 * Page addresses end in "/". Every public page is prerendered as a folder
 * (…/index.html), and the host serves a folder at its slash address and
 * redirects the slash-less one there; links that already end in "/" never
 * cost a redirect, and search engines see one address per page.
 */

/** "/menu/lasoul/" — the menu's own page. */
export function menuPath(slug: string = DEFAULT_VENUE): string {
  return `${menuBase(slug)}/`;
}

/** "/menu/lasoul/food/" — one category's page. */
export function menuCategoryPath(categorySlug: string, slug: string = DEFAULT_VENUE): string {
  return `${menuBase(slug)}/${categorySlug}/`;
}

/** The menu page with a query string, or without one when it is empty. */
export function menuHome(query?: string | URLSearchParams | null, slug: string = DEFAULT_VENUE): string {
  const qs = typeof query === 'string' ? query.replace(/^\?/, '') : query?.toString() ?? '';
  return qs ? `${menuPath(slug)}?${qs}` : menuPath(slug);
}
