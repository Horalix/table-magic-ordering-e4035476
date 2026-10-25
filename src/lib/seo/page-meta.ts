import { useEffect } from 'react';
import type { Locale } from '../i18n';
import { absoluteUrl } from './site-url';
import { OG_IMAGE_PATH } from './structured-data';
import { jsonForScript } from './static-pages';

const OG_LOCALE: Record<Locale, string> = { en: 'en_GB', bs: 'bs_BA', ar: 'ar_AR' };

export interface PageMeta {
  title: string;
  description: string;
  /** The page's own address; canonical and og:url. */
  path: string;
  locale: Locale;
  /** hreflang → path. Pages that are one address in every language pass none, and any are removed. */
  alternates?: Record<string, string>;
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
 * The page's title, description, canonical address, language alternates and
 * structured data, kept in step with what the prerendered HTML for the same
 * address says (scripts/seo-prerender.ts) — Google reads the page after the
 * app has run, and it must find the same thing a crawler without JavaScript
 * found. Every public page calls this; each one overwrites the last.
 */
export function usePageMeta(meta: PageMeta) {
  const { title, description, path, locale, alternates, jsonLd, image } = meta;
  const alternatesKey = JSON.stringify(alternates ?? {});
  const jsonLdKey = jsonLd === undefined ? '' : JSON.stringify(jsonLd);
  useEffect(() => {
    const url = absoluteUrl(path);
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
    for (const [lang, p] of Object.entries(JSON.parse(alternatesKey) as Record<string, string>)) {
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
  }, [title, description, path, locale, alternatesKey, jsonLdKey, image]);
}
