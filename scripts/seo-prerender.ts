/**
 * Vite build step: write every public page as real HTML, plus robots.txt,
 * sitemap.xml, llms.txt and llms-full.txt (src/lib/seo/static-pages.ts says
 * why). Runs in `writeBundle` — after the app is written, before the service
 * worker's precache list is made — so the precache sees the final pages.
 *
 * Pages: the website in English (/), Bosnian (/bs) and Arabic (/ar); the menu
 * (/menu/lasoul) and each category, with every dish read from the live
 * database (read-only); the privacy notice and terms (/privacy); the booking
 * page (/reserve/), which says what the database says the restaurant does:
 * takes table requests online, or does not. If the database cannot be reached, or the build is
 * offline (the e2e build, SEO_OFFLINE=1), the menu pages are written without
 * dishes, the booking page says "not open online", and the build carries on.
 *
 * Built as Vera Italia's own site (VITE_HOME_VENUE=veraitalia,
 * src/lib/home-venue.ts) it writes Vera Italia's pages instead — its website
 * at "/", its menu and courses, its privacy notice — with its own sitemap,
 * robots.txt, llms.txt and Netlify rules.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadEnv, type Plugin, type ResolvedConfig, type Rollup } from 'vite';
import type { Locale } from '../src/lib/i18n';
import { siteT } from '../src/lib/site-copy';
import { VERA_OG_IMAGE, veraLlms, veraPages, veraRestaurantNode, veraSeoMenu } from '../src/lib/seo/vera-seo';
import { HOME_VENUE } from '../src/lib/home-venue';
import { homePoster, posterScript, type Poster } from '../src/lib/seo/poster';
import { PRIVACY_PATH } from '../src/lib/privacy';
import { OWN_SITE_LIVE, VENUE_URLS } from '../src/lib/seo/site-url';
import { DEFAULT_VENUE, VENUES, type Venue } from '../src/lib/venues';
import { fetchSeoMenu, type SeoMenu } from '../src/lib/seo/menu-data';
import { fetchOrderingOffered, offerOrdering, orderingCopy, orderingOffered } from '../src/lib/seo/ordering';
import {
  RESERVE_PATH, fetchReservationsOffered, offerReservations, reservationsOffered, reserveBody, reserveClosedBody, reserveClosedMeta,
  reserveGraph, reserveMeta,
} from '../src/lib/seo/reservations';
import {
  categoryPath, dishGraph, dishPath, homeGraph, LOCALES, menuGraph, menuPath, restaurantNode, sitePath,
} from '../src/lib/seo/structured-data';
import {
  dishBody, dishMeta, escapeHtml, forwardToOwnSite, headTags, homeBody, llmsFullTxt, llmsTxt, menuBody, ownSiteRedirects, robotsTxt,
  sitemapXml, type SitemapEntry,
} from '../src/lib/seo/static-pages';
import { languageAlternates, localePath, unprefixed } from '../src/lib/seo/locale-path';
import { menuFaq, setSiteFacts, SITE_FACTS_PATH } from '../src/lib/seo/menu-faq';
import { privacyPageBody, privacyPageGraph, privacyPageMeta } from '../src/lib/seo/privacy-page';

/** The app hides the plain HTML the moment its code runs; crawlers that run none read it. */
const PRERENDER_STYLE = '<script>document.documentElement.classList.add(\'js\')</script>'
  + '<style>.js [data-prerender]{display:none}[data-prerender]{max-width:46rem;margin:0 auto;padding:1.5rem;'
  + 'font-family:Inter,system-ui,sans-serif;line-height:1.6;color:#232E28;background:#F7F4EC}</style>';

/**
 * `poster`: the first screen's photograph, for a home page (src/lib/seo/poster.ts).
 * `own` says the page is a file of its own (/bs/, /ar/), not the one every
 * address without a page falls back to: its head then asks for the photograph
 * itself.
 */
export function renderPage(template: string, head: string, body: string, locale: Locale, poster?: Poster | null, own = false): string {
  return template
    .replace(/<html lang="[^"]*"[^>]*>/, `<html lang="${locale}"${locale === 'ar' ? ' dir="rtl"' : ''}>`)
    // The template's defaults are for pages this step does not write.
    .replace(/\s*<title>[\s\S]*?<\/title>/, '')
    .replace(/\s*<meta (?:name|property)="(?:description|author|og:[^"]+|twitter:[^"]+)"[^>]*>/g, '')
    .replace('</head>', `    ${head}\n    ${PRERENDER_STYLE}${poster ? poster.style + (own ? poster.preload : '') : ''}\n  </head>`)
    .replace('<div id="root"></div>', `${poster ? posterScript(poster.markup) : ''}<div id="root"><div data-prerender>\n${body}\n</div></div>`);
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
    .replace(/(<link rel="manifest" href=")[^"]*/, `$1${venue.brand.manifest}`)
    // The heading face it uses, not La Soul's Lora (index.html preloads that).
    .replace(/(<link rel="preload" as="font" type="font\/woff2" href=")\/fonts\/lora\.woff2/, `$1${venue.brand.headingFont}`)
    // And its own first photograph: the template asks for La Soul's hero on "/",
    // which Vera Italia's home page never shows (a wasted download ahead of its own).
    .replace(/preload\('hero-wide'[^\n]*\n\s*preload\('hero-tall'[^\n]*/, (asked) => (venue.slug === 'veraitalia'
      ? "preload('vera/room-2', [640, 960, 1280, 1600, 2400], 'all');"
      : asked));
}

/*
 * The screen a page shows is lazy-loaded (src/App.tsx), so a phone used to
 * ask for it only once the app's own code had arrived and run — a round trip
 * later on a slow connection, and two for the menu, whose PageTransition
 * wrapper loads before the menu itself. Each page now names the code it
 * needs in its HTML, so it comes down alongside the app's.
 */
const SHELL = 'src/components/PageTransition.tsx';
const SCREEN = {
  site: 'src/pages/site/SiteHome.tsx',
  vera: 'src/pages/vera/VeraSite.tsx',
  menu: 'src/pages/GuestMenu.tsx',
  category: 'src/pages/CategoryPage.tsx',
  dish: 'src/pages/DishLink.tsx',
  privacy: 'src/pages/Trust.tsx',
  reserve: 'src/pages/ReservePage.tsx',
  table: 'src/pages/TableEntry.tsx',
  start: 'src/pages/TableNumberEntry.tsx',
};

/** The modules a prerendered address draws first (see src/App.tsx's routes): the same in every language. */
export function pageModules(address: string, veraHome: boolean): string[] {
  // /bs/menu/lasoul/ is /menu/lasoul/'s screen; /bs/ and /ar/ are the website's.
  const urlPath = unprefixed(address);
  if (/^\/menu\/[^/]+\/dish\//.test(urlPath)) return [SCREEN.dish, SHELL, SCREEN.category];
  if (/^\/menu\/[^/]+\/$/.test(urlPath)) return [SHELL, SCREEN.menu];
  if (/^\/menu\//.test(urlPath)) return [SHELL, SCREEN.category];
  if (urlPath === PRIVACY_PATH) return [SHELL, SCREEN.privacy];
  if (urlPath === RESERVE_PATH) return [SCREEN.reserve];
  return [veraHome || urlPath.startsWith('/veraitalia') ? SCREEN.vera : SCREEN.site];
}

/** The built files behind `modules` — their chunks, the chunks those import, and their CSS — less what `template` already loads. */
export function moduleFiles(bundle: Rollup.OutputBundle, template: string, modules: string[]): string[] {
  const chunks = Object.values(bundle).filter((c): c is Rollup.OutputChunk => c.type === 'chunk');
  const byFile = new Map(chunks.map((c) => [c.fileName, c]));
  const files = new Set<string>();
  const visit = (chunk: Rollup.OutputChunk) => {
    if (files.has(chunk.fileName)) return;
    files.add(chunk.fileName);
    for (const css of chunk.viteMetadata?.importedCss ?? []) files.add(css);
    for (const dep of chunk.imports) {
      const next = byFile.get(dep);
      if (next) visit(next);
    }
  };
  for (const m of modules) {
    const chunk = chunks.find((c) => c.facadeModuleId?.replace(/\\/g, '/').endsWith(`/${m}`));
    if (chunk) visit(chunk);
  }
  return [...files].filter((f) => !template.includes(`/${f}"`)).map((f) => `/${f}`);
}

/** The tags that fetch `files` ahead: crossorigin, as Vite's own loader asks for them, so nothing is fetched twice. */
export function preloadTags(files: string[]): string {
  return files.map((f) => (f.endsWith('.css')
    ? `<link rel="preload" as="style" crossorigin href="${f}">`
    : `<link rel="modulepreload" crossorigin href="${f}">`)).join('');
}

/**
 * The home page's HTML is also what every address without a page of its own
 * gets (Netlify's fallback, the service worker's): a QR code's /table/… and
 * /start, the staff screens. So its preloads are chosen by the address the
 * phone opened, not written as tags — a waiter's phone does not fetch the
 * website, and a guest scanning a table's code fetches the menu.
 */
export function rootPreloadScript(byPath: { home: string[]; table: string[]; start: string[] }): string {
  const lists = JSON.stringify(byPath);
  return `<script>(function(){var m=${lists},p=location.pathname,`
    + `f=p==='/'?m.home:/^\\/table\\//.test(p)?m.table:/^\\/start\\/?$/.test(p)?m.start:null;if(!f)return;`
    + `f.forEach(function(u){var l=document.createElement('link'),c=/\\.css$/.test(u);l.rel=c?'preload':'modulepreload';`
    + `if(c)l.as='style';l.crossOrigin='';l.href=u;document.head.appendChild(l)})})()</script>`;
}

/**
 * What a build believed about the two switches its pages depend on, written
 * to /site-state.json. scripts/republish-check.mjs reads it from the live
 * site, asks the database the same two questions, and asks for a new publish
 * where they differ, so a switch flipped in the admin reaches search engines
 * without anyone publishing by hand. `asked` false: the build had no database
 * to ask (the e2e build), and says nothing more. The address and key are the
 * ones every page of the app already carries to talk to the database.
 */
export function siteState(s: {
  venue: string; ordering: boolean; reservations: boolean; builtAt: string; api?: string; publishableKey?: string;
}): Record<string, unknown> {
  const asked = !!(s.api && s.publishableKey);
  return asked
    ? { venue: s.venue, asked, ordering: s.ordering, reservations: s.reservations, builtAt: s.builtAt, api: s.api, publishableKey: s.publishableKey }
    : { venue: s.venue, asked, builtAt: s.builtAt };
}

export function seoPrerender(): Plugin {
  let config: ResolvedConfig;
  return {
    name: 'lasoul-seo-prerender',
    apply: 'build',
    configResolved(resolved) { config = resolved; },
    async writeBundle(_options, bundle) {
      const outDir = path.resolve(config.root, config.build.outDir);
      const templatePath = path.join(outDir, 'index.html');
      if (!existsSync(templatePath)) return;
      const template = readFileSync(templatePath, 'utf8');
      const venue = VENUES[DEFAULT_VENUE];
      const veraHome = HOME_VENUE === 'veraitalia';
      const code = (modules: string[]) => moduleFiles(bundle, template, modules);
      const preloadsFor = (urlPath: string) => (urlPath === '/'
        ? rootPreloadScript({
          home: code(pageModules('/', veraHome)),
          table: code([SCREEN.table, SHELL, SCREEN.menu]),
          start: code([SCREEN.start, SHELL, SCREEN.menu]),
        })
        : preloadTags(code(pageModules(urlPath, veraHome))));

      const env = { ...loadEnv(config.mode, config.root, 'VITE_'), ...process.env } as Record<string, string | undefined>;
      const offline = config.mode === 'e2e' || process.env.SEO_OFFLINE === '1';
      // Whether these pages may say guests order from their table: not while
      // this restaurant shows its menu only (src/lib/seo/ordering.ts).
      if (!offline && env.VITE_SUPABASE_URL && env.VITE_SUPABASE_PUBLISHABLE_KEY) {
        offerOrdering(await fetchOrderingOffered(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, HOME_VENUE));
        // And whether they may say a table can be asked for online: only while
        // its admin has that switched on (src/lib/seo/reservations.ts).
        offerReservations(await fetchReservationsOffered(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, HOME_VENUE));
      }
      const asked = !offline && !!env.VITE_SUPABASE_URL && !!env.VITE_SUPABASE_PUBLISHABLE_KEY;
      writeFileSync(path.join(outDir, 'site-state.json'), JSON.stringify(siteState({
        venue: HOME_VENUE, ordering: orderingOffered(), reservations: reservationsOffered(), builtAt: new Date().toISOString(),
        ...(asked ? { api: env.VITE_SUPABASE_URL, publishableKey: env.VITE_SUPABASE_PUBLISHABLE_KEY } : {}),
      })));
      const manifestPath = path.join(config.root, 'src', 'lib', 'image-manifest.json');
      const manifest: Record<string, { widths?: number[]; v?: string }> = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};
      const imageFor = (id: string) => {
        const widths = manifest[id]?.widths;
        if (!widths?.length) return null;
        // The same versioned address the app uses (scripts/image-versions.mjs).
        const v = manifest[id]?.v;
        return `/menu/${id}/${widths.includes(768) ? 768 : widths[widths.length - 1]}.webp${v ? `?v=${v}` : ''}`;
      };
      // A small square of it, for lists of dishes: a 240 px file by address keeps the menu page's HTML small.
      const thumbFor = (id: string) => {
        const entry = manifest[id] as { squares?: number[]; v?: string } | undefined;
        if (!entry?.squares?.includes(240)) return null;
        return `/menu/${id}/sq-240.webp${entry.v ? `?v=${entry.v}` : ''}`;
      };
      const menu: SeoMenu | null = HOME_VENUE !== 'lasoul' || offline || !env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_PUBLISHABLE_KEY
        ? null
        : await fetchSeoMenu(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, imageFor, undefined, thumbFor);

      const write = (urlPath: string, html: string) => {
        const file = urlPath === '/' ? templatePath : path.join(outDir, urlPath.replace(/^\//, ''), 'index.html');
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, html.replace('</head>', `    ${preloadsFor(urlPath)}\n  </head>`));
      };

      // The privacy notice and terms of the restaurant whose site this is
      // (src/lib/privacy.ts), in its colours and icons. Without it,
      // /privacy was the home page's HTML to anything that runs no JavaScript.
      // In each language, at its own address (src/lib/seo/locale-path.ts).
      const writePrivacy = (home: Venue, image?: string): SitemapEntry[] => LOCALES.map((locale) => {
        const p = localePath(PRIVACY_PATH, locale);
        const alternates = languageAlternates(PRIVACY_PATH);
        write(p, withBrand(renderPage(template, headTags({
          path: p, locale, venue: home, image, alternates,
          ...privacyPageMeta(home, locale), jsonLd: privacyPageGraph(home, locale),
        }), privacyPageBody(home, locale), locale), home));
        return { path: p, priority: 0.3, alternates };
      });

      // The booking page (src/pages/ReservePage.tsx) of the restaurant whose
      // site this is. While it takes requests online: what the page is, how
      // it works and its questions, for search and answer engines, and a
      // place in the sitemap. While it does not: the same address says so and
      // asks to be left out of search results, so a page that was listed once
      // is dropped, not kept (src/lib/seo/reservations.ts).
      // In each language at its own address; while closed, none of them is listed or named by hreflang.
      const writeReserve = (home: Venue, restaurant: (locale: Locale) => Record<string, unknown>, image?: string): SitemapEntry[] => {
        const on = reservationsOffered();
        const alternates = on ? languageAlternates(RESERVE_PATH) : undefined;
        return LOCALES.flatMap((locale) => {
          const p = localePath(RESERVE_PATH, locale);
          write(p, withBrand(renderPage(template, headTags({
            path: p, locale, venue: home, image, noindex: !on, alternates,
            ...(on ? reserveMeta(home, locale) : reserveClosedMeta(home, locale)),
            jsonLd: on ? reserveGraph(home, locale, restaurant(locale)) : { '@context': 'https://schema.org', ...restaurant(locale) },
          }), on ? reserveBody(home, '/', locale) : reserveClosedBody(home, '/', locale), locale), home));
          return on ? [{ path: p, priority: 0.8, alternates }] : [];
        });
      };

      // Vera Italia's pages (src/lib/seo/vera-seo.ts): its website — at "/",
      // /bs/ and /ar/ on its own site, at /veraitalia/ on La Soul's until that
      // is up — its menu, each course and each dish. Without them those
      // addresses would be served La Soul's home page, title, canonical and
      // all, to every crawler and link preview; until it opens, search engines
      // are asked to leave the menu and dishes out.
      const vera = VENUES.veraitalia;
      const veraMenu = veraSeoMenu();
      const writeVera = (): SitemapEntry[] => {
        const pages = veraPages(veraMenu);
        // Its home page, in each language, shows the room before any code has run.
        const poster = (p: string) => (veraHome && /^\/(?:(?:bs|ar)\/)?$/.test(p) ? homePoster('veraitalia') : null);
        for (const page of pages) write(page.path, withBrand(renderPage(template, headTags(page.head), page.body, page.locale, poster(page.path), page.path !== '/'), vera));
        return pages.map((page) => page.sitemap).filter((e): e is SitemapEntry => !!e);
      };

      // Vera Italia's own site: its pages, and nothing of La Soul's.
      if (HOME_VENUE === 'veraitalia') {
        const pages = veraPages(veraMenu).length;
        const entries = writeVera();
        entries.push(...writeReserve(vera, (l) => veraRestaurantNode(veraMenu, l), VERA_OG_IMAGE));
        entries.push(...writePrivacy(vera, VERA_OG_IMAGE));
        const today = new Date().toISOString().slice(0, 10);
        const llms = veraLlms(veraMenu);
        writeFileSync(path.join(outDir, 'robots.txt'), robotsTxt());
        writeFileSync(path.join(outDir, 'sitemap.xml'), sitemapXml(entries, today));
        writeFileSync(path.join(outDir, 'llms.txt'), llms.short);
        writeFileSync(path.join(outDir, 'llms-full.txt'), llms.full);
        writeFileSync(path.join(outDir, '_redirects'), ownSiteRedirects('veraitalia', VENUE_URLS.lasoul));
        config.logger.info(`  seo: Vera Italia's own site — ${pages} pages in ${LOCALES.length} languages (${vera.live ? 'open' : 'menu and dishes not indexed until it opens'}), booking page (${reservationsOffered() ? 'open, listed' : 'not open online, not listed'}), privacy, robots.txt, sitemap.xml, llms.txt, _redirects`);
        return;
      }

      // What the live menu answers (src/lib/seo/menu-faq.ts): asked on the home pages below, in their
      // FAQPage data, and left in /site-facts.json for the live home page to ask the same.
      const facts = menuFaq(menu);
      setSiteFacts(menu ? facts : null);
      writeFileSync(path.join(outDir, SITE_FACTS_PATH.replace(/^\//, '')), JSON.stringify(facts));

      // The website, once per language, each pointing at the others.
      const alternates = languageAlternates('/');
      for (const locale of LOCALES) {
        const head = headTags({
          path: sitePath(locale), locale, venue, alternates,
          title: siteT('seo_title', locale), description: siteT(orderingCopy('seo_description'), locale),
          jsonLd: homeGraph(venue, locale),
        });
        write(sitePath(locale), renderPage(template, head, homeBody(venue, locale, thumbFor), locale, homePoster(venue.slug), sitePath(locale) !== '/'));
      }

      // The menu, each category and every dish, in each language at its own
      // address (src/lib/seo/locale-path.ts): /menu/lasoul/, /bs/menu/lasoul/,
      // /ar/menu/lasoul/, the same slugs after the prefix. Each page is
      // written in its language — names, descriptions (English where a
      // translation is missing), the words around them — names its other two
      // versions with hreflang, and is its own canonical. The app shows the
      // same head at each address (usePageMeta, src/lib/seo/page-meta.ts).
      const base = menuPath(venue.slug);
      const categories = menu?.categories ?? [];
      const menuEntries: SitemapEntry[] = [];
      const dishEntries: SitemapEntry[] = [];
      for (const locale of LOCALES) {
        const p = localePath(base, locale);
        write(p, renderPage(template, headTags({
          path: p, locale, venue, alternates: languageAlternates(base),
          title: siteT('seo_menu_title', locale), description: siteT('seo_menu_description', locale),
          jsonLd: menu ? menuGraph(venue, menu, locale) : homeGraph(venue, locale),
        }), menuBody(venue, menu, locale), locale));
        menuEntries.push({ path: p, priority: locale === 'en' ? 0.9 : 0.85, alternates: languageAlternates(base) });

        for (const category of categories) {
          const en = categoryPath(venue.slug, category.slug);
          const cp = localePath(en, locale);
          write(cp, renderPage(template, headTags({
            path: cp, locale, venue, alternates: languageAlternates(en),
            title: siteT('seo_category_title', locale, { category: category.names[locale] }),
            description: siteT('seo_category_description', locale, { category: category.names[locale] }),
            jsonLd: menuGraph(venue, menu as SeoMenu, locale, category),
          }), menuBody(venue, menu, locale, category), locale));
          menuEntries.push({ path: cp, priority: 0.8, alternates: languageAlternates(en) });
        }

        // A page for every dish: what people search for by name, and what
        // answer engines cite when someone asks where to get it in Sarajevo.
        for (const category of categories) {
          for (const section of category.sections) {
            for (const item of section.items) {
              const en = dishPath(venue.slug, item);
              const dp = localePath(en, locale);
              write(dp, renderPage(template, headTags({
                path: dp, locale, venue, image: item.image, alternates: languageAlternates(en),
                // The same title and description the app shows while this dish is open from here.
                ...dishMeta(item.names[locale], item.price, item.descriptions[locale], locale),
                jsonLd: dishGraph(venue, category, section, item, locale),
              }), dishBody(venue, category, section, item, locale), locale));
              dishEntries.push({ path: dp, priority: 0.6, alternates: languageAlternates(en), images: item.image ? [item.image] : [] });
            }
          }
        }
      }

      // Until Vera Italia's own site is up, La Soul's serves its pages; then
      // it forwards their addresses there (src/lib/seo/site-url.ts).
      const veraEntries = OWN_SITE_LIVE.veraitalia ? [] : writeVera();
      if (OWN_SITE_LIVE.veraitalia) {
        const rules = path.join(outDir, '_redirects');
        const current = existsSync(rules) ? readFileSync(rules, 'utf8') : '';
        writeFileSync(rules, forwardToOwnSite('veraitalia', VENUE_URLS.veraitalia) + '\n' + current);
      }

      const reserve = writeReserve(venue, (l) => restaurantNode(venue, l));
      const privacy = writePrivacy(venue);

      const today = new Date().toISOString().slice(0, 10);
      const entries: SitemapEntry[] = [
        ...LOCALES.map((l) => ({ path: sitePath(l), alternates, priority: l === 'en' ? 1 : 0.9, images: ['/site/hero-wide-1600.webp'] })),
        ...menuEntries,
        // Only prerendered pages: anything else is served the home page's
        // HTML until the app runs, canonical and all.
        ...dishEntries,
        ...reserve,
        ...privacy,
        ...veraEntries,
      ];
      writeFileSync(path.join(outDir, 'robots.txt'), robotsTxt());
      writeFileSync(path.join(outDir, 'sitemap.xml'), sitemapXml(entries, today));
      writeFileSync(path.join(outDir, 'llms.txt'), llmsTxt(venue, menu));
      writeFileSync(path.join(outDir, 'llms-full.txt'), llmsFullTxt(venue, menu));

      const dishes = categories.reduce((n, c) => n + c.sections.reduce((m, s) => m + s.items.length, 0), 0);
      config.logger.info(`  seo: ${LOCALES.length} languages — ${LOCALES.length} site pages, ${menuEntries.length} menu pages, ${dishEntries.length} dish pages, ${facts.en.length} menu questions (${menu ? `${dishes} dishes` : 'menu offline'}), booking page (${reservationsOffered() ? 'open, listed' : 'not open online, not listed'}), privacy, robots.txt, sitemap.xml, llms.txt`);
    },
  };
}
