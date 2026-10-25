import { useSiteT } from '@/lib/site-i18n';
import Reveal from './Reveal';
import SiteImage from './SiteImage';
import { Container, Eyebrow } from './SiteSection';

/**
 * Who La Soul is, in two short paragraphs and two arched photographs — the
 * arch is the shape of the La Soul mark. Nothing here is invented: no
 * founders, years or awards, only what the café is.
 */
const SiteStory = () => {
  const { st } = useSiteT();
  return (
    <section id="story" aria-labelledby="story-title" className="scroll-mt-20 py-20 sm:py-32 lg:py-40">
      <Container className="grid items-center gap-14 lg:grid-cols-12 lg:gap-10">
        <Reveal className="lg:col-span-5">
          <Eyebrow>{st('story_eyebrow')}</Eyebrow>
          <h2
            id="story-title"
            className="mt-4 font-serif text-[2.1rem] font-medium leading-[1.08] tracking-[-0.012em] text-ls-forest text-balance sm:text-[2.75rem] lg:text-[3.25rem] rtl:font-semibold rtl:leading-[1.3] rtl:tracking-normal"
          >
            {st('story_title')}
          </h2>
          <div className="mt-6 space-y-4 text-[16px] leading-[1.75] text-ls-grey sm:text-[17px]">
            <p>{st('story_p1')}</p>
            <p>{st('story_p2')}</p>
          </div>
          <ul className="mt-9 grid grid-cols-3 border-y border-ls-forest/10">
            {(['fact_halal', 'fact_alcohol', 'fact_fresh'] as const).map((k, i) => (
              <li
                key={k}
                className={`flex flex-col items-start gap-2.5 py-5 sm:flex-row sm:items-center ${i > 0 ? 'border-s border-ls-forest/10 ps-3.5 sm:ps-6' : 'pe-3.5 sm:pe-6'}`}
              >
                <span className="h-1.5 w-1.5 shrink-0 rotate-45 bg-ls-sage" aria-hidden />
                <span className="font-serif text-[15px] font-medium leading-snug text-ls-forest sm:text-[17px] rtl:font-semibold">{st(k)}</span>
              </li>
            ))}
          </ul>
        </Reveal>

        <div className="relative lg:col-span-7 lg:ps-10">
          <div className="relative grid grid-cols-2 gap-4 sm:gap-6">
            <Reveal className="relative">
              <div className="relative ls-arch-2x3 aspect-[2/3] overflow-hidden bg-ls-sand shadow-[0_30px_60px_-35px_rgba(35,46,40,0.45)]">
                <SiteImage fill name="story-burger" alt={st('story_burger_alt')} sizes="(min-width: 1024px) 26vw, 46vw" />
              </div>
            </Reveal>
            <Reveal className="relative mt-14 sm:mt-24" delay={0.12}>
              <div className="relative ls-arch-2x3 aspect-[2/3] overflow-hidden bg-ls-sand shadow-[0_30px_60px_-35px_rgba(35,46,40,0.45)]">
                <SiteImage fill name="story-cake" alt={st('story_cake_alt')} sizes="(min-width: 1024px) 26vw, 46vw" />
              </div>
            </Reveal>
          </div>
        </div>
      </Container>
    </section>
  );
};

export default SiteStory;
