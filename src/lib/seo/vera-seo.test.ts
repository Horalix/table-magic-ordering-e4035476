/**
 * @vitest-environment node
 *
 * What search engines and answer engines are told about Vera Italia is true
 * to its menu, complete in three languages, claims nothing of La Soul's, and
 * says nothing the owner has not given yet.
 */
import { afterEach, describe, expect, it } from 'vitest';
import VERA_MENU from '../../../scripts/vera-italia/menu.json';
import { VENUES } from '../venues';
import { assignDishSlugs } from './menu-data';
import { LOCALES } from './structured-data';
import { km, veraFaq, veraLlms, veraPages, veraPriceRange, veraSeoMenu, veraSiteGraph } from './vera-seo';

const menu = veraSeoMenu();
const rows = (VERA_MENU.categories as { sections: { name: string; items: { id: string; name: string; price: number; dietary_tags?: string[] }[] }[] }[])
  .flatMap((c) => c.sections.flatMap((s) => s.items.map((i) => ({ ...i, section: s.name }))));
const dishes = rows.filter((r) => r.section !== 'Extras');
const pizzas = (VERA_MENU.categories as { name: string; sections: { items: unknown[] }[] }[])
  .find((c) => c.name === 'Pizza Napoletana')!.sections.flatMap((s) => s.items);

const graphNodes = (g: unknown) => (g as { '@graph': Record<string, unknown>[] })['@graph'];
const typed = (g: unknown, type: string) => graphNodes(g).find((n) => n['@type'] === type) as Record<string, unknown>;

describe('Vera Italia’s questions and answers', () => {
  it('are answered from its menu, in all three languages', () => {
    const en = veraFaq(menu, 'en').map(({ a }) => a).join('\n');
    expect(en).toContain(`Its menu has ${dishes.length} dishes.`);
    expect(en).toContain(`There are ${pizzas.length} Neapolitan pizzas, 12–25 KM`);
    expect(en).toContain(`${dishes.filter((d) => d.dietary_tags?.includes('vegetarian')).length} of its ${dishes.length} dishes are vegetarian`);
    expect(en).toContain('Truffle Pizza (freshly grated truffle, from the oven)');
    for (const locale of LOCALES) {
      const faq = veraFaq(menu, locale);
      expect(faq.length).toBe(veraFaq(menu, 'en').length);
      for (const { q, a } of faq) {
        expect(q.length).toBeGreaterThan(5);
        expect(a).not.toMatch(/undefined|NaN|\{\w+\}/);
      }
    }
    expect(veraFaq(menu, 'bs')[2].a).toContain('vegetarijanska');
    expect(veraFaq(menu, 'ar')[1].a).toContain('نابوليتانية');
  });

  it('claim nothing of La Soul’s', () => {
    const everything = [
      ...LOCALES.flatMap((l) => veraFaq(menu, l).flatMap(({ q, a }) => [q, a])),
      ...veraPages(menu).flatMap((p) => [p.body, JSON.stringify(p.head)]),
      veraLlms(menu).full,
    ].join('\n');
    expect(everything).not.toMatch(/halal|burger|La Soul|Butmirska/i);
  });

  it('ask where, when and how to call only once the owner has said', () => {
    expect(veraFaq(menu, 'en').map(({ q }) => q)).not.toContain('Where is Vera Italia?');
    expect(typed(veraSiteGraph(menu, 'en'), 'Restaurant')).not.toHaveProperty('address');
  });
});

describe('Vera Italia’s facts, once given', () => {
  const v = VENUES.veraitalia;
  const before = { ...v };
  afterEach(() => { Object.assign(v, before); });

  it('appear in the answers and the structured data', () => {
    Object.assign(v, {
      address: 'Ulica 1', city: 'Sarajevo', country: 'BA', phone: '+387 33 000 000', phoneHref: '+38733000000',
      hours: [{ days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'], opens: '12:00', closes: '23:00' }],
    });
    const faq = veraFaq(menu, 'en');
    expect(faq.find(({ q }) => q === 'Where is Vera Italia?')?.a).toBe('Ulica 1, Sarajevo.');
    expect(faq.find(({ q }) => q === 'When is Vera Italia open?')?.a).toBe('Every day, 12:00–23:00.');
    expect(veraFaq(menu, 'bs').find(({ q }) => q === 'Kada radi Vera Italia?')?.a).toBe('Svaki dan, 12:00–23:00.');
    const restaurant = typed(veraSiteGraph(menu, 'en'), 'Restaurant');
    expect(restaurant).toMatchObject({ telephone: '+38733000000', address: { streetAddress: 'Ulica 1', addressLocality: 'Sarajevo', addressCountry: 'BA' } });
    expect(restaurant.openingHoursSpecification).toHaveLength(1);
  });
});

describe('Vera Italia’s structured data', () => {
  it('is an Italian restaurant with its menu, prices in BAM and its FAQ', () => {
    const graph = veraSiteGraph(menu, 'en');
    const restaurant = typed(graph, 'Restaurant');
    expect(restaurant.servesCuisine).toContain('Italian');
    expect(restaurant.priceRange).toBe(veraPriceRange(menu));
    expect(restaurant.priceRange).toBe('7–64 KM');
    expect(restaurant.currenciesAccepted).toBe('BAM');
    expect(String(restaurant.hasMenu)).toMatch(/\/menu\/veraitalia\/$/);
    expect((typed(graph, 'FAQPage').mainEntity as unknown[]).length).toBe(veraFaq(menu, 'en').length);
  });
});

describe('Vera Italia’s pages', () => {
  const pages = veraPages(menu);

  it('are its website, its menu, four courses and one page per dish, each address once', () => {
    const paths = pages.map((p) => p.path);
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths.filter((p) => p.includes('/dish/'))).toHaveLength(rows.length);
    // The same addresses the app's deep link reads (src/pages/DishLink.tsx).
    const slugs = assignDishSlugs(rows);
    for (const r of rows) expect(paths).toContain(`/menu/veraitalia/dish/${slugs.get(r.id)}/`);
  });

  it('price every dish in BAM, and list the menu in search once it opens', () => {
    const dish = pages.find((p) => p.path === '/menu/veraitalia/dish/truffle-pizza/')!;
    expect(dish.head.title).toBe(`Truffle Pizza — ${km(25)} · Vera Italia`);
    const item = graphNodes(dish.head.jsonLd).find((n) => n['@type'] === 'MenuItem') as { offers: { price: string; priceCurrency: string } };
    expect(item.offers).toEqual({ '@type': 'Offer', price: '25.00', priceCurrency: 'BAM' });
    const notLive = !VENUES.veraitalia.live;
    for (const p of pages.filter((x) => x.path.startsWith('/menu/'))) {
      expect(p.head.noindex).toBe(notLive);
      expect(p.sitemap === null).toBe(notLive);
    }
    expect(pages.find((p) => p.path === '/veraitalia/')?.head.noindex).toBeFalsy();
  });

  it('give answer engines every dish, with its price and page', () => {
    const { short, full } = veraLlms(menu);
    expect(short).toMatch(/^# Vera Italia\n/);
    expect(short.includes('- Status: opening soon')).toBe(!VENUES.veraitalia.live);
    for (const r of rows) expect(full).toContain(`[${r.name}](`);
    expect(full).toContain('Truffle Pizza](https://');
    expect(full).toContain('— 25 KM');
  });
});
