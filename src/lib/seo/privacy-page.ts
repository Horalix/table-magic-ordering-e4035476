/**
 * The privacy notice and terms (src/lib/privacy.ts) as the page each
 * language's address serves: /privacy/, /bs/privacy/, /ar/privacy/. The
 * words are privacy.ts's own, which the app shows at the same addresses
 * (src/pages/Trust.tsx); this only lays them out for readers that run no
 * script, and says what the page is in structured data.
 *
 * Relative imports only: the build imports this module outside the app.
 */
import type { Locale } from '../i18n';
import { privacyCopy } from '../privacy';
import { siteT } from '../site-copy';
import { menuPath, type Venue } from '../venues';
import { localePath } from './locale-path';
import { absoluteUrl } from './site-url';
import { escapeHtml, languageLinks } from './static-pages';
import { PRIVACY_PATH } from './structured-data';

/** Its structured data: one page of the website this build is, in its language. */
export function privacyPageGraph(venue: Venue, locale: Locale) {
  const url = absoluteUrl(localePath(PRIVACY_PATH, locale));
  return {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    '@id': `${url}#webpage`,
    url,
    name: privacyCopy(venue).title[locale],
    inLanguage: locale,
    isPartOf: { '@id': absoluteUrl('/#website') },
    about: { '@id': absoluteUrl('/#restaurant') },
  };
}

/** The page as plain HTML, in one language. */
export function privacyPageBody(venue: Venue, locale: Locale): string {
  const copy = privacyCopy(venue);
  const h = escapeHtml;
  return [
    `<header><nav><a href="${localePath('/', locale)}">${h(venue.name)}</a> · <a href="${localePath(menuPath(venue.slug), locale)}">${h(siteT('nav_menu', locale))}</a></nav>`,
    languageLinks(localePath(PRIVACY_PATH, locale), locale),
    `</header>`,
    `<main><h1>${h(copy.heading[locale])}</h1>`,
    `<p>${h(copy.intro[locale])}</p>`,
    ...copy.sections.map((s) => `<section><h2>${h(s.title[locale])}</h2>${s.body.map((p) => `<p>${h(p[locale])}</p>`).join('')}</section>`),
    `<p>${h(copy.footnote[locale])}</p>`,
    `</main>`,
  ].join('\n');
}

/** Its title and description, the same the app sets there (Trust.tsx). */
export const privacyPageMeta = (venue: Venue, locale: Locale) => {
  const copy = privacyCopy(venue);
  return { title: copy.title[locale], description: copy.intro[locale] };
};
