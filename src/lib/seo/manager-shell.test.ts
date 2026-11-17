/**
 * @vitest-environment node
 *
 * The app an admin adds to the Home Screen opens the admin, not the menu.
 *
 * "Add to Home Screen" reads the web manifest, name and icon from the HTML a
 * phone is sent, and an iPhone reads them once, before any code has run. The
 * app's index.html names the guests' manifest (start_url: the menu), so the
 * app added from /admin opened the menu, whatever VenueTheme swapped in
 * afterwards. Netlify now answers /admin and /admin/* with a first page of
 * its own, which names the Manager's (scripts/seo-prerender.ts, managerShell).
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { managerShell } from '../../../scripts/seo-prerender';
import { VENUES } from '../venues';
import { APP_ROUTES, appRedirects, MANAGER_SHELL } from './static-pages';

const root = path.join(__dirname, '..', '..', '..');
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');

/** What the build hands managerShell: index.html as Vite writes it, with the PWA plugin's manifest link. */
const template = read('index.html').replace('</head>', '<link rel="manifest" href="/manifest.webmanifest"></head>');

describe.each(['lasoul', 'veraitalia'] as const)('the admin’s first page for %s', (slug) => {
  const venue = VENUES[slug];
  const manifestFile = venue.brand.managerManifest.replace(/^\//, 'public/');
  const manifest = JSON.parse(read(manifestFile)) as Record<string, string>;
  const html = managerShell(template, venue, manifest.theme_color);

  it('names the Manager’s web manifest, which starts at /admin, and not the menu’s', () => {
    expect(html).toContain(`<link rel="manifest" href="${venue.brand.managerManifest}">`);
    expect(html).not.toContain(`href="${venue.brand.manifest}"`);
    expect(manifest.start_url).toBe('/admin');
    expect(manifest.id).toBe('/admin');
    expect(manifest.display).toBe('standalone');
    expect(manifest.scope).toBe('/');
  });

  it('names the Manager’s icon and name, in the admin’s colour', () => {
    expect(html).toContain(`<link rel="apple-touch-icon" href="${venue.brand.managerTouchIcon}"`);
    expect(html).toContain('<meta name="apple-mobile-web-app-title" content="Manager"');
    expect(html).toContain(`<meta name="theme-color" content="${manifest.theme_color}"`);
    expect(html).toContain(`<title>${venue.name} Manager</title>`);
    expect(read(`public${venue.brand.managerTouchIcon}`).length).toBeGreaterThan(0);
  });

  it('is the app, with none of the home page, and nobody’s search result', () => {
    expect(html).toContain('<div id="root"></div>');
    expect(html).toContain('<script type="module"');
    expect(html).not.toContain('data-prerender');
    expect(html).toContain('<meta name="robots" content="noindex, nofollow" />');
    expect(html).not.toMatch(/<meta (name|property)="(description|og:|twitter:)/);
    expect(html.match(/<title>/g)).toHaveLength(1);
  });
});

describe('the rules that serve it', () => {
  const rules = appRedirects().map((l) => l.split(/\s+/));

  it('answer the admin’s addresses with it, and every other address of the app with index.html', () => {
    for (const route of APP_ROUTES) {
      const admin = route === '/admin' || route.startsWith('/admin/');
      expect(rules).toContainEqual([route, admin ? MANAGER_SHELL : '/index.html', '200']);
    }
    expect(rules.filter(([, to]) => to === MANAGER_SHELL).map(([from]) => from)).toEqual(['/admin', '/admin/*']);
  });

  it('are the ones La Soul’s public/_redirects has', () => {
    const own = read('public/_redirects').split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#')).map((l) => l.trim().split(/\s+/));
    for (const route of ['/admin', '/admin/*']) expect(own).toContainEqual([route, MANAGER_SHELL, '200']);
  });
});

describe('the web manifests in public/', () => {
  const headers = read('public/_headers').split(/\r?\n/);
  const manifests = readdirSync(path.join(root, 'public')).filter((f) => /^manifest.*\.webmanifest$/.test(f));

  it('are each served as a manifest (Netlify answers application/octet-stream otherwise)', () => {
    expect(manifests.length).toBeGreaterThanOrEqual(7);
    for (const file of manifests) {
      const at = headers.findIndex((l) => l.trim() === `/${file}`);
      expect(at, `${file} has no entry in public/_headers`).toBeGreaterThanOrEqual(0);
      expect(headers[at + 1].trim()).toBe('Content-Type: application/manifest+json');
    }
  });

  it('and the admin’s first page is kept out of search by header too', () => {
    // The generated /manifest.webmanifest is Vite's, with the same header (first entry of _headers).
    expect(headers.map((l) => l.trim())).toContain('/manifest.webmanifest');
    const at = headers.findIndex((l) => l.trim() === MANAGER_SHELL);
    expect(at).toBeGreaterThanOrEqual(0);
    expect(headers[at + 1].trim()).toBe('X-Robots-Tag: noindex, nofollow');
  });
});
