/**
 * @vitest-environment node
 *
 * A switch flipped in the admin reaches search engines by itself: each build
 * says what it believed (/site-state.json), and twice an hour that is
 * compared with what the database says now (scripts/republish-check.mjs,
 * .github/workflows/republish.yml). It publishes when they differ, once.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { siteState } from '../../../scripts/seo-prerender';
import { BUILD_MINUTES, SITES, decide, readBuilt, readNow, stateLine, type Built, type Now } from '../../../scripts/republish-check.mjs';
import { VENUE_URLS } from './site-url';

const root = path.join(__dirname, '..', '..', '..');
const [laSoul, vera] = SITES;
const MIN = 60_000;
const T0 = Date.parse('2026-11-13T10:00:00Z');

const built = (over: Partial<Built> = {}): Built => ({ ordering: true, reservations: false, builtAt: T0, api: 'https://db.example', key: 'pk', ...over });
const now = (over: Partial<Now> = {}): Now => ({ ordering: true, reservations: false, ...over });
const sites = (laSoulNow: Partial<Now> = {}, laSoulBuilt: Partial<Built> = {}) => [
  { site: laSoul, built: built(laSoulBuilt), now: now(laSoulNow) },
  { site: vera, built: built(), now: now() },
];
/** The newest commit on main: an ordinary one, made before the sites were last built. */
const head = (over: Partial<{ time: number; body: string }> = {}) => ({ time: T0 - 60 * MIN, body: 'Some change', ...over });

describe('what a build says it believed (/site-state.json)', () => {
  it('names the restaurant, both switches and when, with the address and key the checker asks the database with', () => {
    expect(siteState({ venue: 'lasoul', ordering: true, reservations: false, builtAt: '2026-11-13T10:00:00.000Z', api: 'https://db.example', publishableKey: 'pk' }))
      .toEqual({ venue: 'lasoul', asked: true, ordering: true, reservations: false, builtAt: '2026-11-13T10:00:00.000Z', api: 'https://db.example', publishableKey: 'pk' });
  });

  it('a build made without the database says only that, so nothing is concluded from it', () => {
    expect(siteState({ venue: 'veraitalia', ordering: true, reservations: false, builtAt: 'x' })).toEqual({ venue: 'veraitalia', asked: false, builtAt: 'x' });
  });
});

describe('reading the two sides', () => {
  const answer = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => body }) as Response;

  it('reads what the live site was built believing, fresh', async () => {
    const fetcher = vi.fn(async () => answer({ venue: 'lasoul', asked: true, ordering: true, reservations: true, builtAt: '2026-11-13T10:00:00Z', api: 'https://db.example', publishableKey: 'pk' }));
    expect(await readBuilt(laSoul, fetcher as unknown as typeof fetch)).toEqual({ ordering: true, reservations: true, builtAt: T0, api: 'https://db.example', key: 'pk' });
    expect((fetcher.mock.calls[0] as unknown as [string])[0]).toMatch(/^https:\/\/lasoul\.net\/site-state\.json\?at=\d+$/);
  });

  it('takes nothing from a site that cannot say: an older build, another restaurant’s file, a build without the database', async () => {
    const tries: [unknown, boolean?][] = [
      [null], [{ venue: 'veraitalia', asked: true, api: 'a', publishableKey: 'k' }], [{ venue: 'lasoul', asked: false }], [{}, false],
    ];
    for (const [body, ok] of tries) {
      expect(await readBuilt(laSoul, (async () => answer(body, ok)) as unknown as typeof fetch)).toBeNull();
    }
    expect(await readBuilt(laSoul, (async () => { throw new Error('offline'); }) as unknown as typeof fetch)).toBeNull();
  });

  it('asks the database the build’s two questions, for that restaurant', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetcher = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return answer(url.endsWith('guest_reservation_options') ? { enabled: true } : { menu_only: true });
    }) as unknown as typeof fetch;
    expect(await readNow(vera, built(), fetcher)).toEqual({ ordering: false, reservations: true });
    expect(calls.map((c) => c.url).sort()).toEqual([
      'https://db.example/rest/v1/rpc/guest_get_service_status', 'https://db.example/rest/v1/rpc/guest_reservation_options',
    ]);
    const service = calls.find((c) => c.url.endsWith('guest_get_service_status'))!;
    expect((service.init.headers as Record<string, string>)['x-venue']).toBe('veraitalia');
    expect(JSON.parse(calls.find((c) => c.url.endsWith('guest_reservation_options'))!.init.body as string)).toEqual({ _venue: 'veraitalia' });
  });

  it('a database that cannot be asked is no reason to publish', async () => {
    expect(await readNow(laSoul, built(), (async () => answer({}, false)) as unknown as typeof fetch)).toBeNull();
    expect(decide({ sites: [{ site: laSoul, built: built(), now: null }], head: head(), nowMs: T0 }).action).toBe('none');
  });
});

describe('deciding', () => {
  it('does nothing while both sites say what the database says', () => {
    expect(decide({ sites: sites(), head: head(), nowMs: T0 + 5 * MIN })).toMatchObject({ action: 'none' });
  });

  it('publishes when a restaurant switched reservations on, and says why in the commit', () => {
    const verdict = decide({ sites: sites({ reservations: true }), head: head(), nowMs: T0 + 5 * MIN });
    expect(verdict.action).toBe('publish');
    expect(verdict.message).toMatch(/^Republish: La Soul takes reservations online\n/);
    expect(verdict.message).toContain('state: lasoul reservations=on ordering=on | veraitalia reservations=off ordering=on');
  });

  it('and when it switched them off, or changed "Menu only"', () => {
    expect(decide({ sites: sites({ reservations: false }, { reservations: true }), head: head(), nowMs: T0 }).message)
      .toMatch(/^Republish: La Soul no longer takes reservations online\n/);
    expect(decide({ sites: sites({ ordering: false }), head: head(), nowMs: T0 }).message).toMatch(/^Republish: La Soul shows its menu only\n/);
  });

  it('waits while a push is still on its way to the sites: it carries the change', () => {
    const pushed = head({ time: T0 + 2 * MIN });
    expect(decide({ sites: sites({ reservations: true }), head: pushed, nowMs: T0 + 6 * MIN }).action).toBe('wait');
  });

  it('never publishes twice for the same thing: a build that cannot read the switch is reported, not repeated', () => {
    const wanted = stateLine(sites({ reservations: true }).map(({ site, now: n }) => ({ site, now: n })));
    const asked = head({ time: T0, body: `Republish: La Soul takes reservations online\n\nstate: ${wanted}\n` });
    // Published again since, and still saying otherwise.
    const rebuilt = sites({ reservations: true }, { builtAt: T0 + 4 * MIN });
    const verdict = decide({ sites: rebuilt, head: asked, nowMs: T0 + 30 * MIN });
    expect(verdict.action).toBe('stuck');
    expect(verdict.reason).toContain('the build is not reading the switch');
    // Asked, and Netlify never published it.
    const never = decide({ sites: sites({ reservations: true }, { builtAt: T0 - MIN }), head: asked, nowMs: T0 + (BUILD_MINUTES + 10) * MIN });
    expect(never.action).toBe('stuck');
    expect(never.reason).toContain('Netlify has not published it');
  });

  it('a switch flipped back after a publish is a new thing, and is published', () => {
    const on = stateLine(sites({ reservations: true }).map(({ site, now: n }) => ({ site, now: n })));
    const asked = head({ time: T0, body: `Republish: La Soul takes reservations online\n\nstate: ${on}\n` });
    const verdict = decide({ sites: sites({ reservations: false }, { reservations: true, builtAt: T0 + 4 * MIN }), head: asked, nowMs: T0 + 40 * MIN });
    expect(verdict.action).toBe('publish');
    expect(verdict.message).toContain('state: lasoul reservations=off ordering=on');
  });

  it('by hand, publishes whatever the sites say', () => {
    expect(decide({ sites: sites(), head: head(), nowMs: T0, force: true })).toMatchObject({ action: 'publish' });
    expect(decide({ sites: [], head: head(), nowMs: T0, force: true }).message).toContain('Republish: asked by hand');
  });
});

describe('the workflow', () => {
  const workflow = readFileSync(path.join(root, '.github', 'workflows', 'republish.yml'), 'utf8');

  it('runs twice an hour and by hand, and may push to main, nothing else', () => {
    expect(workflow).toContain("cron: '9,39 * * * *'");
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toMatch(/permissions:\n {2}contents: write\n/);
    expect(workflow).toContain('run: node scripts/republish-check.mjs');
    expect(workflow).toContain("if: steps.check.outputs.publish == 'true'");
    expect(workflow).toContain('git commit --allow-empty -F "$RUNNER_TEMP/republish-message.txt"');
  });

  it('checks the two sites the restaurants are served from', () => {
    expect(SITES.map(({ venue, url }) => [venue, url])).toEqual(Object.entries(VENUE_URLS));
  });

  it('never prints the key', () => {
    const script = readFileSync(path.join(root, 'scripts', 'republish-check.mjs'), 'utf8');
    for (const line of script.split('\n').filter((l) => l.includes('console.log'))) expect(line).not.toMatch(/key|api/i);
  });
});
