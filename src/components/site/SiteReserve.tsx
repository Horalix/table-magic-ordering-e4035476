import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRight, CalendarClock, Check, Clock, Timer } from 'lucide-react';
import { easeEnter } from '@/lib/motion';
import { useSiteT } from '@/lib/site-i18n';
import { rcopy } from '@/lib/reservation-copy';
import { RESERVE_PATH } from '@/lib/seo/reservations';
import { hoursDays } from '@/lib/seo/structured-data';
import type { Venue } from '@/lib/venues';
import Reveal from './Reveal';
import { Container, Eyebrow } from './SiteSection';

/**
 * "Reserve a table" as a part of the page of its own, after the menu: by then
 * a visitor knows what they would come for. A sage card on the cream page (the
 * parts after it are sand or forest, so it is neither), found by someone
 * scrolling past, with the one button and the phone number for whoever would
 * rather call.
 *
 * Drawn only while the restaurant takes requests online (`open`, from
 * useReservationsOffered): the website never offers what the restaurant does
 * not (src/lib/seo/reservations.ts).
 */
const SiteReserve = ({ venue, open }: { venue: Venue; open: boolean }) => {
  const { st, locale } = useSiteT();
  if (!open) return null;
  const hours = venue.hours?.[0];
  // A phone number inside an Arabic sentence keeps its own left-to-right run.
  const phone = locale === 'ar' ? `⁦${venue.phone}⁩` : venue.phone;

  return (
    <section id="reserve" aria-labelledby="reserve-title" className="scroll-mt-24 pb-20 sm:pb-28 lg:pb-32">
      <Container>
        <Reveal>
          <div className="relative isolate overflow-hidden rounded-[28px] bg-ls-sage/20 px-6 py-12 text-ls-forest ring-1 ring-inset ring-ls-sage/25 sm:rounded-[36px] sm:px-12 sm:py-16 lg:px-16 lg:py-20">
            {/* The olive branch of the mark, barely there. */}
            <img
              src="/brand/branch-white.webp"
              alt=""
              aria-hidden
              loading="lazy"
              decoding="async"
              className="pointer-events-none absolute -end-16 -top-10 -z-10 h-[140%] w-auto max-w-none opacity-[0.04] brightness-0 rtl:-scale-x-100 sm:-end-6 sm:opacity-[0.07]"
            />
            <div className="grid items-end gap-10 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-16">
              <div>
                <Eyebrow>{st('reserve_eyebrow')}</Eyebrow>
                <h2
                  id="reserve-title"
                  className="mt-4 max-w-[16ch] font-serif text-[2.1rem] font-medium leading-[1.08] tracking-[-0.012em] text-ls-forest text-balance sm:text-[2.75rem] lg:text-[3.25rem] rtl:font-semibold rtl:leading-[1.3] rtl:tracking-normal"
                >
                  {st('reserve_title')}
                </h2>
                <p className="mt-4 max-w-[34rem] text-[16px] leading-[1.7] text-ls-forest/75 sm:text-[17px]">{st('reserve_sub')}</p>
                <ul className="mt-7 flex flex-wrap gap-x-7 gap-y-2.5 text-[14px] font-medium text-ls-forest/85">
                  {hours && (
                    <li className="flex items-center gap-2.5">
                      <Clock className="h-4 w-4 text-ls-sage-deep" strokeWidth={1.7} aria-hidden />
                      <span>{hoursDays(hours, locale)} <span dir="ltr" className="tabular-nums">{hours.opens}–{hours.closes}</span></span>
                    </li>
                  )}
                  <li className="flex items-center gap-2.5"><Timer className="h-4 w-4 text-ls-sage-deep" strokeWidth={1.7} aria-hidden />{st('reserve_fact_fast')}</li>
                  <li className="flex items-center gap-2.5"><Check className="h-4 w-4 text-ls-sage-deep" strokeWidth={1.7} aria-hidden />{st('reserve_fact_free')}</li>
                </ul>
              </div>

              <div className="flex flex-col items-start gap-4 lg:items-end">
                <Link
                  to={RESERVE_PATH}
                  data-testid="reserve-link"
                  className="group inline-flex h-[58px] items-center gap-3 rounded-full bg-ls-forest pe-6 ps-7 text-[16px] font-semibold text-ls-cream shadow-[0_18px_36px_-16px_rgba(35,46,40,0.75)] transition-colors hover:bg-ls-forest-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ls-sage-deep focus-visible:ring-offset-2 focus-visible:ring-offset-ls-cream"
                >
                  <CalendarClock className="h-[18px] w-[18px] text-ls-sage" aria-hidden />
                  {rcopy('title', locale)}
                  <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5 rtl:-scale-x-100 rtl:group-hover:-translate-x-0.5" aria-hidden />
                </Link>
                {venue.phone && (
                  <a
                    href={`tel:${venue.phoneHref}`}
                    className="rounded-sm text-[14.5px] text-ls-forest/75 underline-offset-4 transition-colors hover:text-ls-forest hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ls-sage-deep focus-visible:ring-offset-2 lg:pe-2"
                  >
                    {st('reserve_or_call', { phone })}
                  </a>
                )}
              </div>
            </div>
          </div>
        </Reveal>
      </Container>
    </section>
  );
};

/**
 * On a phone, once the first screen has scrolled away: "Reserve a table"
 * stays within a thumb's reach, as one small pill above the bottom edge. It
 * steps aside where the page already offers the same button (the part above,
 * and "Visit") and over the footer, so it never covers a link or repeats one
 * in view.
 */
export const SiteReserveFloat = ({ open }: { open: boolean }) => {
  const { locale } = useSiteT();
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (!open) { setShown(false); return; }
    const covered = new Set<Element>();
    const places = ['#reserve', '#visit', 'footer'].map((s) => document.querySelector(s)).filter((el): el is Element => !!el);
    const update = () => setShown(window.scrollY > window.innerHeight * 0.7 && covered.size === 0);
    const watcher = new IntersectionObserver((entries) => {
      for (const e of entries) { if (e.isIntersecting) covered.add(e.target); else covered.delete(e.target); }
      update();
    }, { rootMargin: '0px 0px -12% 0px' });
    places.forEach((el) => watcher.observe(el));
    window.addEventListener('scroll', update, { passive: true });
    update();
    return () => { watcher.disconnect(); window.removeEventListener('scroll', update); };
  }, [open]);

  return (
    <AnimatePresence>
      {shown && (
        <motion.div
          className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center pb-[max(1rem,calc(env(safe-area-inset-bottom)+0.5rem))] md:hidden"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
          transition={{ duration: 0.35, ease: easeEnter }}
        >
          <Link
            to={RESERVE_PATH}
            className="pointer-events-auto inline-flex h-[52px] items-center gap-2.5 rounded-full bg-ls-forest pe-6 ps-5 text-[15px] font-semibold text-ls-cream shadow-[0_18px_40px_-14px_rgba(35,46,40,0.75)] ring-1 ring-ls-cream/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ls-sage-deep focus-visible:ring-offset-2 focus-visible:ring-offset-ls-cream"
          >
            <CalendarClock className="h-[18px] w-[18px] text-ls-sage" aria-hidden />
            {rcopy('title', locale)}
          </Link>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default SiteReserve;
