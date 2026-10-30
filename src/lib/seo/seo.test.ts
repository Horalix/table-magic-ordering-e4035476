/**
 * @vitest-environment node
 *
 * What search engines and answer engines are told about La Soul — the facts,
 * the FAQ, the menu as structured data, the prerendered pages and the crawler
 * files — is true, complete in three languages, and well-formed.
 */
import { describe, expect, it } from 'vitest';
import { renderPage } from '../../../scripts/seo-prerender';
import { VENUES } from '../venues';
import { assignDishSlugs, buildSeoMenu } from './menu-data';
import { SITE_URL } from './site-url';
import { dishGraph, dishPath, faqEntries, homeGraph, LOCALES, menuGraph, sitePath } from './structured-data';
import {
  forwardToOwnSite, headTags, homeBody, jsonForScript, llmsFullTxt, llmsTxt, menuBody, ownSiteRedirects, robotsTxt, sitemapXml,
} from './static-pages';

const venue = VENUES.lasoul;

const menu = buildSeoMenu(
  [{ id: 'c2', name: 'Food', name_bs: 'Hrana', name_ar: 'الطعام', sort_order: 1 },
    { id: 'c1', name: 'Drinks', name_bs: 'Pića', name_ar: 'مشروبات', sort_order: 0 },
    { id: 'c3', name: 'Desserts', name_bs: 'Deserti', name_ar: null, sort_order: 2 }],
  [{ id: 's1', category_id: 'c2', name: 'Burgers', name_bs: 'Burgeri', name_ar: 'برغر', sort_order: 0 },
    { id: 's2', category_id: 'c1', name: 'Coffee', name_bs: 'Kafa', name_ar: 'قهوة', sort_order: 0 }],
  [{ id: 'b', subcategory_id: 's1', name: 'La Soul Burger', name_bs: null, name_ar: 'برجر La Soul', description: 'Beef & cheddar', description_bs: null, description_ar: null, price: '15.5', sort_order: 1, allergens: ['gluten'] },
    { id: 'a', subcategory_id: 's1', name: 'Classic', name_bs: null, name_ar: null, description: null, description_bs: null, description_ar: null, price: 12, sort_order: 0 },
    { id: 'e', subcategory_id: 's2', name: 'Espresso', name_bs: null, name_ar: 'إسبريسو', description: null, description_bs: null, description_ar: null, price: 3, sort_order: 0 }],
  (id) => (id === 'b' ? '/menu/b/768.webp' : null),
);

describe('the facts', () => {
  it('describe La Soul as a halal restaurant and café, with its pin, hours and profiles', () => {
    const graph = homeGraph(venue, 'en')['@graph'];
    const place = graph[0] as Record<string, unknown>;
    expect(place['@type']).toEqual(['Restaurant', 'CafeOrCoffeeShop']);
    expect(place).toMatchObject({
      name: 'La Soul',
      telephone: '+38733877779',
      url: `${SITE_URL}/`,
      hasMenu: `${SITE_URL}/menu/lasoul/`,
      address: { streetAddress: 'Butmirska cesta 16A | 16B', addressLocality: 'Sarajevo', addressCountry: 'BA' },
      geo: { '@type': 'GeoCoordinates', latitude: 43.827548, longitude: 18.3103156 },
      currenciesAccepted: 'BAM',
    });
    expect(place.alternateName).toContain('La Soul Cafe & Burger Boutique');
    expect(place.servesCuisine).toContain('Halal');
    expect(place.sameAs).toEqual(expect.arrayContaining(['https://www.instagram.com/lasoul.bih', venue.mapsUrl]));
    expect(place.openingHoursSpecification).toEqual([{
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((d) => `https://schema.org/${d}`),
      opens: '11:00', closes: '21:00',
    }]);
  });

  it('answer the same questions in all three languages, with every placeholder filled', () => {
    const counts = LOCALES.map((l) => faqEntries(venue, l).length);
    expect(new Set(counts).size).toBe(1);
    expect(counts[0]).toBeGreaterThanOrEqual(7);
    for (const l of LOCALES) {
      for (const { q, a } of faqEntries(venue, l)) {
        expect(`${q} ${a}`).not.toMatch(/\{\w+\}/);
      }
    }
    const en = faqEntries(venue, 'en').map((e) => e.a).join(' ');
    expect(en).toContain('11:00');
    expect(en).toContain('21:00');
    expect(en).toContain('Butmirska cesta 16A | 16B');
    expect(en).toMatch(/alcohol-free/);
    const faq = homeGraph(venue, 'bs')['@graph'][2] as { mainEntity: { name: string; acceptedAnswer: { text: string } }[] };
    expect(faq.mainEntity[0].name).toBe('Je li sve u La Soulu halal?');
  });
});

describe('the menu', () => {
  it('is grouped in menu order, skips empty categories, and keeps a dish’s three names', () => {
    expect(menu.categories.map((c) => c.slug)).toEqual(['drinks', 'food']);
    expect(menu.categories[1].sections[0].items.map((i) => i.names.en)).toEqual(['Classic', 'La Soul Burger']);
    const burger = menu.categories[1].sections[0].items[1];
    expect(burger).toMatchObject({ slug: 'la-soul-burger', price: 15.5, image: '/menu/b/768.webp', allergens: ['gluten'] });
    expect(burger.names).toEqual({ en: 'La Soul Burger', bs: 'La Soul Burger', ar: 'برجر La Soul' });
  });

  it('gives every dish a stable address, whatever order the menu is in', () => {
    const items = [{ id: 'z', name: 'Iced Latte' }, { id: 'a', name: 'Iced latte' }, { id: 'm', name: 'Čokolada' }];
    const one = assignDishSlugs(items);
    const two = assignDishSlugs([...items].reverse());
    expect(Object.fromEntries(one)).toEqual(Object.fromEntries(two));
    expect(one.get('a')).toBe('iced-latte');
    expect(one.get('z')).toBe('iced-latte-2');
    expect(one.get('m')).toBe('cokolada');
  });

  it('is structured data: halal dishes priced in BAM, each with its own page', () => {
    const graph = menuGraph(venue, menu, 'en')['@graph'];
    const node = graph[1] as { hasMenuSection: { name: string; hasMenuItem: Record<string, unknown>[] }[] };
    const burger = node.hasMenuSection.find((s) => s.name === 'Burgers')!.hasMenuItem[1];
    expect(burger).toMatchObject({
      '@type': 'MenuItem', name: 'La Soul Burger', description: 'Beef & cheddar',
      url: `${SITE_URL}/menu/lasoul/dish/la-soul-burger/`, image: `${SITE_URL}/menu/b/768.webp`,
      suitableForDiet: 'https://schema.org/HalalDiet',
      offers: { '@type': 'Offer', price: '15.50', priceCurrency: 'BAM' },
    });
    const crumbs = (dishGraph(venue, menu.categories[1], menu.categories[1].sections[0], menu.categories[1].sections[0].items[1], 'en')['@graph'][2] as { itemListElement: { name: string }[] }).itemListElement;
    expect(crumbs.map((c) => c.name)).toEqual(['La Soul', 'Menu', 'Food', 'La Soul Burger']);
  });
});

describe('the prerendered pages', () => {
  it('say who they are in <head>, safely', () => {
    const head = headTags({
      path: sitePath('bs'), locale: 'bs', venue, title: 'A <b> & "c"', description: 'd',
      alternates: { en: '/', bs: '/bs/', 'x-default': '/' }, jsonLd: { x: '</script><script>alert(1)' },
    });
    expect(head).toContain(`<link rel="canonical" href="${SITE_URL}/bs/" />`);
    expect(head).toContain(`<link rel="alternate" hreflang="x-default" href="${SITE_URL}/" />`);
    expect(head).toContain('<title>A &lt;b&gt; &amp; &quot;c&quot;</title>');
    expect(head).not.toContain('</script><script>alert');
    expect(jsonForScript('<')).toBe('"\\u003c"');
    expect(head).toContain('<meta property="og:locale" content="bs_BA" />');
  });

  it('carry the page’s real words, which the app then replaces', () => {
    const template = '<!doctype html><html lang="en"><head><title>x</title><meta name="description" content="x" /><meta property="og:title" content="x" /></head><body><div id="root"></div></body></html>';
    const html = renderPage(template, '<title>T</title>', homeBody(venue, 'ar'), 'ar');
    expect(html).toContain('<html lang="ar" dir="rtl">');
    expect(html.match(/<title>/g)).toHaveLength(1);
    expect(html).not.toContain('content="x"');
    expect(html).toContain('<div id="root"><div data-prerender>');
    expect(html).toContain('<h1>برغر وكيك، مُحضَّرة بكل شغف.</h1>');
    expect(html).toContain(".js [data-prerender]{display:none}");
    const menuHtml = menuBody(venue, menu, 'en');
    expect(menuHtml).toContain('<a href="/menu/lasoul/dish/la-soul-burger/">La Soul Burger</a></strong> — 15.50 KM');
    expect(dishPath('lasoul', menu.categories[0].sections[0].items[0])).toBe('/menu/lasoul/dish/espresso/');
  });

  it('come with robots.txt, a sitemap, and llms.txt for answer engines', () => {
    const robots = robotsTxt();
    for (const bot of ['GPTBot', 'ClaudeBot', 'PerplexityBot', 'Google-Extended']) expect(robots).toContain(`User-agent: ${bot}\nAllow: /`);
    expect(robots).toContain('Disallow: /admin');
    expect(robots).toContain('Disallow: /kitchen');
    expect(robots).toContain(`Sitemap: ${SITE_URL}/sitemap.xml`);

    const sitemap = sitemapXml([{ path: '/', priority: 1, alternates: { bs: '/bs/' }, images: ['/site/a.webp'] }], '2026-10-25');
    expect(sitemap).toContain(`<loc>${SITE_URL}/</loc>`);
    expect(sitemap).toContain(`hreflang="bs" href="${SITE_URL}/bs/"`);
    expect(sitemap).toContain(`<image:image><image:loc>${SITE_URL}/site/a.webp</image:loc></image:image>`);

    const llms = llmsTxt(venue, menu);
    expect(llms).toMatch(/^# La Soul/);
    expect(llms).toContain('everything is halal');
    expect(llms).toContain('Butmirska cesta 16A | 16B');
    expect(llms).toContain(`(${SITE_URL}/menu/lasoul/food/): Burgers`);
    expect(llmsFullTxt(venue, menu)).toContain(`[La Soul Burger](${SITE_URL}/menu/lasoul/dish/la-soul-burger/) / برجر La Soul — 15.50 KM. Beef & cheddar`);
  });
});

describe('Vera Italia on its own site (veraitalia.net)', () => {
  const rules = (text: string) => text.split('\n').filter((l) => l && !l.startsWith('#')).map((l) => l.split(/\s+/));

  it('sends its old address to its root and La Soul’s menu to La Soul’s site, and serves the app for the rest', () => {
    const own = rules(ownSiteRedirects('veraitalia', 'https://lasoul.net'));
    expect(own).toEqual([
      ['/veraitalia', '/', '301!'],
      ['/veraitalia/*', '/', '301!'],
      ['/menu/lasoul', 'https://lasoul.net/menu/lasoul/', '301!'],
      ['/menu/lasoul/*', 'https://lasoul.net/menu/lasoul/:splat', '301!'],
      // Last: every rule above must win over the app's catch-all.
      ['/*', '/index.html', '200'],
    ]);
  });

  it('is where La Soul’s site forwards its pages once it is up, never to itself', () => {
    const forward = rules(forwardToOwnSite('veraitalia', 'https://veraitalia.net'));
    expect(forward).toEqual([
      ['/veraitalia', 'https://veraitalia.net/', '301!'],
      ['/veraitalia/*', 'https://veraitalia.net/', '301!'],
      ['/menu/veraitalia', 'https://veraitalia.net/menu/veraitalia/', '301!'],
      ['/menu/veraitalia/*', 'https://veraitalia.net/menu/veraitalia/:splat', '301!'],
    ]);
    // Nothing of La Soul's own is touched.
    expect(forward.some(([from]) => /lasoul|^\/\*$|^\/$/.test(from))).toBe(false);
  });
});
