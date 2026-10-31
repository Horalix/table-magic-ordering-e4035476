import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, MapPin } from 'lucide-react';
import { easeEnter } from '@/lib/motion';
import { useSiteT } from '@/lib/site-i18n';
import { menuPath, type Venue } from '@/lib/venues';
import { siteImage, siteSrc, siteSrcSet } from './site-image-data';

/**
 * Art direction, in three layouts:
 *  - phones: a portrait photograph filling the screen, dishes at the top and
 *    the words over the calm linen below;
 *  - tablets (640–1023px): the landscape photograph as a band, cropped to the
 *    dishes, with the words beneath it — a portrait crop at these widths put
 *    the headline across the burger;
 *  - from 1024px: the landscape photograph full-bleed, words on its empty side.
 * index.html preloads the same two candidates on `/` with the same media
 * queries, so the hero is in flight before this code has even downloaded.
 */
export const HERO_WIDE_MEDIA = '(min-width: 640px)';

const enter = (delay: number) => ({
  initial: { opacity: 0, y: 18 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.9, ease: easeEnter, delay },
});

const SiteHero = ({ venue }: { venue: Venue }) => {
  const { st } = useSiteT();
  const wide = siteImage('hero-wide');
  const tall = siteImage('hero-tall');
  const [loaded, setLoaded] = useState(false);

  return (
    <section
      aria-labelledby="hero-title"
      className="relative isolate flex min-h-[max(100svh,600px)] flex-col justify-end overflow-hidden bg-ls-cream sm:min-h-0 sm:justify-start lg:h-[clamp(640px,56.25vw,100svh)] lg:justify-center xl:h-[100svh] xl:max-h-[1100px] xl:min-h-[640px]"
    >
      <div className="absolute inset-0 -z-10 sm:relative sm:inset-auto sm:z-0 sm:aspect-[16/10] sm:w-full lg:absolute lg:inset-0 lg:-z-10 lg:aspect-auto">
        <picture>
          <source media={HERO_WIDE_MEDIA} srcSet={siteSrcSet('hero-wide')} sizes="100vw" width={wide.width} height={wide.height} />
          <img
            src={siteSrc('hero-tall', 720)}
            srcSet={siteSrcSet('hero-tall')}
            sizes="100vw"
            alt={st('hero_alt')}
            width={tall.width}
            height={tall.height}
            loading="eager"
            decoding="async"
            {...({ fetchpriority: 'high' } as Record<string, string>)}
            onLoad={() => setLoaded(true)}
            className="absolute inset-0 h-full w-full object-cover object-[50%_0%] rtl:-scale-x-100 sm:object-[88%_50%] lg:object-[100%_50%]"
            style={loaded ? undefined : { backgroundColor: '#EFE9DD' }}
          />
        </picture>

        {/* A cream veil where the words sit, so they stay legible over any
            crop of the photograph; the photo itself keeps its full colour.
            On a tablet the words sit below the photo, which just fades out.
            On a narrow or short phone the words start higher, so the veil does too. */}
        <div
          aria-hidden
          className="absolute inset-0 bg-gradient-to-t from-ls-cream from-[18%] via-ls-cream/80 via-[40%] to-transparent to-[62%] max-[389px]:via-[50%] max-[389px]:to-[74%] [@media(max-height:700px)]:via-[52%] [@media(max-height:700px)]:to-[76%] sm:from-ls-cream sm:from-0% sm:via-ls-cream/0 sm:via-[22%] sm:to-transparent sm:to-100% lg:bg-gradient-to-r lg:from-ls-cream/95 lg:from-[8%] lg:via-ls-cream/60 lg:via-[34%] lg:to-transparent lg:to-[58%] lg:rtl:bg-gradient-to-l"
        />
      </div>

      <div className="mx-auto w-full max-w-[1240px] px-5 pb-[max(2.75rem,calc(env(safe-area-inset-bottom)+1.5rem))] pt-32 sm:px-8 sm:pb-20 sm:pt-4 lg:pb-0 lg:pt-20">
        <div className="max-w-[35rem] lg:max-w-[26rem] xl:max-w-[35rem]">
          <motion.p {...enter(0.05)} className="flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.26em] text-ls-sage-deep rtl:tracking-normal">
            <span className="h-px w-7 bg-ls-sage-deep/60" aria-hidden />
            <span>{st('tagline')} · {st('city')}</span>
          </motion.p>
          <motion.h1
            id="hero-title"
            {...enter(0.12)}
            className="mt-5 font-serif text-[2.6rem] max-[389px]:text-[2.25rem] [@media(max-height:700px)]:text-[2.25rem] font-medium leading-[1.04] tracking-[-0.015em] text-ls-forest text-balance sm:text-[3.4rem] lg:text-[clamp(3.5rem,5.4vw,5.25rem)] rtl:lg:text-[clamp(3.25rem,4.8vw,4.6rem)] rtl:font-semibold rtl:leading-[1.3] rtl:tracking-normal"
          >
            {st('hero_title')}
          </motion.h1>
          <motion.p {...enter(0.2)} className="mt-5 max-w-[30rem] text-[15.5px] leading-[1.65] text-ls-grey sm:text-[17px] lg:mt-6 lg:text-[18px]">
            {st('hero_sub')}
          </motion.p>
          <motion.div {...enter(0.28)} className="mt-7 flex flex-wrap items-center gap-2.5 sm:gap-3 lg:mt-9">
            <Link
              to={menuPath(venue.slug)}
              className="group inline-flex h-[52px] items-center gap-2 rounded-full bg-ls-forest pe-4 ps-5 text-[14.5px] font-semibold sm:gap-2.5 sm:pe-5 sm:ps-6 sm:text-[15px] text-ls-cream shadow-[0_14px_30px_-14px_rgba(35,46,40,0.7)] transition-colors hover:bg-ls-forest-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ls-sage-deep focus-visible:ring-offset-2 focus-visible:ring-offset-ls-cream"
            >
              {st('hero_cta')}
              <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5 rtl:-scale-x-100 rtl:group-hover:-translate-x-0.5" aria-hidden />
            </Link>
            <a
              href="#visit"
              className="inline-flex h-[52px] items-center gap-2 rounded-full border border-ls-forest/20 bg-ls-cream/60 px-4 text-[14.5px] font-semibold sm:px-5 sm:text-[15px] text-ls-forest backdrop-blur-sm transition-colors hover:border-ls-forest/40 hover:bg-ls-cream focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ls-sage-deep focus-visible:ring-offset-2 focus-visible:ring-offset-ls-cream"
            >
              <MapPin className="h-4 w-4 text-ls-sage-deep" aria-hidden />
              {st('hero_find')}
            </a>
          </motion.div>
          <motion.ul {...enter(0.36)} className="mt-10 hidden items-center gap-x-6 gap-y-2 text-[13px] font-medium text-ls-forest/75 lg:flex">
            {(['fact_halal', 'fact_alcohol', 'fact_fresh'] as const).map((k) => (
              <li key={k} className="flex items-center gap-2.5">
                <span className="h-1.5 w-1.5 rotate-45 bg-ls-sage" aria-hidden />
                {st(k)}
              </li>
            ))}
          </motion.ul>
        </div>
      </div>
    </section>
  );
};

export default SiteHero;
