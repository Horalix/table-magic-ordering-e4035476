/**
 * Vite build step: write every public page as real HTML, plus robots.txt,
 * sitemap.xml, llms.txt and llms-full.txt (src/lib/seo/static-pages.ts says
 * why). Runs in `writeBundle` — after the app is written, before the service
 * worker's precache list is made — so the precache sees the final pages.
 *
 * Pages: the website in English (/), Bosnian (/bs) and Arabic (/ar); the menu
 * (/menu/lasoul) and each category, with every dish read from the live
 * database (read-only). If the database cannot be reached, or the build is
 * offline (the e2e build, SEO_OFFLINE=1), the menu pages are written without
 * dishes and the build carries on.
 *
 * Built as Vera Italia's own site (VITE_HOME_VENUE=veraitalia,
 * src/lib/home-venue.ts) it writes Vera Italia's pages instead — its website
 * at "/", its menu and courses — with its own sitemap, robots.txt, llms.txt
 * and Netlify rules.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadEnv, type Plugin, type ResolvedConfig } from 'vite';
import type { Locale } from '../src/lib/i18n';
import { siteT } from '../src/lib/site-copy';
import { COURSES, SITE as VERA_SITE, VERA } from '../src/components/vera/copy';
import { sectionSlug } from '../src/lib/menu-sections';
import VERA_MENU from './vera-italia/menu.json';
import { HOME_VENUE } from '../src/lib/home-venue';
import { OWN_SITE_LIVE, SITE_URL, VENUE_URLS } from '../src/lib/seo/site-url';
import { DEFAULT_VENUE, VENUES, type Venue } from '../src/lib/venues';
import { fetchSeoMenu, type SeoMenu } from '../src/lib/seo/menu-data';
import { categoryPath, dishGraph, dishPath, homeGraph, LOCALES, menuGraph, menuPath, sitePath } from '../src/lib/seo/structured-data';
import {
  dishBody, escapeHtml, forwardToOwnSite, headTags, homeBody, llmsFullTxt, llmsTxt, menuBody, ownSiteRedirects, robotsTxt, sitemapXml,
  type SitemapEntry,
} from '../src/lib/seo/static-pages';

/** The app hides the plain HTML the moment its code runs; crawlers that run none read it. */
const PRERENDER_STYLE = '<script>document.documentElement.classList.add(\'js\')</script>'
  + '<style>.js [data-prerender]{display:none}[data-prerender]{max-width:46rem;margin:0 auto;padding:1.5rem;'
  + 'font-family:Inter,system-ui,sans-serif;line-height:1.6;color:#232E28;background:#F7F4EC}</style>';

export function renderPage(template: string, head: string, body: string, locale: Locale): string {
  return template
    .replace(/<html lang="[^"]*"[^>]*>/, `<html lang="${locale}"${locale === 'ar' ? ' dir="rtl"' : ''}>`)
    // The template's defaults are for pages this step does not write.
    .replace(/\s*<title>[\s\S]*?<\/title>/, '')
    .replace(/\s*<meta (?:name|property)="(?:description|author|og:[^"]+|twitter:[^"]+)"[^>]*>/g, '')
    .replace('</head>', `    ${head}\n    ${PRERENDER_STYLE}\n  </head>`)
    .replace('<div id="root"></div>', `<div id="root"><div data-prerender>\n${body}\n</div></div>`);
}

/**
 * The template's phone-facing identity is La Soul's: the toolbar colour, the
 * home-screen icon and name, the web manifest. Another restaurant's pages
 * carry their own, so a link preview, a bookmark or "Add to Home Screen" on
 * them is that restaurant's (the app keeps them right as it navigates:
 * VenueTheme in src/hooks/useVenue.ts).
 */
export function withBrand(html: string, venue: Venue): string {
  return html
    .replace(/(<meta name="theme-color" content=")[^"]*/, `$1${venue.brand.themeColor}`)
    .replace(/(<meta name="apple-mobile-web-app-title" content=")[^"]*/, `$1${escapeHtml(venue.name)}`)
    .replace(/(<link rel="apple-touch-icon" href=")[^"]*/, `$1${venue.brand.appleTouchIcon}`)
    .replace(/(<link rel="icon"[^>]*href=")[^"]*/, `$1${venue.brand.icon}`)
    .replace(/(<link rel="manifest" href=")[^"]*/, `$1${venue.brand.manifest}`);
}

export function seoPrerender(): Plugin {
  let config: ResolvedConfig;
  return {
    name: 'lasoul-seo-prerender',
    apply: 'build',
    configResolved(resolved) { config = resolved; },
    async writeBundle() {
      const outDir = path.resolve(config.root, config.build.outDir);
      const templatePath = path.join(outDir, 'index.html');
      if (!existsSync(templatePath)) return;
      const template = readFileSync(templatePath, 'utf8');
      const venue = VENUES[DEFAULT_VENUE];

      const env = { ...loadEnv(config.mode, config.root, 'VITE_'), ...process.env } as Record<string, string | undefined>;
      const offline = config.mode === 'e2e' || process.env.SEO_OFFLINE === '1';
      const manifestPath = path.join(config.root, 'src', 'lib', 'image-manifest.json');
      const manifest: Record<string, { widths?: number[]; v?: string }> = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};
      const imageFor = (id: string) => {
        const widths = manifest[id]?.widths;
        if (!widths?.length) return null;
        // The same versioned address the app uses (scripts/image-versions.mjs).
        const v = manifest[id]?.v;
        return `/menu/${id}/${widths.includes(768) ? 768 : widths[widths.length - 1]}.webp${v ? `?v=${v}` : ''}`;
      };
      const menu: SeoMenu | null = HOME_VENUE !== 'lasoul' || offline || !env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_PUBLISHABLE_KEY
        ? null
        : await fetchSeoMenu(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, imageFor);

      const write = (urlPath: string, html: string) => {
        const file = urlPath === '/' ? templatePath : path.join(outDir, urlPath.replace(/^\//, ''), 'index.html');
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, html);
      };

      // Vera Italia's pages: its website (src/pages/vera/VeraSite.tsx) at
      // `root` — "/" on its own site, /veraitalia/ on La Soul's until that is
      // up — then its menu and each course. Without them those addresses would
      // be served La Soul's home page, title, canonical and all, to every
      // crawler and link preview; until it opens, search engines are asked to
      // leave the menu pages out.
      const vera = VENUES.veraitalia;
      const veraImage = '/site/vera/room-2-1600.webp';
      type VeraItem = { id: string; name: string; price: number; description?: string; featured_rank?: number };
      type VeraCourse = { name: string; sections: { name: string; items: VeraItem[] }[] };
      const veraCourses = VERA_MENU.categories as VeraCourse[];
      const veraLines = (course: VeraCourse) => [
        `<h2>${escapeHtml(course.name)}</h2>`,
        ...course.sections.map((sec) => `<h3>${escapeHtml(sec.name)}</h3><ul>${sec.items.map((d) => `<li>${escapeHtml(d.name)} — ${d.price.toFixed(2)} KM${d.description ? `: ${escapeHtml(d.description)}` : ''}</li>`).join('')}</ul>`),
      ];
      const writeVera = (root: string): SitemapEntry[] => {
        write(root, withBrand(renderPage(template, headTags({
          path: root, locale: 'en', venue: vera, image: veraImage,
          title: VERA_SITE.seoTitle.en, description: VERA_SITE.seoDescription.en,
          jsonLd: {
            '@context': 'https://schema.org',
            '@type': 'Restaurant',
            name: vera.name,
            url: `${SITE_URL}${root}`,
            image: `${SITE_URL}${veraImage}`,
            servesCuisine: ['Italian', 'Pizza'],
            description: VERA_SITE.seoDescription.en,
          },
        }), [
          '<h1>Vera Italia</h1>',
          `<p>${escapeHtml(VERA_SITE.intro.en)} ${escapeHtml(VERA_SITE.introRoom.en)}</p>`,
          ...veraCourses.map((c) => `<h2>${escapeHtml(c.name)}</h2><ul>${c.sections.flatMap((sec) => sec.items).map((d) => `<li>${escapeHtml(d.name)}</li>`).join('')}</ul>`),
        ].join('\n'), 'en'), vera));

        const signature = veraCourses.flatMap((c) => c.sections.flatMap((sec) => sec.items)).find((d) => d.featured_rank === 1);
        const veraMenuPath = menuPath(vera.slug);
        write(veraMenuPath, withBrand(renderPage(template, headTags({
          path: veraMenuPath, locale: 'en', venue: vera, image: (signature && imageFor(signature.id)) || veraImage, noindex: !vera.live,
          title: VERA.menuTitle.en, description: VERA.menuDescription.en,
          jsonLd: { '@context': 'https://schema.org', '@type': 'Menu', name: VERA.menuTitle.en, url: `${SITE_URL}${veraMenuPath}` },
        }), ['<h1>Vera Italia — Il Menù</h1>', ...veraCourses.flatMap(veraLines)].join('\n'), 'en'), vera));
        const coursePaths: string[] = [];
        for (const course of veraCourses) {
          const p = categoryPath(vera.slug, sectionSlug(course.name));
          const cover = COURSES[course.name]?.cover;
          write(p, withBrand(renderPage(template, headTags({
            path: p, locale: 'en', venue: vera, image: (cover && imageFor(cover)) || veraImage, noindex: !vera.live,
            title: `${course.name} — Vera Italia`, description: VERA.menuDescription.en,
            jsonLd: { '@context': 'https://schema.org', '@type': 'MenuSection', name: course.name, url: `${SITE_URL}${p}` },
          }), ['<h1>Vera Italia</h1>', ...veraLines(course)].join('\n'), 'en'), vera));
          coursePaths.push(p);
        }
        return [
          { path: root, priority: root === '/' ? 1 : 0.8, images: [veraImage] },
          ...(vera.live ? [veraMenuPath, ...coursePaths].map((path) => ({ path, priority: 0.8 })) : []),
        ];
      };

      // Vera Italia's own site: its pages, and nothing of La Soul's.
      if (HOME_VENUE === 'veraitalia') {
        const entries = writeVera('/');
        const today = new Date().toISOString().slice(0, 10);
        const llms = [
          `# Vera Italia`, '',
          `> ${VERA_SITE.seoDescription.en}`, '',
          `Website: ${SITE_URL}/`, '',
          '# Menu (prices in KM)', '',
          ...veraCourses.flatMap((c) => [`## ${c.name}`, '', ...c.sections.flatMap((sec) => sec.items).map((d) => `- ${d.name} — ${d.price.toFixed(2)} KM${d.description ? `: ${d.description}` : ''}`), '']),
        ].join('\n');
        writeFileSync(path.join(outDir, 'robots.txt'), robotsTxt());
        writeFileSync(path.join(outDir, 'sitemap.xml'), sitemapXml(entries, today));
        writeFileSync(path.join(outDir, 'llms.txt'), llms);
        writeFileSync(path.join(outDir, 'llms-full.txt'), llms);
        writeFileSync(path.join(outDir, '_redirects'), ownSiteRedirects('veraitalia', VENUE_URLS.lasoul));
        config.logger.info(`  seo: Vera Italia's own site — ${1 + 1 + veraCourses.length} pages, robots.txt, sitemap.xml, llms.txt, _redirects`);
        return;
      }

      // The website, once per language, each pointing at the others.
      const alternates: Record<string, string> = { ...Object.fromEntries(LOCALES.map((l) => [l, sitePath(l)])), 'x-default': '/' };
      for (const locale of LOCALES) {
        const head = headTags({
          path: sitePath(locale), locale, venue, alternates,
          title: siteT('seo_title', locale), description: siteT('seo_description', locale),
          jsonLd: homeGraph(venue, locale),
        });
        write(sitePath(locale), renderPage(template, head, homeBody(venue, locale), locale));
      }

      // The menu: one address in every language, so no alternates; English
      // titles with the Bosnian and Arabic names in the content itself.
      const base = menuPath(venue.slug);
      write(base, renderPage(template, headTags({
        path: base, locale: 'en', venue,
        title: siteT('seo_menu_title', 'en'), description: siteT('seo_menu_description', 'en'),
        jsonLd: menu ? menuGraph(venue, menu, 'en') : homeGraph(venue, 'en'),
      }), menuBody(venue, menu, 'en'), 'en'));

      const categories = menu?.categories ?? [];
      for (const category of categories) {
        const p = categoryPath(venue.slug, category.slug);
        write(p, renderPage(template, headTags({
          path: p, locale: 'en', venue,
          title: siteT('seo_category_title', 'en', { category: category.names.en }),
          description: siteT('seo_category_description', 'en', { category: category.names.en }),
          jsonLd: menuGraph(venue, menu as SeoMenu, 'en', category),
        }), menuBody(venue, menu, 'en', category), 'en'));
      }

      // A page for every dish: what people search for by name, and what
      // answer engines cite when someone asks where to get it in Sarajevo.
      const dishEntries: SitemapEntry[] = [];
      for (const category of categories) {
        for (const section of category.sections) {
          for (const item of section.items) {
            const p = dishPath(venue.slug, item);
            const priceText = `${item.price.toFixed(2)} KM`;
            const description = item.descriptions.en ? `${item.descriptions.en.replace(/\s+$/, '').replace(/([^.!?])$/, '$1.')} ` : '';
            write(p, renderPage(template, headTags({
              path: p, locale: 'en', venue, image: item.image,
              title: siteT('seo_dish_title', 'en', { dish: item.names.en, price: priceText }),
              description: siteT('seo_dish_description', 'en', { dish: item.names.en, price: priceText, description }),
              jsonLd: dishGraph(venue, category, section, item, 'en'),
            }), dishBody(venue, category, section, item), 'en'));
            dishEntries.push({ path: p, priority: 0.6, images: item.image ? [item.image] : [] });
          }
        }
      }

      // Until Vera Italia's own site is up, La Soul's serves its pages; then
      // it forwards their addresses there (src/lib/seo/site-url.ts).
      const veraEntries = OWN_SITE_LIVE.veraitalia ? [] : writeVera('/veraitalia/');
      if (OWN_SITE_LIVE.veraitalia) {
        const rules = path.join(outDir, '_redirects');
        const current = existsSync(rules) ? readFileSync(rules, 'utf8') : '';
        writeFileSync(rules, forwardToOwnSite('veraitalia', VENUE_URLS.veraitalia) + '\n' + current);
      }

      const today = new Date().toISOString().slice(0, 10);
      const entries: SitemapEntry[] = [
        ...LOCALES.map((l) => ({ path: sitePath(l), alternates, priority: l === 'en' ? 1 : 0.9, images: ['/site/hero-wide-1600.webp'] })),
        { path: base, priority: 0.9 },
        ...categories.map((c) => ({ path: categoryPath(venue.slug, c.slug), priority: 0.8 })),
        // Only prerendered pages: anything else is served the home page's
        // HTML until the app runs, canonical and all.
        ...dishEntries,
        ...veraEntries,
      ];
      writeFileSync(path.join(outDir, 'robots.txt'), robotsTxt());
      writeFileSync(path.join(outDir, 'sitemap.xml'), sitemapXml(entries, today));
      writeFileSync(path.join(outDir, 'llms.txt'), llmsTxt(venue, menu));
      writeFileSync(path.join(outDir, 'llms-full.txt'), llmsFullTxt(venue, menu));

      const dishes = categories.reduce((n, c) => n + c.sections.reduce((m, s) => m + s.items.length, 0), 0);
      config.logger.info(`  seo: ${LOCALES.length} site pages, ${1 + categories.length} menu pages, ${dishEntries.length} dish pages (${menu ? `${dishes} dishes` : 'menu offline'}), robots.txt, sitemap.xml, llms.txt`);
    },
  };
}
