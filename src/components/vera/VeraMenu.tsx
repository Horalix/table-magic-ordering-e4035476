/**
 * Vera Italia's menu home: the parts that are its own. Ordering, search,
 * the featured dishes and the cart are the same as La Soul's; the page is
 * not. It is laid out like the restaurant's printed menu and its magazine
 * pages: ivory paper, the lockup, an italic "Il Menù" between brass rules,
 * and each course as one overhead photograph of a whole dish on travertine,
 * numbered like a menu's courses.
 */
import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { MapPin, Phone } from 'lucide-react';
import CallWaiterButton from '@/components/guest/CallWaiterButton';
import LanguageSelector from '@/components/guest/LanguageSelector';
import SmartImage from '@/components/ui/SmartImage';
import { fadeUp, PRESS_SCALE } from '@/lib/motion';
import { getLocalizedName, useLanguageStore, useT } from '@/lib/i18n';
import { VENUES } from '@/lib/venues';
import type { Database } from '@/integrations/supabase/types';
import { COURSES, ROMAN, VERA, pick } from './copy';

type CategoryRow = Database['public']['Tables']['categories']['Row'];

/** The ceiling's line of light, drawn once across the top of the page. */
export const LightLine = ({ className = '' }: { className?: string }) => (
  <svg aria-hidden viewBox="0 0 400 60" preserveAspectRatio="none" className={`pointer-events-none ${className}`}>
    <path
      d="M-10 38 C 40 10, 90 12, 130 30 S 210 56, 250 34 S 330 4, 410 22"
      fill="none"
      stroke="hsl(var(--vi-brass))"
      strokeOpacity="0.55"
      strokeWidth="1"
      vectorEffect="non-scaling-stroke"
    />
  </svg>
);

/** A centred heading between two brass rules, the way the printed menu titles its pages. */
export const RuledTitle = ({ children, className = '' }: { children: ReactNode; className?: string }) => (
  <div className={`flex items-center gap-4 ${className}`}>
    <span aria-hidden className="vi-hairline flex-1" />
    <span className="font-serif italic font-normal leading-none text-foreground">{children}</span>
    <span aria-hidden className="vi-hairline flex-1" />
  </div>
);

interface HeroProps {
  table: string | null;
  showTable: boolean;
  onChangeTable: () => void;
}

export const VeraMenuHero = ({ table, showTable, onChangeTable }: HeroProps) => {
  const t = useT();
  const locale = useLanguageStore((s) => s.locale);
  return (
    <header className="relative px-5 pt-[max(0.75rem,env(safe-area-inset-top))] pb-7 text-center">
      <div className="flex justify-end">
        <LanguageSelector />
      </div>

      <h1 className="mx-auto mt-1 w-[13rem] max-w-[60vw]" dir="ltr">
        <img
          src="/brand/vera/lockup-ink.webp"
          alt="Vera Italia"
          width={1158}
          height={806}
          {...{ fetchpriority: 'high' }}
          className="w-full h-auto"
        />
        <span className="sr-only"> — {t('menu')}</span>
      </h1>

      <RuledTitle className="mx-auto mt-8 max-w-[18rem] text-[40px]">
        <span aria-hidden>{pick(VERA.menu, locale)}</span>
      </RuledTitle>

      {showTable && table && (
        <div className="mt-6 flex items-center justify-center gap-2">
          <button
            onClick={onChangeTable}
            className="px-4 min-h-[44px] rounded-full border border-border bg-card/70 text-xs font-sans font-medium text-foreground tracking-wide rtl:tracking-normal hover:bg-card transition-colors"
            title={t('not_your_table')}
          >
            {t('table_n', { n: table })} · <span className="underline underline-offset-2">{t('change_table')}</span>
          </button>
          <CallWaiterButton />
        </div>
      )}
    </header>
  );
};

interface CoursesProps {
  categories: CategoryRow[];
  onOpen: (categoryName: string) => void;
}

/**
 * The courses, two to a row: each one's photograph square and whole, the
 * plate never cropped, with its number and its name under it.
 */
export const VeraCourses = ({ categories, onOpen }: CoursesProps) => {
  const locale = useLanguageStore((s) => s.locale);
  return (
    <section aria-label={pick(VERA.courses, locale)} className="pt-2">
      <div className="grid grid-cols-2 gap-x-4 gap-y-9">
        {categories.map((cat, i) => {
          const course = COURSES[cat.name];
          const name = getLocalizedName(cat, locale);
          return (
            <motion.button
              key={cat.id}
              variants={fadeUp}
              whileTap={{ scale: PRESS_SCALE }}
              onClick={() => onOpen(cat.name)}
              className="group text-center tap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 rounded-[3px]"
            >
              <span className="relative block aspect-square overflow-hidden rounded-[3px] bg-muted">
                {course && (
                  <SmartImage
                    id={course.cover}
                    src={`/menu/${course.cover}/768.webp`}
                    alt=""
                    width={320}
                    height={320}
                    sizes="(max-width: 640px) 45vw, 320px"
                    priority={i < 2}
                    wrapperClassName="absolute inset-0 w-full h-full"
                    className="w-full h-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.02]"
                  />
                )}
              </span>
              <span aria-hidden className="mt-4 block vi-caps text-muted-foreground">{ROMAN[i] ?? i + 1}</span>
              <h2 className="mt-1.5 font-serif italic text-[25px] font-normal leading-[1.1] text-foreground">{name}</h2>
              {course && <span className="block mt-1.5 px-1 text-[12px] leading-snug font-sans text-muted-foreground">{pick(course.line, locale)}</span>}
            </motion.button>
          );
        })}
      </div>
    </section>
  );
};

/** Vera Italia's foot of the menu: who it is, and how to reach it once that is known. */
export const VeraMenuFooter = () => {
  const t = useT();
  const locale = useLanguageStore((s) => s.locale);
  const venue = VENUES.veraitalia;
  return (
    <motion.footer variants={fadeUp} className="pt-10 text-center">
      <div aria-hidden className="mx-auto mb-8 w-16 vi-hairline" />
      <img src="/brand/vera/monogram-ink.webp" alt="" aria-hidden width={501} height={664} className="mx-auto h-12 w-auto opacity-80" />
      <p className="mt-3 vi-caps text-muted-foreground">Vera Italia · {pick(VERA.tagline, locale)}</p>
      {(venue.phone || venue.mapsUrl) && (
        <div className="mt-4 flex justify-center gap-2">
          {venue.phone && (
            <a href={`tel:${venue.phoneHref}`} className="inline-flex items-center gap-2 px-4 min-h-[44px] rounded-full border border-border text-sm font-sans">
              <Phone className="w-4 h-4 text-primary" aria-hidden /><span dir="ltr">{venue.phone}</span>
            </a>
          )}
          {venue.mapsUrl && (
            <a href={venue.mapsUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 px-4 min-h-[44px] rounded-full border border-border text-sm font-sans">
              <MapPin className="w-4 h-4 text-primary" aria-hidden />{t('find_us')}
            </a>
          )}
        </div>
      )}
      <Link to="/privacy" className="block pt-5 text-[11px] text-muted-foreground/80 font-sans hover:text-primary transition-colors">
        {t('privacy_security')}
      </Link>
    </motion.footer>
  );
};
