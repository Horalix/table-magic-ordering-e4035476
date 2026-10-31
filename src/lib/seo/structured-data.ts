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
import type { SeoMenu, SeoMenuCategory, SeoMenuItem, SeoMenuSection } from './menu-data';

/* Page addresses end in "/" — see venues.ts. */
export { menuPath };
export const categoryPath = (venueSlug: string, categorySlug: string) => menuCategoryPath(categorySlug, venueSlug);
/** A dish's own page. */
export const dishPath = (venueSlug: string, item: SeoMenuItem) => `${menuBase(venueSlug)}/dish/${item.slug}/`;

export const LOCALES: Locale[] = ['en', 'bs', 'ar'];
export const OG_IMAGE_PATH = '/site/og.jpg';
const IN_LANGUAGE: Record<Locale, string> = { en: 'en', bs: 'bs', ar: 'ar' };

/** The website's address in each language: / for English, /bs/ and /ar/. */
export const sitePath = (locale: Locale) => (locale === 'en' ? '/' : `/${locale}/`);

/** The privacy notice and ordering terms, one address in every language (src/lib/privacy.ts). */
export const PRIVACY_PATH = '/privacy/';

/** "Every day" when a run covers the whole week; otherwise the days, in English (schema.org names). */
export function hoursDays(h: OpeningHours, locale: Locale): string {
  return EVERY_DAY.every((d) => h.days.includes(d)) ? siteT('hours_every_day', locale) : h.days.join(', ');
}

/** The questions on the website, answered — only those whose answer is known. */
export function faqEntries(venue: Venue, locale: Locale): { q: string; a: string }[] {
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
  entries.push(
    { q: siteT('faq_order_q', locale), a: siteT('faq_order_a', locale) },
    { q: siteT('faq_languages_q', locale), a: siteT('faq_languages_a', locale) },
    { q: siteT('faq_menu_q', locale), a: siteT('faq_menu_a', locale) },
  );
  if (venue.instagram) {
    entries.push({ q: siteT('faq_contact_q', locale), a: siteT('faq_contact_a', locale, { phone: venue.phone }) });
  }
  return entries;
}

const restaurantId = () => absoluteUrl('/#restaurant');
const websiteId = () => absoluteUrl('/#website');

/** La Soul as a place: a restaurant and a café, with everything known for certain. */
export function restaurantNode(venue: Venue, locale: Locale) {
  const sameAs = [venue.instagram, venue.facebook, venue.mapsUrl].filter((x): x is string => !!x);
  return {
    '@type': ['Restaurant', 'CafeOrCoffeeShop'],
    '@id': restaurantId(),
    name: venue.name,
    alternateName: venue.alternateNames,
    description: siteT('seo_description', locale),
    slogan: siteT('hero_title', locale),
    url: absoluteUrl(sitePath(locale)),
    image: [absoluteUrl(OG_IMAGE_PATH), absoluteUrl('/site/hero-wide-1600.webp')],
    logo: absoluteUrl('/brand/lockup-dark.webp'),
    telephone: venue.phoneHref,
    address: {
      '@type': 'PostalAddress',
      streetAddress: venue.address,
      addressLocality: venue.city,
      addressCountry: venue.country,
    },
    ...(venue.geo ? { geo: { '@type': 'GeoCoordinates', latitude: venue.geo.lat, longitude: venue.geo.lng } } : {}),
    hasMap: venue.mapsUrl,
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
    hasMenu: absoluteUrl(menuPath(venue.slug)),
    priceRange: '3–35 KM',
    currenciesAccepted: 'BAM',
    paymentAccepted: 'Cash, Credit Card, Debit Card',
    availableLanguage: ['bs', 'en', 'ar'],
    ...(sameAs.length ? { sameAs } : {}),
  };
}

export function websiteNode(venue: Venue, locale: Locale) {
  return {
    '@type': 'WebSite',
    '@id': websiteId(),
    url: absoluteUrl('/'),
    name: venue.name,
    inLanguage: IN_LANGUAGE[locale],
    publisher: { '@id': restaurantId() },
  };
}

export function faqNode(venue: Venue, locale: Locale) {
  return {
    '@type': 'FAQPage',
    '@id': absoluteUrl(`${sitePath(locale)}#faq`),
    inLanguage: IN_LANGUAGE[locale],
    mainEntity: faqEntries(venue, locale).map(({ q, a }) => ({
      '@type': 'Question',
      name: q,
      acceptedAnswer: { '@type': 'Answer', text: a },
    })),
  };
}

/** Everything the home page says about itself, as one @graph. */
export function homeGraph(venue: Venue, locale: Locale) {
  return {
    '@context': 'https://schema.org',
    '@graph': [restaurantNode(venue, locale), websiteNode(venue, locale), faqNode(venue, locale)],
  };
}

const priceText = (n: number) => n.toFixed(2);

/** One dish, as schema.org MenuItem: halal, priced in BAM, with its own page. */
export function menuItemNode(venue: Venue, item: SeoMenuItem, locale: Locale) {
  const url = absoluteUrl(dishPath(venue.slug, item));
  return {
    '@type': 'MenuItem',
    '@id': `${url}#dish`,
    name: item.names[locale],
    url,
    ...(item.descriptions[locale] ? { description: item.descriptions[locale] } : {}),
    ...(item.image ? { image: absoluteUrl(item.image) } : {}),
    suitableForDiet: 'https://schema.org/HalalDiet',
    offers: {
      '@type': 'Offer',
      price: priceText(item.price),
      priceCurrency: 'BAM',
      availability: 'https://schema.org/InStock',
      url,
    },
  };
}

/**
 * The menu as schema.org Menu → MenuSection → MenuItem, every item halal and
 * priced in BAM. A category page gets just its own sections.
 */
export function menuNode(venue: Venue, menu: SeoMenu, locale: Locale, only?: SeoMenuCategory) {
  const categories = only ? [only] : menu.categories;
  const path = only ? categoryPath(venue.slug, only.slug) : menuPath(venue.slug);
  return {
    '@type': 'Menu',
    '@id': absoluteUrl(`${path}#menu`),
    name: only ? `${venue.name} — ${only.names[locale]}` : `${venue.name} — ${siteT('nav_menu', locale)}`,
    url: absoluteUrl(path),
    inLanguage: ['bs', 'en', 'ar'],
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

/** A dish's page: the dish, the restaurant that serves it, and where it sits in the menu. */
export function dishGraph(venue: Venue, category: SeoMenuCategory, section: SeoMenuSection, item: SeoMenuItem, locale: Locale) {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      { ...restaurantNode(venue, locale), hasMenu: { '@id': absoluteUrl(`${menuPath(venue.slug)}#menu`) } },
      { ...menuItemNode(venue, item, locale), isPartOf: { '@id': absoluteUrl(`${menuPath(venue.slug)}#menu`) } },
      breadcrumbNode([
        { name: venue.name, path: '/' },
        { name: siteT('nav_menu', locale), path: menuPath(venue.slug) },
        { name: category.names[locale], path: categoryPath(venue.slug, category.slug) },
        { name: item.names[locale], path: dishPath(venue.slug, item) },
      ]),
    ],
  };
}

/** A menu page: the restaurant it belongs to, the menu (or one category of it), and where it sits. */
export function menuGraph(venue: Venue, menu: SeoMenu, locale: Locale, only?: SeoMenuCategory) {
  const crumbs = [
    { name: venue.name, path: '/' },
    { name: siteT('nav_menu', locale), path: menuPath(venue.slug) },
    ...(only ? [{ name: only.names[locale], path: categoryPath(venue.slug, only.slug) }] : []),
  ];
  return {
    '@context': 'https://schema.org',
    '@graph': [
      { ...restaurantNode(venue, locale), hasMenu: { '@id': absoluteUrl(`${menuPath(venue.slug)}#menu`) } },
      menuNode(venue, menu, locale, only),
      breadcrumbNode(crumbs),
    ],
  };
}
