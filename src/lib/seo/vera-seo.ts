/**
 * What search engines, link previews and AI answer engines are told about
 * Vera Italia: its website in three languages, its menu, every dish.
 *
 * Built only from what is real — its menu (scripts/vera-italia/menu.json),
 * its own words (src/components/vera/copy.ts) and the facts in
 * src/lib/venues.ts. A fact the owner has not given yet (the address, the
 * hours, the phone, its profiles) is left out everywhere, and appears
 * everywhere — structured data, pages, FAQ, llms.txt — the day it is filled
 * in. Nothing of La Soul's is claimed for it (no "halal", no "burgers").
 *
 * The build writes these pages (scripts/seo-prerender.ts); the website
 * (src/pages/vera/VeraSite.tsx) puts the same structured data on the page.
 * Relative imports only: the build imports this module outside the app.
 */
import type { Locale } from '../i18n';
import { COURSES, PLACE, SITE, VERA, clip, courseTitle, dishMeta, km } from '../../components/vera/copy';
import VERA_MENU from '../../../scripts/vera-italia/menu.json';
import IMAGE_MANIFEST from '../image-manifest.json';
import { HOME_VENUE } from '../home-venue';
import { EVERY_DAY, VENUES, menuPath, type Venue } from '../venues';
import { buildSeoMenu, type SeoMenu, type SeoMenuCategory, type SeoMenuItem } from './menu-data';
import { absoluteUrl } from './site-url';
import { escapeHtml, type PageHead, type SitemapEntry } from './static-pages';
import { categoryPath, dishPath, LOCALES } from './structured-data';

const SLUG = 'veraitalia';
const vera = (): Venue => VENUES[SLUG];
const ON_OWN_SITE = HOME_VENUE === SLUG;

export const VERA_OG_IMAGE = '/site/vera/og.jpg';
const ROOM_IMAGES = ['/site/vera/room-2-1600.webp', '/site/vera/room-1-1600.webp', '/site/vera/room-3-1600.webp'];
const LOGO = '/brand/vera/icon-512.png';
/** Which Sarajevo: its Wikidata entry, for engines that link a restaurant to its city. */
const WIKIDATA_CITY: Record<string, string> = { Sarajevo: 'https://www.wikidata.org/wiki/Q11194' };
const upper = (s: string) => s.replace(/^./, (c) => c.toUpperCase());

// ---- addresses --------------------------------------------------------------

/** Its website in a language: /, /bs/, /ar/ on its own site; /veraitalia/ (English) on La Soul's until then. */
export function veraSitePath(locale: Locale): string {
  if (!ON_OWN_SITE) return `/${SLUG}/`;
  return locale === 'en' ? '/' : `/${locale}/`;
}

/** hreflang for its website: the three languages on its own site, none on La Soul's (one page there). */
export function veraSiteAlternates(): Record<string, string> | undefined {
  if (!ON_OWN_SITE) return undefined;
  return { ...Object.fromEntries(LOCALES.map((l) => [l, veraSitePath(l)])), 'x-default': veraSitePath('en') };
}

const restaurantId = () => absoluteUrl(`${veraSitePath('en')}#restaurant`);
const websiteId = () => absoluteUrl(`${veraSitePath('en')}#website`);
const menuUrl = () => absoluteUrl(menuPath(SLUG));
const courseUrl = (c: SeoMenuCategory) => absoluteUrl(categoryPath(SLUG, c.slug));
const dishUrl = (i: SeoMenuItem) => absoluteUrl(dishPath(SLUG, i));

// ---- the menu ---------------------------------------------------------------

type JsonItem = {
  id: string; name: string; name_bs: string; name_ar: string; price: number;
  description?: string; description_bs?: string; description_ar?: string;
  allergens?: string[]; dietary_tags?: string[];
  featured_rank?: number; featured_note?: string; featured_note_bs?: string; featured_note_ar?: string;
};
type JsonSection = { id: string; sort_order: number; name: string; name_bs: string; name_ar: string; items: JsonItem[] };
type JsonCourse = Omit<JsonSection, 'items'> & { sections: JsonSection[] };
const COURSE_ROWS = VERA_MENU.categories as JsonCourse[];
const ITEM_ROWS = COURSE_ROWS.flatMap((c) => c.sections.flatMap((s) => s.items));

/** The photo a page shows for a dish: the same versioned 768px file the app uses (scripts/fetch-images.mjs). */
const manifest = IMAGE_MANIFEST as Record<string, { widths?: number[]; v?: string }>;
export function veraImage(id: string): string | null {
  const widths = manifest[id]?.widths;
  if (!widths?.length) return null;
  const v = manifest[id]?.v;
  return `/menu/${id}/${widths.includes(768) ? 768 : widths[widths.length - 1]}.webp${v ? `?v=${v}` : ''}`;
}

/** Its menu, grouped as La Soul's is for its pages (src/lib/seo/menu-data.ts): the same dish addresses as the app's. */
export function veraSeoMenu(imageFor: (id: string) => string | null = veraImage): SeoMenu {
  return buildSeoMenu(
    COURSE_ROWS.map(({ id, name, name_bs, name_ar, sort_order }) => ({ id, name, name_bs, name_ar, sort_order })),
    COURSE_ROWS.flatMap((c) => c.sections.map(({ id, name, name_bs, name_ar, sort_order }) => ({ id, name, name_bs, name_ar, sort_order, category_id: c.id }))),
    COURSE_ROWS.flatMap((c) => c.sections.flatMap((s) => s.items.map((i, n) => ({
      id: i.id, subcategory_id: s.id, name: i.name, name_bs: i.name_bs, name_ar: i.name_ar,
      description: i.description ?? null, description_bs: i.description_bs ?? null, description_ar: i.description_ar ?? null,
      price: i.price, sort_order: n, allergens: i.allergens ?? [], dietary_tags: i.dietary_tags ?? [],
    })))),
    imageFor,
  );
}

const itemsOf = (c: SeoMenuCategory | undefined, withExtras = true) =>
  (c?.sections ?? []).filter((s) => withExtras || s.names.en !== 'Extras').flatMap((s) => s.items);
const allItems = (m: SeoMenu) => m.categories.flatMap((c) => itemsOf(c));
/** The dishes, without the add-ons (grilled chicken for a pasta): what "dishes on the menu" counts. */
const dishesOf = (m: SeoMenu) => m.categories.flatMap((c) => itemsOf(c, false));
const course = (m: SeoMenu, en: string) => m.categories.find((c) => c.names.en === en);
const isVegetarian = (i: SeoMenuItem) => i.dietaryTags.includes('vegetarian');

/** "12 KM", "10.50 KM" (10,50 in Bosnian): components/vera/copy.ts, where the app reads it too. */
export { km };
const range = (list: SeoMenuItem[], locale: Locale) => {
  if (!list.length) return '';
  const prices = list.map((i) => i.price);
  const [lo, hi] = [Math.min(...prices), Math.max(...prices)];
  return lo === hi ? km(lo, locale) : `${km(lo, locale).replace(' KM', '')}–${km(hi, locale)}`;
};
const join = (parts: string[], locale: Locale) => {
  if (parts.length < 2) return parts.join('');
  const and = { en: ' and ', bs: ' i ', ar: ' و' }[locale];
  return `${parts.slice(0, -1).join(locale === 'ar' ? '، ' : ', ')}${and}${parts[parts.length - 1]}`;
};

/** The three dishes the owner features, with their line. */
function signatures(m: SeoMenu) {
  const byId = new Map(allItems(m).map((i) => [i.id, i]));
  return ITEM_ROWS.filter((r) => r.featured_rank).sort((a, b) => (a.featured_rank ?? 0) - (b.featured_rank ?? 0))
    .map((r) => ({ item: byId.get(r.id), note: { en: r.featured_note ?? '', bs: r.featured_note_bs || r.featured_note || '', ar: r.featured_note_ar || r.featured_note || '' } }))
    .filter((s): s is { item: SeoMenuItem; note: Record<Locale, string> } => !!s.item);
}

/** Every price it charges for a dish, from the cheapest main to the dearest (add-ons left out). */
export function veraPriceRange(m: SeoMenu): string {
  return range(m.categories.flatMap((c) => itemsOf(c, false)), 'en');
}

// ---- questions and answers ----------------------------------------------------

export interface Faq { q: string; a: string }

/**
 * What people ask about a restaurant before they go, answered from its menu
 * and its facts. Where, when and how to call are asked only once known.
 */
export function veraFaq(m: SeoMenu, locale: Locale): Faq[] {
  const v = vera();
  const all = dishesOf(m);
  const pizzas = itemsOf(course(m, 'Pizza Napoletana'));
  const pasta = itemsOf(course(m, 'Pasta & Risotto'), false);
  const antipasti = itemsOf(course(m, 'Antipasti & Insalate'));
  const carne = itemsOf(course(m, 'Carne'));
  const veg = all.filter(isVegetarian);
  // One vegetarian dish from each course, by name.
  const vegExamples = m.categories.map((c) => itemsOf(c, false).find(isVegetarian)).filter((i): i is SeoMenuItem => !!i).map((i) => i.names[locale]);
  const sig = signatures(m).map(({ item, note }) => `${item.names[locale]} (${note[locale].replace(/^./, (ch) => (locale === 'ar' ? ch : ch.toLowerCase()))})`);
  // Three pizzas by name, the house's own first, in the owner's order.
  const sigItems = signatures(m).map(({ item }) => item);
  const pizzaNames = [...sigItems.filter((i) => pizzas.includes(i)), ...pizzas.filter((i) => !sigItems.includes(i))].slice(0, 3).map((i) => i.names[locale]);
  const hours = v.hours?.[0];
  const everyDay = hours && EVERY_DAY.every((d) => hours.days.includes(d));
  // The street once the owner gives it; until then the city and the country.
  const comma = locale === 'ar' ? '، ' : ', ';
  const whereAnswer = v.address
    ? `${v.address}${comma}${PLACE.city[locale]}${comma}${PLACE.country[locale]}.`
    : `${upper(PLACE.inCity[locale])}${comma}${PLACE.country[locale]}.`;

  type Asked = 'what' | 'apart' | 'pizza' | 'pizzaIn' | 'veg' | 'price' | 'order' | 'table' | 'where' | 'when' | 'call';
  const answers: Record<Locale, Record<Asked, [string, string]>> = {
    en: {
      what: ['What is Vera Italia?', `${SITE.seoDescription.en} Its menu has ${all.length} dishes.`],
      apart: ['What sets Vera Italia apart from other Italian restaurants in Sarajevo?', SITE.apart.en],
      pizza: ['Is the pizza at Vera Italia Neapolitan?', `Yes. There are ${pizzas.length} Neapolitan pizzas, ${range(pizzas, 'en')}, each baked in the dome oven at the heart of the room: a puffy, leopard-spotted crust, soft in the middle.`],
      pizzaIn: ['Where can I eat Neapolitan pizza in Sarajevo?', `At Vera Italia, an Italian restaurant in Sarajevo: ${pizzas.length} Neapolitan pizzas, ${range(pizzas, 'en')}, each baked in its dome oven — among them ${join(pizzaNames, 'en')}.`],
      veg: ['Does Vera Italia have vegetarian dishes?', `Yes: ${veg.length} of its ${all.length} dishes are vegetarian, among them ${join(vegExamples, 'en')}.`],
      price: ['How much does a meal at Vera Italia cost?', `${[
        pizzas.length && `pizzas ${range(pizzas, 'en')}`, pasta.length && `pasta and risotto ${range(pasta, 'en')}`,
        antipasti.length && `antipasti and salads ${range(antipasti, 'en')}`, carne.length && `the ${carne[0].names.en.toLowerCase()} ${range(carne, 'en')}`,
      ].filter(Boolean).join(', ').replace(/^./, (c) => c.toUpperCase())}. Prices are in convertible marks (KM, BAM).`],
      order: ['What should I order at Vera Italia?', `The house specialities: ${join(sig, 'en')}.`],
      table: ['Can I order from my table at Vera Italia?', 'Yes. Scan the code on your table and order from the menu on your phone, in English, Bosnian or Arabic; the order goes straight to the kitchen, and you pay your waiter whenever you like.'],
      where: ['Where is Vera Italia?', whereAnswer],
      when: ['When is Vera Italia open?', hours ? `${everyDay ? 'Every day' : hours.days.join(', ')}, ${hours.opens}–${hours.closes}.` : ''],
      call: ['How do I contact Vera Italia?', `By phone: ${v.phone}.`],
    },
    bs: {
      what: ['Šta je Vera Italia?', `${SITE.seoDescription.bs} Meni ima ${all.length} jela.`],
      apart: ['Po čemu se Vera Italia razlikuje od drugih italijanskih restorana u Sarajevu?', SITE.apart.bs],
      pizza: ['Je li pizza u Vera Italia napolitanska?', `Da. Na meniju je ${pizzas.length} napolitanskih pizza, ${range(pizzas, 'bs')}, a svaka se peče u kupolastoj peći u srcu restorana: prozračan rub s tamnim mrljama, mekana sredina.`],
      pizzaIn: ['Gdje u Sarajevu jesti napolitansku pizzu?', `U Vera Italia, italijanskom restoranu u Sarajevu: ${pizzas.length} napolitanskih pizza, ${range(pizzas, 'bs')}, svaka pečena u kupolastoj peći — među njima ${join(pizzaNames, 'bs')}.`],
      veg: ['Ima li Vera Italia vegetarijanskih jela?', `Ima: ${veg.length} od ${all.length} jela su vegetarijanska, među njima ${join(vegExamples, 'bs')}.`],
      price: ['Koliko košta obrok u Vera Italia?', `${[
        pizzas.length && `pizze ${range(pizzas, 'bs')}`, pasta.length && `pasta i rižoto ${range(pasta, 'bs')}`,
        antipasti.length && `predjela i salate ${range(antipasti, 'bs')}`, carne.length && `${carne[0].names.bs} ${range(carne, 'bs')}`,
      ].filter(Boolean).join(', ').replace(/^./, (c) => c.toUpperCase())}. Cijene su u konvertibilnim markama (KM).`],
      order: ['Šta naručiti u Vera Italia?', `Specijaliteti kuće: ${join(sig, 'bs')}.`],
      table: ['Mogu li naručiti sa stola u Vera Italia?', 'Možete. Skenirajte kod na stolu i naručite iz menija na telefonu, na bosanskom, engleskom ili arapskom; narudžba ide pravo u kuhinju, a konobaru plaćate kad god želite.'],
      where: ['Gdje se nalazi Vera Italia?', whereAnswer],
      when: ['Kada radi Vera Italia?', hours ? `${everyDay ? 'Svaki dan' : hours.days.join(', ')}, ${hours.opens}–${hours.closes}.` : ''],
      call: ['Kako kontaktirati Vera Italia?', `Telefonom: ${v.phone}.`],
    },
    ar: {
      what: ['ما هو Vera Italia؟', `${SITE.seoDescription.ar} تضم القائمة ${all.length} طبقًا.`],
      apart: ['ما الذي يميز Vera Italia عن المطاعم الإيطالية الأخرى في سراييفو؟', SITE.apart.ar],
      pizza: ['هل البيتزا في Vera Italia نابوليتانية؟', `نعم. في القائمة ${pizzas.length} أنواع من البيتزا النابوليتانية، ${range(pizzas, 'ar')}، تُخبز كل واحدة منها في الفرن ذي القبة في قلب المطعم: حافة منتفخة مبقّعة ووسط طري.`],
      pizzaIn: ['أين يمكنني تناول البيتزا النابوليتانية في سراييفو؟', `في Vera Italia، مطعم إيطالي في سراييفو: ${pizzas.length} أنواع من البيتزا النابوليتانية، ${range(pizzas, 'ar')}، تُخبز كل واحدة في الفرن ذي القبة — منها ${join(pizzaNames, 'ar')}.`],
      veg: ['هل توجد أطباق نباتية في Vera Italia؟', `نعم: ${veg.length} من أصل ${all.length} طبقًا نباتية، منها ${join(vegExamples, 'ar')}.`],
      price: ['كم تكلفة الوجبة في Vera Italia؟', `${[
        pizzas.length && `البيتزا ${range(pizzas, 'ar')}`, pasta.length && `الباستا والريزوتو ${range(pasta, 'ar')}`,
        antipasti.length && `المقبلات والسلطات ${range(antipasti, 'ar')}`, carne.length && `${carne[0].names.ar} ${range(carne, 'ar')}`,
      ].filter(Boolean).join('، ')}. الأسعار بالمارك البوسني القابل للتحويل (KM).`],
      order: ['ماذا أطلب في Vera Italia؟', `أطباق البيت المميزة: ${join(sig, 'ar')}.`],
      table: ['هل يمكنني الطلب من طاولتي في Vera Italia؟', 'نعم. امسح الرمز على طاولتك واطلب من القائمة على هاتفك بالعربية أو الإنجليزية أو البوسنية؛ يصل الطلب مباشرة إلى المطبخ، وتدفع للنادل متى شئت.'],
      where: ['أين يقع Vera Italia؟', whereAnswer],
      when: ['ما هي ساعات عمل Vera Italia؟', hours ? `${everyDay ? 'يوميًا' : hours.days.join('، ')}، ${hours.opens}–${hours.closes}.` : ''],
      call: ['كيف أتواصل مع Vera Italia؟', `بالهاتف: ${v.phone}.`],
    },
  };
  const t = answers[locale];

  // The questions that name the city are asked once it is known (src/lib/venues.ts).
  const pairs: [string, string][] = [t.what];
  if (v.city) pairs.push(t.apart);
  pairs.push(t.pizza);
  if (v.city && pizzas.length) pairs.push(t.pizzaIn);
  pairs.push(t.veg, t.price);
  if (sig.length) pairs.push(t.order);
  pairs.push(t.table);
  if (v.city) pairs.push(t.where);
  if (hours) pairs.push(t.when);
  if (v.phone) pairs.push(t.call);
  return pairs.filter(([, a]) => a).map(([q, a]) => ({ q, a }));
}

// ---- structured data ----------------------------------------------------------

/** The restaurant, with everything known for certain; what is not known yet is not said. */
export function veraRestaurantNode(m: SeoMenu, locale: Locale) {
  const v = vera();
  const sameAs = [v.instagram, v.facebook, v.mapsUrl].filter((x): x is string => !!x);
  const dishImages = signatures(m).map(({ item }) => item.image).filter((x): x is string => !!x);
  return {
    '@type': 'Restaurant',
    '@id': restaurantId(),
    name: v.name,
    ...(v.alternateNames.length ? { alternateName: v.alternateNames } : {}),
    description: SITE.seoDescription[locale],
    slogan: SITE.heroLine[locale],
    url: absoluteUrl(veraSitePath(locale)),
    image: [VERA_OG_IMAGE, ...ROOM_IMAGES, ...dishImages].map(absoluteUrl),
    logo: absoluteUrl(LOGO),
    servesCuisine: ['Italian', 'Neapolitan pizza', 'Pizza', 'Pasta', 'Risotto'],
    hasMenu: menuUrl(),
    priceRange: veraPriceRange(m),
    currenciesAccepted: 'BAM',
    availableLanguage: ['bs', 'en', 'ar'],
    ...(v.phoneHref ? { telephone: v.phoneHref } : {}),
    // The city as soon as it is known, the street once the owner gives it.
    ...(v.city ? {
      address: {
        '@type': 'PostalAddress',
        ...(v.address ? { streetAddress: v.address } : {}),
        addressLocality: v.city,
        ...(v.country ? { addressCountry: v.country } : {}),
      },
      areaServed: { '@type': 'City', name: v.city, ...(WIKIDATA_CITY[v.city] ? { sameAs: WIKIDATA_CITY[v.city] } : {}) },
    } : {}),
    ...(v.geo ? { geo: { '@type': 'GeoCoordinates', latitude: v.geo.lat, longitude: v.geo.lng } } : {}),
    ...(v.mapsUrl ? { hasMap: v.mapsUrl } : {}),
    ...(v.hours?.length ? {
      openingHoursSpecification: v.hours.map((h) => ({
        '@type': 'OpeningHoursSpecification', dayOfWeek: h.days.map((d) => `https://schema.org/${d}`), opens: h.opens, closes: h.closes,
      })),
    } : {}),
    ...(sameAs.length ? { sameAs } : {}),
  };
}

const menuItemNode = (i: SeoMenuItem) => ({
  '@type': 'MenuItem',
  '@id': `${dishUrl(i)}#dish`,
  name: i.names.en,
  url: dishUrl(i),
  ...(i.descriptions.en ? { description: i.descriptions.en } : {}),
  ...(i.image ? { image: absoluteUrl(i.image) } : {}),
  offers: { '@type': 'Offer', price: i.price.toFixed(2), priceCurrency: 'BAM' },
  ...(isVegetarian(i) ? { suitableForDiet: 'https://schema.org/VegetarianDiet' } : {}),
});

const courseNode = (c: SeoMenuCategory) => ({
  '@type': 'MenuSection',
  '@id': `${courseUrl(c)}#course`,
  name: c.names.en,
  url: courseUrl(c),
  ...(COURSES[c.names.en] ? { description: COURSES[c.names.en].line.en } : {}),
  hasMenuSection: c.sections.map((s) => ({ '@type': 'MenuSection', name: s.names.en, hasMenuItem: s.items.map(menuItemNode) })),
});

/** The menu as schema.org Menu → MenuSection → MenuItem, every dish priced in BAM with its own page. */
export function veraMenuNode(m: SeoMenu, only?: SeoMenuCategory) {
  return {
    '@type': 'Menu',
    '@id': `${menuUrl()}#menu`,
    name: only ? `Vera Italia — ${only.names.en}` : VERA.menuTitle.en,
    url: only ? courseUrl(only) : menuUrl(),
    inLanguage: ['en', 'bs', 'ar'],
    hasMenuSection: (only ? [only] : m.categories).map(courseNode),
  };
}

const breadcrumbs = (trail: { name: string; url: string }[]) => ({
  '@type': 'BreadcrumbList',
  itemListElement: trail.map((t, n) => ({ '@type': 'ListItem', position: n + 1, name: t.name, item: t.url })),
});
const trailHome = () => ({ name: 'Vera Italia', url: absoluteUrl(veraSitePath('en')) });
const trailMenu = () => ({ name: VERA.menu.en, url: menuUrl() });

/** Everything its website says about itself, in one language, as one @graph. */
export function veraSiteGraph(m: SeoMenu, locale: Locale) {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      veraRestaurantNode(m, locale),
      { '@type': 'WebSite', '@id': websiteId(), url: absoluteUrl(veraSitePath('en')), name: 'Vera Italia', inLanguage: locale, publisher: { '@id': restaurantId() } },
      {
        '@type': 'FAQPage',
        '@id': absoluteUrl(`${veraSitePath(locale)}#faq`),
        inLanguage: locale,
        mainEntity: veraFaq(m, locale).map(({ q, a }) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
      },
    ],
  };
}

// ---- the pages ------------------------------------------------------------------

export interface VeraPage {
  path: string;
  locale: Locale;
  head: PageHead;
  body: string;
  /** In the sitemap: its website always, the menu and dishes once it is open. */
  sitemap: SitemapEntry | null;
}

const h = escapeHtml;
const faqTitle: Record<Locale, string> = { en: 'Questions', bs: 'Pitanja', ar: 'أسئلة' };
const languageName: Record<Locale, string> = { en: 'English', bs: 'Bosanski', ar: 'العربية' };
const dishLine = (i: SeoMenuItem, withNames = true) => [
  `<a href="${h(dishPath(SLUG, i))}">${h(i.names.en)}</a>`,
  withNames && i.names.bs !== i.names.en ? ` / <span lang="bs">${h(i.names.bs)}</span>` : '',
  withNames && i.names.ar !== i.names.en ? ` / <span lang="ar" dir="rtl">${h(i.names.ar)}</span>` : '',
  ` — ${km(i.price)}`,
  i.descriptions.en ? `. ${h(i.descriptions.en)}` : '',
  isVegetarian(i) ? ' (vegetarian)' : '',
  i.allergens.length ? ` Allergens: ${h(i.allergens.join(', '))}.` : '',
].join('');
const courseBlock = (c: SeoMenuCategory, link: boolean) => [
  `<h2>${link ? `<a href="${h(categoryPath(SLUG, c.slug))}">${h(c.names.en)}</a>` : h(c.names.en)}</h2>`,
  COURSES[c.names.en] ? `<p>${h(COURSES[c.names.en].line.en)}</p>` : '',
  ...c.sections.map((s) => `<h3>${h(s.names.en)}</h3><ul>${s.items.map((i) => `<li>${dishLine(i)}</li>`).join('')}</ul>`),
].join('\n');

function siteBody(m: SeoMenu, locale: Locale): string {
  const v = vera();
  const pick = (c: Record<Locale, string>) => h(c[locale] ?? c.en);
  const facts = v.address
    ? `<address>${h(v.name)}<br />${h(v.address)}, ${pick(PLACE.city)}, ${pick(PLACE.country)}${v.phone ? `<br /><a href="tel:${h(v.phoneHref)}">${h(v.phone)}</a>` : ''}</address>`
    : v.city
      ? `<p>${pick(PLACE.city)}, ${pick(PLACE.country)}. ${pick(SITE.visitSoon)}</p>`
      : `<p>${pick(SITE.openingSoon)}. ${pick(SITE.visitSoon)}</p>`;
  return [
    `<h1>Vera Italia</h1>`,
    v.city ? `<p>${pick(SITE.place)}</p>` : '',
    `<p>${pick(SITE.heroLine)}</p>`,
    `<p>${pick(SITE.intro)} ${pick(SITE.introRoom)}</p>`,
    `<h2>${pick(SITE.signatures)}</h2>`,
    `<ul>${signatures(m).map(({ item, note }) => `<li><a href="${h(dishPath(SLUG, item))}">${h(item.names[locale])}</a> — ${h(note[locale])} — ${km(item.price, locale)}</li>`).join('')}</ul>`,
    `<h2>${pick(SITE.ovenTitle)}</h2><p>${pick(SITE.ovenBody)}</p>`,
    `<h2>${pick(SITE.menuTitle)}</h2>`,
    `<ul>${m.categories.map((c) => `<li><a href="${h(categoryPath(SLUG, c.slug))}">${h(c.names[locale])}</a>${COURSES[c.names.en] ? ` — ${pick(COURSES[c.names.en].line)}` : ''} (${range(itemsOf(c, false), locale)})</li>`).join('')}</ul>`,
    `<p><a href="${h(menuPath(SLUG))}">${pick(SITE.viewMenu)}</a></p>`,
    `<h2>${pick(SITE.roomTitle)}</h2><p>${pick(SITE.roomBody)}</p>`,
    `<section id="faq"><h2>${h(faqTitle[locale])}</h2>${veraFaq(m, locale).map(({ q, a }) => `<h3>${h(q)}</h3><p>${h(a)}</p>`).join('')}</section>`,
    `<h2>${pick(SITE.visit)}</h2>${facts}`,
    ON_OWN_SITE ? `<p>${LOCALES.map((l) => (l === locale ? `<strong>${languageName[l]}</strong>` : `<a href="${veraSitePath(l)}" hreflang="${l}" lang="${l}">${languageName[l]}</a>`)).join(' · ')}</p>` : '',
  ].filter(Boolean).join('\n');
}

/** Every page of Vera Italia's the build writes: its website, its menu, each course and each dish. */
export function veraPages(m: SeoMenu): VeraPage[] {
  const v = vera();
  const noindex = !v.live;
  const pages: VeraPage[] = [];
  const languages = ON_OWN_SITE ? LOCALES : (['en'] as Locale[]);

  for (const locale of languages) {
    const path = veraSitePath(locale);
    pages.push({
      path, locale,
      head: {
        path, locale, venue: v, image: VERA_OG_IMAGE, alternates: veraSiteAlternates(),
        title: SITE.seoTitle[locale], description: SITE.seoDescription[locale], jsonLd: veraSiteGraph(m, locale),
      },
      body: siteBody(m, locale),
      sitemap: locale === 'en'
        ? { path, priority: ON_OWN_SITE ? 1 : 0.8, alternates: veraSiteAlternates(), images: [VERA_OG_IMAGE, ...ROOM_IMAGES] }
        : { path, priority: 0.9, alternates: veraSiteAlternates() },
    });
  }

  const menu = menuPath(SLUG);
  const signature = signatures(m)[0]?.item;
  pages.push({
    path: menu, locale: 'en',
    head: {
      path: menu, locale: 'en', venue: v, image: signature?.image ?? VERA_OG_IMAGE, noindex,
      title: VERA.menuTitle.en, description: VERA.menuDescription.en,
      jsonLd: { '@context': 'https://schema.org', '@graph': [veraMenuNode(m), breadcrumbs([trailHome(), trailMenu()])] },
    },
    body: [`<h1>Vera Italia — ${h(VERA.menu.en)}</h1>`, `<p>${h(VERA.menuDescription.en)} Prices in KM (BAM).</p>`, ...m.categories.map((c) => courseBlock(c, true))].join('\n'),
    sitemap: noindex ? null : { path: menu, priority: 0.9 },
  });

  for (const c of m.categories) {
    const path = categoryPath(SLUG, c.slug);
    const line = COURSES[c.names.en]?.line.en;
    const cover = COURSES[c.names.en]?.cover;
    pages.push({
      path, locale: 'en',
      head: {
        path, locale: 'en', venue: v, image: (cover && veraImage(cover)) || VERA_OG_IMAGE, noindex,
        title: courseTitle(c.names.en, 'en'),
        description: clip(`${c.names.en} at Vera Italia, an Italian restaurant ${PLACE.inCity.en}${line ? `: ${line}` : ''}, ${range(itemsOf(c, false), 'en')}.`),
        jsonLd: { '@context': 'https://schema.org', '@graph': [veraMenuNode(m, c), breadcrumbs([trailHome(), trailMenu(), { name: c.names.en, url: courseUrl(c) }])] },
      },
      body: [`<h1>Vera Italia — ${h(c.names.en)}</h1>`, courseBlock(c, false), `<p><a href="${h(menu)}">${h(VERA.menuTitle.en)}</a></p>`].join('\n'),
      sitemap: noindex ? null : { path, priority: 0.8, images: cover && veraImage(cover) ? [veraImage(cover) as string] : [] },
    });
  }

  for (const c of m.categories) {
    for (const s of c.sections) {
      for (const i of s.items) {
        const path = dishPath(SLUG, i);
        pages.push({
          path, locale: 'en',
          head: {
            path, locale: 'en', venue: v, image: i.image ?? VERA_OG_IMAGE, noindex,
            // The same title and description the app shows while this dish is open from here.
            ...dishMeta(c.names.en, i.names.en, i.price, i.descriptions.en, 'en'),
            jsonLd: {
              '@context': 'https://schema.org',
              '@graph': [menuItemNode(i), breadcrumbs([trailHome(), trailMenu(), { name: c.names.en, url: courseUrl(c) }, { name: i.names.en, url: dishUrl(i) }])],
            },
          },
          body: [
            `<h1>${h(i.names.en)}</h1>`,
            i.names.bs !== i.names.en || i.names.ar !== i.names.en ? `<p><span lang="bs">${h(i.names.bs)}</span> · <span lang="ar" dir="rtl">${h(i.names.ar)}</span></p>` : '',
            `<p>${km(i.price)} · ${h(c.names.en)} · ${h(s.names.en)}${isVegetarian(i) ? ' · vegetarian' : ''}</p>`,
            ...LOCALES.map((l) => (i.descriptions[l] ? `<p lang="${l}"${l === 'ar' ? ' dir="rtl"' : ''}>${h(i.descriptions[l] as string)}</p>` : '')),
            i.allergens.length ? `<p>Allergens: ${h(i.allergens.join(', '))}</p>` : '',
            `<p><a href="${h(categoryPath(SLUG, c.slug))}">${h(c.names.en)}</a> · <a href="${h(menu)}">${h(VERA.menuTitle.en)}</a> · <a href="${h(veraSitePath('en'))}">Vera Italia</a></p>`,
          ].filter(Boolean).join('\n'),
          sitemap: noindex ? null : { path, priority: 0.6, images: i.image ? [i.image] : [] },
        });
      }
    }
  }
  return pages;
}

// ---- for AI answer engines -------------------------------------------------------

/** llms.txt (what to know, and where to read more) and llms-full.txt (that, plus every dish). */
export function veraLlms(m: SeoMenu): { short: string; full: string } {
  const v = vera();
  const all = dishesOf(m);
  const where = `${PLACE.city.en}, ${PLACE.country.en}`;
  const known = [
    `- What: an Italian restaurant${v.city ? ` in ${where}` : ''} — ${SITE.heroLine.en}`,
    v.city ? `- Known for: ${SITE.apart.en}` : '',
    `- Menu: ${all.length} dishes in ${m.categories.length} courses (${m.categories.map((c) => c.names.en).join(', ')}), in English, Bosnian and Arabic`,
    `- Prices: ${veraPriceRange(m)} (convertible marks, KM / BAM)`,
    `- Vegetarian: ${all.filter(isVegetarian).length} of ${all.length} dishes`,
    `- Ordering: from the table, by scanning the code on it; pay the waiter`,
    v.address ? `- Address: ${v.address}, ${where}` : v.city ? `- Where: ${where} (street address to be announced)` : '- Address: to be announced',
    v.hours?.length ? `- Hours: ${v.hours.map((x) => `${x.days.join(', ')} ${x.opens}–${x.closes}`).join('; ')}` : '- Hours: to be announced',
    v.phone ? `- Phone: ${v.phone}` : '',
    v.instagram ? `- Instagram: ${v.instagram}` : '',
    v.live ? '' : '- Status: opening soon',
  ].filter(Boolean);
  const head = [
    '# Vera Italia', '',
    `> ${SITE.seoDescription.en}`, '',
    ...known, '',
    '## Pages', '',
    `- [Vera Italia](${absoluteUrl(veraSitePath('en'))}): the restaurant, its signature dishes, the oven and the room` +
      (ON_OWN_SITE ? ` (also in [Bosnian](${absoluteUrl(veraSitePath('bs'))}) and [Arabic](${absoluteUrl(veraSitePath('ar'))}))` : ''),
    `- [The menu](${menuUrl()}): every dish with its price`,
    ...m.categories.map((c) => `- [${c.names.en}](${courseUrl(c)}): ${COURSES[c.names.en]?.line.en ?? ''}`.replace(/: $/, '')),
    '',
    '## Questions', '',
    ...veraFaq(m, 'en').flatMap(({ q, a }) => [`### ${q}`, '', a, '']),
  ];
  const short = [...head, ON_OWN_SITE ? `Every dish: ${absoluteUrl('/llms-full.txt')}` : '', ''].join('\n');
  const full = [
    ...head,
    '# Menu (prices in KM)', '',
    ...m.categories.flatMap((c) => [
      `## ${c.names.en}`, '',
      ...c.sections.flatMap((s) => [
        `### ${s.names.en}`, '',
        ...s.items.map((i) => `- [${i.names.en}](${dishUrl(i)})${i.names.bs !== i.names.en ? ` / ${i.names.bs}` : ''}${i.names.ar !== i.names.en ? ` / ${i.names.ar}` : ''} — ${km(i.price)}${i.descriptions.en ? `. ${i.descriptions.en}` : ''}${isVegetarian(i) ? ' (vegetarian)' : ''}${i.allergens.length ? ` Allergens: ${i.allergens.join(', ')}.` : ''}`),
        '',
      ]),
    ]),
  ].join('\n');
  return { short, full };
}
