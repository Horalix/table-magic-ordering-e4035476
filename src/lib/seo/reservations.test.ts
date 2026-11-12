/**
 * @vitest-environment node
 *
 * What search engines, maps and answer engines are told about reserving a
 * table: nothing while the restaurant takes no requests online, and the
 * whole of it, the same in every place, once it does (./reservations.ts).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pageModules, renderPage } from '../../../scripts/seo-prerender';
import { reservationCopyTable } from '../reservation-copy';
import { VENUES } from '../venues';
import { SITE_URL } from './site-url';
import { faqEntries, homeGraph, LOCALES, restaurantNode } from './structured-data';
import { headTags, homeBody, jsonForScript, llmsFullTxt, llmsTxt, robotsTxt, sitemapXml } from './static-pages';
import {
  RESERVATION_PREFIX, RESERVE_PATH, fetchReservationsOffered, homeReserveFaq, offerReservations, reservationFacts,
  reservationsOffered, reserveAddress, reserveBody, reserveClosedBody, reserveClosedMeta, reserveFaq, reserveGraph, reserveMeta,
  reserveSteps,
} from './reservations';
import { veraLlms, veraPages, veraSeoMenu, veraSiteGraph } from './vera-seo';

const venue = VENUES.lasoul;
const root = path.join(__dirname, '..', '..', '..');
const template = '<html lang="en"><head><title>x</title></head><body><div id="root"></div></body></html>';

type Node = Record<string, unknown>;
const nodes = (graph: unknown) => (graph as { '@graph': Node[] })['@graph'];
const typed = (graph: unknown, type: string | string[]) => nodes(graph).find((n) =>
  (Array.isArray(n['@type']) ? (n['@type'] as string[]) : [n['@type']]).some((t) => [type].flat().includes(t as string))) as Node;
const restaurantOf = (graph: unknown) => nodes(graph).find((n) => 'servesCuisine' in n) as Node;
const questions = (graph: unknown) => (typed(graph, 'FAQPage').mainEntity as { name: string }[]).map((q) => q.name);

afterEach(() => offerReservations(false));

describe('while the restaurant takes no requests online', () => {
  it('is what a build believes until the database says otherwise', () => {
    expect(reservationsOffered()).toBe(false);
  });

  it('its structured data, its questions and its home page promise nothing', () => {
    for (const locale of LOCALES) {
      const graph = homeGraph(venue, locale);
      expect(restaurantOf(graph)).not.toHaveProperty('acceptsReservations');
      expect(JSON.stringify(graph)).not.toMatch(/ReserveAction|reserve/i);
      expect(faqEntries(venue, locale).map(({ q }) => q)).not.toContain(homeReserveFaq(locale).q);
      expect(homeBody(venue, locale)).not.toContain(RESERVE_PATH);
    }
  });

  it('answer engines are told nothing either', () => {
    expect(`${llmsTxt(venue, null)}\n${llmsFullTxt(venue, null)}`).not.toMatch(/reserv/i);
  });

  it('the booking page is still there, says so, and asks to be left out of search results', () => {
    const meta = reserveClosedMeta(venue, 'en');
    expect(meta.title).toBe('Reserve a table · La Soul');
    expect(meta.description).toBe('Online reservations are not open yet. Call us and we will find you a table.');
    const html = renderPage(template, headTags({
      path: RESERVE_PATH, locale: 'en', venue, noindex: true, ...meta, jsonLd: { '@context': 'https://schema.org', ...restaurantNode(venue, 'en') },
    }), reserveClosedBody(venue), 'en');
    expect(html).toContain('<meta name="robots" content="noindex, follow" />');
    expect(html).toContain('<h1>Online reservations are not open yet</h1>');
    expect(html).toContain(`<a href="tel:${venue.phoneHref}">${venue.phone}</a>`);
    expect(html).not.toMatch(/ReserveAction|acceptsReservations/);
    // A restaurant with no number yet sends guests to ask there.
    expect(reserveClosedMeta(VENUES.veraitalia, 'en').description).toMatch(VENUES.veraitalia.phone ? /Call us/ : /ask at the restaurant/);
  });

  it('robots.txt never keeps crawlers from the booking page: the page itself says whether it is listed', () => {
    const robots = robotsTxt();
    expect(robots).not.toMatch(/Disallow: \/reserve\/?\n/);
    // A guest's own reservation is nobody's search result, on or off.
    expect(robots).toContain(`Disallow: ${RESERVATION_PREFIX}`);
    offerReservations(true);
    expect(robotsTxt()).toBe(robots);
  });
});

describe('once the restaurant takes requests online', () => {
  it('its own entry says it takes reservations, where, and what an assistant can offer', () => {
    offerReservations(true);
    for (const locale of LOCALES) {
      const restaurant = restaurantOf(homeGraph(venue, locale));
      expect(restaurant.acceptsReservations).toBe(`${SITE_URL}/reserve/`);
      const action = restaurant.potentialAction as { '@type': string; target: Node; result: Node };
      expect(action['@type']).toBe('ReserveAction');
      expect(action.target).toMatchObject({ '@type': 'EntryPoint', urlTemplate: `${SITE_URL}/reserve/`, inLanguage: ['bs', 'en', 'ar'] });
      expect(action.result['@type']).toBe('FoodEstablishmentReservation');
    }
    expect(reservationFacts().acceptsReservations).toBe(`${SITE_URL}${RESERVE_PATH}`);
  });

  it('"Can I reserve a table?" is among its questions, on the page and in its structured data, in three languages', () => {
    offerReservations(true);
    expect(reserveAddress()).toBe(`${SITE_URL.replace(/^https?:\/\//, '')}/reserve`);
    for (const locale of LOCALES) {
      const asked = homeReserveFaq(locale);
      expect(asked.a).toContain(reserveAddress());
      expect(`${asked.q}${asked.a}`).not.toMatch(/[{}]/);
      const shown = faqEntries(venue, locale);
      expect(shown).toContainEqual(asked);
      // Word for word what the page shows.
      expect(questions(homeGraph(venue, locale))).toEqual(shown.map(({ q }) => q));
    }
    expect(homeReserveFaq('en')).toEqual({
      q: 'Can I reserve a table?',
      a: `Yes. Ask for a table online at ${reserveAddress()}: pick a day, a time and the number of guests, and we confirm, usually within minutes.`,
    });
  });

  it('the home page links to the booking page, in its own language', () => {
    offerReservations(true);
    expect(homeBody(venue, 'en')).toContain('<a href="/reserve/">Reserve a table</a>');
    expect(homeBody(venue, 'bs')).toContain('<a href="/reserve/">Rezervišite sto</a>');
    expect(homeBody(venue, 'ar')).toContain('<a href="/reserve/">احجز طاولة</a>');
  });

  it('answer engines are told how, and given the page', () => {
    offerReservations(true);
    for (const llms of [llmsTxt(venue, null), llmsFullTxt(venue, null)]) {
      expect(llms).toContain(`- Reservations: ask for a table online at ${SITE_URL}/reserve/`);
      expect(llms).toContain('the restaurant confirms each request itself');
    }
    expect(llmsTxt(venue, null)).toContain(`- [Reserve a table](${SITE_URL}/reserve/): ask online, the restaurant confirms`);
  });

  it('the live site says what the database says now, whatever the build believed', () => {
    offerReservations(true);
    expect(restaurantOf(homeGraph(venue, 'en', true, false))).not.toHaveProperty('acceptsReservations');
    expect(faqEntries(venue, 'en', true, false)).not.toContainEqual(homeReserveFaq('en'));
    offerReservations(false);
    expect(restaurantOf(homeGraph(venue, 'en', true, true))).toHaveProperty('acceptsReservations');
    expect(faqEntries(venue, 'en', true, true)).toContainEqual(homeReserveFaq('en'));
  });
});

describe('the booking page (/reserve/)', () => {
  it('is named for what people search: reserving a table at the restaurant, in its city', () => {
    expect(reserveMeta(venue, 'en')).toEqual({
      title: 'Reserve a table at La Soul, Sarajevo',
      description: 'Ask for a table at La Soul online: pick a day, a time and the number of guests, and the restaurant confirms, usually within minutes.',
    });
    for (const locale of LOCALES) {
      const { title, description } = reserveMeta(venue, locale);
      expect(`${title}${description}`).not.toMatch(/[{}]/);
      expect(title).toContain('La Soul');
      expect(description.length).toBeLessThanOrEqual(160);
    }
    // The city as each language writes it.
    expect(reserveMeta(venue, 'bs').title).toBe('Rezervišite sto u La Soul, Sarajevo');
    expect(reserveMeta(venue, 'ar').title).toBe('احجز طاولة في La Soul، سراييفو');
  });

  it('says what it is in structured data: the restaurant, the page and its action, its questions, where it sits', () => {
    for (const locale of LOCALES) {
      const graph = reserveGraph(venue, locale, restaurantNode(venue, locale, true, true));
      const restaurant = restaurantOf(graph);
      const page = typed(graph, 'WebPage');
      expect(page.url).toBe(`${SITE_URL}/reserve/`);
      expect(page.name).toBe(reserveMeta(venue, locale).title);
      expect(page.about).toEqual({ '@id': restaurant['@id'] });
      expect((page.potentialAction as Node)['@type']).toBe('ReserveAction');
      // The questions under the form, word for word.
      expect((typed(graph, 'FAQPage').mainEntity as { name: string; acceptedAnswer: { text: string } }[])
        .map((q) => ({ q: q.name, a: q.acceptedAnswer.text }))).toEqual(reserveFaq(locale));
      expect((typed(graph, 'BreadcrumbList').itemListElement as { item: string }[]).map((i) => i.item))
        .toEqual([`${SITE_URL}/`, `${SITE_URL}/reserve/`]);
      expect(() => JSON.parse(jsonForScript(graph))).not.toThrow();
    }
  });

  it('answers what guests ask before they book, and never calls a request a booking', () => {
    const en = reserveFaq('en');
    expect(en.map(({ q }) => q)).toEqual([
      'Is my table reserved as soon as I send the request?',
      'Can I cancel or change my reservation?',
      'Can I reserve for a large group?',
      'Does a reservation cost anything?',
    ]);
    expect(en[0].a).toMatch(/^Not yet\. It is a request until the restaurant confirms it\./);
    expect(en[3].a).toBe('No. Reserving a table is free.');
    expect(reserveSteps('en')).toHaveLength(3);
    for (const locale of LOCALES) {
      expect(reserveFaq(locale)).toHaveLength(4);
      for (const { q, a } of reserveFaq(locale)) expect(q.length * a.length).toBeGreaterThan(0);
      expect(reserveSteps(locale).every((s) => s.length > 10)).toBe(true);
    }
    // Every new line exists in all three languages.
    for (const key of ['seo_title', 'seo_description', 'how_title', 'faq_title', 'home_faq_q', 'home_faq_a'] as const) {
      for (const locale of LOCALES) expect(reservationCopyTable[key][locale]).toBeTruthy();
    }
  });

  it('is written as a real page: listed, with its words in English, Bosnian and Arabic', () => {
    offerReservations(true);
    const html = renderPage(template, headTags({
      path: RESERVE_PATH, locale: 'en', venue, ...reserveMeta(venue, 'en'),
      jsonLd: reserveGraph(venue, 'en', restaurantNode(venue, 'en')),
    }), reserveBody(venue), 'en');
    expect(html).toContain('<title>Reserve a table at La Soul, Sarajevo</title>');
    expect(html).toContain(`<link rel="canonical" href="${SITE_URL}/reserve/" />`);
    expect(html).toContain('<meta name="robots" content="index, follow, max-image-preview:large" />');
    expect(html).toContain('"@type":"ReserveAction"');
    // One address in every language: no alternates that point a page at itself.
    expect(html).not.toContain('hreflang');
    expect(html).toContain('<h1>Reserve a table at La Soul, Sarajevo</h1>');
    expect(html).toContain('<h2>How it works</h2>');
    expect(html.match(/<li>/g)).toHaveLength(9);
    expect(html).toContain('<dt>Does a reservation cost anything?</dt><dd>No. Reserving a table is free.</dd>');
    expect(html).toContain('<section lang="bs"><h2>Rezervišite sto u La Soul, Sarajevo</h2>');
    expect(html).toContain('<section lang="ar" dir="rtl">');
    expect(html).toContain(`<a href="tel:${venue.phoneHref}">`);
    expect(html).toContain('<a href="/">La Soul</a>');
  });

  it('is in the sitemap and comes with its own code, so the form is there at once', () => {
    expect(sitemapXml([{ path: RESERVE_PATH, priority: 0.8 }], '2026-11-12')).toContain(`<loc>${SITE_URL}/reserve/</loc>`);
    expect(pageModules(RESERVE_PATH, false)).toEqual(['src/pages/ReservePage.tsx']);
    expect(pageModules(RESERVE_PATH, true)).toEqual(['src/pages/ReservePage.tsx']);
  });

  it('shows people the same steps and questions it gives search engines', () => {
    const page = readFileSync(path.join(root, 'src', 'pages', 'ReservePage.tsx'), 'utf8');
    expect(page).toContain('reserveSteps(locale).map(');
    expect(page).toContain('reserveFaq(locale).map(');
    expect(page).toContain('path: RESERVE_PATH');
  });
});

describe('a guest’s own reservation (/reservation/<id>)', () => {
  const blocks = readFileSync(path.join(root, 'public', '_headers'), 'utf8').split(/\r?\n(?=\/)/);
  const block = (address: string) => blocks.find((b) => b.split(/\r?\n/)[0].trim() === address) ?? '';

  it('is kept out of search results, caches and referrers; the booking page is not', () => {
    const own = block('/reservation/*');
    expect(own).toContain('X-Robots-Tag: noindex, nofollow');
    expect(own).toContain('Referrer-Policy: no-referrer');
    expect(own).toContain('Cache-Control: no-store');
    // A rule for /reserve/* would also cover /reserve/ itself, the page search engines list.
    expect(block('/reserve')).toBe('');
    expect(block('/reserve/*')).toBe('');
    expect(RESERVATION_PREFIX.startsWith(RESERVE_PATH)).toBe(false);
  });

  it('has the app’s route and the server’s rule at the same address', () => {
    expect(readFileSync(path.join(root, 'src', 'App.tsx'), 'utf8')).toContain('<Route path="/reservation/:id"');
    expect(readFileSync(path.join(root, 'public', '_redirects'), 'utf8')).toMatch(/^\/reservation\/\*\s+\/index\.html\s+200$/m);
    expect(readFileSync(path.join(root, 'src', 'lib', 'reservations.ts'), 'utf8')).toContain('`/reservation/${key.id}?t=');
  });
});

describe('asking the database whether the restaurant takes requests online', () => {
  afterEach(() => vi.unstubAllGlobals());
  const answer = (body: unknown, ok = true) => vi.fn(async () => ({ ok, json: async () => body }) as Response);

  it('asks as the booking page does, for the restaurant whose site is being built', async () => {
    const fetched = answer({ enabled: true });
    vi.stubGlobal('fetch', fetched);
    expect(await fetchReservationsOffered('https://db.example', 'anon', 'veraitalia')).toBe(true);
    const [url, init] = fetched.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://db.example/rest/v1/rpc/guest_reservation_options');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ _venue: 'veraitalia' });
  });

  it('takes nothing but a plain yes as a yes', async () => {
    for (const body of [{ enabled: false }, { enabled: 'true' }, {}, null]) {
      vi.stubGlobal('fetch', answer(body));
      expect(await fetchReservationsOffered('https://db.example', 'anon', 'lasoul')).toBe(false);
    }
    // A database that does not know reservations yet, or cannot be reached.
    vi.stubGlobal('fetch', answer({ code: 'PGRST202' }, false));
    expect(await fetchReservationsOffered('https://db.example', 'anon', 'lasoul')).toBe(false);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    expect(await fetchReservationsOffered('https://db.example', 'anon', 'lasoul')).toBe(false);
  });
});

describe('Vera Italia', () => {
  const menu = veraSeoMenu();

  it('on its live site says what the database says now', () => {
    const on = veraSiteGraph(menu, 'en', true);
    expect(restaurantOf(on).acceptsReservations).toBe(`${SITE_URL}/reserve/`);
    expect(questions(on)).toContain('Can I reserve a table?');
    const off = veraSiteGraph(menu, 'en', false);
    expect(restaurantOf(off)).not.toHaveProperty('acceptsReservations');
    expect(questions(off)).not.toContain('Can I reserve a table?');
  });

  it('shown on another restaurant’s site, promises no table there: /reserve/ is that site’s own page', () => {
    // This build is La Soul's (src/lib/home-venue.ts), and La Soul takes requests online.
    offerReservations(true);
    expect(restaurantOf(veraSiteGraph(menu, 'en'))).not.toHaveProperty('acceptsReservations');
    expect(veraPages(menu).map((p) => p.body).join('\n')).not.toContain(RESERVE_PATH);
    const llms = veraLlms(menu);
    expect(`${llms.short}\n${llms.full}`).not.toMatch(/reserv/i);
  });
});

describe('Vera Italia on its own site (veraitalia.net)', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

  it('says the same things La Soul’s site does, about its own booking page', async () => {
    vi.stubEnv('VITE_HOME_VENUE', 'veraitalia');
    vi.resetModules();
    const own = await import('./vera-seo');
    const reservations = await import('./reservations');
    const menu = own.veraSeoMenu();
    const home = () => own.veraPages(menu).find((p) => p.path === '/')!;

    expect(home().body).not.toContain('/reserve/');
    expect(`${own.veraLlms(menu).short}\n${own.veraLlms(menu).full}`).not.toMatch(/reserv/i);

    reservations.offerReservations(true);
    const address = 'https://veraitalia.net/reserve/';
    expect(home().body).toContain('<a href="/reserve/">Reserve a table</a>');
    expect(home().body).toContain('<h3>Can I reserve a table?</h3>');
    expect(restaurantOf(home().head.jsonLd).acceptsReservations).toBe(address);
    expect(questions(home().head.jsonLd)).toContain('Can I reserve a table?');
    const llms = own.veraLlms(menu);
    expect(llms.short).toContain(`- [Reserve a table](${address}): ask online, the restaurant confirms`);
    expect(llms.short).toContain(`- Reservations: ask for a table online at ${address}`);
    expect(llms.full).toContain('### Can I reserve a table?');
    // Its booking page is its own: its name, its city, its address.
    const graph = reservations.reserveGraph(VENUES.veraitalia, 'en', own.veraRestaurantNode(menu, 'en'));
    expect(typed(graph, 'WebPage').url).toBe(address);
    expect(reservations.reserveMeta(VENUES.veraitalia, 'en').title).toBe('Reserve a table at Vera Italia, Sarajevo');
    expect(reservations.reserveBody(VENUES.veraitalia)).not.toMatch(/La Soul|Butmirska/);
  });
});
