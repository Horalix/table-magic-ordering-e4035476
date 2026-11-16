/**
 * @vitest-environment node
 *
 * Parking, terrace, Wi-Fi, children, takeaway and delivery: answered only as
 * the owner confirmed them (src/lib/venues.ts, 16 November 2026), "no" included.
 */
import { describe, expect, it } from 'vitest';
import { VENUES } from '../venues';
import { amenityFaq } from './amenity-faq';
import { faqEntries, homeGraph, LOCALES } from './structured-data';
import { veraFaq, veraSeoMenu } from './vera-seo';

const laSoul = VENUES.lasoul;

describe('the amenities, answered', () => {
  it('say yes to what the owner confirmed and no to delivery, in all three languages', () => {
    expect(amenityFaq(laSoul, 'en')).toEqual([
      { q: 'Is there parking at La Soul?', a: 'Yes, there is parking.' },
      { q: 'Does La Soul have a terrace?', a: 'Yes, there is a terrace.' },
      { q: 'Is there Wi-Fi at La Soul?', a: 'Yes, there is Wi-Fi for guests.' },
      { q: 'Are children welcome at La Soul?', a: 'Yes, children are welcome.' },
      { q: 'Does La Soul do takeaway or delivery?', a: 'Takeaway, yes; there is no delivery.' },
    ]);
    expect(amenityFaq(laSoul, 'bs')[3].q).toBe('Jesu li djeca dobrodošla u La Soulu?');
    expect(amenityFaq(laSoul, 'bs')[4].a).toBe('Hrana za ponijeti, da; dostave nema.');
    expect(amenityFaq(laSoul, 'ar')[4].a).toBe('نعم للطلبات الخارجية؛ ولا يوجد توصيل.');
  });

  it('ask nothing of a restaurant whose amenities nobody confirmed', () => {
    expect(amenityFaq({ ...laSoul, amenities: null }, 'en')).toEqual([]);
  });

  it('are on both restaurants’ FAQ, and in La Soul’s FAQPage data word for word', () => {
    for (const l of LOCALES) {
      const asked = amenityFaq(laSoul, l);
      expect(faqEntries(laSoul, l, true, false, null)).toEqual(expect.arrayContaining(asked));
      const data = (homeGraph(laSoul, l, true, false, null)['@graph'].find((n) => (n as { '@type': string })['@type'] === 'FAQPage') as
        { mainEntity: { name: string; acceptedAnswer: { text: string } }[] }).mainEntity.map((q) => ({ q: q.name, a: q.acceptedAnswer.text }));
      expect(data).toEqual(expect.arrayContaining(asked));
      expect(veraFaq(veraSeoMenu(), l)).toEqual(expect.arrayContaining(amenityFaq(VENUES.veraitalia, l)));
    }
  });
});
