/**
 * Every name the demo shows, in one place (demo mode only).
 *
 * The product is sold to restaurants under a name that is not final:
 * `PRODUCT.name` is the placeholder. Rename it here and the demo hub, the
 * page titles, the sign-in cards and the docs' screenshots all follow. The
 * restaurant is fictional; nothing here belongs to a real venue.
 *
 * No imports, so anything may read it — the app, the seed, the build.
 */

export const PRODUCT = {
  /** Placeholder product name. Change it here only. */
  name: 'TableFlow',
  tagline: 'QR ordering, kitchen display and floor service in one system',
  /** Shown small under the demo hub's title. */
  byline: 'Live product demo',
} as const;

export const RESTAURANT = {
  /** The address segment of its menu: /menu/casademo. */
  slug: 'casademo',
  /** Its row in the database's `venues` table (the first venue's fixed id). */
  dbId: 'a5000000-0000-4000-8000-000000000001',
  name: 'Casa Demo',
  tagline: 'Mediterranean Kitchen & Bar',
  city: 'Sarajevo',
  country: 'BA',
  address: 'Obala Kulina bana 12',
  phone: '+387 33 555 010',
  phoneHref: '+38733555010',
  currency: 'KM',
  /** The table the demo's guest sits at. */
  guestTable: 5,
  /** Every waiter's Floor PIN on the floor monitor. */
  floorPin: '1234',
} as const;

/** The browser toolbar colour on the restaurant's pages. */
export const RESTAURANT_THEME_COLOR = '#7e9b79';

const svg = (markup: string) => `data:image/svg+xml,${encodeURIComponent(markup)}`;

/** The demo's icon (browser tab, home screen): a monogram, drawn here so no image file is needed. */
export const DEMO_ICON = svg(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><rect width='64' height='64' rx='15' fill='#33473B'/>"
  + "<path d='M42 21.5a14 14 0 1 0 0 21' fill='none' stroke='#F4ECDD' stroke-width='6' stroke-linecap='round'/>"
  + "<circle cx='45' cy='32' r='3.4' fill='#D98A5F'/></svg>",
);

/** The second venue row the schema ships with stays in the database, switched off and unnamed. */
export const SPARE_VENUE = {
  dbId: 'a5000000-0000-4000-8000-000000000002',
  slug: 'casademo-spare',
  name: 'Casa Demo (second location)',
} as const;

export type DemoArea = 'admin' | 'kitchen' | 'waiter' | 'monitor';

export interface DemoAccount {
  id: string;
  email: string;
  password: string;
  label: string;
}

/**
 * Who is signed in on each staff area of the demo. Nobody types a password:
 * opening /admin, /kitchen, /waiter or /waiter/monitor signs this account in
 * (src/demo/session.ts). The ids are fixed so the seed can give them roles.
 */
export const ACCOUNTS: Record<DemoArea, DemoAccount> = {
  admin: { id: 'de300000-0000-4000-8000-000000000001', email: 'owner@casademo.example', password: 'demo-owner-pass', label: 'Owner' },
  kitchen: { id: 'de300000-0000-4000-8000-000000000002', email: 'casademo-kitchen@staff.casademo.example', password: 'demo-kitchen-pass', label: 'Kitchen' },
  waiter: { id: 'de300000-0000-4000-8000-000000000011', email: 'amra@staff.casademo.example', password: 'demo-waiter-pass', label: 'Amra (waiter)' },
  monitor: { id: 'de300000-0000-4000-8000-000000000003', email: 'casademo-floor@staff.casademo.example', password: 'demo-floor-pass', label: 'Floor screen' },
};

/** The staff area a page belongs to; null for guest pages, the TV board and the demo hub. */
export function areaForPath(pathname: string): DemoArea | null {
  if (/^\/admin(\/|$)/.test(pathname)) return 'admin';
  if (/^\/kitchen(\/|$)/.test(pathname)) return 'kitchen';
  if (/^\/waiter\/monitor(\/|$)/.test(pathname)) return 'monitor';
  if (/^\/waiter(\/|$)/.test(pathname)) return 'waiter';
  return null;
}

/** The fixed QR token of a seeded table, so demo links to a table never go stale. */
export const tableQrToken = (tableNumber: number) =>
  `demo${String(tableNumber).padStart(2, '0')}`.padEnd(64, 'c0ffee');

/** The venue-wide QR token (one code at the door, the guest types their table). */
export const VENUE_QR_TOKEN = 'demovenue'.padEnd(64, 'beef');

export const guestTablePath = (tableNumber: number = RESTAURANT.guestTable) =>
  `/table/${tableNumber}?token=${tableQrToken(tableNumber)}`;
