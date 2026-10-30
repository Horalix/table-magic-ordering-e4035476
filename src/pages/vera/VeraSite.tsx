import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, Clock, MapPin, Phone } from 'lucide-react';
import LanguageSelector from '@/components/guest/LanguageSelector';
import SmartImage from '@/components/ui/SmartImage';
import Reveal from '@/components/site/Reveal';
import { LightLine } from '@/components/vera/VeraMenu';
import { COURSES, SITE, pick, type Copy } from '@/components/vera/copy';
import roomImages from '@/components/vera/room-images.json';
import { useLanguageStore, useT } from '@/lib/i18n';
import { usePageMeta } from '@/lib/seo/page-meta';
import { sectionSlug } from '@/lib/menu-sections';
import { VENUES, menuCategoryPath, menuPath } from '@/lib/venues';
import menuData from '../../../scripts/vera-italia/menu.json';

/**
 * Vera Italia's website, /veraitalia/ (docs/two-restaurants.md).
 *
 * Built from what is real: the owner's photographs of the room, the dishes as
 * the kitchen plates them, the menu as sent. Facts that are not known yet —
 * the address, the hours, the phone — are simply not on the page; when they
 * are filled in src/lib/venues.ts, the "visit" section shows them. Until the
 * restaurant is live its menu links read "Opening soon" instead.
 */

type Room = keyof typeof roomImages;

/** A photograph of the room at every width it was cut to. */
const RoomImage = ({ name, alt, sizes, className, priority }: { name: Room; alt: string; sizes: string; className?: string; priority?: boolean }) => {
  const r = roomImages[name];
  const largest = r.widths[r.widths.length - 1];
  return (
    <img
      src={`/site/vera/${name}-${largest}.webp`}
      srcSet={r.widths.map((w) => `/site/vera/${name}-${w}.webp ${w}w`).join(', ')}
      sizes={sizes}
      alt={alt}
      width={r.width}
      height={r.height}
      loading={priority ? 'eager' : 'lazy'}
      decoding="async"
      {...(priority ? { fetchpriority: 'high' } : {})}
      style={{ backgroundImage: `url(${r.blur})`, backgroundSize: 'cover' }}
      className={className}
    />
  );
};

type Dish = { id: string; name: string; name_bs: string; name_ar: string; featured_rank?: number; featured_note?: string; featured_note_bs?: string; featured_note_ar?: string };
const SIGNATURES = (menuData.categories as { sections: { items: Dish[] }[] }[])
  .flatMap((c) => c.sections.flatMap((s) => s.items))
  .filter((d) => d.featured_rank)
  .sort((a, b) => (a.featured_rank ?? 0) - (b.featured_rank ?? 0));

const local = (d: Dish, field: 'name' | 'featured_note', locale: string) =>
  (locale === 'bs' ? d[`${field}_bs`] : locale === 'ar' ? d[`${field}_ar`] : d[field]) || d[field] || '';

const Caps = ({ children, light = false }: { children: string; light?: boolean }) => (
  <p className={`vi-caps ${light ? 'text-[hsl(var(--vi-glow))]/80' : 'text-accent'}`}>{children}</p>
);

const VeraSite = () => {
  const t = useT();
  const locale = useLanguageStore((s) => s.locale);
  const c = (copy: Copy) => pick(copy, locale);
  const venue = VENUES.veraitalia;

  usePageMeta({ title: c(SITE.seoTitle), description: c(SITE.seoDescription), path: '/veraitalia/', locale });

  // The header sits on the photograph until the page moves, then on travertine.
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const menuCta = venue.live ? (
    <Link
      to={menuPath('veraitalia')}
      className="inline-flex items-center justify-center min-h-[48px] px-7 rounded-full bg-primary text-primary-foreground font-sans text-sm font-semibold tracking-[0.08em] uppercase rtl:tracking-normal shadow-[0_12px_30px_-12px_hsl(var(--vi-terracotta)/0.7)] hover:brightness-110 transition"
    >
      {c(SITE.viewMenu)}
    </Link>
  ) : (
    <span className="inline-flex items-center min-h-[48px] px-7 rounded-full border border-[hsl(var(--vi-glow))]/50 text-[hsl(var(--vi-glow))] font-sans text-sm font-semibold tracking-[0.08em] uppercase rtl:tracking-normal">
      {c(SITE.openingSoon)}
    </span>
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* ---- Header ---------------------------------------------------- */}
      <header
        className={`fixed inset-x-0 top-0 z-40 transition-colors duration-500 ${scrolled ? 'bg-background/90 backdrop-blur-md shadow-[0_1px_0_hsl(var(--border))]' : 'bg-transparent'}`}
      >
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-5 sm:px-8">
          <a href="#top" aria-label="Vera Italia" dir="ltr">
            <img
              src={scrolled ? '/brand/vera/wordmark-ink.webp' : '/brand/vera/wordmark-cream.webp'}
              alt="Vera Italia"
              width={1434}
              height={193}
              className="h-[15px] sm:h-[18px] w-auto"
            />
          </a>
          <div className="flex items-center gap-2">
            {venue.live && (
              <Link
                to={menuPath('veraitalia')}
                className={`hidden sm:inline-flex items-center min-h-[40px] px-4 rounded-full text-[13px] font-sans font-semibold tracking-[0.08em] uppercase rtl:tracking-normal transition-colors ${scrolled ? 'text-foreground hover:bg-muted' : 'text-white hover:bg-white/10'}`}
              >
                {c(SITE.menuTitle)}
              </Link>
            )}
            <div className={scrolled ? '' : '[&_button]:text-white [&_button]:border-white/30'}>
              <LanguageSelector variant="site" />
            </div>
          </div>
        </div>
      </header>

      <main id="top">
        {/* ---- Hero: the room ------------------------------------------- */}
        <section className="relative h-[100svh] min-h-[600px] overflow-hidden bg-[hsl(var(--vi-espresso))]">
          <RoomImage name="room-2" alt={c(SITE.heroAlt)} sizes="100vw" priority className="absolute inset-0 h-full w-full object-cover" />
          <span aria-hidden className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/20 to-black/70" />
          <div className="relative z-10 flex h-full flex-col items-center justify-center px-6 text-center">
            <h1 dir="ltr">
              <img src="/brand/vera/lockup-cream.webp" alt="Vera Italia" width={1158} height={806} className="w-64 sm:w-80 h-auto drop-shadow-[0_2px_18px_rgba(0,0,0,0.35)]" />
            </h1>
            <p className="mt-7 font-serif italic text-[22px] sm:text-2xl text-[hsl(var(--vi-glow))]">{c(SITE.heroLine)}</p>
            <div className="mt-9">{menuCta}</div>
          </div>
          <a href="#benvenuti" aria-label={c(SITE.welcome)} className="absolute bottom-6 left-1/2 z-10 -translate-x-1/2 text-white/70 hover:text-white">
            <ChevronDown className="h-6 w-6 animate-bounce" aria-hidden />
          </a>
        </section>

        {/* ---- Welcome --------------------------------------------------- */}
        <section id="benvenuti" className="relative overflow-hidden px-6 py-24 sm:py-32 text-center">
          <LightLine className="absolute inset-x-0 top-10 h-16 w-full" />
          <Reveal className="relative mx-auto max-w-2xl">
            <Caps>{c(SITE.welcome)}</Caps>
            <h2 className="mt-6 font-serif text-[34px] sm:text-5xl font-light leading-[1.15] text-foreground">{c(SITE.intro)}</h2>
            <p className="mt-6 font-serif italic text-xl text-muted-foreground">{c(SITE.introRoom)}</p>
          </Reveal>
        </section>

        {/* ---- Signature dishes ----------------------------------------- */}
        <section className="px-5 sm:px-8 pb-24 sm:pb-32">
          <Reveal className="text-center">
            <Caps>{c(SITE.fromKitchen)}</Caps>
            <h2 className="mt-4 font-serif text-4xl sm:text-5xl font-light">{c(SITE.signatures)}</h2>
          </Reveal>
          <div className="mx-auto mt-14 grid max-w-5xl gap-x-6 gap-y-14 sm:grid-cols-3">
            {SIGNATURES.map((d, i) => (
              <Reveal key={d.id} delay={i * 0.12} className="text-center">
                <div className="mx-auto w-full max-w-[320px] aspect-[3/4] vi-arch overflow-hidden shadow-[0_30px_50px_-30px_rgba(43,33,27,0.8)]">
                  <SmartImage
                    id={d.id}
                    src={`/menu/${d.id}/1152.webp`}
                    alt={local(d, 'name', locale)}
                    width={320}
                    height={427}
                    sizes="(max-width: 640px) 86vw, 320px"
                    wrapperClassName="w-full h-full"
                    className="w-full h-full object-cover"
                  />
                </div>
                <h3 className="mt-6 font-serif text-[28px] font-normal">{local(d, 'name', locale)}</h3>
                <p className="mt-1 font-serif italic text-lg text-muted-foreground">{local(d, 'featured_note', locale)}</p>
              </Reveal>
            ))}
          </div>
        </section>

        {/* ---- The oven -------------------------------------------------- */}
        <section className="bg-[hsl(var(--vi-espresso))] text-[hsl(var(--vi-glow))]">
          <div className="mx-auto grid max-w-6xl items-center gap-12 px-6 py-24 sm:px-8 sm:py-32 md:grid-cols-2">
            <Reveal>
              <div className="mx-auto w-full max-w-[420px] aspect-[3/4] vi-arch overflow-hidden ring-1 ring-[hsl(var(--vi-brass)/0.4)]">
                <RoomImage name="room-1" alt={c(SITE.ovenAlt)} sizes="(max-width: 768px) 90vw, 420px" className="h-full w-full object-cover" />
              </div>
            </Reveal>
            <Reveal delay={0.1} className="text-center md:text-start">
              <Caps light>{c(SITE.oven)}</Caps>
              <h2 className="mt-5 font-serif text-4xl sm:text-5xl font-light">{c(SITE.ovenTitle)}</h2>
              <p className="mt-6 max-w-md mx-auto md:mx-0 font-serif text-[22px] leading-relaxed text-[hsl(var(--vi-glow))]/85">{c(SITE.ovenBody)}</p>
            </Reveal>
          </div>
        </section>

        {/* ---- The menu, by course --------------------------------------- */}
        <section className="px-5 sm:px-8 py-24 sm:py-32">
          <Reveal className="text-center">
            <Caps>Il Menù</Caps>
            <h2 className="mt-4 font-serif text-4xl sm:text-5xl font-light">{c(SITE.menuTitle)}</h2>
          </Reveal>
          <div className="mx-auto mt-14 grid max-w-5xl grid-cols-2 gap-x-4 gap-y-12 sm:grid-cols-4 sm:gap-x-6">
            {menuData.categories.map((cat, i) => {
              const course = COURSES[cat.name];
              const name = locale === 'bs' ? cat.name_bs : locale === 'ar' ? cat.name_ar : cat.name;
              const inner = (
                <>
                  <span className="block aspect-[3/4] vi-arch overflow-hidden shadow-[0_24px_40px_-28px_rgba(43,33,27,0.8)]">
                    {course && (
                      <SmartImage
                        id={course.cover}
                        src={`/menu/${course.cover}/768.webp`}
                        alt=""
                        width={240}
                        height={320}
                        sizes="(max-width: 640px) 44vw, 240px"
                        wrapperClassName="w-full h-full"
                        className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-[1.04]"
                      />
                    )}
                  </span>
                  <span className="mt-4 block font-serif text-2xl leading-tight">{name}</span>
                  {course && <span className="mt-1 block text-[13px] font-sans text-muted-foreground">{c(course.line)}</span>}
                </>
              );
              return (
                <Reveal key={cat.id} delay={i * 0.08} className="text-center">
                  {venue.live
                    ? <Link to={menuCategoryPath(sectionSlug(cat.name), 'veraitalia')} className="group block">{inner}</Link>
                    : <div>{inner}</div>}
                </Reveal>
              );
            })}
          </div>
          <div className="mt-14 text-center">
            {venue.live ? menuCta : <p className="vi-caps text-accent">{c(SITE.openingSoon)}</p>}
          </div>
        </section>

        {/* ---- The room -------------------------------------------------- */}
        <section className="relative">
          <RoomImage name="room-3" alt={c(SITE.roomAlt)} sizes="100vw" className="h-[70svh] min-h-[420px] w-full object-cover" />
          <span aria-hidden className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/35 to-transparent" />
          <Reveal className="absolute inset-x-0 bottom-0 px-6 pb-14 text-center text-[hsl(var(--vi-glow))]">
            <Caps light>{c(SITE.room)}</Caps>
            <h2 className="mt-4 font-serif text-4xl sm:text-5xl font-light">{c(SITE.roomTitle)}</h2>
            <p className="mx-auto mt-4 max-w-xl font-serif italic text-xl text-[hsl(var(--vi-glow))]/90">{c(SITE.roomBody)}</p>
          </Reveal>
        </section>

        {/* ---- Visit ----------------------------------------------------- */}
        <section className="px-6 py-24 sm:py-32 text-center">
          <Reveal className="mx-auto max-w-xl">
            <Caps>{c(SITE.visit)}</Caps>
            {venue.address ? (
              <>
                <h2 className="mt-5 font-serif text-4xl font-light">{venue.address}</h2>
                <div className="mt-8 flex flex-col items-center gap-3 font-sans text-sm">
                  {venue.hours?.map((h) => (
                    <span key={h.days.join()} className="inline-flex items-center gap-2"><Clock className="h-4 w-4 text-primary" aria-hidden />{h.opens}–{h.closes}</span>
                  ))}
                  {venue.phone && <a href={`tel:${venue.phoneHref}`} className="inline-flex items-center gap-2"><Phone className="h-4 w-4 text-primary" aria-hidden /><span dir="ltr">{venue.phone}</span></a>}
                  {venue.mapsUrl && <a href={venue.mapsUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2"><MapPin className="h-4 w-4 text-primary" aria-hidden />{t('find_us')}</a>}
                </div>
              </>
            ) : (
              <>
                <h2 className="mt-5 font-serif text-4xl sm:text-5xl font-light">{c(SITE.openingSoon)}</h2>
                <p className="mt-5 font-serif italic text-xl text-muted-foreground">{c(SITE.visitSoon)}</p>
              </>
            )}
          </Reveal>
        </section>
      </main>

      {/* ---- Footer ------------------------------------------------------ */}
      <footer className="bg-[hsl(var(--vi-espresso))] px-6 py-16 text-center text-[hsl(var(--vi-glow))]/80">
        <img src="/brand/vera/lockup-cream.webp" alt="Vera Italia" width={1158} height={806} className="mx-auto w-40 h-auto opacity-90" />
        <div className="mt-8 flex justify-center gap-6 font-sans text-[13px]">
          {venue.live && <Link to={menuPath('veraitalia')} className="hover:text-white">{c(SITE.menuTitle)}</Link>}
          <Link to="/privacy" className="hover:text-white">{t('privacy_security')}</Link>
        </div>
        <p className="mt-6 vi-caps text-[hsl(var(--vi-glow))]/50">© {new Date().getFullYear()} Vera Italia</p>
      </footer>
    </div>
  );
};

export default VeraSite;
