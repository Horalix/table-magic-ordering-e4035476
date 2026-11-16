import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { AREAS, LAUNCHERS, PAGES, ownerPaths, pageAt, pagesFor, pagesIn, searchScore, searchText } from './admin-nav';
import { areaLanding, areaTarget, recentPages, rememberVisit } from './nav-memory';

/**
 * The admin's map against the app's routes: a page added to src/App.tsx and
 * not to the map would exist with no way to reach it, and one in the map
 * twice would show two tabs lit. Addresses never change: alerts, bookmarks
 * and the docs link to them.
 */

const app = readFileSync(resolve(__dirname, '..', '..', '..', 'App.tsx'), 'utf8');

/** Every address under <Route path="/admin" …> in src/App.tsx. */
function adminRoutes(): string[] {
  const start = app.indexOf('<Route path="/admin" element=');
  const end = app.indexOf('</Route>', start);
  expect(start, 'the admin routes in src/App.tsx').toBeGreaterThan(-1);
  const block = app.slice(start, end);
  const paths = [...block.matchAll(/<Route path="([^"]+)" element=/g)].map((m) => m[1]).filter((p) => p !== '/admin');
  return [...(/<Route index element=/.test(block) ? ['/admin'] : []), ...paths.map((p) => `/admin/${p}`)];
}

const OWNER = { owner: true, demo: false };
const ADMIN = { owner: false, demo: false };
const DEMO = { owner: true, demo: true };

describe('the admin navigation map', () => {
  it('has every admin route of src/App.tsx exactly once, and nothing else', () => {
    const routes = adminRoutes();
    expect(routes.length).toBeGreaterThan(15);
    expect(PAGES.map((p) => p.path).sort()).toEqual([...routes].sort());
    expect(new Set(PAGES.map((p) => p.path)).size).toBe(PAGES.length);
  });

  it('puts every page in one of the five areas, and every area has a page', () => {
    expect(AREAS.map((a) => a.label)).toEqual(['Home', 'Service', 'Menu', 'Reports', 'Setup']);
    for (const page of PAGES) expect(AREAS.some((a) => a.id === page.area), page.label).toBe(true);
    for (const area of AREAS) expect(pagesIn(area.id, ADMIN).length, area.label).toBeGreaterThan(0);
  });

  it('is the map the owner agreed: each area, in order', () => {
    const labels = (area: Parameters<typeof pagesIn>[0]) => pagesIn(area, OWNER).map((p) => p.label);
    expect(labels('home')).toEqual(['Dashboard', 'Both restaurants']);
    expect(labels('service')).toEqual(['Orders', 'Reservations', 'Tonight’s waiters']);
    expect(labels('menu')).toEqual(['Dishes', 'Promotions', 'Menu intelligence']);
    expect(labels('reports')).toEqual(['Daily report', 'Analytics', 'What the app earned', 'Performance', 'Audit log']);
    expect(labels('setup')).toEqual(['Ordering & service', 'Tables', 'QR codes', 'Floor sections', 'Waiters', 'Printing', 'Team']);
    expect(LAUNCHERS.map((l) => [l.label, l.path])).toEqual([['Kitchen display', '/kitchen'], ['Floor monitor', '/waiter/monitor']]);
  });

  it('keeps the owner’s pages from a restaurant’s own admin, and Both restaurants out of the demo', () => {
    expect(pagesFor(ADMIN).map((p) => p.path)).not.toContain('/admin/team');
    expect(pagesFor(ADMIN).map((p) => p.path)).not.toContain('/admin/overview');
    expect(pagesFor(OWNER).map((p) => p.path)).toEqual(expect.arrayContaining(['/admin/team', '/admin/overview']));
    expect(pagesFor(DEMO).map((p) => p.path)).not.toContain('/admin/overview');
    expect(pagesFor(DEMO).map((p) => p.path)).toContain('/admin/team');
    // Refused to anyone else by AdminLayout: exactly these.
    expect(ownerPaths(false).sort()).toEqual(['/admin/overview', '/admin/team']);
    expect(ownerPaths(true)).toEqual(['/admin/team']);
    // A restaurant's own admin has one Home page, so Home shows no tab row.
    expect(pagesIn('home', ADMIN)).toHaveLength(1);
  });

  it('knows which page an address is', () => {
    expect(pageAt('/admin')?.label).toBe('Dashboard');
    expect(pageAt('/admin/')?.label).toBe('Dashboard');
    expect(pageAt('/admin/menu')?.label).toBe('Dishes');
    expect(pageAt('/admin/menu-intelligence')?.label).toBe('Menu intelligence');
    expect(pageAt('/admin/reservations')?.area).toBe('service');
    expect(pageAt('/admin/nowhere')).toBeNull();
    expect(pageAt('/kitchen')).toBeNull();
  });

  it('finds a page by what a manager would type', () => {
    const find = (words: string) => [...PAGES, ...LAUNCHERS].filter((p) => searchText(p).includes(words)).map((p) => p.label);
    expect(find('pin')).toContain('Waiters');
    expect(find('password')).toEqual(expect.arrayContaining(['Waiters', 'Team']));
    expect(find('sold out')).toContain('Dishes');
    expect(find('price')).toContain('Dishes');
    expect(find('allergens')).toContain('Dishes');
    expect(find('wifi printer')).toContain('Printing');
    expect(find('refund')).toContain('Orders');
    expect(find('tips')).toContain('Daily report');
    expect(find('booking')).toContain('Reservations');
    expect(find('close the day')).toContain('Daily report');
    expect(find('menu only')).toContain('Ordering & service');
    expect(find('qr')).toContain('QR codes');
    expect(find('kds')).toContain('Kitchen display');
    for (const entry of [...PAGES, ...LAUNCHERS]) {
      expect(entry.keywords.length, entry.label).toBeGreaterThan(2);
      expect(entry.about.length, entry.label).toBeLessThanOrEqual(46);
    }
  });
});

describe('the search', () => {
  /** What the search lists for this, best first: as AdminCommandPalette asks. */
  const results = (query: string) => [...PAGES, ...LAUNCHERS]
    .map((p) => ({ label: p.label, score: searchScore(p.label, [...p.keywords, p.about], query) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((r) => r.label);

  it.each([
    ['wifi printer', 'Printing'],
    ['printer', 'Printing'],
    ['sold out', 'Dishes'],
    ['price', 'Dishes'],
    ['allergens', 'Dishes'],
    ['pin', 'Waiters'],
    ['refund', 'Orders'],
    ['booking', 'Reservations'],
    ['close the day', 'Daily report'],
    ['tips', 'Daily report'],
    ['menu only', 'Ordering & service'],
    ['qr', 'QR codes'],
    ['kitchen', 'Kitchen display'],
    ['terrace', 'Floor sections'],
    ['audit', 'Audit log'],
    ['Menu int', 'Menu intelligence'],
  ])('"%s" finds %s first', (query, first) => {
    expect(results(query)[0]).toBe(first);
  });

  it('puts a page named what was typed before pages that only mention it', () => {
    expect(results('waiters').slice(0, 2)).toEqual(['Waiters', 'Tonight’s waiters']);
    expect(results('orders')[0]).toBe('Orders');
    expect(results('tables')[0]).toBe('Tables');
  });

  it('takes the words in any order, and lists nothing for nonsense', () => {
    expect(results('printer wifi')).toContain('Printing');
    expect(results('zzzz')).toEqual([]);
    // Not fuzzy: letters scattered across a page's words are not a match.
    expect(results('wifi printer')).toEqual(['Printing']);
    expect(searchScore('Orders', [], '')).toBe(1);
  });
});

describe('what the navigation remembers', () => {
  beforeEach(() => localStorage.clear());

  it('opens an area on its first page, then on the page last used in it', () => {
    expect(areaLanding('reports', ADMIN)?.path).toBe('/admin/reports');
    rememberVisit('/admin/analytics');
    expect(areaLanding('reports', ADMIN)?.path).toBe('/admin/analytics');
    expect(areaLanding('service', ADMIN)?.path).toBe('/admin/orders');
  });

  it('sends a tap on the area you are in to its first page, and on any other to its last-used page', () => {
    rememberVisit('/admin/analytics');
    // On Analytics, Reports is where you are: its first page.
    expect(areaTarget('reports', ADMIN, '/admin/analytics')).toBe('/admin/reports');
    expect(areaTarget('home', ADMIN, '/admin/analytics')).toBe('/admin');
    // Once the address is Home's (even before its page has arrived), Reports is another area again.
    expect(areaTarget('reports', ADMIN, '/admin')).toBe('/admin/analytics');
    expect(areaTarget('reports', ADMIN, '/admin/')).toBe('/admin/analytics');
    // An address that is no admin page is in no area.
    expect(areaTarget('service', ADMIN, '/kitchen')).toBe('/admin/orders');
  });

  it('never lands a restaurant’s admin on a page that is the owner’s', () => {
    rememberVisit('/admin/team');
    expect(areaLanding('setup', OWNER)?.path).toBe('/admin/team');
    expect(areaLanding('setup', ADMIN)?.path).toBe('/admin/service');
    rememberVisit('/admin/overview');
    expect(areaLanding('home', ADMIN)?.path).toBe('/admin');
    expect(areaLanding('home', DEMO)?.path).toBe('/admin');
  });

  it('lists the last three pages before this one, newest first', () => {
    for (const path of ['/admin', '/admin/orders', '/admin/menu', '/admin/team', '/admin/printing']) rememberVisit(path);
    expect(recentPages('/admin/printing', OWNER).map((p) => p.label)).toEqual(['Team', 'Dishes', 'Orders']);
    expect(recentPages('/admin/printing', ADMIN).map((p) => p.label)).toEqual(['Dishes', 'Orders', 'Dashboard']);
    // Opening a page again moves it to the front instead of listing it twice.
    rememberVisit('/admin/orders');
    expect(recentPages('/admin/orders', OWNER).map((p) => p.label)).toEqual(['Printing', 'Team', 'Dishes']);
  });

  it('ignores an address that is no admin page, and storage that holds nonsense', () => {
    rememberVisit('/kitchen');
    expect(recentPages('/admin', OWNER)).toEqual([]);
    localStorage.setItem('admin:last-page', '{not json');
    localStorage.setItem('admin:recent-pages', '"oops"');
    expect(areaLanding('menu', ADMIN)?.path).toBe('/admin/menu');
    expect(() => recentPages('/admin', OWNER)).not.toThrow();
  });
});
