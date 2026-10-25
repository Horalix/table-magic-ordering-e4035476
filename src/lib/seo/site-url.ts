/**
 * Where the website is served: the one address every canonical link, the
 * sitemap, structured data and llms.txt point at.
 *
 * The published Lovable address until lasoul.net is pointed at this app; that
 * day, change this line to 'https://lasoul.net' (public/_redirects already
 * sends the old lasoul.net pages to their new homes).
 */
export const SITE_URL = 'https://table-magic-ordering.lovable.app';

export const absoluteUrl = (path: string) => `${SITE_URL}${path.startsWith('/') ? path : `/${path}`}`;
