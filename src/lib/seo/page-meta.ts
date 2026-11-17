import { useEffect } from 'react';
import type { Locale } from '../i18n';
import { DEMO_BUILD } from '../home-venue';
import { PRODUCT, RESTAURANT } from '../../demo/brand';
import { absoluteUrl } from './site-url';
import { OG_IMAGE_PATH } from './structured-data';
import { jsonForScript } from './static-pages';
import { languageAlternates, localePath } from './locale-path';

const OG_LOCALE: Record<Locale, string> = { en: 'en_GB', bs: 'bs_BA', ar: 'ar_AR' };

export interface PageMeta {
  title: string;
  description: string;
  /**
   * The page, by any of its three addresses (/menu/lasoul/, /bs/menu/lasoul/…):
   * which one is canonical follows `locale` (see headFor).
   */
  path: string;
  locale: Locale;
  /**
   * hreflang → path. Left out: the page's three addresses and x-default
   * (./locale-path.ts), which every public page has. Null: none, for a page
   * that exists in one language only (Vera Italia's website on La Soul's site).
   */
  alternates?: Record<string, string> | null;
  /** Replaces the page's structured data. Omitted: whatever the prerendered page carried stays. */
  jsonLd?: unknown;
  image?: string | null;
}

function setMeta(attr: 'name' | 'property', key: string, value: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', value);
}

function setCanonical(href: string) {
  let el = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!el) {
    el = document.createElement('link');
    el.rel = 'canonical';
    document.head.appendChild(el);
  }
  el.href = href;
}

/**
 * The address rule, in one place: a page shown in a language is that
 * language's address of the page — its canonical and og:url — and names its
 * whole family with hreflang, exactly as the prerendered HTML at that address
 * does (scripts/seo-prerender.ts). So /bs/menu/lasoul/, opened fresh by a
 * crawler that runs the app, opens in Bosnian (./AddressLanguage.tsx) and
 * ends with the same head its HTML had. A phone set to Bosnian that opens the
 * English address sees Bosnian, as it always has, and its head then names the
 * Bosnian address as canonical: it is showing that page.
 */
export function headFor(path: string, locale: Locale, alternates?: Record<string, string> | null): {
  canonical: string; alternates: Record<string, string>;
} {
  if (alternates === null) return { canonical: path, alternates: {} };
  return { canonical: alternates ? path : localePath(path, locale), alternates: alternates ?? languageAlternates(path) };
}

/**
 * The page's title, description, canonical address, language alternates and
 * structured data, kept in step with what the prerendered HTML for the same
 * address says (scripts/seo-prerender.ts) — Google reads the page after the
 * app has run, and it must find the same thing a crawler without JavaScript
 * found. Every public page calls this; each one overwrites the last.
 *
 * `enabled` false: the page is showing "not found" in its place, which says
 * the opposite (useNoIndex, ./noindex.ts) and must not be overwritten by it.
 */
export function usePageMeta(meta: PageMeta, enabled = true) {
  const { title, description, path, locale, alternates, jsonLd, image } = meta;
  // 'family': none given, the page's three addresses (headFor).
  const alternatesKey = JSON.stringify(alternates === undefined ? 'family' : alternates);
  const jsonLdKey = jsonLd === undefined ? '' : JSON.stringify(jsonLd);
  useEffect(() => {
    if (!enabled) return;
    // The offline demo is nobody's public page: it names its restaurant in the tab and nothing else.
    if (DEMO_BUILD) {
      document.title = `${RESTAURANT.name} — ${PRODUCT.name} demo`;
      return;
    }
    const given = JSON.parse(alternatesKey) as Record<string, string> | null | 'family';
    const head = headFor(path, locale, given === 'family' ? undefined : given);
    const url = absoluteUrl(head.canonical);
    const img = absoluteUrl(image || OG_IMAGE_PATH);
    document.title = title;
    setMeta('name', 'description', description);
    setCanonical(url);
    setMeta('property', 'og:title', title);
    setMeta('property', 'og:description', description);
    setMeta('property', 'og:url', url);
    setMeta('property', 'og:image', img);
    setMeta('property', 'og:locale', OG_LOCALE[locale]);
    setMeta('name', 'twitter:title', title);
    setMeta('name', 'twitter:description', description);
    setMeta('name', 'twitter:image', img);

    document.head.querySelectorAll('link[rel="alternate"][hreflang]').forEach((el) => el.remove());
    for (const [lang, p] of Object.entries(head.alternates)) {
      const link = document.createElement('link');
      link.rel = 'alternate';
      link.hreflang = lang;
      link.href = absoluteUrl(p);
      document.head.appendChild(link);
    }

    if (jsonLdKey) {
      document.head.querySelectorAll('script[type="application/ld+json"]').forEach((el) => el.remove());
      const script = document.createElement('script');
      script.type = 'application/ld+json';
      script.textContent = jsonForScript(JSON.parse(jsonLdKey));
      document.head.appendChild(script);
    }
  }, [enabled, title, description, path, locale, alternatesKey, jsonLdKey, image]);
}
