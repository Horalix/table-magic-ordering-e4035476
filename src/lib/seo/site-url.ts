/**
 * Where each restaurant's website is served, and which one this build is.
 *
 * La Soul: the Netlify address the app is hosted at until lasoul.net is
 * pointed at it; that day, change its line to 'https://lasoul.net'
 * (public/_redirects already sends the old lasoul.net pages to their new
 * homes). Vera Italia: veraitalia.net, its own Netlify site built from this
 * repository (src/lib/home-venue.ts).
 */
import { HOME_VENUE } from '../home-venue';

export const VENUE_URLS: Record<string, string> = {
  lasoul: 'https://lasoulapp.netlify.app',
  veraitalia: 'https://veraitalia.net',
};

/**
 * Whether a restaurant's own site is up at its address. Until Vera Italia's
 * is, La Soul's site serves its pages at /veraitalia/ and /menu/veraitalia/.
 * The day veraitalia.net answers (docs/two-restaurants-rollout.md, "Vera
 * Italia's own site"), set it to true: La Soul's site then forwards those
 * addresses there, and Vera Italia's QR codes are printed with it.
 */
export const OWN_SITE_LIVE: Record<string, boolean> = {
  lasoul: true,
  veraitalia: true, // veraitalia.net answered on 30 October 2026
};

/** This build's own address: every canonical link, the sitemap, structured data and llms.txt point at it. */
export const SITE_URL = VENUE_URLS[HOME_VENUE];

export const absoluteUrl = (path: string) => `${SITE_URL}${path.startsWith('/') ? path : `/${path}`}`;
