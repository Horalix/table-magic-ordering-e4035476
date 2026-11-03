/**
 * The menu board: the TV at the entrance, mounted upright (/tv).
 *
 * Nobody touches it, so it is not the phone menu made big. It is laid out
 * once, for a 1080 × 1920 screen, and that whole stage is scaled to whatever
 * screen it is on — a 720p TV, a 4K one, a laptop testing it — with bars at
 * the sides if the shape differs. The brand stays at the top and the QR code
 * to the full menu at the bottom; between them the menu goes by one section
 * at a time (src/lib/tv-board.ts), a photograph, the section and its dishes
 * with their prices, in text read from the door.
 *
 * It runs all day unattended: the menu is read again every five minutes and
 * the last one that arrived stays on screen if a read fails; the screen is
 * kept awake and the pointer hidden; a new version of the app is taken while
 * it is left alone (src/lib/app-update.ts); and nothing it shows is counted
 * as a guest browsing (src/lib/analytics.ts).
 *
 * ?every=<seconds> sets how long each slide stays, ?lang=en|bs|ar its
 * language. It is the menu of the restaurant whose site this is: La Soul's
 * on lasoul.net, Vera Italia's, in Vera Italia's look, on veraitalia.net.
 */
import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { QRCodeSVG } from 'qrcode.react';
import { BadgeCheck } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import SmartImage from '@/components/ui/SmartImage';
import { PriceTag } from '@/components/guest/PriceTag';
import { LightLine, RuledTitle } from '@/components/vera/VeraMenu';
import { COURSES, ROMAN, VERA, pick } from '@/components/vera/copy';
import { getLocalizedDescription, getLocalizedName, localeLabels, useLanguageStore, useT, type Locale } from '@/lib/i18n';
import { HOME_VENUE } from '@/lib/home-venue';
import { saleView } from '@/lib/promotions';
import type { MenuItemRow } from '@/lib/promotions-api';
import { useNoIndex } from '@/lib/seo/noindex';
import { absoluteUrl } from '@/lib/seo/site-url';
import { boardLocale, buildSlides, oneLine, slideSeconds, type TvSlide } from '@/lib/tv-board';
import { VENUES, menuPath } from '@/lib/venues';
import { useWakeLock } from '@/lib/wake-lock';
import type { Database } from '@/integrations/supabase/types';

type CategoryRow = Database['public']['Tables']['categories']['Row'];
type SectionRow = Database['public']['Tables']['subcategories']['Row'];

/** The stage, in CSS pixels: a portrait full-HD screen. Everything below is sized for it. */
const STAGE_W = 1080;
const STAGE_H = 1920;
const GUTTER = 56;
/** How wide the photograph is on the stage, for choosing which of its files to load. */
const PHOTO_W = STAGE_W - 2 * GUTTER;

const REFRESH_MS = 5 * 60_000;
/** Before the first menu has arrived (the screen was switched on with the network down), ask more often. */
const FIRST_LOAD_RETRY_MS = 30_000;
/** A slide of this many dishes or fewer has room for a line about each. */
const ROOMY_UP_TO = 5;
const LANGUAGES: Locale[] = ['bs', 'en', 'ar'];

/** The picture of each of La Soul's categories (as on the menu home), for a section none of whose dishes has a photograph. */
const LA_SOUL_COVERS: Record<string, string> = {
  Food: '/covers/lasoul-food',
  Drinks: '/covers/lasoul-drinks',
  Desserts: '/covers/lasoul-desserts',
};

const VERA_HOME = HOME_VENUE === 'veraitalia';
const coverFor = (category: string): string | undefined =>
  VERA_HOME ? COURSES[category]?.picture : LA_SOUL_COVERS[category];

/**
 * What differs between the two restaurants' boards, beyond the colours and
 * the serif, which <VenueTheme> already puts on the page (src/index.css).
 */
const LOOK = VERA_HOME
  ? {
      body: '',
      photo: 'rounded-[4px]',
      caption: 'rounded-[3px] italic font-medium',
      caps: 'text-muted-foreground tracking-[0.32em]',
      section: 'italic font-normal text-[104px]',
      name: 'font-medium',
      price: 'font-serif font-medium text-[52px]',
      footer: 'bg-[hsl(var(--vi-espresso))] text-[hsl(var(--background))]',
      qrCard: 'rounded-[6px] bg-[hsl(var(--background))]',
      scan: 'italic font-normal text-[60px]',
      progress: 'bg-[hsl(var(--vi-brass))]',
      leader: 'border-foreground/30',
    }
  : {
      // The menu sheet comes up over the sage band, as on the phone menu.
      body: '-mt-[44px] rounded-t-[44px]',
      photo: 'rounded-[36px] shadow-lux-lg',
      caption: 'rounded-full font-semibold',
      caps: 'text-primary tracking-[0.28em]',
      section: 'font-semibold tracking-[-0.01em] text-[96px]',
      name: 'font-semibold',
      price: 'font-sans font-semibold text-[48px]',
      footer: 'bg-[hsl(var(--hero-sage-dark))] text-white',
      qrCard: 'rounded-[28px] bg-white',
      scan: 'font-semibold text-[52px]',
      progress: 'bg-[hsl(var(--gold))]',
      leader: 'border-foreground/25',
    };

interface BoardMenu {
  categories: CategoryRow[];
  sections: SectionRow[];
  items: MenuItemRow[];
}

/*
 * The same three tables the guest menu reads, whole: the board shows every
 * section. Each request names this site's restaurant (/tv in
 * src/lib/current-venue.ts), as a menu page names its own.
 */
async function fetchBoardMenu(): Promise<BoardMenu> {
  const [categories, sections, items] = await Promise.all([
    supabase.from('categories').select('*').order('sort_order'),
    supabase.from('subcategories').select('*').order('sort_order'),
    supabase.from('menu_items').select('*').order('sort_order'),
  ]);
  if (categories.error) throw categories.error;
  if (sections.error) throw sections.error;
  if (items.error) throw items.error;
  return { categories: categories.data ?? [], sections: sections.data ?? [], items: (items.data ?? []) as MenuItemRow[] };
}

const fit = () => (typeof window === 'undefined' ? 1 : Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H));

/** How much the stage is scaled to fill this screen. */
function useStageScale(): number {
  const [scale, setScale] = useState(fit);
  useEffect(() => {
    const onResize = () => setScale(fit());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return scale;
}

/**
 * A screen nobody uses with a mouse: the pointer, left wherever the browser
 * was opened, would sit over the menu all day. No scrollbars either, and it
 * never dims (src/lib/wake-lock.ts).
 */
function useUnattendedScreen(title: string) {
  useNoIndex();
  useWakeLock(true);
  useEffect(() => {
    const root = document.documentElement;
    const before = { cursor: root.style.cursor, overflow: root.style.overflow };
    root.style.cursor = 'none';
    root.style.overflow = 'hidden';
    return () => {
      root.style.cursor = before.cursor;
      root.style.overflow = before.overflow;
    };
  }, []);
  useEffect(() => {
    const before = document.title;
    document.title = title;
    return () => { document.title = before; };
  }, [title]);
}

/** ?lang= for this screen only: nothing is saved, so the guest menu on the same browser keeps its own choice. */
function useBoardLanguage(lang: Locale | null) {
  useLayoutEffect(() => {
    if (!lang) return;
    const before = useLanguageStore.getState().locale;
    useLanguageStore.setState({ locale: lang });
    return () => useLanguageStore.setState({ locale: before });
  }, [lang]);
}

const TvMenu = () => {
  const { search } = useLocation();
  const t = useT();
  const locale = useLanguageStore((s) => s.locale);
  const venue = VENUES[HOME_VENUE];
  useBoardLanguage(boardLocale(search));
  useUnattendedScreen(`${venue.name} · ${t('menu')}`);
  const seconds = slideSeconds(search);
  const reduced = useReducedMotion() ?? false;
  const scale = useStageScale();

  // A failed read keeps the last menu that arrived: React Query holds on to
  // its data through an error, and the next read is five minutes away.
  const { data } = useQuery({
    queryKey: ['tv-board'],
    queryFn: fetchBoardMenu,
    refetchInterval: (query) => (query.state.data ? REFRESH_MS : FIRST_LOAD_RETRY_MS),
    refetchIntervalInBackground: true,
    staleTime: 60_000,
    retry: 2,
  });

  const slides = useMemo(() => (data ? buildSlides(data.categories, data.sections, data.items) : []), [data]);
  /** Vera Italia numbers its courses, as its printed menu does. */
  const courseNumber = useMemo(() => {
    const order = [...(data?.categories ?? [])].sort((a, b) => a.sort_order - b.sort_order);
    return new Map(order.map((c, i) => [c.id, ROMAN[i] ?? String(i + 1)]));
  }, [data]);

  const [index, setIndex] = useState(0);
  const at = slides.length ? index % slides.length : 0;
  const slide = slides[at];
  const next = slides.length > 1 ? slides[(at + 1) % slides.length] : undefined;

  useEffect(() => {
    if (slides.length < 2) return;
    const timer = window.setTimeout(() => setIndex((i) => (i + 1) % slides.length), seconds * 1000);
    return () => window.clearTimeout(timer);
  }, [index, slides.length, seconds]);

  const menuUrl = absoluteUrl(menuPath(HOME_VENUE));
  const rtl = locale === 'ar';

  return (
    <div className="fixed inset-0 overflow-hidden bg-[hsl(var(--charcoal))]">
      <div
        className="absolute left-1/2 top-1/2 flex flex-col overflow-hidden bg-background text-foreground"
        style={{ width: STAGE_W, height: STAGE_H, transform: `translate(-50%, -50%) scale(${scale})` }}
      >
        {VERA_HOME ? <VeraHeader /> : <LaSoulHeader />}

        <main className={`relative z-10 flex-1 min-h-0 bg-background px-[56px] pt-[48px] pb-[40px] ${LOOK.body}`}>
          <div className="relative h-full">
            <AnimatePresence initial={false}>
              {slide ? (
                <motion.section
                  key={slide.key}
                  aria-label={getLocalizedName(slide.section, locale)}
                  className="absolute inset-0"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: reduced ? 0.4 : 1.1, ease: 'easeInOut' }}
                >
                  <SlideView slide={slide} course={courseNumber.get(slide.category.id)} scale={scale} seconds={seconds} reduced={reduced} />
                </motion.section>
              ) : (
                <motion.div key="waiting" className="absolute inset-0 flex items-center justify-center" exit={{ opacity: 0 }}>
                  <span className="h-[72px] w-[72px] animate-spin rounded-full border-[6px] border-primary/20 border-t-primary" aria-hidden />
                </motion.div>
              )}
            </AnimatePresence>
            {/* The next slide's photograph, loaded while this one is up, so it fades in whole. */}
            {next && (
              <div aria-hidden className="pointer-events-none absolute h-px w-px overflow-hidden opacity-0">
                <Photo slide={next} scale={scale} />
              </div>
            )}
          </div>
        </main>

        <footer className={`relative shrink-0 h-[284px] overflow-hidden ${LOOK.footer}`}>
          {/* How long until the next slide; with reduced motion, how far through the menu it is. */}
          <div className="absolute inset-x-0 top-0 h-[8px] bg-white/15" aria-hidden>
            {slide && (
              <motion.div
                key={`${at}:${slide.key}`}
                className={`h-full ${LOOK.progress}`}
                style={{ originX: rtl ? 1 : 0 }}
                initial={{ scaleX: reduced ? (at + 1) / slides.length : 0 }}
                animate={{ scaleX: reduced ? (at + 1) / slides.length : 1 }}
                transition={{ duration: reduced ? 0 : seconds, ease: 'linear' }}
              />
            )}
          </div>
          {/* La Soul's olive branch again, faint, at the other end of the screen. */}
          {!VERA_HOME && (
            <img src="/brand/branch-white.webp" alt="" aria-hidden width={720} height={670} className="pointer-events-none select-none absolute -bottom-[110px] -end-[60px] w-[400px] rotate-180 opacity-[0.1]" />
          )}
          <div className="relative flex h-full items-center gap-[44px] px-[56px]">
            <figure data-testid="tv-qr" data-url={menuUrl} className={`shrink-0 p-[18px] shadow-lux-lg ${LOOK.qrCard}`}>
              {/* About 13 cm across on a 55-inch screen: scannable from a step or two away. */}
              <QRCodeSVG value={menuUrl} size={200} level="M" fgColor="#1f2925" bgColor="transparent" title={t('tv_scan_full_menu')} />
            </figure>
            <div className="min-w-0">
              <p className={`font-serif leading-[1.1] ${LOOK.scan}`}>{t('tv_scan_full_menu')}</p>
              <p className="mt-[14px] font-sans text-[28px] font-medium opacity-80">
                {LANGUAGES.map((l, i) => (
                  <span key={l}>
                    {i > 0 && <span aria-hidden className="mx-[14px]">·</span>}
                    <bdi lang={l}>{localeLabels[l]}</bdi>
                  </span>
                ))}
              </p>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
};

/** La Soul's sage band from the phone menu: the wordmark, "Menu", and the halal promise. */
const LaSoulHeader = () => {
  const t = useT();
  return (
    <header className="hero-depth relative h-[236px] shrink-0 overflow-hidden px-[56px] pb-[44px]" style={{ backgroundColor: 'hsl(140, 12%, 53%)' }}>
      {/* The olive branch from the logo, faint, as on the phone menu's band. */}
      <img
        src="/brand/branch-white.webp"
        alt=""
        aria-hidden
        width={720}
        height={670}
        className="pointer-events-none select-none absolute -top-[96px] -end-[70px] w-[470px] opacity-[0.17] rtl:-scale-x-100"
      />
      <div className="relative z-10 flex h-full items-center justify-between gap-[32px]">
        <h1 dir="ltr" className="min-w-0">
          <img src="/brand/wordmark-white.webp" alt="La Soul" width={960} height={124} className="h-[68px] w-auto drop-shadow-[0_2px_4px_rgba(0,0,0,0.15)]" />
          <span className="mt-[18px] block ps-[4px] font-sans text-[26px] font-semibold uppercase tracking-[0.34em] text-white/90 rtl:tracking-normal rtl:text-[30px]">{t('menu')}</span>
        </h1>
        <p className="inline-flex shrink-0 items-center gap-[14px] rounded-full bg-white/15 px-[30px] py-[16px] font-sans text-[28px] font-semibold text-white">
          <BadgeCheck className="h-[34px] w-[34px]" aria-hidden /> {t('halal_promise')}
        </p>
      </div>
    </header>
  );
};

/** Vera Italia's head of the menu: ivory paper, the wordmark, "Il Menù" between brass rules. */
const VeraHeader = () => {
  const t = useT();
  const locale = useLanguageStore((s) => s.locale);
  return (
    <header className="relative h-[236px] shrink-0 overflow-hidden px-[56px] text-center">
      <LightLine className="absolute inset-x-0 top-[18px] h-[90px] w-full" />
      <h1 dir="ltr" className="relative mx-auto mt-[46px] w-fit">
        <img src="/brand/vera/wordmark-ink.webp" alt="Vera Italia" width={1434} height={193} className="h-[70px] w-auto" />
        <span className="sr-only"> — {t('menu')}</span>
      </h1>
      <RuledTitle className="relative mx-auto mt-[26px] max-w-[620px] text-[54px]">
        <span aria-hidden>{pick(VERA.menu, locale)}</span>
      </RuledTitle>
    </header>
  );
};

interface SlideProps {
  slide: TvSlide<MenuItemRow>;
  /** Vera Italia's course number, I to IV. */
  course?: string;
  scale: number;
  seconds: number;
  reduced: boolean;
}

/** One section: its photograph, its name, and its dishes with their prices. */
const SlideView = ({ slide, course, scale, seconds, reduced }: SlideProps) => {
  const t = useT();
  const locale = useLanguageStore((s) => s.locale);
  // The prices are read at the moment the slide comes up: a happy hour that
  // ends meanwhile is gone by the section's next turn.
  const [now] = useState(() => Date.now());
  const roomy = slide.items.length <= ROOMY_UP_TO;
  const category = getLocalizedName(slide.category, locale);
  const pictured = slide.photo ? getLocalizedName(slide.photo, locale) : null;

  return (
    <div className="flex h-full flex-col">
      <div className={`relative min-h-[360px] flex-1 overflow-hidden bg-muted ${LOOK.photo}`}>
        {/* A slow push in, the length of the slide; still with reduced motion.
            Drawn once and then only scaled (will-change): redrawn as it grew,
            Chrome showed its unfinished corners as black squares. */}
        <motion.div
          className="absolute inset-0 will-change-transform"
          initial={{ scale: 1 }}
          animate={reduced ? { scale: 1 } : { scale: 1.06 }}
          transition={{ duration: seconds + 1.5, ease: 'linear' }}
        >
          <Photo slide={slide} scale={scale} />
        </motion.div>
        {pictured && (
          <p className={`absolute bottom-[24px] start-[24px] max-w-[calc(100%-48px)] truncate bg-background/90 px-[26px] py-[10px] font-serif text-[30px] text-foreground shadow-lux ${LOOK.caption}`}>
            {pictured}
          </p>
        )}
      </div>

      <div className="mt-[40px] flex items-baseline justify-between gap-[24px]">
        <p className={`min-w-0 truncate font-sans text-[26px] font-semibold uppercase rtl:tracking-normal ${LOOK.caps}`}>
          {VERA_HOME && course ? `${course} · ${category}` : category}
        </p>
        <p className="shrink-0 font-sans text-[26px] font-medium text-muted-foreground">{t('prices_in_km')}</p>
      </div>
      <h2 className={`mt-[6px] font-serif leading-[1.04] text-foreground ${LOOK.section}`}>
        {getLocalizedName(slide.section, locale)}
        {slide.pages > 1 && (
          <span className="ms-[24px] align-middle font-sans text-[34px] font-medium not-italic tabular-nums text-muted-foreground" dir="ltr">
            {slide.page + 1}/{slide.pages}
          </span>
        )}
      </h2>

      <ul className="mt-[22px] border-t border-border">
        {slide.items.map((item) => {
          const sale = saleView(item, now);
          const description = roomy ? oneLine(getLocalizedDescription(item, locale)) : null;
          return (
            <li key={item.id} className={roomy ? 'pt-[22px] pb-[4px]' : 'pt-[20px] pb-[2px]'}>
              <div className="flex items-end gap-[20px]">
                <span className={`min-w-0 font-serif leading-[1.12] text-foreground [text-wrap:balance] ${roomy ? 'text-[52px]' : 'text-[48px]'} ${LOOK.name}`}>
                  {getLocalizedName(item, locale)}
                </span>
                <span aria-hidden className={`mb-[14px] min-w-[32px] flex-1 border-b-[3px] border-dotted ${LOOK.leader}`} />
                <PriceTag
                  price={sale ? sale.price : Number(item.price)}
                  regular={sale?.regular}
                  className={`shrink-0 gap-x-[16px] leading-[1.12] text-foreground ${LOOK.price}`}
                />
              </div>
              {description && (
                <p className="mt-[6px] line-clamp-1 font-sans text-[28px] leading-[1.35] text-muted-foreground">{description}</p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
};

/**
 * The slide's photograph, from the app's own files at the size it is shown:
 * the stage is scaled, so on a 4K screen the same box is twice as many pixels.
 * A section with no photographed dish shows its category's picture.
 */
const Photo = ({ slide, scale }: { slide: TvSlide<MenuItemRow>; scale: number }) => {
  const sizes = `${Math.ceil(PHOTO_W * scale)}px`;
  const dish = slide.photo;
  if (dish?.image_url) {
    return (
      <SmartImage
        src={dish.image_url}
        id={dish.id}
        alt=""
        width={1152}
        height={1152}
        sizes={sizes}
        priority
        wrapperClassName="absolute inset-0 h-full w-full"
        className="h-full w-full object-cover"
      />
    );
  }
  const cover = coverFor(slide.category.name);
  if (cover) {
    return (
      <img
        src={`${cover}-1600.webp`}
        srcSet={`${cover}-640.webp 640w, ${cover}-1080.webp 1080w, ${cover}-1600.webp 1600w`}
        sizes={sizes}
        alt=""
        width={1600}
        height={1067}
        decoding="async"
        className="absolute inset-0 h-full w-full object-cover"
      />
    );
  }
  // Nothing to show of it: the brand's artwork, not an empty box.
  return VERA_HOME ? (
    <span className="absolute inset-0 flex items-center justify-center bg-[hsl(var(--vi-stone))]">
      <img src="/brand/vera/monogram-ink.webp" alt="" width={501} height={664} className="h-[46%] w-auto opacity-25" />
    </span>
  ) : (
    <span className="hero-depth absolute inset-0 flex items-center justify-center" style={{ backgroundColor: 'hsl(140, 12%, 53%)' }}>
      <img src="/brand/branch-white.webp" alt="" width={720} height={670} className="h-[70%] w-auto opacity-30" />
    </span>
  );
};

export default TvMenu;
