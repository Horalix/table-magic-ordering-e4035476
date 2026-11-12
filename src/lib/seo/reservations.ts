/**
 * Whether the website may say that guests reserve a table online, and what
 * it says when it may: to people, to search engines and to answer engines.
 *
 * A restaurant takes requests online only while its admin has switched them
 * on (Admin → Reservations). Off, nothing anyone reads may promise it: no
 * "Reserve a table" link, no page in the sitemap, no line in llms.txt, no
 * ReserveAction in the structured data. On, all of them say it, and all say
 * the same thing the booking page itself says.
 *
 * As with ordering (./ordering.ts): the build sets this once, from the live
 * database (scripts/seo-prerender.ts), and the pages, structured data and
 * llms.txt it writes follow it. The live site passes what the database says
 * now. Switching reservations on changes the live site at once; the
 * prerendered pages follow at the next deploy.
 *
 * Relative imports only: the build imports this module outside the app.
 */
import type { Locale } from '../i18n';
import { rcopy, type ReservationCopyKey } from '../reservation-copy';
import { siteT } from '../site-copy';
import type { Venue } from '../venues';
import { absoluteUrl } from './site-url';

/** The booking page, one address in every language. Page addresses end in "/" (venues.ts). */
export const RESERVE_PATH = '/reserve/';
/** A guest's own reservation is at /reservation/<id>?t=<key>: never a search result. */
export const RESERVATION_PREFIX = '/reservation/';

let offered = false;

/** What the build was told; false until it is told otherwise (an offline build promises nothing). */
export const reservationsOffered = (): boolean => offered;

export function offerReservations(on: boolean): void {
  offered = on;
}

/**
 * Ask the live database, as the booking page does, whether this restaurant
 * takes requests online. A database that cannot be asked, or does not know
 * reservations yet, is not taken as a yes.
 */
export async function fetchReservationsOffered(url: string, key: string, venue: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/rest/v1/rpc/guest_reservation_options`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ _venue: venue }),
    });
    if (!res.ok) return false;
    const options = (await res.json()) as { enabled?: boolean } | null;
    return options?.enabled === true;
  } catch {
    return false;
  }
}

/** "lasoul.net/reserve": the address as a person would type it. */
export const reserveAddress = (): string => absoluteUrl(RESERVE_PATH).replace(/^https?:\/\//, '').replace(/\/$/, '');

/**
 * What the restaurant's own schema.org entry gains: that it takes
 * reservations, where, and the action an assistant can offer ("Reserve a
 * table at …"). Spread into the Restaurant node.
 */
export function reservationFacts() {
  const url = absoluteUrl(RESERVE_PATH);
  return {
    acceptsReservations: url,
    potentialAction: {
      '@type': 'ReserveAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: url,
        inLanguage: ['bs', 'en', 'ar'],
        actionPlatform: ['https://schema.org/DesktopWebPlatform', 'https://schema.org/MobileWebPlatform'],
      },
      result: { '@type': 'FoodEstablishmentReservation', name: 'Table reservation' },
    },
  };
}

/** The restaurant's own website, among its other questions: "Can I reserve a table?" */
export const homeReserveFaq = (locale: Locale): { q: string; a: string } => ({
  q: rcopy('home_faq_q', locale),
  a: rcopy('home_faq_a', locale, { url: reserveAddress() }),
});

const QUESTIONS = ['confirm', 'cancel', 'group', 'cost'] as const;

/** The questions under the booking form, answered: the page shows them and FAQPage repeats them word for word. */
export function reserveFaq(locale: Locale): { q: string; a: string }[] {
  return QUESTIONS.map((k) => ({
    q: rcopy(`faq_${k}_q` as ReservationCopyKey, locale),
    a: rcopy(`faq_${k}_a` as ReservationCopyKey, locale),
  }));
}

/** How a table is asked for, in three steps. */
export const reserveSteps = (locale: Locale): string[] =>
  (['how_1', 'how_2', 'how_3'] as const).map((k) => rcopy(k, locale));

/** The booking page's title and description, in the guest's language. */
export function reserveMeta(venue: Venue, locale: Locale): { title: string; description: string } {
  // The city as that language writes it (سراييفو), where the website's own words have it.
  const where = { venue: venue.name, city: venue.city === siteT('city', 'en') ? siteT('city', locale) : venue.city };
  return {
    title: venue.city ? rcopy('seo_title', locale, where) : `${rcopy('title', locale)} · ${venue.name}`,
    description: rcopy('seo_description', locale, where),
  };
}

/**
 * Everything the booking page says about itself, as one @graph: the
 * restaurant (passed in, each restaurant builds its own), the page with the
 * action it offers, its questions, and where it sits.
 */
export function reserveGraph(venue: Venue, locale: Locale, restaurant: Record<string, unknown>, homePath = '/') {
  const url = absoluteUrl(RESERVE_PATH);
  const meta = reserveMeta(venue, locale);
  return {
    '@context': 'https://schema.org',
    '@graph': [
      restaurant,
      {
        '@type': 'WebPage',
        '@id': `${url}#webpage`,
        url,
        name: meta.title,
        description: meta.description,
        inLanguage: ['en', 'bs', 'ar'],
        about: { '@id': restaurant['@id'] },
        potentialAction: reservationFacts().potentialAction,
      },
      {
        '@type': 'FAQPage',
        '@id': `${url}#faq`,
        inLanguage: locale,
        mainEntity: reserveFaq(locale).map(({ q, a }) => ({
          '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a },
        })),
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: venue.name, item: absoluteUrl(homePath) },
          { '@type': 'ListItem', position: 2, name: rcopy('title', locale), item: url },
        ],
      },
    ],
  };
}

/**
 * The booking page while the restaurant takes no requests online: the page
 * is still there (someone may have kept its address) and says so, and search
 * engines are asked to leave it out (`noindex` in scripts/seo-prerender.ts).
 */
export function reserveClosedMeta(venue: Venue, locale: Locale): { title: string; description: string } {
  return {
    title: `${rcopy('title', locale)} · ${venue.name}`,
    description: `${rcopy('closed_title', locale)}. ${rcopy(venue.phone ? 'closed_body' : 'closed_body_no_phone', locale)}`,
  };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The same, as plain HTML: closed online, and how to reach the restaurant. */
export function reserveClosedBody(venue: Venue, homePath = '/'): string {
  return [
    `<header><p><a href="${homePath}">${esc(venue.name)}</a></p></header>`,
    `<main>`,
    `<h1>${esc(rcopy('closed_title', 'en'))}</h1>`,
    `<p>${esc(rcopy(venue.phone ? 'closed_body' : 'closed_body_no_phone', 'en'))}</p>`,
    venue.phone ? `<p><a href="tel:${esc(venue.phoneHref)}">${esc(venue.phone)}</a></p>` : '',
    `</main>`,
  ].filter(Boolean).join('\n');
}

/**
 * The booking page as plain HTML, for whatever runs no JavaScript: what it
 * is, how it works and its questions in English, and the same promise in
 * Bosnian and Arabic. The app replaces it with the form the moment it starts.
 */
export function reserveBody(venue: Venue, homePath = '/'): string {
  const meta = reserveMeta(venue, 'en');
  const where = [venue.address, venue.city].filter(Boolean).join(', ');
  const other = (locale: 'bs' | 'ar') =>
    `<section lang="${locale}"${locale === 'ar' ? ' dir="rtl"' : ''}><h2>${esc(reserveMeta(venue, locale).title)}</h2>`
    + `<p>${esc(reserveMeta(venue, locale).description)}</p>`
    + `<ol>${reserveSteps(locale).map((s) => `<li>${esc(s)}</li>`).join('')}</ol></section>`;
  return [
    `<header><p><a href="${homePath}">${esc(venue.name)}</a>${venue.tagline ? ` — ${esc(venue.tagline)}` : ''}</p></header>`,
    `<main>`,
    `<h1>${esc(meta.title)}</h1>`,
    `<p>${esc(meta.description)}</p>`,
    `<section><h2>${esc(rcopy('how_title', 'en'))}</h2><ol>${reserveSteps('en').map((s) => `<li>${esc(s)}</li>`).join('')}</ol></section>`,
    `<section id="faq"><h2>${esc(rcopy('faq_title', 'en'))}</h2><dl>${reserveFaq('en').map(({ q, a }) => `<dt>${esc(q)}</dt><dd>${esc(a)}</dd>`).join('')}</dl></section>`,
    where || venue.phone
      ? `<address>${esc(venue.name)}${where ? `<br />${esc(where)}` : ''}${venue.phone ? `<br /><a href="tel:${esc(venue.phoneHref)}">${esc(venue.phone)}</a>` : ''}</address>`
      : '',
    other('bs'),
    other('ar'),
    `</main>`,
  ].filter(Boolean).join('\n');
}
