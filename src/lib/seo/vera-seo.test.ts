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
import { dishMeta } from '../../components/vera/copy';

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
    expect(veraFaq(menu, 'bs').find(({ q }) => q === 'Ima li Vera Italia vegetarijanskih jela?')?.a).toContain('vegetarijanska');
    expect(veraFaq(menu, 'ar').find(({ q }) => q === 'هل البيتزا في Vera Italia نابوليتانية؟')?.a).toContain('نابوليتانية');
  });

  it('answer what people ask about Italian food in Sarajevo, in each language', () => {
    const en = veraFaq(menu, 'en');
    expect(en[0].a).toMatch(/^Vera Italia is an Italian restaurant in Sarajevo: /);
    expect(en[1].q).toBe('What sets Vera Italia apart from other Italian restaurants in Sarajevo?');
    expect(en.find(({ q }) => q === 'Where can I eat Neapolitan pizza in Sarajevo?')?.a)
      .toBe(`At Vera Italia, an Italian restaurant in Sarajevo: ${pizzas.length} Neapolitan pizzas, 12–25 KM, each baked in its dome oven — among them Truffle Pizza, Burrata Pizza and Margherita.`);
    expect(veraFaq(menu, 'bs').map(({ q }) => q)).toEqual(expect.arrayContaining([
      'Gdje u Sarajevu jesti napolitansku pizzu?', 'Po čemu se Vera Italia razlikuje od drugih italijanskih restorana u Sarajevu?',
    ]));
    expect(veraFaq(menu, 'ar').map(({ q }) => q)).toContain('أين يمكنني تناول البيتزا النابوليتانية في سراييفو؟');
  });

  it('claim nothing of La Soul’s', () => {
    const everything = [
      ...LOCALES.flatMap((l) => veraFaq(menu, l).flatMap(({ q, a }) => [q, a])),
      ...veraPages(menu).flatMap((p) => [p.body, JSON.stringify(p.head)]),
      veraLlms(menu).full,
    ].join('\n');
    expect(everything).not.toMatch(/halal|burger|La Soul|Butmirska/i);
  });

  it('say where by the city until the street is given, and when and how to call only once the owner has said', () => {
    const faq = veraFaq(menu, 'en');
    expect(faq.find(({ q }) => q === 'Where is Vera Italia?')?.a).toBe('In Sarajevo, Bosnia and Herzegovina.');
    expect(veraFaq(menu, 'bs').find(({ q }) => q === 'Gdje se nalazi Vera Italia?')?.a).toBe('U Sarajevu, Bosna i Hercegovina.');
    expect(faq.map(({ q }) => q)).not.toContain('When is Vera Italia open?');
    const restaurant = typed(veraSiteGraph(menu, 'en'), 'Restaurant');
    expect(restaurant.address).toEqual({ '@type': 'PostalAddress', addressLocality: 'Sarajevo', addressCountry: 'BA' });
    expect(restaurant).not.toHaveProperty('telephone');
    expect(restaurant).not.toHaveProperty('openingHoursSpecification');
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
    expect(faq.find(({ q }) => q === 'Where is Vera Italia?')?.a).toBe('Ulica 1, Sarajevo, Bosnia and Herzegovina.');
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

  it('is in Sarajevo — the Sarajevo on Wikidata — in every language', () => {
    for (const locale of LOCALES) {
      const restaurant = typed(veraSiteGraph(menu, locale), 'Restaurant');
      expect(restaurant.areaServed).toEqual({ '@type': 'City', name: 'Sarajevo', sameAs: 'https://www.wikidata.org/wiki/Q11194' });
      expect(restaurant.address).toMatchObject({ addressLocality: 'Sarajevo', addressCountry: 'BA' });
    }
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
    expect(dish.head.title).toBe(`Truffle Pizza — ${km(25)} · Vera Italia, Sarajevo`);
    expect(dish.head.description).toMatch(/^Pizza Napoletana at Vera Italia, an Italian restaurant in Sarajevo, 25 KM\. White cream/);
    const item = graphNodes(dish.head.jsonLd).find((n) => n['@type'] === 'MenuItem') as { offers: { price: string; priceCurrency: string } };
    expect(item.offers).toEqual({ '@type': 'Offer', price: '25.00', priceCurrency: 'BAM' });
    const notLive = !VENUES.veraitalia.live;
    for (const p of pages.filter((x) => x.path.startsWith('/menu/'))) {
      expect(p.head.noindex).toBe(notLive);
      expect(p.sitemap === null).toBe(notLive);
    }
    expect(pages.find((p) => p.path === '/veraitalia/')?.head.noindex).toBeFalsy();
  });

  it('give a dish the title and description the app shows while that dish is open from its address', () => {
    for (const c of menu.categories) {
      for (const i of c.sections.flatMap((s) => s.items)) {
        const page = pages.find((p) => p.path === `/menu/veraitalia/dish/${i.slug}/`)!;
        expect(dishMeta(c.names.en, i.names.en, i.price, i.descriptions.en, 'en')).toEqual({ title: page.head.title, description: page.head.description });
      }
    }
    // In the guest's language in the app: Bosnian prices with a decimal comma.
    expect(dishMeta('Antipasti', 'Burrata', 10.5, 'Kremasta', 'bs')).toEqual({
      title: 'Burrata — 10,50 KM · Vera Italia, Sarajevo',
      description: 'Antipasti — Vera Italia, italijanski restoran u Sarajevu, 10,50 KM. Kremasta.',
    });
    expect(dishMeta('Antipasti', 'Burrata', 12, null, 'ar').title).toBe('Burrata — 12 KM · Vera Italia، سراييفو');
  });

  it('name other languages only on its website, where each has an address of its own', () => {
    // The menu, its courses and its dishes are one address in every language
    // (the guest picks one in the app), so they name none.
    for (const p of pages.filter((x) => x.path.startsWith('/menu/'))) expect(p.head.alternates).toBeUndefined();
  });

  it('say "Italian restaurant in Sarajevo" in their titles, and no longer "Opening soon"', () => {
    const site = pages.find((p) => p.path === '/veraitalia/')!;
    expect(site.head.title).toBe('Vera Italia — Italian Restaurant & Pizza in Sarajevo');
    expect(site.body).toContain('<p>Italian restaurant · Sarajevo</p>');
    expect(site.body).toContain('Sarajevo, Bosnia and Herzegovina. Our street address and opening hours will be here very soon.');
    expect(site.body).not.toContain('Opening soon');
    expect(pages.find((p) => p.path === '/menu/veraitalia/')?.head.title).toBe('Menu — Vera Italia, Italian Restaurant in Sarajevo');
    expect(pages.find((p) => p.path === '/menu/veraitalia/pizza-napoletana/')?.head.title).toBe('Pizza Napoletana in Sarajevo — Vera Italia');
  });

  it('give answer engines every dish, with its price and page', () => {
    const { short, full } = veraLlms(menu);
    expect(short).toMatch(/^# Vera Italia\n/);
    expect(short.includes('- Status: opening soon')).toBe(!VENUES.veraitalia.live);
    expect(short).toContain('- What: an Italian restaurant in Sarajevo, Bosnia and Herzegovina — ');
    expect(short).toContain('- Where: Sarajevo, Bosnia and Herzegovina (street address to be announced)');
    expect(short).toContain('### What sets Vera Italia apart from other Italian restaurants in Sarajevo?');
    for (const r of rows) expect(full).toContain(`[${r.name}](`);
    expect(full).toContain('Truffle Pizza](https://');
    expect(full).toContain('— 25 KM');
  });
});
