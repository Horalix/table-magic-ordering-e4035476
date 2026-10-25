import { useSiteT, type SiteKey } from '@/lib/site-i18n';
import Reveal from './Reveal';
import SiteImage from './SiteImage';
import { Container, SectionHeading } from './SiteSection';

const PROMISES: { title: SiteKey; body: SiteKey }[] = [
  { title: 'promise_halal_title', body: 'promise_halal_body' },
  { title: 'promise_alcohol_title', body: 'promise_alcohol_body' },
  { title: 'promise_fresh_title', body: 'promise_fresh_body' },
  { title: 'promise_allergens_title', body: 'promise_allergens_body' },
];

/** The halal and quality promise, on the deep forest green of the brand. */
const SitePromise = () => {
  const { st } = useSiteT();
  return (
    <section aria-labelledby="promise-title" className="relative isolate overflow-hidden bg-ls-forest py-20 text-ls-cream sm:py-32 lg:py-40">
      {/* The olive branch from the La Soul mark, very faint. */}
      <img
        src="/brand/branch-white.webp"
        alt=""
        aria-hidden
        width={720}
        height={670}
        loading="lazy"
        decoding="async"
        className="pointer-events-none absolute -end-24 -top-16 -z-10 w-[26rem] select-none opacity-[0.07] rtl:-scale-x-100 lg:-end-10 lg:w-[34rem]"
      />
      <Container className="grid items-center gap-14 lg:grid-cols-12 lg:gap-16">
        <div className="lg:col-span-6">
          <SectionHeading id="promise-title" tone="dark" eyebrow={st('promise_eyebrow')} title={st('promise_title')} />
          <dl className="mt-12 grid gap-x-10 gap-y-9 sm:grid-cols-2">
            {PROMISES.map((p, i) => (
              <Reveal key={p.title} delay={i * 0.07} className="border-t border-ls-cream/15 pt-5">
                <dt className="font-serif text-[21px] font-medium leading-tight text-ls-cream rtl:font-semibold">{st(p.title)}</dt>
                <dd className="mt-2.5 text-[15.5px] leading-[1.65] text-ls-cream/70">{st(p.body)}</dd>
              </Reveal>
            ))}
          </dl>
        </div>
        <Reveal className="lg:col-span-6" delay={0.1}>
          <div className="relative aspect-[4/3] overflow-hidden rounded-[28px] bg-ls-forest-soft ls-arch-5x6 lg:aspect-[5/6]">
            <SiteImage fill name="promise" alt={st('promise_alt')} sizes="(min-width: 1240px) 580px, (min-width: 1024px) 46vw, 100vw" className="object-[60%_50%]" />
          </div>
        </Reveal>
      </Container>
    </section>
  );
};

export default SitePromise;
