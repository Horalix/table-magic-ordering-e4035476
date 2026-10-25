import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { useSiteT, type SiteKey } from '@/lib/site-i18n';
import type { Venue } from '@/lib/venues';
import Reveal from './Reveal';
import SiteImage from './SiteImage';
import type { SiteImageName } from './site-image-data';
import { Container, SectionHeading } from './SiteSection';
import { categoryHref, type SiteCategory } from './signature-dishes';

const CARDS: { category: SiteCategory; image: SiteImageName; title: SiteKey; desc: SiteKey }[] = [
  { category: 'Drinks', image: 'cat-drinks', title: 'cat_drinks', desc: 'cat_drinks_desc' },
  { category: 'Food', image: 'cat-food', title: 'cat_food', desc: 'cat_food_desc' },
  { category: 'Desserts', image: 'cat-desserts', title: 'cat_desserts', desc: 'cat_desserts_desc' },
];

/**
 * The three ways into the menu. Wide cards stacked on a phone; on a larger
 * screen, three tall arches — the shape of the La Soul mark.
 */
const SiteMenuCards = ({ venue }: { venue: Venue }) => {
  const { st } = useSiteT();
  return (
    <section id="menu" aria-labelledby="menu-title" className="scroll-mt-20 py-20 sm:py-32 lg:py-40">
      <Container>
        <SectionHeading id="menu-title" eyebrow={st('menu_eyebrow')} title={st('menu_title')} lead={st('menu_sub')} align="center" className="max-w-[44rem]" />
        <ul className="mt-14 grid gap-5 sm:mt-16 sm:grid-cols-3 sm:gap-5 lg:gap-8">
          {CARDS.map((c, i) => {
            const title = st(c.title);
            return (
              <Reveal as="li" key={c.category} delay={i * 0.08}>
                <Link
                  to={categoryHref(c.category, venue.slug)}
                  aria-label={st('menu_open', { name: title })}
                  className="group relative block aspect-[4/3] overflow-hidden rounded-[28px] bg-ls-sand shadow-[0_30px_60px_-40px_rgba(35,46,40,0.55)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ls-sage-deep focus-visible:ring-offset-4 focus-visible:ring-offset-ls-cream ls-arch-card sm:aspect-[3/4.4]"
                >
                  <SiteImage
                    fill
                    name={c.image}
                    alt=""
                    sizes="(min-width: 1240px) 380px, (min-width: 640px) 31vw, 100vw"
                    className="object-[50%_62%] transition-transform [transition-duration:1400ms] ease-out group-hover:scale-[1.04]"
                  />
                  <span aria-hidden className="absolute inset-0 bg-gradient-to-t from-ls-forest/80 via-ls-forest/15 via-45% to-transparent" />
                  <span className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-4 p-6 sm:p-7">
                    <span className="min-w-0">
                      <span className="block font-serif text-[30px] font-medium leading-none text-ls-cream rtl:font-semibold rtl:leading-tight lg:text-[34px]">{title}</span>
                      <span className="mt-2.5 block text-[14px] leading-snug text-ls-cream/85">{st(c.desc)}</span>
                    </span>
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-ls-cream/15 text-ls-cream backdrop-blur-md transition-colors duration-300 group-hover:bg-ls-cream group-hover:text-ls-forest" aria-hidden>
                      <ArrowRight className="h-[18px] w-[18px] rtl:-scale-x-100" />
                    </span>
                  </span>
                </Link>
              </Reveal>
            );
          })}
        </ul>
      </Container>
    </section>
  );
};

export default SiteMenuCards;
