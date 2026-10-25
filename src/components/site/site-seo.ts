import { useEffect } from 'react';
import type { Locale } from '@/lib/i18n';
import { menuBase, type Venue } from '@/lib/venues';

const OG_LOCALE: Record<Locale, string> = { en: 'en_GB', bs: 'bs_BA', ar: 'ar_AR' };
export const OG_IMAGE_PATH = '/site/og.jpg';

/**
 * schema.org data for search engines: a Restaurant with what is known for
 * certain. Opening hours are left out until venues.ts has them; social
 * profiles are listed only when they exist.
 */
export function restaurantJsonLd(venue: Venue, origin: string, description: string) {
  const sameAs = [venue.instagram, venue.facebook].filter((x): x is string => !!x);
  return {
    '@context': 'https://schema.org',
    '@type': 'Restaurant',
    name: venue.name,
    description,
    url: `${origin}/`,
    image: `${origin}${OG_IMAGE_PATH}`,
    telephone: venue.phoneHref,
    address: {
      '@type': 'PostalAddress',
      streetAddress: venue.address,
      addressLocality: venue.city,
      addressCountry: 'BA',
    },
    servesCuisine: ['Burgers', 'Cakes', 'Desserts', 'Coffee', 'Breakfast'],
    hasMenu: `${origin}${menuBase(venue.slug)}`,
    ...(sameAs.length ? { sameAs } : {}),
  };
}

/**
 * Title, description, Open Graph and structured data for the home page, in
 * the visitor's language. index.html carries the same defaults for crawlers
 * that do not run JavaScript; this adds the absolute URLs and the JSON-LD, and
 * puts everything back as it was when the visitor moves on to the menu.
 */
export function useSiteSeo({ venue, locale, title, description, imageAlt }: {
  venue: Venue; locale: Locale; title: string; description: string; imageAlt: string;
}) {
  useEffect(() => {
    const origin = window.location.origin;
    const undo: (() => void)[] = [];

    const prevTitle = document.title;
    document.title = title;
    undo.push(() => { document.title = prevTitle; });

    const setMeta = (attr: 'name' | 'property', key: string, value: string) => {
      let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
      const created = !el;
      if (!el) {
        el = document.createElement('meta');
        el.setAttribute(attr, key);
        document.head.appendChild(el);
      }
      const prev = el.getAttribute('content');
      el.setAttribute('content', value);
      const node = el;
      undo.push(() => {
        if (created) node.remove();
        else if (prev === null) node.removeAttribute('content');
        else node.setAttribute('content', prev);
      });
    };

    const image = `${origin}${OG_IMAGE_PATH}`;
    setMeta('name', 'description', description);
    setMeta('property', 'og:type', 'website');
    setMeta('property', 'og:site_name', venue.name);
    setMeta('property', 'og:title', title);
    setMeta('property', 'og:description', description);
    setMeta('property', 'og:url', `${origin}/`);
    setMeta('property', 'og:locale', OG_LOCALE[locale]);
    setMeta('property', 'og:image', image);
    setMeta('property', 'og:image:width', '1200');
    setMeta('property', 'og:image:height', '630');
    setMeta('property', 'og:image:alt', imageAlt);
    setMeta('name', 'twitter:card', 'summary_large_image');
    setMeta('name', 'twitter:title', title);
    setMeta('name', 'twitter:description', description);
    setMeta('name', 'twitter:image', image);

    let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    const createdCanonical = !canonical;
    if (!canonical) {
      canonical = document.createElement('link');
      canonical.rel = 'canonical';
      document.head.appendChild(canonical);
    }
    const prevHref = canonical.getAttribute('href');
    canonical.setAttribute('href', `${origin}/`);
    const canonicalNode = canonical;
    undo.push(() => {
      if (createdCanonical) canonicalNode.remove();
      else if (prevHref !== null) canonicalNode.setAttribute('href', prevHref);
    });

    const ld = document.createElement('script');
    ld.type = 'application/ld+json';
    ld.id = 'site-restaurant-jsonld';
    ld.textContent = JSON.stringify(restaurantJsonLd(venue, origin, description));
    document.head.appendChild(ld);
    undo.push(() => ld.remove());

    return () => { for (const fn of undo.reverse()) fn(); };
  }, [venue, locale, title, description, imageAlt]);
}
