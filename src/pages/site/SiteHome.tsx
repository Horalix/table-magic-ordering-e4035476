import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import SiteHeader from '@/components/site/SiteHeader';
import SiteHero from '@/components/site/SiteHero';
import SiteStory from '@/components/site/SiteStory';
import SiteSignatures from '@/components/site/SiteSignatures';
import SiteMenuCards from '@/components/site/SiteMenuCards';
import SiteOrderSteps from '@/components/site/SiteOrderSteps';
import SitePromise from '@/components/site/SitePromise';
import SiteFaq from '@/components/site/SiteFaq';
import SiteVisit from '@/components/site/SiteVisit';
import SiteFooter from '@/components/site/SiteFooter';
import { useLanguageStore, type Locale } from '@/lib/i18n';
import { useSiteT } from '@/lib/site-i18n';
import { usePageMeta } from '@/lib/seo/page-meta';
import { homeGraph, LOCALES, sitePath } from '@/lib/seo/structured-data';
import { DEFAULT_VENUE, VENUES } from '@/lib/venues';
import './site.css';

const ALTERNATES: Record<string, string> = { ...Object.fromEntries(LOCALES.map((l) => [l, sitePath(l)])), 'x-default': '/' };

/**
 * La Soul's website — what `/` shows, and what lasoul.net will serve.
 *
 * The menu stays its own app under /menu/<venue>; everything here links into
 * it rather than duplicating it. The venue's public facts (address, phone,
 * hours, socials) come from src/lib/venues.ts, so a fact that is not known yet
 * simply does not appear.
 *
 * Each language has its own address — / (English), /bs and /ar — so search
 * engines can index all three and a shared link opens in the language it was
 * sent in. Switching language moves to that language's address.
 */
const SiteHome = ({ venueSlug = DEFAULT_VENUE, locale: pathLocale }: { venueSlug?: string; locale?: Locale }) => {
  const venue = VENUES[venueSlug] ?? VENUES[DEFAULT_VENUE];
  const { st, locale } = useSiteT();
  const navigate = useNavigate();

  // Before the first paint, so /bs never flashes English.
  useLayoutEffect(() => {
    if (pathLocale && useLanguageStore.getState().locale !== pathLocale) useLanguageStore.getState().setLocale(pathLocale);
  }, [pathLocale]);

  const settled = useRef(false);
  useEffect(() => {
    // The first render follows the address; after that the address follows the language.
    if (!settled.current) { settled.current = true; return; }
    const target = sitePath(locale);
    if (window.location.pathname !== target) navigate(`${target}${window.location.hash}`, { replace: true });
  }, [locale, navigate]);

  const shownLocale = pathLocale && !settled.current ? pathLocale : locale;
  const jsonLd = useMemo(() => homeGraph(venue, shownLocale), [venue, shownLocale]);
  usePageMeta({
    title: st('seo_title'), description: st('seo_description'),
    path: sitePath(shownLocale), locale: shownLocale, alternates: ALTERNATES, jsonLd,
  });

  // In-page anchors glide (unless the visitor asked for less motion — the
  // CSS checks), and only while the website is on screen.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add('site-smooth');
    return () => root.classList.remove('site-smooth');
  }, []);

  return (
    <div className="site-root">
      <SiteHeader venue={venue} />
      <main id="main" tabIndex={-1} className="outline-none">
        <SiteHero venue={venue} />
        <SiteStory />
        <SiteSignatures venue={venue} />
        <SiteMenuCards venue={venue} />
        <SiteOrderSteps />
        <SitePromise />
        <SiteFaq venue={venue} />
        <SiteVisit venue={venue} />
      </main>
      <SiteFooter venue={venue} />
    </div>
  );
};

export default SiteHome;
