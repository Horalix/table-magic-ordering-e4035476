import { ChevronDown } from 'lucide-react';
import { useSiteT } from '@/lib/site-i18n';
import { faqEntries } from '@/lib/seo/structured-data';
import type { Venue } from '@/lib/venues';
import Reveal from './Reveal';
import { Container, SectionHeading } from './SiteSection';

/**
 * The questions guests ask before they come — halal, alcohol, where, when,
 * how ordering works — answered in a sentence each.
 *
 * The same entries are the page's FAQPage structured data (homeGraph), word
 * for word, which is what search and answer engines quote. Native
 * <details>, so every answer is in the page for a crawler and a keyboard
 * opens them without any script.
 */
const SiteFaq = ({ venue }: { venue: Venue }) => {
  const { st, locale } = useSiteT();
  const entries = faqEntries(venue, locale);
  return (
    <section id="faq" aria-labelledby="faq-title" className="scroll-mt-24 bg-ls-cream py-20 sm:py-28">
      <Container className="grid gap-12 lg:grid-cols-12 lg:gap-16">
        <div className="lg:col-span-4">
          <SectionHeading id="faq-title" eyebrow={st('faq_eyebrow')} title={st('faq_title')} />
        </div>
        <Reveal className="lg:col-span-8" delay={0.05}>
          <div className="divide-y divide-ls-forest/10 border-y border-ls-forest/10">
            {entries.map(({ q, a }, i) => (
              <details key={q} open={i === 0} className="group py-1">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-5 text-start font-serif text-[19px] font-medium leading-snug text-ls-forest marker:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ls-sage-deep focus-visible:ring-offset-2 rtl:font-semibold sm:text-[21px] [&::-webkit-details-marker]:hidden">
                  {q}
                  <ChevronDown className="h-5 w-5 shrink-0 text-ls-sage-deep transition-transform duration-300 group-open:rotate-180" strokeWidth={1.6} aria-hidden />
                </summary>
                <p className="max-w-[62ch] pb-6 text-[16px] leading-[1.7] text-ls-grey">{a}</p>
              </details>
            ))}
          </div>
        </Reveal>
      </Container>
    </section>
  );
};

export default SiteFaq;
