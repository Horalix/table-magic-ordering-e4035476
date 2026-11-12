/**
 * Publishes both websites again when a switch an admin flipped has not
 * reached them yet.
 *
 * What a person sees follows a switch at once: the app asks the database.
 * What search engines and AI assistants read is written when a site is
 * published (scripts/seo-prerender.ts): whether guests order from the table
 * ("Menu only", src/lib/seo/ordering.ts) and whether a table can be asked
 * for online (Admin → Reservations, src/lib/seo/reservations.ts). Each build
 * says what it believed in /site-state.json. This script reads that from the
 * live sites, asks the database the same two questions now, and where they
 * differ asks for a new publish: an empty commit on main, which Netlify
 * builds as it builds any other.
 *
 * Run by .github/workflows/republish.yml twice an hour, and by hand:
 *
 *   node scripts/republish-check.mjs          (says what it would do)
 *
 * It never publishes twice for the same thing: a build that cannot learn
 * what the database says would otherwise be asked for again every half hour.
 * It stops and fails instead, which GitHub reports to the repository's owner.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** The same addresses as VENUE_URLS in src/lib/seo/site-url.ts (republish.test.ts keeps them equal). */
export const SITES = [
  { venue: 'lasoul', name: 'La Soul', url: 'https://lasoul.net' },
  { venue: 'veraitalia', name: 'Vera Italia', url: 'https://veraitalia.net' },
];

/** A push to main is given this long to reach the sites before anything is concluded from them. */
export const BUILD_MINUTES = 20;

/** What a site's last build believed, or null when it cannot say (an older build, or one made without the database). */
export async function readBuilt(site, fetcher = fetch) {
  try {
    const res = await fetcher(`${site.url}/site-state.json?at=${Date.now()}`, { headers: { 'cache-control': 'no-cache' } });
    if (!res.ok) return null;
    const s = await res.json();
    if (!s || s.venue !== site.venue || s.asked !== true || typeof s.api !== 'string' || typeof s.publishableKey !== 'string') return null;
    return {
      ordering: s.ordering === true,
      reservations: s.reservations === true,
      builtAt: Date.parse(s.builtAt) || 0,
      api: s.api,
      key: s.publishableKey,
    };
  } catch {
    return null;
  }
}

/**
 * What the database says now, asked exactly as the build asks it. Null when
 * it cannot be asked: a database that is briefly away is no reason to
 * publish.
 */
export async function readNow(site, built, fetcher = fetch) {
  const ask = async (fn, body, headers = {}) => {
    const res = await fetcher(`${built.api}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: built.key, Authorization: `Bearer ${built.key}`, 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${fn} answered ${res.status}`);
    return res.json();
  };
  try {
    const [service, options] = await Promise.all([
      ask('guest_get_service_status', {}, { 'x-venue': site.venue }),
      ask('guest_reservation_options', { _venue: site.venue }),
    ]);
    return {
      ordering: service?.menu_only === false || (service !== null && service?.menu_only === undefined),
      reservations: options?.enabled === true,
    };
  } catch {
    return null;
  }
}

const onOff = (yes) => (yes ? 'on' : 'off');

/** One line that names what the sites should say: written into the commit, and looked for in the last one. */
export const stateLine = (known) => known
  .map(({ site, now }) => `${site.venue} reservations=${onOff(now.reservations)} ordering=${onOff(now.ordering)}`)
  .join(' | ');

/**
 * What to do, from what each site was built believing, what the database
 * says now, and the newest commit on main.
 *
 * - `none`: the sites say what the database says.
 * - `wait`: a push is on its way to the sites; it carries what the database says.
 * - `publish`: ask for a new publish, with `message` as the commit.
 * - `stuck`: this was already asked for and did not help; a person has to look.
 */
export function decide({ sites, head, nowMs, force = false }) {
  const known = sites.filter((s) => s.built && s.now);
  const changes = [];
  for (const { site, built, now } of known) {
    if (built.reservations !== now.reservations) changes.push(`${site.name} ${now.reservations ? 'takes' : 'no longer takes'} reservations online`);
    if (built.ordering !== now.ordering) changes.push(`${site.name} ${now.ordering ? 'takes orders from the table' : 'shows its menu only'}`);
  }
  const wanted = stateLine(known);
  const message = (why) => `Republish: ${why}\n\nNothing in the code changed. Netlify builds both sites again so the pages,\nsitemap and llms.txt say what the database says now (scripts/republish-check.mjs).\n\nstate: ${wanted || 'unknown'}\n`;

  if (force) return { action: 'publish', reason: 'asked by hand', message: message(changes.join('; ') || 'asked by hand') };
  if (!known.length) return { action: 'none', reason: 'no site says what it was built believing yet' };
  if (!changes.length) return { action: 'none', reason: 'both sites say what the database says' };

  const headMinutes = Math.round((nowMs - head.time) / 60_000);
  const behind = known.some(({ built }) => built.builtAt < head.time);
  if (behind && headMinutes < BUILD_MINUTES) {
    return { action: 'wait', reason: `a push ${headMinutes} minutes ago is still being published; it carries the change (${changes.join('; ')})` };
  }
  if (head.body.includes(`state: ${wanted}`)) {
    return {
      action: 'stuck',
      reason: behind
        ? `this was asked for ${headMinutes} minutes ago and Netlify has not published it (${changes.join('; ')})`
        : `the sites were published again and still say otherwise: the build is not reading the switch (${changes.join('; ')})`,
    };
  }
  return { action: 'publish', reason: changes.join('; '), message: message(changes.join('; ')) };
}

async function main() {
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
  const head = { time: Date.parse(git('log', '-1', '--format=%cI')), body: git('log', '-1', '--format=%B') };
  const sites = [];
  for (const site of SITES) {
    const built = await readBuilt(site);
    const now = built ? await readNow(site, built) : null;
    sites.push({ site, built, now });
    // Never the key: only what each side says.
    const say = (s) => (s ? `reservations ${onOff(s.reservations)}, ordering ${onOff(s.ordering)}` : 'cannot say');
    console.log(`${site.name}: built believing ${say(built)}; the database says ${built ? say(now) : 'not asked'}`);
  }
  const verdict = decide({ sites, head, nowMs: Date.now(), force: process.env.FORCE === 'true' });
  console.log(`${verdict.action}: ${verdict.reason}`);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `publish=${verdict.action === 'publish'}\n`);
    if (verdict.message) writeFileSync(path.join(process.env.RUNNER_TEMP ?? '.', 'republish-message.txt'), verdict.message);
  }
  if (verdict.action === 'stuck') process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
