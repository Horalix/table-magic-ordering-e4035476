import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { motion } from 'framer-motion';
import LanguageSelector from '@/components/guest/LanguageSelector';
import { cn } from '@/lib/utils';
import { easeEnter } from '@/lib/motion';
import type { Locale } from '@/lib/i18n';
import type { Venue } from '@/lib/venues';
import { sitePath } from '@/lib/seo/structured-data';
import { rcopy } from '@/lib/reservation-copy';
import { reserveLook, type ReservePhoto } from './reserve-look';

/**
 * The frame the two booking pages share (/reserve/ and a guest's own
 * /reservation/<id>), so asking for a table feels like the restaurant's
 * website and not like a form: its photograph, its name as it writes it, its
 * colours and serif (the theme, src/index.css), and the language switch a
 * guest arriving straight from a search or a message needs.
 *
 * - ReserveFrame: the page, with the way back to the website and the
 *   language switch over its top.
 * - ReserveSplit: the booking page. On a phone the photograph is a band
 *   across the top that fades into the page, the title over its foot; on a
 *   wide screen the title, the photograph in an arch and the facts stay put
 *   on one side while the form scrolls on the other.
 * - ReserveCard, ReserveEyebrow: the surface and the small label both pages
 *   build from.
 */

/** Corners follow the restaurant: round at La Soul, nearly square at Vera Italia (--radius). */
export const RESERVE_CARD = 'rounded-[calc(var(--radius)*2.2)] border border-border/70 bg-card shadow-lux';
/** A button that is a pill at La Soul and a plate at Vera Italia. */
export const RESERVE_PILL = "rounded-full [[data-venue='veraitalia']_&]:rounded-[3px]";

const WIDE = '(min-width: 1024px)';

/** Whether the screen is wide enough for the two-column page; known before the first paint. */
function useWide(): boolean {
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.matchMedia(WIDE).matches);
  useEffect(() => {
    const query = window.matchMedia(WIDE);
    const onChange = () => setWide(query.matches);
    onChange();
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return wide;
}

export const ReservePhotoImage = ({ photo, alt, sizes, className }: { photo: ReservePhoto; alt: string; sizes: string; className?: string }) => (
  <img
    src={photo.src}
    srcSet={photo.srcSet}
    sizes={sizes}
    alt={alt}
    width={photo.width}
    height={photo.height}
    loading="eager"
    decoding="async"
    {...({ fetchpriority: 'high' } as Record<string, string>)}
    style={{ backgroundImage: `url(${photo.blur})`, backgroundSize: 'cover', objectPosition: photo.focus }}
    className={cn('h-full w-full object-cover', className)}
  />
);

export const ReserveEyebrow = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <p className={cn('flex items-center gap-3 text-[11px] font-sans font-semibold uppercase tracking-[0.24em] text-primary rtl:tracking-normal', className)}>
    <span className="h-px w-7 bg-primary/50" aria-hidden />
    <span>{children}</span>
  </p>
);

export const ReserveCard = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn(RESERVE_CARD, className)} {...props} />
));
ReserveCard.displayName = 'ReserveCard';

/** Rises in once, when the page opens; simply there for a guest who asked for less motion. */
export const ReserveRise = ({ children, delay = 0, className }: { children: React.ReactNode; delay?: number; className?: string }) => (
  <motion.div
    className={className}
    initial={{ opacity: 0, y: 14 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.7, ease: easeEnter, delay }}
  >
    {children}
  </motion.div>
);

export const ReserveFrame = ({ venue, locale, children, className }: {
  venue: Venue; locale: Locale; children: React.ReactNode; className?: string;
}) => {
  const look = reserveLook(venue.slug);
  return (
    <div className={cn('relative min-h-[100dvh] bg-background text-foreground', className)} dir={locale === 'ar' ? 'rtl' : 'ltr'}>
      <header className="absolute inset-x-0 top-0 z-30 pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex h-16 max-w-[1180px] items-center justify-between gap-3 px-4 sm:px-8 lg:h-[88px]">
          <Link
            to={sitePath(locale)}
            aria-label={rcopy('back', locale, { venue: venue.name })}
            className={cn(
              'group inline-flex min-h-[44px] items-center gap-3 border border-border/60 bg-background/85 pe-5 ps-3.5 text-foreground shadow-sm backdrop-blur-md transition-colors hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
              RESERVE_PILL,
            )}
          >
            <ArrowLeft className="h-4 w-4 shrink-0 transition-transform duration-300 group-hover:-translate-x-0.5 rtl:rotate-180 rtl:group-hover:translate-x-0.5" aria-hidden />
            {look.wordmark
              ? <img src={look.wordmark.src} alt={venue.name} width={look.wordmark.width} height={look.wordmark.height} className={look.wordmark.className} />
              : <span className="font-serif text-[15px] font-semibold leading-none">{venue.name}</span>}
          </Link>
          <LanguageSelector />
        </div>
      </header>
      {children}
    </div>
  );
};

export const ReserveSplit = ({ venue, locale, title, intro, facts, children }: {
  venue: Venue;
  locale: Locale;
  /** The page's one h1. */
  title: string;
  /** A sentence under the title; a node so the page can hold its place while it loads. */
  intro?: React.ReactNode;
  /** What the restaurant takes: hours, party size, where it is. Under the photograph on a wide screen. */
  facts?: React.ReactNode;
  children: React.ReactNode;
}) => {
  const look = reserveLook(venue.slug);
  const wide = useWide();
  const alt = rcopy('photo_alt', locale, { venue: venue.name });

  return (
    // dir again: a browser test reads it from the form's parent.
    <div dir={locale === 'ar' ? 'rtl' : 'ltr'} className="mx-auto max-w-[1180px] lg:grid lg:grid-cols-[minmax(0,0.88fr)_minmax(0,1fr)] lg:gap-14 lg:px-8 xl:gap-20">
      <aside className="lg:sticky lg:top-0 lg:flex lg:h-[100dvh] lg:min-h-[620px] lg:flex-col lg:pb-10 lg:pt-[116px]">
        {!wide && (
          <div className="relative h-[38svh] max-h-[400px] min-h-[250px] overflow-hidden bg-secondary">
            <ReservePhotoImage photo={look.wide} alt={alt} sizes="100vw" />
            {/* The photograph fades into the page where the title sits. */}
            <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-background from-[4%] via-background/55 via-[34%] to-transparent to-[72%]" />
          </div>
        )}

        <ReserveRise className={cn('relative px-5 sm:px-8 lg:order-1 lg:mt-0 lg:px-0', !wide && '-mt-[4.5rem]')}>
          <ReserveEyebrow>{rcopy('eyebrow', locale)} · {venue.name}</ReserveEyebrow>
          <h1 className="mt-4 font-serif text-[2.6rem] font-medium leading-[1.04] tracking-[-0.015em] text-foreground text-balance sm:text-[3rem] lg:text-[3.5rem] rtl:font-semibold rtl:leading-[1.3] rtl:tracking-normal">
            {title}
          </h1>
          {intro && <div className="mt-4 max-w-[30rem] text-[15.5px] font-sans leading-[1.65] text-muted-foreground lg:text-[16.5px]">{intro}</div>}
        </ReserveRise>

        {wide && (
          <ReserveRise delay={0.08} className="order-2 mt-8 flex min-h-0 flex-1">
            <div
              className="relative aspect-[4/5] h-full max-h-[540px] overflow-hidden bg-secondary shadow-[0_40px_80px_-50px_hsl(var(--foreground)/0.55)]"
              // An arch: a true semicircle on top (half the width is 40% of a 4:5 box's height), soft feet.
              style={{ borderRadius: '50% 50% calc(var(--radius) * 1.6) calc(var(--radius) * 1.6) / 40% 40% calc(var(--radius) * 1.6) calc(var(--radius) * 1.6)' }}
            >
              <ReservePhotoImage photo={look.tall} alt={alt} sizes="(min-width: 1024px) 432px, 1px" />
            </div>
          </ReserveRise>
        )}

        {facts && <ReserveRise delay={0.14} className="mt-5 px-5 sm:px-8 lg:order-3 lg:mt-7 lg:px-0">{facts}</ReserveRise>}
      </aside>

      <main className="mx-auto max-w-xl px-5 pb-20 pt-7 sm:px-8 lg:mx-0 lg:max-w-none lg:px-0 lg:pb-24 lg:pt-[116px]">
        {children}
      </main>
    </div>
  );
};
