/**
 * Which restaurant's website this build is.
 *
 * One repository, two Netlify sites. La Soul's (lasoul.net) is built with
 * nothing set; Vera Italia's (veraitalia.net) is built from the same code
 * with VITE_HOME_VENUE=veraitalia. Both serve the whole app — the menus,
 * ordering, the staff screens — against the one database. What differs is
 * the page at "/", the restaurant an address without one means (a bare
 * /menu, the table pages, the admin's first view), the app a phone installs,
 * and what search engines are told (docs/two-restaurants-rollout.md,
 * "Vera Italia's own site").
 *
 * No imports: src/lib/current-venue.ts and src/lib/seo/site-url.ts read this,
 * and so does the build (scripts/seo-prerender.ts, vite.config.ts), where
 * Vite's import.meta.env does not exist but the process environment does.
 * So set it in the build's environment (the Netlify site's settings, or
 * before the command), not in a .env file, which the build step never reads.
 */
// This module is also checked by build scripts without the app's ambient types.
declare const __TABLEFLOW_DEMO_BUILD__: boolean | undefined;

const HOMES = ['lasoul', 'veraitalia'];

/**
 * The offline demo build (docs/demo-mode.md): one fictional restaurant, whose
 * names are in src/demo/brand.ts.
 *
 * vite.config.ts replaces __TABLEFLOW_DEMO_BUILD__ with a literal in every
 * build, so in the normal build this is the constant `false` and whatever it
 * guards — every import of src/demo — is left out of the bundle. Where
 * nothing replaces it (the unit tests, the build's own scripts) it does not
 * exist, and this is false there too.
 */
export const DEMO_BUILD: boolean = typeof __TABLEFLOW_DEMO_BUILD__ !== 'undefined' && __TABLEFLOW_DEMO_BUILD__ === true;
/** The demo restaurant's slug; the same value as RESTAURANT.slug in src/demo/brand.ts (this file imports nothing). */
export const DEMO_VENUE = 'casademo';

const fromApp = (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_HOME_VENUE;
const fromBuild = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.VITE_HOME_VENUE;
const requested = (fromApp ?? fromBuild ?? '').trim();

export const HOME_VENUE: string = DEMO_BUILD ? DEMO_VENUE : HOMES.includes(requested) ? requested : 'lasoul';
