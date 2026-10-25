import { Clock, Facebook, Instagram, MapPin, Navigation, Phone } from 'lucide-react';
import { useSiteT } from '@/lib/site-i18n';
import type { Venue } from '@/lib/venues';
import { hoursDays } from '@/lib/seo/structured-data';
import Reveal from './Reveal';
import SiteImage from './SiteImage';
import { Container, SectionHeading } from './SiteSection';

/**
 * Where La Soul is and how to reach it. Opening hours and social links come
 * from src/lib/venues.ts and appear only once they are filled in there —
 * never a "TBD" or an invented time.
 */
const SiteVisit = ({ venue }: { venue: Venue }) => {
  const { st, locale } = useSiteT();
  const socials = [
    venue.instagram && { href: venue.instagram, label: 'Instagram', icon: Instagram },
    venue.facebook && { href: venue.facebook, label: 'Facebook', icon: Facebook },
  ].filter(Boolean) as { href: string; label: string; icon: typeof Instagram }[];

  return (
    <section id="visit" aria-labelledby="visit-title" className="scroll-mt-20 py-20 sm:py-32 lg:py-40">
      <Container className="grid items-center gap-12 lg:grid-cols-12 lg:gap-16">
        <div className="lg:col-span-5">
          <SectionHeading id="visit-title" eyebrow={st('visit_eyebrow')} title={st('visit_title')} lead={st('visit_sub')} />

          <Reveal delay={0.08}>
            <dl className="mt-10 divide-y divide-ls-forest/10 border-y border-ls-forest/10">
              <div className="flex gap-4 py-5">
                <dt className="sr-only">{st('visit_address')}</dt>
                <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-ls-sage-deep" strokeWidth={1.6} aria-hidden />
                <dd className="text-[16px] leading-[1.6] text-ls-forest">
                  <span className="block font-medium">{venue.address}</span>
                  <span className="block text-ls-grey">{venue.city}</span>
                </dd>
              </div>
              <div className="flex gap-4 py-5">
                <dt className="sr-only">{st('visit_phone')}</dt>
                <Phone className="mt-0.5 h-5 w-5 shrink-0 text-ls-sage-deep" strokeWidth={1.6} aria-hidden />
                <dd>
                  <a href={`tel:${venue.phoneHref}`} dir="ltr" className="text-[16px] font-medium text-ls-forest underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ls-sage-deep focus-visible:ring-offset-2">
                    {venue.phone}
                  </a>
                </dd>
              </div>
              {venue.hours && venue.hours.length > 0 && (
                <div className="flex gap-4 py-5">
                  <dt className="sr-only">{st('visit_hours')}</dt>
                  <Clock className="mt-0.5 h-5 w-5 shrink-0 text-ls-sage-deep" strokeWidth={1.6} aria-hidden />
                  <dd className="w-full">
                    <ul className="space-y-1 text-[16px] text-ls-forest">
                      {venue.hours.map((h) => (
                        <li key={h.days.join()} className="flex justify-between gap-6">
                          <span>{hoursDays(h, locale)}</span>
                          <span dir="ltr" className="tabular-nums text-ls-grey">{h.opens}–{h.closes}</span>
                        </li>
                      ))}
                    </ul>
                  </dd>
                </div>
              )}
            </dl>
          </Reveal>

          <Reveal delay={0.14} className="mt-8 flex flex-wrap gap-3">
            <a
              href={venue.mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-[52px] items-center gap-2.5 rounded-full bg-ls-forest px-6 text-[15px] font-semibold text-ls-cream shadow-[0_14px_30px_-14px_rgba(35,46,40,0.7)] transition-colors hover:bg-ls-forest-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ls-sage-deep focus-visible:ring-offset-2 focus-visible:ring-offset-ls-cream"
            >
              <Navigation className="h-4 w-4 rtl:-scale-x-100" aria-hidden />
              {st('visit_directions')}
              <span className="sr-only"> {st('new_tab')}</span>
            </a>
            <a
              href={`tel:${venue.phoneHref}`}
              className="inline-flex h-[52px] items-center gap-2.5 rounded-full border border-ls-forest/20 px-6 text-[15px] font-semibold text-ls-forest transition-colors hover:border-ls-forest/40 hover:bg-ls-forest/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ls-sage-deep focus-visible:ring-offset-2 focus-visible:ring-offset-ls-cream"
            >
              <Phone className="h-4 w-4" aria-hidden />
              {st('visit_call')}
            </a>
          </Reveal>

          {socials.length > 0 && (
            <Reveal delay={0.2} className="mt-8">
              <p className="text-[13px] font-semibold text-ls-grey">{st('visit_follow')}</p>
              <ul className="mt-3 flex gap-3">
                {socials.map((s) => (
                  <li key={s.label}>
                    <a
                      href={s.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`${s.label} ${st('new_tab')}`}
                      className="flex h-11 w-11 items-center justify-center rounded-full border border-ls-forest/15 text-ls-forest transition-colors hover:bg-ls-forest hover:text-ls-cream"
                    >
                      <s.icon className="h-[18px] w-[18px]" aria-hidden />
                    </a>
                  </li>
                ))}
              </ul>
            </Reveal>
          )}
        </div>

        <Reveal className="lg:col-span-7" delay={0.06}>
          <div className="relative aspect-[4/3] overflow-hidden rounded-[28px] bg-ls-sand shadow-[0_40px_80px_-50px_rgba(35,46,40,0.55)] sm:aspect-[3/2]">
            <SiteImage fill name="visit" alt={st('visit_alt')} sizes="(min-width: 1240px) 680px, (min-width: 1024px) 55vw, 100vw" className="object-[80%_50%]" />
          </div>
        </Reveal>
      </Container>
    </section>
  );
};

export default SiteVisit;
