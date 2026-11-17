/**
 * @vitest-environment node
 *
 * Every public page in three languages, each at its own address
 * (./locale-path.ts): English at the address it always had, Bosnian under
 * /bs/, Arabic under /ar/. Each names all three and x-default with hreflang,
 * is its own canonical, is written in its language, and the app ends with the
 * same head the HTML at that address has (headFor in ./page-meta.ts).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { pageModules, renderPage } from '../../../scripts/seo-prerender';
import { VENUES } from '../venues';
import { addressLocale, languageAlternates, localePath, unprefixed } from './locale-path';
import { buildSeoMenu } from './menu-data';
import { menuFaq, parseSiteFacts, setSiteFacts } from './menu-faq';
import { headFor } from './page-meta';
import { POSTER_PATHS } from './poster';
import { privacyPageBody, privacyPageGraph } from './privacy-page';
import { SITE_URL } from './site-url';
import { dishGraph, dishPath, faqEntries, homeGraph, LOCALES, menuGraph, menuPath, sitePath } from './structured-data';
import { appRedirects, dishBody, dishMeta, headTags, homeBody, llmsTxt, menuBody, sitemapXml } from './static-pages';

const venue = VENUES.lasoul;
const root = path.resolve(__dirname, '../../..');
const template = '<!doctype html><html lang="en"><head><title>x</title></head><body><div id="root"></div></body></html>';

const menu = buildSeoMenu(
  [{ id: 'c1', name: 'Food', name_bs: 'Hrana', name_ar: 'مأكولات', sort_order: 0 },
    { id: 'c2', name: 'Desserts', name_bs: 'Deserti', name_ar: 'حلويات', sort_order: 1 }],
  [{ id: 's1', category_id: 'c1', name: 'Burgers', name_bs: 'Burgeri', name_ar: 'برجر', sort_order: 0 },
    { id: 's2', category_id: 'c1', name: 'Breakfast', name_bs: 'Doručak', name_ar: 'فطور', sort_order: 1 },
    { id: 's3', category_id: 'c2', name: 'Desserts', name_bs: 'Deserti', name_ar: 'حلويات', sort_order: 0 }],
  [{ id: 'b', subcategory_id: 's1', name: 'La Soul Burger', name_bs: 'La Soul burger', name_ar: 'برجر La Soul', description: 'Beef & cheddar', description_bs: 'Junetina i čedar', description_ar: null, price: '15.5', sort_order: 0, allergens: ['gluten', 'dairy'] },
    { id: 'c', subcategory_id: 's1', name: 'Classic', name_bs: null, name_ar: null, description: null, description_bs: null, description_ar: null, price: 12, sort_order: 1 },
    { id: 'e', subcategory_id: 's2', name: 'Eggs Benedict', name_bs: 'Jaja Benedikt', name_ar: 'بيض بنديكت', description: null, description_bs: null, description_ar: null, price: 11, sort_order: 0, dietary_tags: ['vegetarian'] },
    { id: 'k', subcategory_id: 's3', name: 'Lava Cake', name_bs: 'Lava kolač', name_ar: 'لافا كيك', description: null, description_bs: null, description_ar: null, price: 8, sort_order: 0 }],
  (id) => (id === 'b' ? '/menu/b/768.webp?v=1' : null),
  (id) => (id === 'b' ? '/menu/b/sq-240.webp?v=1' : null),
);
const food = menu.categories[0];
const burgers = food.sections[0];
const burger = burgers.items[0];

/** The <link rel="alternate"> set of a page's head, as hreflang → absolute address. */
const alternatesIn = (html: string) => Object.fromEntries(
  [...html.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)" \/>/g)].map((m) => [m[1], m[2]]),
);
const canonicalIn = (html: string) => /<link rel="canonical" href="([^"]+)"/.exec(html)?.[1];

/** A dish's page in a language, as the build writes it (scripts/seo-prerender.ts). */
const dishPage = (locale: 'en' | 'bs' | 'ar') => {
  const p = localePath(dishPath('lasoul', burger), locale);
  return renderPage(template, headTags({
    path: p, locale, venue, image: burger.image, alternates: languageAlternates(dishPath('lasoul', burger)),
    ...dishMeta(burger.names[locale], burger.price, burger.descriptions[locale], locale),
    jsonLd: dishGraph(venue, food, burgers, burger, locale),
  }), dishBody(venue, food, burgers, burger, locale), locale);
};

describe('the addresses', () => {
  it('put Bosnian under /bs/ and Arabic under /ar/, with the same path after the prefix', () => {
    expect(localePath('/menu/lasoul/dish/la-soul-burger/', 'bs')).toBe('/bs/menu/lasoul/dish/la-soul-burger/');
    expect(localePath('/menu/lasoul/', 'ar')).toBe('/ar/menu/lasoul/');
    expect(localePath('/bs/menu/lasoul/', 'en')).toBe('/menu/lasoul/');
    expect(localePath('/bs/reserve/', 'ar')).toBe('/ar/reserve/');
    expect(localePath('/', 'bs')).toBe('/bs/');
    expect(sitePath('ar')).toBe('/ar/');
    expect(unprefixed('/ar/')).toBe('/');
    expect(unprefixed('/bs')).toBe('/');
    expect(addressLocale('/bs/menu/lasoul/')).toBe('bs');
    expect(addressLocale('/ar')).toBe('ar');
    // A word that starts with the letters is no prefix.
    expect(addressLocale('/bsomething/')).toBe('en');
    expect(addressLocale('/menu/lasoul/')).toBe('en');
  });

  it('name each family with all three and x-default, the same set from every member', () => {
    const family = languageAlternates('/bs/menu/lasoul/food/');
    expect(family).toEqual({ en: '/menu/lasoul/food/', bs: '/bs/menu/lasoul/food/', ar: '/ar/menu/lasoul/food/', 'x-default': '/menu/lasoul/food/' });
    expect(languageAlternates('/menu/lasoul/food/')).toEqual(family);
    expect(languageAlternates('/ar/menu/lasoul/food/')).toEqual(family);
  });

  it('are reciprocal and complete on the pages themselves, each its own canonical', () => {
    const pages = Object.fromEntries((['en', 'bs', 'ar'] as const).map((l) => [l, dishPage(l)]));
    const urls = { en: `${SITE_URL}/menu/lasoul/dish/la-soul-burger/`, bs: `${SITE_URL}/bs/menu/lasoul/dish/la-soul-burger/`, ar: `${SITE_URL}/ar/menu/lasoul/dish/la-soul-burger/` };
    for (const l of ['en', 'bs', 'ar'] as const) {
      expect(canonicalIn(pages[l])).toBe(urls[l]);
      // Every page names every other one, and itself, and the same x-default.
      expect(alternatesIn(pages[l])).toEqual({ ...urls, 'x-default': urls.en });
    }
    expect(pages.en).toContain('<html lang="en">');
    expect(pages.bs).toContain('<html lang="bs">');
    expect(pages.ar).toContain('<html lang="ar" dir="rtl">');
    expect(pages.bs).toContain('<meta property="og:locale" content="bs_BA" />');
    expect(pages.ar).toContain('<meta property="og:locale" content="ar_AR" />');
  });
});

describe('a dish’s page in Bosnian and in Arabic', () => {
  it('is written in its language: title, description, heading, the words around it, and its other names as one line', () => {
    const bs = dishPage('bs');
    expect(bs).toContain('<title>La Soul burger — 15,50 KM · La Soul, Sarajevo</title>');
    expect(bs).toContain('<meta name="description" content="La Soul burger u La Soulu u Sarajevu, 15,50 KM. Junetina i čedar. Potpuno halal i bez alkohola.');
    expect(bs).toContain('<h1>La Soul burger</h1>');
    expect(bs).toContain('Alergeni: gluten, mlijeko i mliječni proizvodi.');
    expect(bs).toContain('<p>Junetina i čedar</p>');
    expect(bs).toContain('Poznato i kao: <span lang="en">La Soul Burger</span> · <span lang="ar" dir="rtl">برجر La Soul</span>');
    expect(bs).toContain('<a href="/bs/menu/lasoul/">Meni</a>');
    expect(bs).toContain('alt="La Soul burger — La Soul, Sarajevo"');
    // Links to the other two versions of the same page.
    expect(bs).toContain('<a href="/ar/menu/lasoul/dish/la-soul-burger/" hreflang="ar" lang="ar">العربية</a>');

    const ar = dishPage('ar');
    expect(ar).toContain('<h1>برجر La Soul</h1>');
    expect(ar).toContain('مسببات الحساسية: الغلوتين، الحليب ومشتقاته'.replace('، ', ', '));
    // No Arabic description: the English one, never an empty field.
    expect(ar).toContain('<p>Beef &amp; cheddar</p>');
    expect(ar).toContain('<a href="/ar/menu/lasoul/food/">');
  });

  it('says the same in its structured data: names, addresses, language and the one restaurant', () => {
    const graph = dishGraph(venue, food, burgers, burger, 'ar')['@graph'] as Record<string, unknown>[];
    const type = (t: string) => graph.find((n) => n['@type'] === t || (Array.isArray(n['@type']) && (n['@type'] as string[]).includes(t)))!;
    const dish = type('MenuItem');
    expect(dish).toMatchObject({
      name: 'برجر La Soul', url: `${SITE_URL}/ar/menu/lasoul/dish/la-soul-burger/`,
      // One dish, one @id, whichever language names it.
      '@id': `${SITE_URL}/menu/lasoul/dish/la-soul-burger/#dish`,
      offers: { price: '15.50', priceCurrency: 'BAM', offeredBy: { '@id': `${SITE_URL}/#restaurant` } },
    });
    const page = type('WebPage');
    expect(page).toMatchObject({
      url: `${SITE_URL}/ar/menu/lasoul/dish/la-soul-burger/`, inLanguage: 'ar', about: { '@id': `${SITE_URL}/#restaurant` },
      primaryImageOfPage: { '@type': 'ImageObject', url: `${SITE_URL}/menu/b/768.webp?v=1` },
    });
    expect(type('Restaurant')['@id']).toBe(`${SITE_URL}/#restaurant`);
    const crumbs = (type('BreadcrumbList').itemListElement as { item: string; name: string }[]);
    expect(crumbs.map((c) => c.item)).toEqual([`${SITE_URL}/ar/`, `${SITE_URL}/ar/menu/lasoul/`, `${SITE_URL}/ar/menu/lasoul/food/`, `${SITE_URL}/ar/menu/lasoul/dish/la-soul-burger/`]);
    expect(crumbs[1].name).toBe('القائمة');
    expect(() => JSON.parse(JSON.stringify(graph))).not.toThrow();
  });

  it('marks a dish vegetarian only where the menu does', () => {
    const graph = menuGraph(venue, menu, 'bs')['@graph'] as Record<string, unknown>[];
    const sections = (graph[1].hasMenuSection as { hasMenuItem: { name: string; suitableForDiet: unknown }[] }[]);
    const items = sections.flatMap((s) => s.hasMenuItem);
    expect(items.find((i) => i.name === 'Jaja Benedikt')!.suitableForDiet).toEqual(['https://schema.org/HalalDiet', 'https://schema.org/VegetarianDiet']);
    expect(items.find((i) => i.name === 'Lava kolač')!.suitableForDiet).toBe('https://schema.org/HalalDiet');
  });
});

describe('the menu and the home page in a language', () => {
  it('list every dish in that language with a small photo by address, lazy (hidden HTML never fetches it)', () => {
    const html = menuBody(venue, menu, 'bs');
    expect(html).toContain('<h1>La Soul — Meni</h1>');
    expect(html).toContain('<a href="/bs/menu/lasoul/dish/la-soul-burger/">La Soul burger</a></strong> — 15,50 KM');
    expect(html).toContain('<img src="/menu/b/sq-240.webp?v=1" alt="La Soul burger — La Soul, Sarajevo" width="240" height="240" loading="lazy" decoding="async" />');
    expect(html).toContain('Cijene su u KM (BAM)');
    expect(html).not.toMatch(/data:image/);
  });

  it('show the home page’s photographs as real images, with alt text in its language', () => {
    const html = homeBody(venue, 'ar', (id) => `/menu/${id}/sq-240.webp`);
    expect(html).toMatch(/<img src="\/site\/hero-wide-\d+\.webp" alt="برغر La Soul[^"]*" width="\d+" height="\d+" loading="lazy"/);
    // All of them lazy: an eager one would be fetched by every visitor, whose app hides this HTML.
    expect(html.match(/<img /g)!.length).toBe(9);
    expect(html.match(/<img [^>]*loading="lazy"/g)!.length).toBe(9);
    expect(html).toContain('<a href="/ar/menu/lasoul/">');
  });

  it('keep the home page’s photograph to the home page in each language', () => {
    const poster = new RegExp(POSTER_PATHS.slice(1, -1));
    expect(['/', '/bs/', '/ar/', '/bs', '/ar'].every((p) => poster.test(p))).toBe(true);
    expect(['/bs/menu/lasoul/', '/ar/reserve/', '/menu/lasoul/'].some((p) => poster.test(p))).toBe(false);
  });

  it('preload the same screen at every language’s address', () => {
    expect(pageModules('/bs/menu/lasoul/', false)).toEqual(pageModules('/menu/lasoul/', false));
    expect(pageModules('/ar/menu/lasoul/dish/x/', false)).toEqual(pageModules('/menu/lasoul/dish/x/', false));
    expect(pageModules('/ar/menu/lasoul/food/', false)).toEqual(pageModules('/menu/lasoul/food/', false));
    expect(pageModules('/bs/reserve/', false)).toEqual(['src/pages/ReservePage.tsx']);
    expect(pageModules('/ar/privacy/', false)).toEqual(pageModules('/privacy/', false));
    expect(pageModules('/bs/', false)).toEqual(['src/pages/site/SiteHome.tsx']);
  });

  it('write the privacy notice in each language at its own address', () => {
    expect(privacyPageBody(venue, 'bs')).toContain('<a href="/bs/menu/lasoul/">Meni</a>');
    expect(privacyPageGraph(venue, 'ar')).toMatchObject({ url: `${SITE_URL}/ar/privacy/`, inLanguage: 'ar' });
  });
});

describe('the sitemap and llms.txt', () => {
  it('list each language’s page with all its alternates', () => {
    const family = languageAlternates(menuPath('lasoul'));
    const xml = sitemapXml(LOCALES.map((l) => ({ path: localePath(menuPath('lasoul'), l), priority: 0.9, alternates: family })), '2026-11-16');
    for (const l of LOCALES) {
      expect(xml).toContain(`<loc>${SITE_URL}${localePath('/menu/lasoul/', l)}</loc>`);
    }
    // Three entries, each naming four alternates.
    expect(xml.match(/<xhtml:link rel="alternate" hreflang="bs" href="[^"]+\/bs\/menu\/lasoul\/" \/>/g)).toHaveLength(3);
    expect(xml.match(/hreflang="x-default"/g)).toHaveLength(3);
  });

  it('say once which languages every page is in, and give the main pages’ three addresses', () => {
    const txt = llmsTxt(venue, menu);
    expect(txt).toContain('Every page is in English, Bosnian and Arabic');
    expect(txt).toContain(`- Full menu with prices: [English](${SITE_URL}/menu/lasoul/) · [Bosanski](${SITE_URL}/bs/menu/lasoul/) · [العربية](${SITE_URL}/ar/menu/lasoul/)`);
  });
});

describe('Netlify’s rules', () => {
  const rules = (text: string) => text.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#')).map((l) => l.trim().split(/\s+/));
  const laSoul = rules(readFileSync(path.join(root, 'public', '_redirects'), 'utf8'));
  const at = (from: string) => laSoul.findIndex(([f]) => f === from);

  it('answer a dish address with no page "404" with the app, before the menu’s own rule answers 200', () => {
    for (const p of ['', '/bs', '/ar']) {
      expect(laSoul[at(`${p}/menu/:venue/dish/*`)]).toEqual([`${p}/menu/:venue/dish/*`, '/index.html', '404']);
    }
    // Not forced ("404", not "404!"): a dish page the build wrote is a file, and a file wins (shadowing).
    expect(at('/menu/:venue/dish/*')).toBeLessThan(at('/menu/*'));
    expect(at('/bs/menu/:venue/dish/*')).toBeLessThan(at('/bs/menu/*'));
    expect(appRedirects().join('\n')).toContain('/ar/menu/:venue/dish/*');
  });

  it('serve the app at the Bosnian and Arabic addresses the build may not have written', () => {
    for (const from of ['/bs/menu/*', '/ar/menu/*', '/bs/reserve', '/ar/reserve', '/bs/privacy', '/ar/privacy']) {
      expect(laSoul[at(from)]).toEqual([from, '/index.html', '200']);
    }
  });

  it('keep the old addresses where they were', () => {
    expect(laSoul[at('/bs/home')]).toEqual(['/bs/home', '/bs/', '301']);
    expect(laSoul[at('https://menu.lasoul.net/*')]).toEqual(['https://menu.lasoul.net/*', 'https://lasoul.net/:splat', '301!']);
  });

  it('match routes in the app for every prefixed address', () => {
    const app = readFileSync(path.join(root, 'src', 'App.tsx'), 'utf8');
    for (const route of ['/bs/menu/:venue', '/bs/menu/:venue/:type', '/bs/menu/:venue/dish/:dishSlug', '/bs/reserve', '/bs/privacy',
      '/ar/menu/:venue', '/ar/menu/:venue/:type', '/ar/menu/:venue/dish/:dishSlug', '/ar/reserve', '/ar/privacy']) {
      expect(app).toContain(`<Route path="${route}"`);
    }
  });
});

describe('the app’s head, by address (usePageMeta)', () => {
  it('ends with the canonical and hreflang the HTML at that address has', () => {
    // The menu, opened at /bs/menu/lasoul/ (the app runs it in Bosnian): the Bosnian address.
    expect(headFor('/menu/lasoul/', 'bs')).toEqual({ canonical: '/bs/menu/lasoul/', alternates: languageAlternates('/menu/lasoul/') });
    expect(headFor('/menu/lasoul/', 'en').canonical).toBe('/menu/lasoul/');
    // A dish's page, its address carried in from DishLink.
    expect(headFor('/menu/lasoul/dish/la-soul-burger/', 'ar').canonical).toBe('/ar/menu/lasoul/dish/la-soul-burger/');
    // The home page passes its own; a page in one language only passes null.
    expect(headFor('/bs/', 'bs', languageAlternates('/'))).toEqual({ canonical: '/bs/', alternates: languageAlternates('/') });
    expect(headFor('/veraitalia/', 'bs', null)).toEqual({ canonical: '/veraitalia/', alternates: {} });
  });
});

describe('questions the live menu answers (menu-faq.ts)', () => {
  afterEach(() => setSiteFacts(null));

  it('are asked only of what the menu has, with real prices, in all three languages', () => {
    const faq = menuFaq(menu);
    expect(faq.en.map((e) => e.q)).toEqual([
      'Does La Soul serve breakfast?', 'How much is a burger at La Soul?', 'How much is a cake at La Soul?', 'Are there vegetarian dishes at La Soul?',
    ]);
    expect(faq.en[1].a).toBe('The 2 burgers on the menu cost 12.00–15.50 KM, among them La Soul Burger and Classic.');
    expect(faq.bs[1].a).toBe('Burgeri na meniju koštaju 12,00–15,50 KM, među njima La Soul burger i Classic.');
    expect(faq.ar.length).toBe(faq.en.length);
    expect(menuFaq(null)).toEqual({ en: [], bs: [], ar: [] });
  });

  it('are the same words on the page and in its FAQPage data, and in the file the live page reads', () => {
    const facts = menuFaq(menu);
    const fromFile = parseSiteFacts(JSON.parse(JSON.stringify(facts)));
    expect(fromFile).toEqual(facts);
    for (const l of LOCALES) {
      const entries = faqEntries(venue, l, true, false, fromFile);
      expect(entries).toEqual(expect.arrayContaining(facts[l]));
      const data = (homeGraph(venue, l, true, false, fromFile)['@graph'].find((n) => (n as { '@type': string })['@type'] === 'FAQPage') as
        { mainEntity: { name: string; acceptedAnswer: { text: string } }[] }).mainEntity.map((q) => ({ q: q.name, a: q.acceptedAnswer.text }));
      expect(data).toEqual(entries);
    }
    // The prerendered page: set by the build, then read by default.
    setSiteFacts(facts);
    expect(homeBody(venue, 'bs')).toContain(facts.bs[0].q);
    expect(parseSiteFacts({ en: [{ q: 1 }] })).toBeNull();
  });
});
