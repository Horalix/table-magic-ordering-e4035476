/**
 * The restaurants this app serves, by the slug in their menu's address.
 *
 * Each venue's menu lives at /menu/<slug>, so a second restaurant (Italia
 * Verde is next) is one entry here plus its own menu data. Everything that
 * links into a menu asks `menuBase()` rather than writing "/menu", which is
 * what lets the bare /menu and the old /menu/drinks-style addresses keep
 * working as redirects.
 *
 * Facts the website shows publicly are kept here, not invented: a field that
 * is not known yet is null and its part of the site stays hidden.
 */
export interface Venue {
  slug: string;
  name: string;
  /** Shown under the name, e.g. on the website hero. */
  tagline: string;
  phone: string;
  /** For a tel: link — digits and +. */
  phoneHref: string;
  address: string;
  city: string;
  /** Opens directions in the guest's maps app. */
  mapsUrl: string;
  /** e.g. [{ days: 'Mon–Sun', hours: '08:00–23:00' }]; null until confirmed. */
  hours: { days: string; hours: string }[] | null;
  instagram: string | null;
  facebook: string | null;
  /** Live: has a menu and takes orders. Not live: the address answers "not found". */
  live: boolean;
}

export const VENUES: Record<string, Venue> = {
  lasoul: {
    slug: 'lasoul',
    name: 'La Soul',
    tagline: 'Cake & Burger Boutique',
    phone: '+387 33 877 779',
    phoneHref: '+38733877779',
    address: 'Butmirska cesta 16A | 16B',
    city: 'Sarajevo',
    mapsUrl: 'https://www.google.com/maps/search/?api=1&query=La+Soul+Butmirska+cesta+16+Sarajevo',
    hours: null,
    instagram: null,
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

/** "/menu/lasoul" — the root of a venue's menu. */
export function menuBase(slug: string = DEFAULT_VENUE): string {
  return `/menu/${slug}`;
}

/** The menu root with a query string, or without one when it is empty. */
export function menuHome(query?: string | URLSearchParams | null, slug: string = DEFAULT_VENUE): string {
  const qs = typeof query === 'string' ? query.replace(/^\?/, '') : query?.toString() ?? '';
  return qs ? `${menuBase(slug)}?${qs}` : menuBase(slug);
}
