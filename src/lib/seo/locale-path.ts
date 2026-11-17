/**
 * Every public page in three languages, each at an address of its own.
 *
 * English keeps the addresses the site always had; Bosnian lives under /bs/
 * and Arabic under /ar/, with the same path after the prefix:
 *
 *   /menu/lasoul/dish/spanish-latte/      English
 *   /bs/menu/lasoul/dish/spanish-latte/   Bosnian
 *   /ar/menu/lasoul/dish/spanish-latte/   Arabic
 *
 * Same slugs in every language, so a page's other versions are found by
 * swapping the prefix and nothing else. The website's home (/, /bs/, /ar/)
 * was already built this way; the menu, its categories, every dish, the
 * booking page and the privacy notice now are too.
 *
 * Why: hreflang names a page's other-language versions, each at its own
 * address (developers.google.com/search/docs/specialty/international/localized-versions).
 * One address that changes language with the phone shows a crawler English
 * only, so a search in Bosnian or Arabic had nothing in its language to land
 * on but the home page.
 *
 * The build writes each address (scripts/seo-prerender.ts); the app opens a
 * prefixed address in its language (./AddressLanguage.tsx) and keeps the head
 * in step (usePageMeta in ./page-meta.ts). Inside the app, links still go to
 * the unprefixed addresses: the language stays with the visitor.
 *
 * Pure, relative imports only: the build imports this module outside the app.
 */
import type { Locale } from '../i18n';

/** The languages with a prefix of their own. English is the address without one. */
export const PREFIXED_LOCALES = ['bs', 'ar'] as const satisfies readonly Locale[];
const ORDER: Locale[] = ['en', 'bs', 'ar'];
const PREFIX = /^\/(bs|ar)(?=\/|$)/;

/** The language an address names: its prefix, or English. */
export function addressLocale(pathname: string): Locale {
  return (PREFIX.exec(pathname)?.[1] as Locale | undefined) ?? 'en';
}

/** Whether an address carries a language prefix (/bs/…, /ar/…). */
export const isPrefixed = (pathname: string): boolean => PREFIX.test(pathname);

/** The English address of a page in any language: "/bs/menu/lasoul/" → "/menu/lasoul/", "/ar/" → "/". */
export function unprefixed(pathname: string): string {
  const rest = pathname.replace(PREFIX, '');
  return rest.startsWith('/') ? rest : `/${rest}`;
}

/** A page's address in a language: "/menu/lasoul/" in Bosnian is "/bs/menu/lasoul/"; "/" is "/bs/". */
export function localePath(path: string, locale: Locale): string {
  const base = unprefixed(path);
  return locale === 'en' ? base : `/${locale}${base}`;
}

/**
 * The hreflang set of a page: itself and its two other versions, plus
 * x-default, the English address (what a visitor in a fourth language gets).
 * The same for every member of the family, so the links are reciprocal, as
 * Google requires; each page is still its own canonical.
 */
export function languageAlternates(path: string): Record<string, string> {
  const base = unprefixed(path);
  return { ...Object.fromEntries(ORDER.map((l) => [l, localePath(base, l)])), 'x-default': base };
}
