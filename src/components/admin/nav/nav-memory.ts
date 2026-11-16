import { PAGES, pageAt, pagesIn, type AreaId, type NavAudience, type NavPage } from './admin-nav';

/**
 * What the navigation remembers on this device: the page last used in each
 * area (so "Reports" opens the report this manager actually reads), and the
 * last few pages visited (the search lists them first). Nothing here leaves
 * the browser, and with storage off the areas simply open on their first page.
 */

const LAST_KEY = 'admin:last-page';
const RECENT_KEY = 'admin:recent-pages';
const RECENT_KEPT = 6;

function read(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage off or full: nothing is remembered.
  }
}

/** Whatever is in storage, as what it should be: another version, or a hand, may have written it. */
function lastByArea(): Partial<Record<AreaId, string>> {
  const value = read(LAST_KEY);
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Partial<Record<AreaId, string>>) : {};
}

function recentPaths(): string[] {
  const value = read(RECENT_KEY);
  return Array.isArray(value) ? value.filter((p): p is string => typeof p === 'string') : [];
}

/** Note that this page was opened. */
export function rememberVisit(pathname: string): void {
  const page = pageAt(pathname);
  if (!page) return;
  const last = lastByArea();
  if (last[page.area] !== page.path) write(LAST_KEY, { ...last, [page.area]: page.path });
  const recent = recentPaths();
  if (recent[0] !== page.path) write(RECENT_KEY, [page.path, ...recent.filter((p) => p !== page.path)].slice(0, RECENT_KEPT));
}

/**
 * Where an area opens: the page last used in it, if this account still has
 * it; else its first page. Null for an area with no page for this account.
 */
export function areaLanding(area: AreaId, audience: NavAudience): NavPage | null {
  const pages = pagesIn(area, audience);
  if (!pages.length) return null;
  const last = lastByArea()[area];
  return pages.find((p) => p.path === last) ?? pages[0];
}

/** The pages visited before this one, newest first, among those this account has. */
export function recentPages(currentPath: string, audience: NavAudience, count = 3): NavPage[] {
  const current = pageAt(currentPath)?.path;
  const allowed = new Set(PAGES.filter((p) => (audience.owner || !p.ownerOnly) && !(audience.demo && p.hiddenInDemo)).map((p) => p.path));
  return recentPaths()
    .filter((path) => path !== current && allowed.has(path))
    .map((path) => PAGES.find((p) => p.path === path))
    .filter((p): p is NavPage => !!p)
    .slice(0, count);
}
