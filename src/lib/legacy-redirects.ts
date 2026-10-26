/**
 * The permanent redirects in public/_redirects, followed by the app itself.
 *
 * Netlify answers them on a first visit. A phone that has opened the site
 * before is answered by the service worker instead, which serves the app for
 * every address and never asks Netlify — so an old printed QR code
 * (/food/burgers.html) or an old lasoul.net link (/en/home) landed on "Page
 * not found". The app reads the very same file, so there is one list.
 */
import rules from '../../public/_redirects?raw';

/** `from → to` for every exact-path permanent redirect in a _redirects file. */
export function parseRedirects(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of text.split('\n')) {
    const [from, to, status] = line.trim().split(/\s+/);
    if (!from || from.startsWith('#') || from.includes('*') || !to) continue;
    if (!/^30[1278]$/.test(status ?? '')) continue;
    map.set(from, to);
  }
  return map;
}

const REDIRECTS = parseRedirects(rules);

/** Where an old address lives now, or null. */
export const legacyRedirect = (pathname: string): string | null => REDIRECTS.get(pathname) ?? null;
