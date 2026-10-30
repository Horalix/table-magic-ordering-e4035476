/**
 * Vera Italia's menu home: the parts that are its own. Ordering, search,
 * the featured dishes and the cart are the same as La Soul's; the room is
 * not. Its arched niches, softly lit from within, are the motif: the logo
 * sits in one, every course is framed in one, and the ceiling's flowing line
 * of light runs across the top.
 */
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
import { COURSES, VERA, pick } from './copy';

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

interface HeroProps {
  table: string | null;
  showTable: boolean;
  onChangeTable: () => void;
}

export const VeraMenuHero = ({ table, showTable, onChangeTable }: HeroProps) => {
  const t = useT();
  const locale = useLanguageStore((s) => s.locale);
  return (
    <header className="relative overflow-hidden px-5 pt-[max(0.75rem,env(safe-area-inset-top))] pb-8 text-center">
      <LightLine className="absolute inset-x-0 top-3 h-12 w-full" />
      <div className="relative z-10 flex justify-end">
        <LanguageSelector />
      </div>

      {/* The backlit niche: a true semicircle on a 3:4 arch, lit from within,
          holding the logo and the word "menu" as the room's niches hold light. */}
      <div
        className="relative mx-auto -mt-3 w-[16rem] max-w-[74vw] aspect-[3/4] vi-arch flex flex-col items-center justify-center px-7"
        style={{
          background: 'radial-gradient(75% 60% at 50% 45%, hsl(var(--vi-glow)) 0%, hsl(var(--vi-glow) / 0.7) 50%, hsl(var(--background) / 0) 100%)',
          boxShadow: 'inset 0 0 44px hsl(var(--vi-glow)), inset 0 0 0 1px hsl(var(--vi-brass) / 0.3), 0 30px 60px -40px hsl(var(--vi-walnut) / 0.45)',
        }}
      >
        <h1 className="w-full pt-6" dir="ltr">
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
        <div className="mt-6 flex w-full items-center gap-3" aria-hidden>
          <span className="vi-hairline flex-1" />
          <span className="font-serif italic text-[19px] text-accent">{pick(VERA.menu, locale)}</span>
          <span className="vi-hairline flex-1" />
        </div>
      </div>

      {showTable && table && (
        <div className="relative z-10 mt-6 flex items-center justify-center gap-2">
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

/** Each course framed in an arch, two to a row. */
export const VeraCourses = ({ categories, onOpen }: CoursesProps) => {
  const locale = useLanguageStore((s) => s.locale);
  return (
    <div className="grid grid-cols-2 gap-x-3.5 gap-y-7 pt-2">
      {categories.map((cat, i) => {
        const course = COURSES[cat.name];
        const name = getLocalizedName(cat, locale);
        return (
          <motion.button
            key={cat.id}
            variants={fadeUp}
            whileTap={{ scale: PRESS_SCALE }}
            onClick={() => onOpen(cat.name)}
            className="group text-center tap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 rounded-md"
          >
            <span className="relative block aspect-[3/4] vi-arch overflow-hidden bg-muted shadow-[0_22px_40px_-26px_rgba(43,33,27,0.7)]">
              {course && (
                <SmartImage
                  id={course.cover}
                  src={`/menu/${course.cover}/768.webp`}
                  alt=""
                  width={300}
                  height={400}
                  sizes="(max-width: 640px) 46vw, 300px"
                  priority={i < 2}
                  wrapperClassName="absolute inset-0 w-full h-full"
                  className="w-full h-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.03]"
                />
              )}
              <span aria-hidden className="absolute inset-0 vi-arch ring-1 ring-inset ring-[hsl(var(--vi-brass)/0.35)]" />
            </span>
            <h2 className="mt-3 font-serif text-[23px] font-medium leading-tight text-foreground">{name}</h2>
            {course && <span className="block mt-1 px-1 text-[12px] leading-snug font-sans text-muted-foreground">{pick(course.line, locale)}</span>}
          </motion.button>
        );
      })}
    </div>
  );
};

/** Vera Italia's foot of the menu: who it is, and how to reach it once that is known. */
export const VeraMenuFooter = () => {
  const t = useT();
  const locale = useLanguageStore((s) => s.locale);
  const venue = VENUES.veraitalia;
  return (
    <motion.footer variants={fadeUp} className="pt-8 text-center">
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
