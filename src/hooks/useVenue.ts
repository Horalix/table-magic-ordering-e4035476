import { useLayoutEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { DEFAULT_VENUE, VENUES, activeVenue, type Venue } from '@/lib/venues';

const GUEST = /^\/(menu|cart|tab|table|start)(\/|$)/;
const SITE = /^\/(veraitalia)(\/|$)/;

/**
 * The restaurant whose look a page wears: its website (/veraitalia/), the
 * menu a guest is browsing or the table they sat at, else La Soul. Staff
 * screens wear the shared look whichever restaurant they show.
 */
export function venueForPage(pathname: string): Venue {
  const site = SITE.exec(pathname);
  if (site) return VENUES[site[1]];
  if (GUEST.test(pathname)) return VENUES[activeVenue()];
  return VENUES[DEFAULT_VENUE];
}

/** The restaurant this page belongs to; changes as the guest moves between pages. */
export function useVenue(): Venue {
  return venueForPage(useLocation().pathname);
}

const THEME_COLOR: Record<string, string> = {
  lasoul: '#7e9b79',
  veraitalia: '#f4efe6',
};

/**
 * Puts the restaurant's look on <html> before the page paints: its colours,
 * its serif (src/index.css), and the browser's toolbar colour.
 */
export function VenueTheme() {
  const venue = useVenue();
  useLayoutEffect(() => {
    document.documentElement.dataset.venue = venue.slug;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta && THEME_COLOR[venue.slug]) meta.setAttribute('content', THEME_COLOR[venue.slug]);
  }, [venue.slug]);
  return null;
}
