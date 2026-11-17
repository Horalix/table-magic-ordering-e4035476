import { useLayoutEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { HOME_VENUE } from '@/lib/home-venue';
import { DEFAULT_VENUE, VENUES, activeVenue, type Venue } from '@/lib/venues';
// Keeps the browser's "Install app" offer for the admin's install hint; it must listen from the first moment.
import '@/components/admin/nav/install-prompt';

const GUEST = /^\/(menu|cart|tab|table|start)(\/|$)/;
const SITE = /^\/(veraitalia)(\/|$)/;
const WAITER = /^\/waiter(\/|$)/;
const ADMIN = /^\/admin(\/|$)/;

/**
 * The restaurant whose look a page wears: its website (/veraitalia/), the
 * menu a guest is browsing or the table they sat at, else the restaurant
 * whose site this is (La Soul, or Vera Italia on veraitalia.net). Staff
 * screens wear the shared look whichever restaurant they show.
 */
export function venueForPage(pathname: string): Venue {
  const site = SITE.exec(pathname);
  if (site) return VENUES[site[1]];
  if (GUEST.test(pathname)) return VENUES[activeVenue()];
  return VENUES[HOME_VENUE];
}

/** The restaurant this page belongs to; changes as the guest moves between pages. */
export function useVenue(): Venue {
  return venueForPage(useLocation().pathname);
}

/** Points an existing <link> or <meta> at this restaurant's value. */
const setHead = (selector: string, attr: 'href' | 'content', value: string) => {
  const el = document.querySelector(selector);
  if (el && el.getAttribute(attr) !== value) el.setAttribute(attr, value);
};

/**
 * The admin's own background (--background in src/index.css), as a colour the
 * browser's toolbar and an iPhone's status bar can wear. The admin's top bar
 * is that colour, so the two read as one surface; the guests' sage (or Vera
 * Italia's ivory) over it read as a stripe from another app.
 */
function adminSurface(fallback: string): string {
  try {
    const [h, s, l] = getComputedStyle(document.documentElement).getPropertyValue('--background').trim().split(/\s+/).map(parseFloat);
    if (![h, s, l].every(Number.isFinite)) return fallback;
    const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
    const channel = (n: number) => {
      const k = (n + h / 30) % 12;
      const value = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
      return Math.round(value * 255).toString(16).padStart(2, '0');
    };
    return `#${channel(0)}${channel(8)}${channel(4)}`;
  } catch {
    return fallback;
  }
}

/** iPhone and iPad: the only phones that take their launch picture from the page. */
const appleTouch = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/**
 * Puts the restaurant's look on <html> before the page paints: its colours,
 * its serif (src/index.css), the browser's toolbar colour, and what "Add to
 * Home Screen" installs — its name, its icon, its web manifest. A table's QR
 * code (/table/7) names no restaurant, so the HTML cannot say; this does.
 *
 * From a waiter page it installs the waiter's app, which opens the waiter
 * screen rather than the menu: on iPhone, lock-screen alerts work only from
 * a Home Screen app, and one that opened the menu had no way to /waiter.
 * From an admin page it installs "Manager", which opens the admin, with an
 * icon of its own: the manager's phone rings for a reservation from there.
 * There the toolbar and status bar take the admin's background, and an
 * iPhone gets the picture it shows while the app opens
 * (src/components/admin/nav/launch-image.ts).
 *
 * All of it is on the page from the first render, long before anyone can
 * reach Share → Add to Home Screen, which reads the page as it is then. An
 * iPhone, though, reads the manifest, name and icon once, from the HTML it
 * was sent, so an admin's addresses are sent manager-shell.html, which names
 * the Manager's already (scripts/seo-prerender.ts, managerShell); this keeps
 * them right as the app moves between pages.
 */
export function VenueTheme() {
  const { pathname } = useLocation();
  const venue = venueForPage(pathname);
  useLayoutEffect(() => {
    const waiter = WAITER.test(pathname);
    const manager = ADMIN.test(pathname);
    document.documentElement.dataset.venue = venue.slug;
    const surface = manager ? adminSurface(venue.brand.themeColor) : venue.brand.themeColor;
    setHead('meta[name="theme-color"]', 'content', surface);
    setHead('meta[name="apple-mobile-web-app-title"]', 'content', waiter ? 'Waiter' : manager ? 'Manager' : venue.name);
    setHead('link[rel="apple-touch-icon"]', 'href', manager ? venue.brand.managerTouchIcon : venue.brand.appleTouchIcon);
    setHead('link[rel="icon"]', 'href', venue.brand.icon);
    setHead('link[rel="manifest"]', 'href', waiter ? venue.brand.waiterManifest : manager ? venue.brand.managerManifest : venue.brand.manifest);
    // Pages that set no title of their own (the table, the order, the tab)
    // keep the HTML's, which is La Soul's: on another restaurant's pages, its name.
    if (venue.slug !== DEFAULT_VENUE && document.title.includes('La Soul')) {
      document.title = `${venue.name} — ${venue.tagline}`;
    }
    // The launch picture is the Manager app's alone: off the page wherever another app would be added from.
    if (!manager) document.querySelectorAll('link[rel="apple-touch-startup-image"]').forEach((link) => link.remove());
    if (manager && appleTouch()) {
      // The 512 px icon beside the Home Screen one, so it is sharp at three times the size.
      const icon = venue.brand.managerTouchIcon.replace('manager-apple-touch-icon.png', 'manager-512.png');
      void import('@/components/admin/nav/launch-image').then((m) => m.addLaunchImage(icon, surface)).catch(() => undefined);
    }
  }, [venue, pathname]);
  return null;
}
