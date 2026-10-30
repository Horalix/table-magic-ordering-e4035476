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
import { categoryPath, dishPath, faqEntries, hoursDays, LOCALES, menuPath, OG_IMAGE_PATH, sitePath } from './structured-data';

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
    `<meta name="robots" content="index, follow, max-image-preview:large" />`,
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

const languageLinks = (current: Locale) =>
  `<p>${LOCALES.map((l) => (l === current
    ? `<strong lang="${l}">${LANGUAGE_NAME[l]}</strong>`
    : `<a href="${sitePath(l)}" hreflang="${l}" lang="${l}">${LANGUAGE_NAME[l]}</a>`)).join(' · ')}</p>`;

const sectionHref = (venueSlug: string, category: string, section: string | null) => {
  const base = categoryPath(venueSlug, category.toLowerCase());
  return section ? `${base}?section=${encodeURIComponent(section.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''))}` : base;
};

function visitBlock(venue: Venue, locale: Locale): string {
  const hours = (venue.hours ?? []).map((h) => `<li>${escapeHtml(hoursDays(h, locale))}: <time>${h.opens}</time>–<time>${h.closes}</time></li>`);
  return [
    `<section id="visit"><h2>${st('visit_title', locale)}</h2>`,
    `<p>${st('visit_sub', locale)}</p>`,
    `<address>${escapeHtml(venue.name)}<br />${escapeHtml(venue.address)}<br />${escapeHtml(venue.city)}, Bosna i Hercegovina<br />`,
    `<a href="tel:${venue.phoneHref}">${escapeHtml(venue.phone)}</a></address>`,
    hours.length ? `<h3>${st('visit_hours', locale)}</h3><ul>${hours.join('')}</ul>` : '',
    `<p><a href="${escapeHtml(venue.mapsUrl)}">${st('visit_directions', locale)}</a>`,
    venue.instagram ? ` · <a href="${escapeHtml(venue.instagram)}">Instagram</a>` : '',
    venue.facebook ? ` · <a href="${escapeHtml(venue.facebook)}">Facebook</a>` : '',
    `</p></section>`,
  ].join('');
}

/** The website's home page, in one language, as plain HTML. */
export function homeBody(venue: Venue, locale: Locale): string {
  const steps = ([1, 2, 3] as const).map((n) =>
    `<li><strong>${st(`step${n}_title` as SiteKey, locale)}</strong> — ${st(`step${n}_body` as SiteKey, locale)}</li>`).join('');
  const promise = (['halal', 'alcohol', 'fresh', 'allergens'] as const).map((k) =>
    `<li><strong>${st(`promise_${k}_title` as SiteKey, locale)}</strong> — ${st(`promise_${k}_body` as SiteKey, locale)}</li>`).join('');
  const signatures = CURATED_SIGNATURES.map((d) =>
    `<li><a href="${sectionHref(venue.slug, d.category, d.section)}">${escapeHtml(d.name[locale])}</a></li>`).join('');
  const categories = (['drinks', 'food', 'desserts'] as const).map((c) =>
    `<li><a href="${categoryPath(venue.slug, c)}">${st(`cat_${c}` as SiteKey, locale)}</a> — ${st(`cat_${c}_desc` as SiteKey, locale)}</li>`).join('');
  const faq = faqEntries(venue, locale).map(({ q, a }) => `<dt>${escapeHtml(q)}</dt><dd>${escapeHtml(a)}</dd>`).join('');
  return [
    `<header><p><a href="${sitePath(locale)}">${escapeHtml(venue.name)}</a> — ${st('tagline', locale)}</p>`,
    `<nav aria-label="${st('nav_label', locale)}"><a href="${menuPath(venue.slug)}">${st('nav_menu', locale)}</a> · <a href="#story">${st('nav_story', locale)}</a> · <a href="#faq">${st('faq_eyebrow', locale)}</a> · <a href="#visit">${st('nav_visit', locale)}</a></nav>`,
    languageLinks(locale), `</header>`,
    `<main>`,
    `<h1>${st('hero_title', locale)}</h1>`,
    `<p>${st('hero_sub', locale)}</p>`,
    `<p><a href="${menuPath(venue.slug)}">${st('hero_cta', locale)}</a></p>`,
    `<section id="story"><h2>${st('story_title', locale)}</h2><p>${st('story_p1', locale)}</p><p>${st('story_p2', locale)}</p></section>`,
    `<section><h2>${st('sig_title', locale)}</h2><p>${st('sig_sub', locale)}</p><ul>${signatures}</ul></section>`,
    `<section><h2>${st('menu_title', locale)}</h2><p>${st('menu_sub', locale)}</p><ul>${categories}</ul></section>`,
    `<section><h2>${st('order_title', locale)}</h2><p>${st('order_sub', locale)}</p><ol>${steps}</ol></section>`,
    `<section><h2>${st('promise_title', locale)}</h2><ul>${promise}</ul></section>`,
    `<section id="faq"><h2>${st('faq_title', locale)}</h2><dl>${faq}</dl></section>`,
    visitBlock(venue, locale),
    `</main>`,
    `<footer><p>${st('footer_rights', locale, { year: new Date().getFullYear() })} · <a href="/privacy">${st('footer_privacy', locale)}</a></p></footer>`,
  ].join('\n');
}

const price = (n: number) => `${n.toFixed(2)} KM`;

/** A menu page — the whole menu, or one category — with every dish in all three languages. */
export function menuBody(venue: Venue, menu: SeoMenu | null, locale: Locale, only?: SeoMenuCategory): string {
  const categories = menu ? (only ? [only] : menu.categories) : [];
  const title = only
    ? `${escapeHtml(only.names.en)} — ${escapeHtml(venue.name)}`
    : `${escapeHtml(venue.name)} — ${st('nav_menu', 'en')}`;
  const body = categories.map((c) => [
    only ? '' : `<h2><a href="${categoryPath(venue.slug, c.slug)}">${escapeHtml(c.names.en)}</a> <span lang="bs">(${escapeHtml(c.names.bs)})</span> <span lang="ar" dir="rtl">${escapeHtml(c.names.ar)}</span></h2>`,
    ...c.sections.map((s) => [
      `<section><h3>${escapeHtml(s.names.en)} <span lang="bs">(${escapeHtml(s.names.bs)})</span> <span lang="ar" dir="rtl">${escapeHtml(s.names.ar)}</span></h3><ul>`,
      ...s.items.map((i) => [
        `<li><strong><a href="${dishPath(venue.slug, i)}">${escapeHtml(i.names.en)}</a></strong> — ${price(i.price)}`,
        i.names.bs !== i.names.en ? ` <span lang="bs">(${escapeHtml(i.names.bs)})</span>` : '',
        i.names.ar !== i.names.en ? ` <span lang="ar" dir="rtl">${escapeHtml(i.names.ar)}</span>` : '',
        i.descriptions.en ? `<br />${escapeHtml(i.descriptions.en)}` : '',
        `</li>`,
      ].join('')),
      `</ul></section>`,
    ].join('')),
  ].join('\n')).join('\n');
  const otherCategories = (menu?.categories ?? []).filter((c) => c.id !== only?.id)
    .map((c) => `<a href="${categoryPath(venue.slug, c.slug)}">${escapeHtml(c.names.en)}</a>`).join(' · ');
  return [
    `<header><p><a href="/">${escapeHtml(venue.name)}</a> — ${st('tagline', 'en')}, ${escapeHtml(venue.city)}</p>`,
    `<nav><a href="${menuPath(venue.slug)}">${st('nav_menu', 'en')}</a>${otherCategories ? ` · ${otherCategories}` : ''}</nav></header>`,
    `<main><h1>${title}</h1>`,
    `<p>${st('seo_menu_description', 'en')}</p>`,
    `<p lang="bs">${st('seo_menu_description', 'bs')}</p>`,
    `<p lang="ar" dir="rtl">${st('seo_menu_description', 'ar')}</p>`,
    `<p>${st('fact_halal', 'en')} · ${st('fact_alcohol', 'en')} · ${escapeHtml('Prices in KM (BAM)')}</p>`,
    body || `<p><a href="${menuPath(venue.slug)}">${st('hero_cta', locale)}</a></p>`,
    `</main>`,
    visitBlock(venue, 'en'),
  ].join('\n');
}

const ALLERGEN_NAMES: Record<string, string> = {
  gluten: 'gluten', dairy: 'milk and dairy', eggs: 'eggs', fish: 'fish', shellfish: 'shellfish',
  nuts: 'tree nuts', peanuts: 'peanuts', soy: 'soy', sesame: 'sesame', celery: 'celery',
  mustard: 'mustard', sulphites: 'sulphites', lupin: 'lupin', molluscs: 'molluscs',
};

/** One dish's page: names in three languages, photo, price, description, allergens, and its neighbours. */
export function dishBody(venue: Venue, category: SeoMenuCategory, section: SeoMenuSection, item: SeoMenuItem): string {
  const categoryHref = categoryPath(venue.slug, category.slug);
  const openHref = `${categoryHref}?section=${encodeURIComponent(section.names.en.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''))}&dish=${item.id}`;
  const facts = [
    `<strong>${price(item.price)}</strong>`,
    escapeHtml(siteT('fact_halal', 'en')),
    escapeHtml(siteT('fact_alcohol', 'en')),
    item.portionNote ? escapeHtml(item.portionNote) : '',
    item.prepMinutes ? `ready in about ${item.prepMinutes} minutes` : '',
  ].filter(Boolean).join(' · ');
  const allergens = item.allergens.length
    ? `<p>Allergens: ${item.allergens.map((a) => escapeHtml(ALLERGEN_NAMES[a] ?? a)).join(', ')}. Please tell your waiter about any allergy.</p>`
    : '';
  const neighbours = section.items.filter((i) => i.id !== item.id)
    .map((i) => `<li><a href="${dishPath(venue.slug, i)}">${escapeHtml(i.names.en)}</a> — ${price(i.price)}</li>`).join('');
  return [
    `<header><p><a href="/">${escapeHtml(venue.name)}</a> — ${st('tagline', 'en')}, ${escapeHtml(venue.city)}</p>`,
    `<nav aria-label="Breadcrumb"><a href="/">${escapeHtml(venue.name)}</a> › <a href="${menuPath(venue.slug)}">${st('nav_menu', 'en')}</a> › <a href="${categoryHref}">${escapeHtml(category.names.en)}</a>${section.names.en !== category.names.en ? ` › ${escapeHtml(section.names.en)}` : ''}</nav></header>`,
    `<main><article>`,
    `<h1>${escapeHtml(item.names.en)}</h1>`,
    item.names.bs !== item.names.en ? `<p lang="bs">${escapeHtml(item.names.bs)}</p>` : '',
    item.names.ar !== item.names.en ? `<p lang="ar" dir="rtl">${escapeHtml(item.names.ar)}</p>` : '',
    item.image ? `<img src="${item.image}" alt="${escapeHtml(item.names.en)} at ${escapeHtml(venue.name)}, ${escapeHtml(venue.city)}" width="768" loading="lazy" />` : '',
    `<p>${facts}</p>`,
    item.descriptions.en ? `<p>${escapeHtml(item.descriptions.en)}</p>` : '',
    item.descriptions.bs && item.descriptions.bs !== item.descriptions.en ? `<p lang="bs">${escapeHtml(item.descriptions.bs)}</p>` : '',
    item.descriptions.ar && item.descriptions.ar !== item.descriptions.en ? `<p lang="ar" dir="rtl">${escapeHtml(item.descriptions.ar)}</p>` : '',
    allergens,
    `<p><a href="${openHref}">Open ${escapeHtml(item.names.en)} on the menu</a> · <a href="${categoryHref}">All ${escapeHtml(category.names.en.toLowerCase())}</a></p>`,
    neighbours ? `<section><h2>More ${escapeHtml(section.names.en.toLowerCase())} at ${escapeHtml(venue.name)}</h2><ul>${neighbours}</ul></section>` : '',
    `</article></main>`,
    visitBlock(venue, 'en'),
  ].join('\n');
}

/** Which crawlers may read what: everything public, nothing private. */
export function robotsTxt(): string {
  const privatePaths = ['/admin', '/kitchen', '/waiter', '/cart', '/tab', '/table/', '/start'];
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
    `- Ordering: scan the QR code on the table, order from the menu in Bosnian, English or Arabic, pay the waiter at the table (cash or card terminal)`,
    `- Prices: in convertible marks (KM, BAM)`,
  ].join('\n');
}

/** llms.txt: what an AI engine should know about La Soul, and where to read more. */
export function llmsTxt(venue: Venue, menu: SeoMenu | null): string {
  const cats = (menu?.categories ?? []).map((c) =>
    `- [${c.names.en}](${absoluteUrl(categoryPath(venue.slug, c.slug))}): ${c.sections.map((s) => s.names.en).join(', ')}`);
  return [
    `# ${venue.name}`, '',
    `> ${siteT('seo_description', 'en')}`, '',
    factsMarkdown(venue), '',
    '## Pages', '',
    `- [Website (English)](${absoluteUrl('/')})`,
    `- [Website (Bosnian)](${absoluteUrl(sitePath('bs'))})`,
    `- [Website (Arabic)](${absoluteUrl(sitePath('ar'))})`,
    `- [Full menu with prices](${absoluteUrl(menuPath(venue.slug))})`,
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
    `> ${siteT('seo_description', 'en')}`, '',
    factsMarkdown(venue), '',
    '## Questions', '', faq, '',
    `# Menu (prices in KM; everything halal and alcohol-free)`, '',
    dishes || `See ${absoluteUrl(menuPath(venue.slug))}`, '',
  ].join('\n');
}
