import { useLayoutEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { HOME_VENUE } from '@/lib/home-venue';
import { DEFAULT_VENUE, VENUES, activeVenue, type Venue } from '@/lib/venues';

const GUEST = /^\/(menu|cart|tab|table|start)(\/|$)/;
const SITE = /^\/(veraitalia)(\/|$)/;

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
 * Puts the restaurant's look on <html> before the page paints: its colours,
 * its serif (src/index.css), the browser's toolbar colour, and what "Add to
 * Home Screen" installs — its name, its icon, its web manifest. A table's QR
 * code (/table/7) names no restaurant, so the HTML cannot say; this does.
 */
export function VenueTheme() {
  const { pathname } = useLocation();
  const venue = venueForPage(pathname);
  useLayoutEffect(() => {
    document.documentElement.dataset.venue = venue.slug;
    setHead('meta[name="theme-color"]', 'content', venue.brand.themeColor);
    setHead('meta[name="apple-mobile-web-app-title"]', 'content', venue.name);
    setHead('link[rel="apple-touch-icon"]', 'href', venue.brand.appleTouchIcon);
    setHead('link[rel="icon"]', 'href', venue.brand.icon);
    setHead('link[rel="manifest"]', 'href', venue.brand.manifest);
    // Pages that set no title of their own (the table, the order, the tab)
    // keep the HTML's, which is La Soul's: on another restaurant's pages, its name.
    if (venue.slug !== DEFAULT_VENUE && document.title.includes('La Soul')) {
      document.title = `${venue.name} — ${venue.tagline}`;
    }
  }, [venue, pathname]);
  return null;
}
