/**
 * What guests ask before they come — parking, a terrace, Wi-Fi, children,
 * takeaway, delivery — answered from what the owner confirmed
 * (src/lib/venues.ts, `amenities`, checked 16 November 2026). Nothing is
 * asked of a restaurant whose amenities are not confirmed, and an answer
 * says exactly what was confirmed, "no" included (no delivery).
 *
 * One function for both restaurants: La Soul's FAQ (faqEntries in
 * ./structured-data.ts, which the website and its FAQPage data both read) and
 * Vera Italia's (veraFaq in ./vera-seo.ts).
 *
 * Pure, relative imports only: the build imports this module outside the app.
 */
import type { Locale } from '../i18n';
import type { Venue } from '../venues';

export interface AmenityAnswer { q: string; a: string }

type Copy = Record<Locale, (venue: string) => AmenityAnswer>;

/** "u La Soulu", as the website says it (src/lib/site-copy.ts); "u Vera Italia" stays as it is. */
const LOCATIVE: Record<string, string> = { 'La Soul': 'La Soulu' };

const YES: Record<'parking' | 'terrace' | 'wifi' | 'childFriendly', Copy> = {
  parking: {
    en: (v) => ({ q: `Is there parking at ${v}?`, a: 'Yes, there is parking.' }),
    bs: (v) => ({ q: `Ima li ${v} parking?`, a: 'Da, ima parking.' }),
    ar: (v) => ({ q: `هل يوجد موقف للسيارات في ${v}؟`, a: 'نعم، يوجد موقف للسيارات.' }),
  },
  terrace: {
    en: (v) => ({ q: `Does ${v} have a terrace?`, a: 'Yes, there is a terrace.' }),
    bs: (v) => ({ q: `Ima li ${v} terasu?`, a: 'Da, ima terasu.' }),
    ar: (v) => ({ q: `هل لدى ${v} تراس؟`, a: 'نعم، يوجد تراس.' }),
  },
  wifi: {
    en: (v) => ({ q: `Is there Wi-Fi at ${v}?`, a: 'Yes, there is Wi-Fi for guests.' }),
    bs: (v) => ({ q: `Ima li ${v} Wi-Fi?`, a: 'Da, za goste ima Wi-Fi.' }),
    ar: (v) => ({ q: `هل تتوفر خدمة الواي فاي في ${v}؟`, a: 'نعم، تتوفر خدمة الواي فاي للضيوف.' }),
  },
  childFriendly: {
    en: (v) => ({ q: `Are children welcome at ${v}?`, a: 'Yes, children are welcome.' }),
    bs: (v) => ({ q: `Jesu li djeca dobrodošla u ${LOCATIVE[v] ?? v}?`, a: 'Jesu, djeca su dobrodošla.' }),
    ar: (v) => ({ q: `هل الأطفال مرحَّب بهم في ${v}؟`, a: 'نعم، الأطفال مرحَّب بهم.' }),
  },
};

/** Takeaway and delivery, in one answer: what a guest who wants to eat at home asks. */
const AWAY: Record<Locale, { q: (v: string) => string; a: (takeaway: boolean, delivery: boolean) => string }> = {
  en: {
    q: (v) => `Does ${v} do takeaway or delivery?`,
    a: (t, d) => `${t ? 'Takeaway, yes' : 'No takeaway'}; ${d ? 'delivery too' : 'there is no delivery'}.`,
  },
  bs: {
    q: (v) => `Ima li ${v} hranu za ponijeti ili dostavu?`,
    a: (t, d) => `${t ? 'Hrana za ponijeti, da' : 'Hrane za ponijeti nema'}; ${d ? 'dostava također' : 'dostave nema'}.`,
  },
  ar: {
    q: (v) => `هل يقدّم ${v} الطلبات الخارجية أو التوصيل؟`,
    a: (t, d) => `${t ? 'نعم للطلبات الخارجية' : 'لا توجد طلبات خارجية'}؛ ${d ? 'والتوصيل متاح أيضًا' : 'ولا يوجد توصيل'}.`,
  },
};

/** The questions the owner's confirmed amenities answer, in one language; none when not confirmed. */
export function amenityFaq(venue: Venue, locale: Locale): AmenityAnswer[] {
  const a = venue.amenities;
  if (!a) return [];
  const out = (['parking', 'terrace', 'wifi', 'childFriendly'] as const).filter((k) => a[k]).map((k) => YES[k][locale](venue.name));
  out.push({ q: AWAY[locale].q(venue.name), a: AWAY[locale].a(a.takeaway, a.delivery) });
  return out;
}
