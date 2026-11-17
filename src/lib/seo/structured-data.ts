/**
 * What search engines and answer engines are told about La Soul, as
 * schema.org JSON-LD — one source for the live site (site-seo.ts) and the
 * pages prerendered at build time (scripts/seo-prerender.ts).
 *
 * Everything here is a fact from venues.ts, site-copy.ts or the live menu.
 * Answer engines quote FAQ answers and menu entries verbatim, so nothing is
 * added that the page itself does not say.
 *
 * Relative imports only: the build imports this module outside the app.
 */
import type { Locale } from '../i18n';
import { siteT } from '../site-copy';
import { EVERY_DAY, menuBase, menuCategoryPath, menuPath, type OpeningHours, type Venue } from '../venues';
import { absoluteUrl } from './site-url';
import { orderingCopy, orderingOffered } from './ordering';
import { homeReserveFaq, reservationFacts, reservationsOffered } from './reservations';
import type { SeoMenu, SeoMenuCategory, SeoMenuItem, SeoMenuSection } from './menu-data';
import { languageAlternates, localePath } from './locale-path';
import { siteFacts, type MenuFaq } from './menu-faq';
import { CURATED_SIGNATURES } from '../../components/site/signature-list';
import { amenityFaq } from './amenity-faq';

/* Page addresses end in "/" — see venues.ts. */
export { menuPath };
export const categoryPath = (venueSlug: string, categorySlug: string) => menuCategoryPath(categorySlug, venueSlug);
/** A dish's own page. */
export const dishPath = (venueSlug: string, item: SeoMenuItem) => `${menuBase(venueSlug)}/dish/${item.slug}/`;
export { languageAlternates, localePath };

export const LOCALES: Locale[] = ['en', 'bs', 'ar'];
export const OG_IMAGE_PATH = '/site/og.jpg';
const IN_LANGUAGE: Record<Locale, string> = { en: 'en', bs: 'bs', ar: 'ar' };

/** The website's address in each language: / for English, /bs/ and /ar/ (./locale-path.ts). */
export const sitePath = (locale: Locale) => localePath('/', locale);

/** The privacy notice and ordering terms (src/lib/privacy.ts); /bs/privacy/ and /ar/privacy/ in the other two languages. */
export const PRIVACY_PATH = '/privacy/';

/**
 * Which Sarajevo: Wikidata's entry (Q11194, "capital city of Bosnia and
 * Herzegovina", opened 2026-11-16) and Wikipedia's page, for engines that tie
 * a restaurant to its city. Only for a city named here; nothing is guessed.
 */
const CITY_SAME_AS: Record<string, string[]> = {
  Sarajevo: ['https://www.wikidata.org/wiki/Q11194', 'https://en.wikipedia.org/wiki/Sarajevo'],
};
export const cityNode = (city: string) => ({
  '@type': 'City', name: city, ...(CITY_SAME_AS[city] ? { sameAs: CITY_SAME_AS[city] } : {}),
});

/**
 * The street as an address reads to a machine. The owner writes La Soul's as
 * "Butmirska cesta 16A | 16B" (two house numbers), and the page shows it so;
 * a "|" in a PostalAddress is no address format, so there it is "16A/16B".
 */
export const schemaStreet = (address: string) => address.replace(/\s*\|\s*/g, '/');

/**
 * Its postal address, with what the owner has confirmed (src/lib/venues.ts):
 * the street, the postal code, the city, the country. Google reads these for
 * a LocalBusiness (developers.google.com/search/docs/appearance/structured-data/local-business).
 */
export function postalAddress(venue: Venue) {
  return {
    '@type': 'PostalAddress',
    ...(venue.address ? { streetAddress: schemaStreet(venue.address) } : {}),
    ...(venue.postalCode ? { postalCode: venue.postalCode } : {}),
    addressLocality: venue.city,
    ...(venue.country ? { addressCountry: venue.country } : {}),
  };
}

/** Where it is: its municipality (Ilidža) inside the city, where the owner has given one; else the city. */
export const placeWithin = (venue: Venue) => (venue.municipality
  ? { '@type': 'AdministrativeArea', name: venue.municipality, containedInPlace: cityNode(venue.city) }
  : cityNode(venue.city));

const AMENITIES: Record<string, string> = {
  parking: 'Parking', terrace: 'Terrace', wifi: 'Wi-Fi', childFriendly: 'Children welcome', takeaway: 'Takeaway', delivery: 'Delivery',
  freeWifi: 'Free Wi-Fi', wheelchairEntrance: 'Wheelchair-accessible entrance', restroom: 'Restroom',
};

/** What the owner confirmed it has, and has not (schema.org Place.amenityFeature); nothing when not confirmed. */
export function amenityFeatures(venue: Venue) {
  const a = venue.amenities;
  if (!a) return {};
  return {
    amenityFeature: Object.entries(a).filter(([k]) => AMENITIES[k]).map(([k, value]) => ({
      '@type': 'LocationFeatureSpecification', name: AMENITIES[k], value,
    })),
  };
}

/** "Every day" when a run covers the whole week; otherwise the days, in English (schema.org names). */
export function hoursDays(h: OpeningHours, locale: Locale): string {
  return EVERY_DAY.every((d) => h.days.includes(d)) ? siteT('hours_every_day', locale) : h.days.join(', ');
}

/**
 * The questions on the website, answered — only those whose answer is known.
 * `ordering`: whether the table takes orders (src/lib/seo/ordering.ts); if
 * not, the ordering question becomes the menu-on-your-phone one.
 * `reservations`: whether a table can be asked for online
 * (src/lib/seo/reservations.ts); only then is that question there.
 */
export function faqEntries(
  venue: Venue, locale: Locale, ordering: boolean = orderingOffered(), reservations: boolean = reservationsOffered(),
  facts: MenuFaq | null = siteFacts(),
): { q: string; a: string }[] {
  const hours = venue.hours?.[0];
  const allWeek = hours && EVERY_DAY.every((d) => hours.days.includes(d));
  const entries: { q: string; a: string }[] = [
    { q: siteT('faq_halal_q', locale), a: siteT('faq_halal_a', locale) },
    { q: siteT('faq_alcohol_q', locale), a: siteT('faq_alcohol_a', locale) },
    { q: siteT('faq_where_q', locale), a: siteT('faq_where_a', locale, { address: venue.address }) },
  ];
  if (hours && allWeek && venue.hours?.length === 1) {
    entries.push({ q: siteT('faq_hours_q', locale), a: siteT('faq_hours_a', locale, { opens: hours.opens, closes: hours.closes }) });
  }
  if (reservations) entries.push(homeReserveFaq(locale));
  entries.push(
    { q: siteT(orderingCopy('faq_order_q', ordering), locale), a: siteT(orderingCopy('faq_order_a', ordering), locale) },
    { q: siteT('faq_languages_q', locale), a: siteT('faq_languages_a', locale) },
    // Parking, terrace, Wi-Fi, children, takeaway and delivery, as the owner confirmed them (./amenity-faq.ts).
    ...amenityFaq(venue, locale),
    { q: siteT('faq_menu_q', locale), a: siteT('faq_menu_a', locale) },
    // What the live menu answers (./menu-faq.ts): the same words on the page, in its data and in /site-facts.json.
    ...(facts?.[locale] ?? []),
  );
  if (venue.instagram) {
    entries.push({ q: siteT('faq_contact_q', locale), a: siteT('faq_contact_a', locale, { phone: venue.phone }) });
  }
  return entries;
}

const restaurantId = () => absoluteUrl('/#restaurant');
const websiteId = () => absoluteUrl('/#website');

/** La Soul as a place: a restaurant and a café, with everything known for certain. */
export function restaurantNode(
  venue: Venue, locale: Locale, ordering: boolean = orderingOffered(), reservations: boolean = reservationsOffered(),
) {
  const sameAs = [venue.instagram, venue.facebook, venue.mapsUrl, venue.mapsListingUrl].filter((x): x is string => !!x);
  return {
    '@type': ['Restaurant', 'CafeOrCoffeeShop'],
    '@id': restaurantId(),
    name: venue.name,
    alternateName: venue.alternateNames,
    description: siteT(orderingCopy('seo_description', ordering), locale),
    slogan: siteT('hero_title', locale),
    url: absoluteUrl(sitePath(locale)),
    image: [absoluteUrl(OG_IMAGE_PATH), absoluteUrl('/site/hero-wide-1600.webp')],
    logo: absoluteUrl('/brand/lockup-dark.webp'),
    telephone: venue.phoneHref,
    address: postalAddress(venue),
    // The city it serves, and the municipality it is in, as the owner confirmed them.
    ...(venue.city ? { areaServed: cityNode(venue.city), containedInPlace: placeWithin(venue) } : {}),
    ...amenityFeatures(venue),
    ...(venue.geo ? { geo: { '@type': 'GeoCoordinates', latitude: venue.geo.lat, longitude: venue.geo.lng } } : {}),
    hasMap: venue.mapsListingUrl || venue.mapsUrl,
    ...(venue.hours?.length
      ? {
          openingHoursSpecification: venue.hours.map((h) => ({
            '@type': 'OpeningHoursSpecification',
            dayOfWeek: h.days.map((d) => `https://schema.org/${d}`),
            opens: h.opens,
            closes: h.closes,
          })),
        }
      : {}),
    servesCuisine: ['Burgers', 'Cakes', 'Desserts', 'Breakfast', 'Coffee', 'Halal'],
    hasMenu: absoluteUrl(localePath(menuPath(venue.slug), locale)),
    priceRange: '3–35 KM',
    currenciesAccepted: 'BAM',
    paymentAccepted: 'Cash, Credit Card, Debit Card',
    availableLanguage: ['bs', 'en', 'ar'],
    // Only while a table can be asked for online: where, and the action an assistant can offer.
    ...(reservations ? reservationFacts() : {}),
    ...(sameAs.length ? { sameAs } : {}),
  };
}

export function websiteNode(venue: Venue, locale: Locale) {
  return {
    '@type': 'WebSite',
    '@id': websiteId(),
    url: absoluteUrl('/'),
    name: venue.name,
    inLanguage: ['en', 'bs', 'ar'],
    publisher: { '@id': restaurantId() },
    about: { '@id': restaurantId() },
  };
}

/**
 * The page itself: its address, language and name, what it is about (the one
 * restaurant every page refers to by @id), and the site it is part of.
 */
export function webPageNode(path: string, locale: Locale, name: string, extra: Record<string, unknown> = {}) {
  const url = absoluteUrl(path);
  return {
    '@type': 'WebPage',
    '@id': `${url}#webpage`,
    url,
    name,
    inLanguage: IN_LANGUAGE[locale],
    isPartOf: { '@id': websiteId() },
    about: { '@id': restaurantId() },
    ...extra,
  };
}

export function faqNode(
  venue: Venue, locale: Locale, ordering: boolean = orderingOffered(), reservations: boolean = reservationsOffered(),
  facts: MenuFaq | null = siteFacts(),
) {
  return {
    '@type': 'FAQPage',
    '@id': absoluteUrl(`${sitePath(locale)}#faq`),
    inLanguage: IN_LANGUAGE[locale],
    mainEntity: faqEntries(venue, locale, ordering, reservations, facts).map(({ q, a }) => ({
      '@type': 'Question',
      name: q,
      acceptedAnswer: { '@type': 'Answer', text: a },
    })),
  };
}

/**
 * Everything the home page says about itself, as one @graph. `ordering`: the
 * live site passes what the database says now (src/lib/seo/ordering.ts).
 */
export function homeGraph(
  venue: Venue, locale: Locale, ordering: boolean = orderingOffered(), reservations: boolean = reservationsOffered(),
  facts: MenuFaq | null = siteFacts(),
) {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      restaurantNode(venue, locale, ordering, reservations), websiteNode(venue, locale),
      webPageNode(sitePath(locale), locale, siteT('seo_title', locale), { mainEntity: { '@id': restaurantId() } }),
      faqNode(venue, locale, ordering, reservations, facts),
      signaturesNode(venue, locale),
    ],
  };
}

/** The section of the menu a signature dish opens at, in the page's language (the home page links the same). */
export function signatureHref(venueSlug: string, d: { category: string; section: string | null }, locale: Locale): string {
  const base = localePath(categoryPath(venueSlug, d.category.toLowerCase()), locale);
  return d.section ? `${base}?section=${encodeURIComponent(d.section.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''))}` : base;
}

/** The house signatures, as the home page lists them: an ItemList, in order. */
export function signaturesNode(venue: Venue, locale: Locale) {
  return {
    '@type': 'ItemList',
    '@id': absoluteUrl(`${sitePath(locale)}#signatures`),
    name: siteT('sig_title', locale),
    itemListOrder: 'https://schema.org/ItemListOrderAscending',
    numberOfItems: CURATED_SIGNATURES.length,
    itemListElement: CURATED_SIGNATURES.map((d, n) => ({
      '@type': 'ListItem', position: n + 1, name: d.name[locale], url: absoluteUrl(signatureHref(venue.slug, d, locale)),
    })),
  };
}

const priceText = (n: number) => n.toFixed(2);

/** One dish, as schema.org MenuItem: halal, priced in BAM, with its own page. */
export function menuItemNode(venue: Venue, item: SeoMenuItem, locale: Locale) {
  const url = absoluteUrl(localePath(dishPath(venue.slug, item), locale));
  // Halal: everything La Soul serves is (its FAQ says so). Vegetarian: only a dish the menu marks so.
  const diets = ['https://schema.org/HalalDiet', ...(item.dietaryTags.includes('vegetarian') ? ['https://schema.org/VegetarianDiet'] : [])];
  return {
    '@type': 'MenuItem',
    // One dish, one entity, whichever language's page names it.
    '@id': `${absoluteUrl(dishPath(venue.slug, item))}#dish`,
    name: item.names[locale],
    url,
    ...(item.descriptions[locale] ? { description: item.descriptions[locale] } : {}),
    ...(item.image ? { image: absoluteUrl(item.image) } : {}),
    suitableForDiet: diets.length === 1 ? diets[0] : diets,
    offers: {
      '@type': 'Offer',
      price: priceText(item.price),
      priceCurrency: 'BAM',
      // Only available dishes are read (menu-data.ts), so each is on the menu today.
      availability: 'https://schema.org/InStock',
      url,
      offeredBy: { '@id': restaurantId() },
    },
  };
}

/**
 * The menu as schema.org Menu → MenuSection → MenuItem, every item halal and
 * priced in BAM. A category page gets just its own sections.
 */
export function menuNode(venue: Venue, menu: SeoMenu, locale: Locale, only?: SeoMenuCategory) {
  const categories = only ? [only] : menu.categories;
  const path = localePath(only ? categoryPath(venue.slug, only.slug) : menuPath(venue.slug), locale);
  return {
    '@type': 'Menu',
    '@id': absoluteUrl(`${path}#menu`),
    name: only ? `${venue.name} — ${only.names[locale]}` : `${venue.name} — ${siteT('nav_menu', locale)}`,
    url: absoluteUrl(path),
    inLanguage: IN_LANGUAGE[locale],
    hasMenuSection: categories.flatMap((c) => c.sections.map((s) => ({
      '@type': 'MenuSection',
      name: s.names[locale],
      hasMenuItem: s.items.map((i) => menuItemNode(venue, i, locale)),
    }))),
  };
}

export function breadcrumbNode(crumbs: { name: string; path: string }[]) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: absoluteUrl(c.path) })),
  };
}

/**
 * Where a page sits, in its language: the website, the menu, the category,
 * the dish. Positions count from 1 and every item is a page's own address
 * (developers.google.com/search/docs/appearance/structured-data/breadcrumb).
 */
const trail = (venue: Venue, locale: Locale, category?: SeoMenuCategory, item?: SeoMenuItem) => breadcrumbNode([
  { name: venue.name, path: sitePath(locale) },
  { name: siteT('nav_menu', locale), path: localePath(menuPath(venue.slug), locale) },
  ...(category ? [{ name: category.names[locale], path: localePath(categoryPath(venue.slug, category.slug), locale) }] : []),
  ...(item ? [{ name: item.names[locale], path: localePath(dishPath(venue.slug, item), locale) }] : []),
]);

/** A photograph as schema.org ImageObject: its address and what it shows. */
export const imageNode = (path: string, caption: string) => ({
  '@type': 'ImageObject', url: absoluteUrl(path), contentUrl: absoluteUrl(path), caption,
});

/** A dish's page: the dish, the restaurant that serves it, the page, and where it sits in the menu. */
export function dishGraph(venue: Venue, category: SeoMenuCategory, _section: SeoMenuSection, item: SeoMenuItem, locale: Locale) {
  const menuId = { '@id': absoluteUrl(`${localePath(menuPath(venue.slug), locale)}#menu`) };
  const page = localePath(dishPath(venue.slug, item), locale);
  const dish = menuItemNode(venue, item, locale);
  return {
    '@context': 'https://schema.org',
    '@graph': [
      { ...restaurantNode(venue, locale), hasMenu: menuId },
      { ...dish, isPartOf: menuId, mainEntityOfPage: { '@id': `${absoluteUrl(page)}#webpage` } },
      webPageNode(page, locale, item.names[locale], {
        mainEntity: { '@id': dish['@id'] },
        ...(item.image ? { primaryImageOfPage: imageNode(item.image, item.names[locale]) } : {}),
      }),
      trail(venue, locale, category, item),
    ],
  };
}

/** A menu page: the restaurant it belongs to, the menu (or one category of it), the page, and where it sits. */
export function menuGraph(venue: Venue, menu: SeoMenu, locale: Locale, only?: SeoMenuCategory) {
  const node = menuNode(venue, menu, locale, only);
  const page = localePath(only ? categoryPath(venue.slug, only.slug) : menuPath(venue.slug), locale);
  return {
    '@context': 'https://schema.org',
    '@graph': [
      { ...restaurantNode(venue, locale), hasMenu: { '@id': absoluteUrl(`${localePath(menuPath(venue.slug), locale)}#menu`) } },
      node,
      webPageNode(page, locale, node.name, { mainEntity: { '@id': node['@id'] } }),
      trail(venue, locale, only),
    ],
  };
}
