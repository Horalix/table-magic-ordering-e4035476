import { Link } from 'react-router-dom';
import { ArrowRight, ArrowUpRight } from 'lucide-react';
import SmartImage from '@/components/ui/SmartImage';
import { useSiteT, type SiteKey } from '@/lib/site-i18n';
import { menuPath, type Venue } from '@/lib/venues';
import Reveal from './Reveal';
import { Container, SectionHeading } from './SiteSection';
import { categoryHref, useSignatureDishes, type SiteCategory } from './signature-dishes';

const CATEGORY_KEY: Record<SiteCategory, SiteKey> = { Drinks: 'cat_drinks', Food: 'cat_food', Desserts: 'cat_desserts' };

/**
 * A handful of real dishes with their real photographs, each a link into the
 * menu at its section. A swipeable row on a phone, a grid on a desktop.
 */
const SiteSignatures = ({ venue }: { venue: Venue }) => {
  const { st, locale } = useSiteT();
  const dishes = useSignatureDishes();

  return (
    <section aria-labelledby="signatures-title" className="overflow-hidden bg-ls-paper py-20 sm:py-32 lg:py-36">
      <Container>
        <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <SectionHeading id="signatures-title" eyebrow={st('sig_eyebrow')} title={st('sig_title')} lead={st('sig_sub')} />
          <Reveal className="hidden shrink-0 sm:block" delay={0.1}>
            <Link
              to={menuPath(venue.slug)}
              className="group inline-flex items-center gap-2 border-b border-ls-forest/25 pb-1 text-[15px] font-semibold text-ls-forest transition-colors hover:border-ls-forest focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ls-sage-deep focus-visible:ring-offset-4 focus-visible:ring-offset-ls-paper"
            >
              {st('sig_all')}
              <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5 rtl:-scale-x-100 rtl:group-hover:-translate-x-0.5" aria-hidden />
            </Link>
          </Reveal>
        </div>

        <ul
          className="scrollbar-hide -mx-5 mt-12 flex snap-x snap-mandatory scroll-px-5 gap-4 overflow-x-auto px-5 pb-2 sm:-mx-8 sm:scroll-px-8 sm:px-8 lg:mx-0 lg:grid lg:grid-cols-4 lg:gap-x-6 lg:gap-y-12 lg:overflow-visible lg:px-0 lg:pb-0"
        >
          {dishes.map((dish, i) => {
            const name = dish.name[locale] || dish.name.en;
            return (
              <Reveal as="li" key={dish.id} delay={Math.min(i % 4, 3) * 0.07} className="w-[68vw] max-w-[300px] shrink-0 snap-start sm:w-[42vw] lg:w-auto lg:max-w-none">
                <Link
                  to={categoryHref(dish.category, venue.slug, dish.section)}
                  className="group block rounded-[24px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ls-sage-deep focus-visible:ring-offset-4 focus-visible:ring-offset-ls-paper"
                >
                  <div className="relative overflow-hidden rounded-[24px] bg-ls-sand">
                    <SmartImage
                      id={dish.id}
                      src={dish.imageUrl ?? undefined}
                      alt={name}
                      width={480}
                      height={600}
                      sizes="(min-width: 1240px) 290px, (min-width: 1024px) 23vw, (min-width: 640px) 42vw, 68vw"
                      wrapperClassName="w-full rounded-[24px]"
                      className="group-hover:scale-[1.035] group-hover:[transition-duration:1200ms]"
                      fallbackText={name}
                    />
                    {dish.badge && (
                      <span className="absolute start-3 top-3 rounded-full bg-ls-cream/90 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-ls-forest backdrop-blur-sm rtl:tracking-normal">
                        {st(dish.badge === 'new' ? 'sig_new' : 'sig_featured')}
                      </span>
                    )}
                  </div>
                  <div className="mt-4 flex items-start justify-between gap-3 px-1">
                    <div className="min-w-0">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ls-sage-deep rtl:tracking-normal">{st(CATEGORY_KEY[dish.category])}</p>
                      <h3 className="mt-1.5 font-serif text-[19px] font-medium leading-snug text-ls-forest rtl:font-semibold">{name}</h3>
                    </div>
                    <span className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-ls-forest/15 text-ls-forest transition-colors duration-300 group-hover:border-ls-forest group-hover:bg-ls-forest group-hover:text-ls-cream" aria-hidden>
                      <ArrowUpRight className="h-4 w-4 rtl:-scale-x-100" />
                    </span>
                  </div>
                </Link>
              </Reveal>
            );
          })}
        </ul>

        <div className="mt-8 sm:hidden">
          <Link
            to={menuPath(venue.slug)}
            className="inline-flex items-center gap-2 border-b border-ls-forest/25 pb-1 text-[15px] font-semibold text-ls-forest"
          >
            {st('sig_all')}
            <ArrowRight className="h-4 w-4 rtl:-scale-x-100" aria-hidden />
          </Link>
        </div>
      </Container>
    </section>
  );
};

export default SiteSignatures;
