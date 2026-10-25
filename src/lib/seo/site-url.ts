/**
 * Where the website is served: the one address every canonical link, the
 * sitemap, structured data and llms.txt point at.
 *
 * The Netlify address the app is hosted at until lasoul.net is pointed at
 * it; that day, change this line to 'https://lasoul.net' (public/_redirects
 * already sends the old lasoul.net pages to their new homes).
 */
export const SITE_URL = 'https://lasoulapp.netlify.app';

export const absoluteUrl = (path: string) => `${SITE_URL}${path.startsWith('/') ? path : `/${path}`}`;
