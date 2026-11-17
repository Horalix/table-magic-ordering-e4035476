/**
 * The HTML and text files crawlers read without running JavaScript.
 *
 * Most AI answer engines (ChatGPT, Claude, Perplexity) and many link-preview
 * bots fetch a page and read its HTML; they do not run the app. The site and
 * the menu are a React app, so to them every page was an empty
 * <div id="root">. scripts/seo-prerender.ts writes each public page at build
 * time with what these functions produce: the right title, description,
 * canonical link, language alternates, structured data, and the page's real
 * content as plain semantic HTML. The app replaces that content the moment it
 * starts, so people see the designed page and crawlers see the same words.
 *
 * Plus robots.txt, sitemap.xml, llms.txt and llms-full.txt.
 *
 * Relative imports only: the build imports this module outside the app.
 */
import type { Locale } from '../i18n';
import { siteT, type SiteKey } from '../site-copy';
import type { Venue } from '../venues';
import { CURATED_SIGNATURES } from '../../components/site/signature-list';
import { absoluteUrl, SITE_URL } from './site-url';
import type { SeoMenu, SeoMenuCategory, SeoMenuItem, SeoMenuSection } from './menu-data';
import {
  categoryPath, dishPath, faqEntries, hoursDays, LOCALES, menuPath, OG_IMAGE_PATH, PRIVACY_PATH, signatureHref, sitePath,
} from './structured-data';
import { orderingCopy, orderingOffered } from './ordering';
import { RESERVE_PATH, reservationsOffered } from './reservations';
import { rcopy } from '../reservation-copy';
import { addressLocale, localePath, PREFIXED_LOCALES } from './locale-path';
import { allergenName, kmPrice, pageT } from './page-copy';
import SITE_IMAGES from '../../components/site/site-images.json';

const OG_LOCALE: Record<Locale, string> = { en: 'en_GB', bs: 'bs_BA', ar: 'ar_AR' };
const LANGUAGE_NAME: Record<Locale, string> = { en: 'English', bs: 'Bosanski', ar: 'العربية' };

export const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** JSON for a <script> element: `<` escaped so no string inside can close it. */
export const jsonForScript = (data: unknown) => JSON.stringify(data).replace(/</g, '\\u003c');

export interface PageHead {
  path: string;
  locale: Locale;
  title: string;
  description: string;
  /** hreflang → path, including x-default. Omitted for pages that are one URL in every language. */
  alternates?: Record<string, string>;
  jsonLd: unknown;
  venue: Venue;
  /** Site-relative preview image; the website's own by default. */
  image?: string | null;
  /** Kept out of search results: a restaurant's menu before it opens. */
  noindex?: boolean;
}

/** Everything a page says about itself in <head>. */
export function headTags(p: PageHead): string {
  const url = absoluteUrl(p.path);
  const ownImage = !!p.image;
  const image = absoluteUrl(p.image || OG_IMAGE_PATH);
  const lines = [
    `<title>${escapeHtml(p.title)}</title>`,
    `<meta name="description" content="${escapeHtml(p.description)}" />`,
    `<link rel="canonical" href="${url}" />`,
    ...Object.entries(p.alternates ?? {}).map(([lang, path]) =>
      `<link rel="alternate" hreflang="${lang}" href="${absoluteUrl(path)}" />`),
    `<meta name="robots" content="${p.noindex ? 'noindex, follow' : 'index, follow, max-image-preview:large'}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${escapeHtml(p.venue.name)}" />`,
    `<meta property="og:title" content="${escapeHtml(p.title)}" />`,
    `<meta property="og:description" content="${escapeHtml(p.description)}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:image" content="${image}" />`,
    ...(ownImage ? [] : [`<meta property="og:image:width" content="1200" />`, `<meta property="og:image:height" content="630" />`]),
    `<meta property="og:locale" content="${OG_LOCALE[p.locale]}" />`,
    ...LOCALES.filter((l) => l !== p.locale).map((l) => `<meta property="og:locale:alternate" content="${OG_LOCALE[l]}" />`),
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escapeHtml(p.title)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(p.description)}" />`,
    `<meta name="twitter:image" content="${image}" />`,
    // Sarajevo Canton (ISO 3166-2:BA-09), and the pin on the venue's Google Maps listing.
    // (Not for a restaurant whose address is not known yet.)
    ...(p.venue.city ? [
      `<meta name="geo.region" content="BA-09" />`,
      `<meta name="geo.placename" content="${escapeHtml(p.venue.city)}" />`,
    ] : []),
    ...(p.venue.geo ? [
      `<meta name="geo.position" content="${p.venue.geo.lat};${p.venue.geo.lng}" />`,
      `<meta name="ICBM" content="${p.venue.geo.lat}, ${p.venue.geo.lng}" />`,
    ] : []),
    `<script type="application/ld+json">${jsonForScript(p.jsonLd)}</script>`,
  ];
  return lines.join('\n    ');
}

const st = (key: SiteKey, locale: Locale, vars?: Record<string, string | number>) => escapeHtml(siteT(key, locale, vars));

/** This page in the other two languages: links a reader (and a crawler) can follow, each to its own address. */
export const languageLinks = (path: string, current: Locale = addressLocale(path)) =>
  `<p>${LOCALES.map((l) => (l === current
    ? `<strong lang="${l}">${LANGUAGE_NAME[l]}</strong>`
    : `<a href="${localePath(path, l)}" hreflang="${l}" lang="${l}">${LANGUAGE_NAME[l]}</a>`)).join(' · ')}</p>`;

/** "/menu/lasoul/" as the reader of a page in `locale` should follow it. */
const at = (path: string, locale: Locale) => localePath(path, locale);

/**
 * A photograph in the HTML crawlers read: by address, never inlined, its
 * size known, and every one lazy, the first too. This HTML is hidden the
 * moment the app runs (`.js [data-prerender]{display:none}`), and a browser
 * still fetches an eager <img> inside a hidden element: an eager first photo
 * would be a download every visitor pays for and nobody sees. A lazy one in a
 * hidden element is never fetched; crawlers and image search read its src.
 */
const img = (src: string, alt: string, width: number, height?: number) =>
  `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" width="${width}"${height ? ` height="${height}"` : ''} loading="lazy" decoding="async" />`;

/** A dish's square photo in a list (240 px). */
const thumbImg = (src: string, alt: string) => img(src, alt, 240, 240);

/** What a dish's photo shows, in the page's language. */
const photoAlt = (venue: Venue, dish: string, locale: Locale) =>
  pageT('photo_alt', locale, { dish, venue: venue.name, city: siteT('city', locale) });

/** The home page's first photograph, at the smallest width its file comes in (src/components/site/site-images.json). */
const HERO = (() => {
  const hero = (SITE_IMAGES as Record<string, { width: number; height: number; widths: number[] }>)['hero-wide'];
  const w = hero.widths[0];
  return { src: `/site/hero-wide-${w}.webp`, width: w, height: Math.round((hero.height / hero.width) * w) };
})();

function visitBlock(venue: Venue, locale: Locale): string {
  const hours = (venue.hours ?? []).map((h) => `<li>${escapeHtml(hoursDays(h, locale))}: <time>${h.opens}</time>–<time>${h.closes}</time></li>`);
  return [
    `<section id="visit"><h2>${st('visit_title', locale)}</h2>`,
    `<p>${st('visit_sub', locale)}</p>`,
    `<address>${escapeHtml(venue.name)}<br />${escapeHtml(venue.address)}<br />${venue.city === 'Sarajevo' ? st('city', locale) : escapeHtml(venue.city)}, ${escapeHtml(pageT('country', locale))}<br />`,
    `<a href="tel:${venue.phoneHref}">${escapeHtml(venue.phone)}</a></address>`,
    hours.length ? `<h3>${st('visit_hours', locale)}</h3><ul>${hours.join('')}</ul>` : '',
    // Only while a table can be asked for online (src/lib/seo/reservations.ts).
    reservationsOffered() ? `<p><a href="${at(RESERVE_PATH, locale)}">${escapeHtml(rcopy('title', locale))}</a></p>` : '',
    `<p><a href="${escapeHtml(venue.mapsUrl)}">${st('visit_directions', locale)}</a>`,
    venue.instagram ? ` · <a href="${escapeHtml(venue.instagram)}">Instagram</a>` : '',
    venue.facebook ? ` · <a href="${escapeHtml(venue.facebook)}">Facebook</a>` : '',
    `</p></section>`,
  ].join('');
}

/**
 * The website's home page, in one language, as plain HTML: its words, links
 * to the menu in the same language, and its photographs (the first screen's
 * and each signature dish's) as real <img> for image search and for readers
 * that run no script.
 */
export function homeBody(venue: Venue, locale: Locale, imageFor: (id: string) => string | null = () => null): string {
  const steps = ([1, 2, 3] as const).map((n) =>
    `<li><strong>${st(`step${n}_title` as SiteKey, locale)}</strong> — ${st(`step${n}_body` as SiteKey, locale)}</li>`).join('');
  const promise = (['halal', 'alcohol', 'fresh', 'allergens'] as const).map((k) =>
    `<li><strong>${st(`promise_${k}_title` as SiteKey, locale)}</strong> — ${st(`promise_${k}_body` as SiteKey, locale)}</li>`).join('');
  const signatures = CURATED_SIGNATURES.map((d) => {
    const photo = imageFor(d.id);
    return `<li>${photo ? thumbImg(photo, photoAlt(venue, d.name[locale], locale)) : ''}`
      + `<a href="${escapeHtml(signatureHref(venue.slug, d, locale))}">${escapeHtml(d.name[locale])}</a></li>`;
  }).join('');
  const categories = (['drinks', 'food', 'desserts'] as const).map((c) =>
    `<li><a href="${at(categoryPath(venue.slug, c), locale)}">${st(`cat_${c}` as SiteKey, locale)}</a> — ${st(`cat_${c}_desc` as SiteKey, locale)}</li>`).join('');
  const menu = at(menuPath(venue.slug), locale);
  const faq = faqEntries(venue, locale).map(({ q, a }) => `<dt>${escapeHtml(q)}</dt><dd>${escapeHtml(a)}</dd>`).join('');
  return [
    `<header><p><a href="${sitePath(locale)}">${escapeHtml(venue.name)}</a> — ${st('tagline', locale)}</p>`,
    `<nav aria-label="${st('nav_label', locale)}"><a href="${menu}">${st('nav_menu', locale)}</a> · <a href="#story">${st('nav_story', locale)}</a> · <a href="#faq">${st('faq_eyebrow', locale)}</a> · <a href="#visit">${st('nav_visit', locale)}</a></nav>`,
    languageLinks(sitePath(locale), locale), `</header>`,
    `<main>`,
    `<h1>${st('hero_title', locale)}</h1>`,
    img(HERO.src, siteT('hero_alt', locale), HERO.width, HERO.height),
    `<p>${st(orderingCopy('hero_sub'), locale)}</p>`,
    `<p><a href="${menu}">${st('hero_cta', locale)}</a>${reservationsOffered() ? ` · <a href="${at(RESERVE_PATH, locale)}">${escapeHtml(rcopy('title', locale))}</a>` : ''}</p>`,
    `<section id="story"><h2>${st('story_title', locale)}</h2><p>${st('story_p1', locale)}</p><p>${st('story_p2', locale)}</p></section>`,
    `<section><h2>${st('sig_title', locale)}</h2><p>${st('sig_sub', locale)}</p><ul>${signatures}</ul></section>`,
    `<section><h2>${st('menu_title', locale)}</h2><p>${st('menu_sub', locale)}</p><ul>${categories}</ul></section>`,
    // Not while the restaurant shows its menu only (src/lib/seo/ordering.ts).
    ...(orderingOffered() ? [`<section><h2>${st('order_title', locale)}</h2><p>${st('order_sub', locale)}</p><ol>${steps}</ol></section>`] : []),
    `<section><h2>${st('promise_title', locale)}</h2><ul>${promise}</ul></section>`,
    `<section id="faq"><h2>${st('faq_title', locale)}</h2><dl>${faq}</dl></section>`,
    visitBlock(venue, locale),
    `</main>`,
    `<footer><p>${st('footer_rights', locale, { year: new Date().getFullYear() })} · <a href="${at(PRIVACY_PATH, locale)}">${st('footer_privacy', locale)}</a></p></footer>`,
  ].join('\n');
}

const price = (n: number, locale: Locale = 'en') => kmPrice(n, locale);

/**
 * A dish's title and description: its own page's (/menu/lasoul/dish/<slug>/,
 * in English), and the app's in the guest's language while that dish is open
 * from that address (src/pages/CategoryPage.tsx).
 */
export function dishMeta(name: string, amount: number, description: string | null | undefined, locale: Locale, ordering: boolean = orderingOffered()) {
  const vars = { dish: name, price: price(amount, locale) };
  // The description as a sentence, then the template's own.
  const sentence = description ? `${description.replace(/\s+$/, '').replace(/([^.!?])$/, '$1.')} ` : '';
  return {
    title: siteT('seo_dish_title', locale, vars),
    description: siteT(orderingCopy('seo_dish_description', ordering), locale, { ...vars, description: sentence }),
  };
}

/** A dish's other names, as one modest line: people search across languages. */
function alsoCalled(item: SeoMenuItem, locale: Locale): string {
  const others = LOCALES.filter((l) => l !== locale).map((l) => ({ l, name: item.names[l] }))
    .filter(({ name }, n, all) => name !== item.names[locale] && all.findIndex((o) => o.name === name) === n);
  if (!others.length) return '';
  const names = others.map(({ l, name }) => `<span lang="${l}"${l === 'ar' ? ' dir="rtl"' : ''}>${escapeHtml(name)}</span>`).join(' · ');
  return pageT('also_called', locale, { names });
}

/** The header every menu and dish page starts with, in its language, with the way to its other two versions. */
function menuHeader(venue: Venue, locale: Locale, path: string, nav: string): string {
  return [
    `<header><p><a href="${sitePath(locale)}">${escapeHtml(venue.name)}</a> — ${st('tagline', locale)}, ${st('city', locale)}</p>`,
    nav,
    languageLinks(path, locale),
    `</header>`,
  ].join('\n');
}

/**
 * A menu page — the whole menu, or one category — in one language: every
 * dish's name, price and description in that language (English where a
 * translation is missing: menu-data.ts), its square photo by address, and a
 * link to its own page in the same language.
 */
export function menuBody(venue: Venue, menu: SeoMenu | null, locale: Locale, only?: SeoMenuCategory): string {
  const categories = menu ? (only ? [only] : menu.categories) : [];
  const path = at(only ? categoryPath(venue.slug, only.slug) : menuPath(venue.slug), locale);
  const title = only
    ? `${escapeHtml(only.names[locale])} — ${escapeHtml(venue.name)}`
    : `${escapeHtml(venue.name)} — ${st('nav_menu', locale)}`;
  const body = categories.map((c) => [
    only ? '' : `<h2><a href="${at(categoryPath(venue.slug, c.slug), locale)}">${escapeHtml(c.names[locale])}</a></h2>`,
    ...c.sections.map((s) => [
      `<section><h3>${escapeHtml(s.names[locale])}</h3><ul>`,
      ...s.items.map((i) => {
        const photo = i.thumb ? thumbImg(i.thumb, photoAlt(venue, i.names[locale], locale)) : '';
        return [
          `<li>${photo}<strong><a href="${at(dishPath(venue.slug, i), locale)}">${escapeHtml(i.names[locale])}</a></strong> — ${price(i.price, locale)}`,
          i.descriptions[locale] ? `<br />${escapeHtml(i.descriptions[locale] as string)}` : '',
          `</li>`,
        ].join('');
      }),
      `</ul></section>`,
    ].join('')),
  ].join('\n')).join('\n');
  const otherCategories = (menu?.categories ?? []).filter((c) => c.id !== only?.id)
    .map((c) => `<a href="${at(categoryPath(venue.slug, c.slug), locale)}">${escapeHtml(c.names[locale])}</a>`).join(' · ');
  return [
    menuHeader(venue, locale, path,
      `<nav><a href="${at(menuPath(venue.slug), locale)}">${st('nav_menu', locale)}</a>${otherCategories ? ` · ${otherCategories}` : ''}</nav>`),
    `<main><h1>${title}</h1>`,
    `<p>${only ? st('seo_category_description', locale, { category: only.names[locale] }) : st('seo_menu_description', locale)}</p>`,
    `<p>${st('fact_halal', locale)} · ${st('fact_alcohol', locale)} · ${escapeHtml(pageT('prices', locale))}</p>`,
    body || `<p><a href="${at(menuPath(venue.slug), locale)}">${st('hero_cta', locale)}</a></p>`,
    `</main>`,
    visitBlock(venue, locale),
  ].join('\n');
}

/** One dish's page, in one language: its name, photo, price, description, allergens, and its neighbours. */
export function dishBody(venue: Venue, category: SeoMenuCategory, section: SeoMenuSection, item: SeoMenuItem, locale: Locale = 'en'): string {
  const categoryHref = at(categoryPath(venue.slug, category.slug), locale);
  const openHref = `${categoryHref}?section=${encodeURIComponent(section.names.en.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''))}&dish=${item.id}`;
  const facts = [
    `<strong>${price(item.price, locale)}</strong>`,
    st('fact_halal', locale),
    st('fact_alcohol', locale),
    item.portionNote ? escapeHtml(item.portionNote) : '',
    item.prepMinutes ? escapeHtml(pageT('ready_in', locale, { n: item.prepMinutes })) : '',
    item.dietaryTags.includes('vegetarian') ? escapeHtml(pageT('vegetarian', locale)) : '',
  ].filter(Boolean).join(' · ');
  const allergens = item.allergens.length
    ? `<p>${escapeHtml(pageT('allergens', locale, { list: item.allergens.map((a) => allergenName(a, locale)).join(', ') }))}</p>`
    : '';
  const neighbours = section.items.filter((i) => i.id !== item.id)
    .map((i) => `<li><a href="${at(dishPath(venue.slug, i), locale)}">${escapeHtml(i.names[locale])}</a> — ${price(i.price, locale)}</li>`).join('');
  const also = alsoCalled(item, locale);
  const name = escapeHtml(item.names[locale]);
  return [
    menuHeader(venue, locale, at(dishPath(venue.slug, item), locale),
      `<nav aria-label="${escapeHtml(pageT('breadcrumb', locale))}"><a href="${sitePath(locale)}">${escapeHtml(venue.name)}</a> › <a href="${at(menuPath(venue.slug), locale)}">${st('nav_menu', locale)}</a> › <a href="${categoryHref}">${escapeHtml(category.names[locale])}</a>${section.names.en !== category.names.en ? ` › ${escapeHtml(section.names[locale])}` : ''}</nav>`),
    `<main><article>`,
    `<h1>${name}</h1>`,
    also ? `<p>${also}</p>` : '',
    item.image ? img(item.image, photoAlt(venue, item.names[locale], locale), 768) : '',
    `<p>${facts}</p>`,
    item.descriptions[locale] ? `<p>${escapeHtml(item.descriptions[locale] as string)}</p>` : '',
    allergens,
    `<p><a href="${escapeHtml(openHref)}">${escapeHtml(pageT('open_on_menu', locale, { dish: item.names[locale] }))}</a> · <a href="${categoryHref}">${escapeHtml(pageT('all_of', locale, { category: category.names[locale] }))}</a></p>`,
    neighbours ? `<section><h2>${escapeHtml(pageT('more_of', locale, { section: locale === 'en' ? section.names.en.toLowerCase() : section.names[locale], venue: venue.name }))}</h2><ul>${neighbours}</ul></section>` : '',
    `</article></main>`,
    visitBlock(venue, locale),
  ].join('\n');
}

/** Which crawlers may read what: everything public, nothing private. */
export function robotsTxt(): string {
  // The TV menu board (/tv) shows the menu pages' dishes again, one section at a time: nothing for a search result.
  // Nor is a guest's own reservation (/reservation/<id>). The booking page (/reserve/) is not listed here:
  // while the restaurant takes no requests online the page itself says "noindex", and a crawler that is
  // kept away could never read that (src/lib/seo/reservations.ts).
  const privatePaths = ['/admin', '/kitchen', '/waiter', '/cart', '/tab', '/table/', '/start', '/tv', '/reservation/'];
  const disallow = privatePaths.map((p) => `Disallow: ${p}`).join('\n');
  // Search engines and AI answer engines are welcome to everything public:
  // being quoted correctly is the point.
  const bots = ['Googlebot', 'Bingbot', 'GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-SearchBot',
    'Claude-User', 'PerplexityBot', 'Perplexity-User', 'Google-Extended', 'Applebot', 'Applebot-Extended'];
  return [
    ...bots.flatMap((b) => [`User-agent: ${b}`, 'Allow: /', disallow, '']),
    'User-agent: *', 'Allow: /', disallow, '',
    `Sitemap: ${SITE_URL}/sitemap.xml`, '',
  ].join('\n');
}

export interface SitemapEntry {
  path: string;
  alternates?: Record<string, string>;
  priority: number;
  /** Site-relative photos on the page, for Google Images. */
  images?: string[];
}

export function sitemapXml(entries: SitemapEntry[], lastmod: string): string {
  const urls = entries.map((e) => [
    '  <url>',
    `    <loc>${absoluteUrl(e.path)}</loc>`,
    ...Object.entries(e.alternates ?? {}).map(([lang, path]) =>
      `    <xhtml:link rel="alternate" hreflang="${lang}" href="${absoluteUrl(path)}" />`),
    ...(e.images ?? []).map((img) => `    <image:image><image:loc>${absoluteUrl(img)}</image:loc></image:image>`),
    `    <lastmod>${lastmod}</lastmod>`,
    `    <priority>${e.priority.toFixed(1)}</priority>`,
    '  </url>',
  ].join('\n')).join('\n');
  return '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml"'
    + ' xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n'
    + `${urls}\n</urlset>\n`;
}

function factsMarkdown(venue: Venue): string {
  const hours = (venue.hours ?? []).map((h) => `${hoursDays(h, 'en')} ${h.opens}–${h.closes}`).join('; ');
  return [
    `- Name: ${venue.name} (also listed as ${venue.alternateNames.join(', ')})`,
    `- What: ${venue.tagline} — a café and restaurant serving burgers, cakes and desserts, breakfast, pasta, specialty coffee and fresh drinks`,
    `- Halal: everything is halal; no pork`,
    `- Alcohol: none — fully alcohol-free (mojitos are made without alcohol)`,
    `- Address: ${venue.address}, ${venue.city}, Bosnia and Herzegovina`,
    ...(venue.geo ? [`- Coordinates: ${venue.geo.lat}, ${venue.geo.lng}`] : []),
    `- Phone: ${venue.phone}`,
    ...(hours ? [`- Opening hours: ${hours}`] : []),
    ...(venue.instagram ? [`- Instagram: ${venue.instagram}`] : []),
    `- Map: ${venue.mapsUrl}`,
    orderingOffered()
      ? `- Ordering: scan the QR code on the table, order from the menu in Bosnian, English or Arabic, pay the waiter at the table (cash or card terminal)`
      : `- Menu: scan the QR code on the table to see the full menu in Bosnian, English or Arabic; the waiter takes the order and is paid at the table (cash or card terminal)`,
    `- Prices: in convertible marks (KM, BAM)`,
    ...(reservationsOffered()
      ? [`- Reservations: ask for a table online at ${absoluteUrl(RESERVE_PATH)} (a day, a time, the number of guests); the restaurant confirms each request itself, usually within minutes; free, and can be cancelled`]
      : []),
  ].join('\n');
}

/** Every public page is in three languages; llms files say so once, and give the main pages' three addresses. */
const LANGUAGES_LINE = 'Every page is in English, Bosnian and Arabic: the same address with /bs/ or /ar/ in front (dish pages too).';
const inThree = (path: string) => (['en', 'bs', 'ar'] as Locale[])
  .map((l) => `[${LANGUAGE_NAME[l]}](${absoluteUrl(localePath(path, l))})`).join(' · ');

/** llms.txt: what an AI engine should know about La Soul, and where to read more. */
export function llmsTxt(venue: Venue, menu: SeoMenu | null): string {
  const cats = (menu?.categories ?? []).map((c) =>
    `- [${c.names.en}](${absoluteUrl(categoryPath(venue.slug, c.slug))}): ${c.sections.map((s) => s.names.en).join(', ')}`);
  return [
    `# ${venue.name}`, '',
    `> ${siteT(orderingCopy('seo_description'), 'en')}`, '',
    factsMarkdown(venue), '',
    '## Pages', '',
    LANGUAGES_LINE, '',
    `- Website: ${inThree('/')}`,
    `- Full menu with prices: ${inThree(menuPath(venue.slug))}`,
    ...(reservationsOffered() ? [`- Reserve a table (ask online, the restaurant confirms): ${inThree(RESERVE_PATH)}`] : []),
    ...cats, '',
    '## Optional', '',
    `- [The whole menu as text](${absoluteUrl('/llms-full.txt')})`, '',
  ].join('\n');
}

/** llms-full.txt: the facts, the FAQ and every dish with its price, as text. */
export function llmsFullTxt(venue: Venue, menu: SeoMenu | null): string {
  const faq = faqEntries(venue, 'en').map(({ q, a }) => `### ${q}\n\n${a}`).join('\n\n');
  const dishes = (menu?.categories ?? []).map((c) => [
    `## ${c.names.en} (${c.names.bs} · ${c.names.ar})`, '',
    ...c.sections.map((s) => [
      `### ${s.names.en} (${s.names.bs} · ${s.names.ar})`, '',
      ...s.items.map((i) => `- [${i.names.en}](${absoluteUrl(dishPath(venue.slug, i))})${i.names.bs !== i.names.en ? ` / ${i.names.bs}` : ''}${i.names.ar !== i.names.en ? ` / ${i.names.ar}` : ''} — ${price(i.price)}${i.descriptions.en ? `. ${i.descriptions.en}` : ''}`),
      '',
    ].join('\n')),
  ].join('\n')).join('\n');
  return [
    `# ${venue.name} — full menu and facts`, '',
    `> ${siteT(orderingCopy('seo_description'), 'en')}`, '',
    factsMarkdown(venue), '',
    LANGUAGES_LINE, '',
    '## Questions', '', faq, '',
    `# Menu (prices in KM; everything halal and alcohol-free)`, '',
    dishes || `See ${absoluteUrl(menuPath(venue.slug))}`, '',
  ].join('\n');
}

const rule = (from: string, to: string, status: string) => `${from.padEnd(22)} ${to.padEnd(52)} ${status}`;

/**
 * The app's own addresses (src/App.tsx). Netlify serves each the app, or the
 * page the build wrote there: a rule applies only where no file matches
 * ("shadowing"), so every prerendered page and every file is served as it
 * is. Any other address is the app's "not found" page with the status that
 * says so. Answered "200 OK", every mistyped or dead link — the old
 * lasoul.net's pages among them — was a page to search engines (a "soft
 * 404"), with the home page's HTML and canonical.
 *
 * La Soul's public/_redirects ends with the same rules; seo.test.ts holds it
 * to them, and them to App.tsx's routes. (Netlify matches a rule with or
 * without the trailing slash, so /tv serves /tv/ too.)
 */
export const APP_ROUTES = [
  '/bs', '/ar', '/veraitalia', '/menu', '/menu/*', '/cart', '/tab', '/table/*', '/start', '/privacy', '/tv',
  '/reserve', '/reservation/*',
  // The same public pages in Bosnian and Arabic (./locale-path.ts), for an address the build wrote no page at.
  ...PREFIXED_LOCALES.flatMap((l) => [`/${l}/menu/*`, `/${l}/reserve`, `/${l}/privacy`]),
  '/admin', '/admin/*', '/kitchen', '/waiter', '/waiter/*',
];

/**
 * A dish's address that has no page: the app, so a dish added since the last
 * publish still opens for a person, but answered "404 Not Found", so a search
 * engine does not keep a dish that is gone as a page (a "soft 404").
 *
 * Relied on (docs.netlify.com/manage/routing/redirects/rewrites-proxies/,
 * "shadowing", and /redirect-options/ for custom 404s): rules are read top to
 * bottom and the first that matches wins; a rule that is not forced ("!")
 * applies only where no file exists, so every dish page the build wrote
 * (…/dish/<slug>/index.html) is served as it is, with 200; and a rewrite to
 * a page with status 404 serves that page with that status, as the last
 * rule here has always done for every other unknown address. These come
 * before "/menu/*", which would answer 200.
 */
export const MISSING_DISH_ROUTES = ['', ...PREFIXED_LOCALES.map((l) => `/${l}`)].map((p) => `${p}/menu/:venue/dish/*`);

/**
 * The folder the websites' photos are in is no page. Google found it while
 * every address still answered "200" and lists it with the home page's
 * title, so it goes to the home page.
 */
const PHOTO_FOLDER = ['/site', '/site/'];

/**
 * The admin's own first page (scripts/seo-prerender.ts, managerShell). A
 * phone reads what "Add to Home Screen" installs from the HTML it is sent,
 * before any code runs, and an iPhone reads it once. The app's index.html is
 * the guests' (the menu's manifest, "La Soul"), so an app added from an admin
 * page opened the menu. The admin's addresses are answered this page instead:
 * the same app, but naming the Manager manifest, icon and name from the start.
 */
export const MANAGER_SHELL = '/manager-shell.html';
const isAdminRoute = (route: string) => route === '/admin' || route.startsWith('/admin/');

/** The rules every site's _redirects ends with: the photo folder home, the app at its own addresses, "not found" at any other. */
export const appRedirects = (): string[] => [
  ...PHOTO_FOLDER.map((p) => rule(p, '/', '301')),
  ...MISSING_DISH_ROUTES.map((p) => rule(p, '/index.html', '404')),
  ...APP_ROUTES.map((p) => rule(p, isAdminRoute(p) ? MANAGER_SHELL : '/index.html', '200')),
  rule('/*', '/index.html', '404'),
];

/**
 * Netlify's rules for a restaurant's own site (src/lib/home-venue.ts), in
 * place of La Soul's public/_redirects. Its old address on La Soul's site,
 * /<slug>/, is its root here; La Soul's menu is on La Soul's site; then the
 * app's own addresses.
 */
export function ownSiteRedirects(slug: string, laSoulUrl: string): string {
  return [
    `# ${slug}'s own site. Written by scripts/seo-prerender.ts; La Soul's site uses public/_redirects.`,
    rule(`/${slug}`, '/', '301!'),
    rule(`/${slug}/*`, '/', '301!'),
    // "/menu" alone is its menu (it answered with the home page, a second copy of it).
    rule('/menu', `/menu/${slug}/`, '301!'),
    rule('/menu/lasoul', `${laSoulUrl}/menu/lasoul/`, '301!'),
    rule('/menu/lasoul/*', `${laSoulUrl}/menu/lasoul/:splat`, '301!'),
    // And its Bosnian and Arabic versions (./locale-path.ts).
    ...PREFIXED_LOCALES.flatMap((l) => [
      rule(`/${l}/menu`, `/${l}/menu/${slug}/`, '301!'),
      rule(`/${l}/menu/lasoul`, `${laSoulUrl}/${l}/menu/lasoul/`, '301!'),
      rule(`/${l}/menu/lasoul/*`, `${laSoulUrl}/${l}/menu/lasoul/:splat`, '301!'),
    ]),
    ...appRedirects(),
    '',
  ].join('\n');
}

/**
 * The rules La Soul's site puts first once a restaurant's own site is up:
 * its website and its menu, which La Soul's site served until then, forward
 * there — bookmarks, shared links and codes printed before the move.
 */
export function forwardToOwnSite(slug: string, url: string): string {
  return [
    `# ${slug} has its own site (src/lib/seo/site-url.ts, OWN_SITE_LIVE).`,
    rule(`/${slug}`, `${url}/`, '301!'),
    rule(`/${slug}/*`, `${url}/`, '301!'),
    rule(`/menu/${slug}`, `${url}/menu/${slug}/`, '301!'),
    rule(`/menu/${slug}/*`, `${url}/menu/${slug}/:splat`, '301!'),
    ...PREFIXED_LOCALES.flatMap((l) => [
      rule(`/${l}/menu/${slug}`, `${url}/${l}/menu/${slug}/`, '301!'),
      rule(`/${l}/menu/${slug}/*`, `${url}/${l}/menu/${slug}/:splat`, '301!'),
    ]),
    '',
  ].join('\n');
}
