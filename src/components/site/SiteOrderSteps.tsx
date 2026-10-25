import { QrCode, ScrollText, HandCoins, type LucideIcon } from 'lucide-react';
import { useSiteT, type SiteKey } from '@/lib/site-i18n';
import Reveal from './Reveal';
import SiteImage from './SiteImage';
import { Container, SectionHeading } from './SiteSection';

const STEPS: { icon: LucideIcon; title: SiteKey; body: SiteKey }[] = [
  { icon: QrCode, title: 'step1_title', body: 'step1_body' },
  { icon: ScrollText, title: 'step2_title', body: 'step2_body' },
  { icon: HandCoins, title: 'step3_title', body: 'step3_body' },
];

/**
 * How table ordering works, in the three steps it actually has. The phone in
 * the photograph shows the real La Soul menu (a screenshot placed into the
 * generated scene), not an invented interface.
 *
 * Phone: heading, photo, steps. Desktop: photo on the left, heading and steps
 * on the right — placed on the grid, so the reading order stays the same.
 */
const SiteOrderSteps = () => {
  const { st } = useSiteT();
  return (
    <section id="order" aria-labelledby="order-title" className="scroll-mt-20 bg-ls-sand py-20 sm:py-32 lg:py-36">
      <Container className="grid gap-10 lg:grid-cols-12 lg:gap-x-16 lg:gap-y-0">
        <div className="lg:col-span-5 lg:col-start-8 lg:row-start-1 lg:self-end">
          <SectionHeading id="order-title" eyebrow={st('order_eyebrow')} title={st('order_title')} lead={st('order_sub')} />
        </div>

        <Reveal className="lg:col-span-7 lg:col-start-1 lg:row-span-2 lg:row-start-1 lg:self-center">
          <div className="relative aspect-[4/3] overflow-hidden rounded-[28px] bg-ls-cream shadow-[0_40px_80px_-50px_rgba(35,46,40,0.6)] sm:aspect-[3/2] lg:aspect-[5/4]">
            <SiteImage fill name="order-table" alt={st('order_alt')} sizes="(min-width: 1240px) 680px, (min-width: 1024px) 55vw, 100vw" className="object-[38%_50%]" />
          </div>
        </Reveal>

        <div className="lg:col-span-5 lg:col-start-8 lg:row-start-2 lg:self-start">
          <ol className="lg:mt-10">
            {STEPS.map((s, i) => (
              <Reveal as="li" key={s.title} delay={i * 0.08} className="flex gap-5 border-t border-ls-forest/10 py-6 last:border-b">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-ls-cream text-ls-sage-deep shadow-[inset_0_0_0_1px_rgba(35,46,40,0.08)]" aria-hidden>
                  <s.icon className="h-5 w-5" strokeWidth={1.6} />
                </span>
                <div className="min-w-0">
                  <p className="flex items-baseline gap-3">
                    <span className="font-serif text-[13px] font-medium tabular-nums text-ls-sage-deep" aria-hidden>{String(i + 1).padStart(2, '0')}</span>
                    <span className="font-serif text-[21px] font-medium leading-tight text-ls-forest rtl:font-semibold">{st(s.title)}</span>
                  </p>
                  <p className="mt-1.5 text-[15.5px] leading-[1.65] text-ls-grey">{st(s.body)}</p>
                </div>
              </Reveal>
            ))}
          </ol>
          <Reveal delay={0.2}>
            <p className="mt-6 text-[14px] leading-[1.6] text-ls-grey">{st('order_note')}</p>
          </Reveal>
        </div>
      </Container>
    </section>
  );
};

export default SiteOrderSteps;
