import { useEffect } from 'react';
import SiteHeader from '@/components/site/SiteHeader';
import SiteHero from '@/components/site/SiteHero';
import SiteStory from '@/components/site/SiteStory';
import SiteSignatures from '@/components/site/SiteSignatures';
import SiteMenuCards from '@/components/site/SiteMenuCards';
import SiteOrderSteps from '@/components/site/SiteOrderSteps';
import SitePromise from '@/components/site/SitePromise';
import SiteVisit from '@/components/site/SiteVisit';
import SiteFooter from '@/components/site/SiteFooter';
import { useSiteSeo } from '@/components/site/site-seo';
import { useSiteT } from '@/lib/site-i18n';
import { DEFAULT_VENUE, VENUES } from '@/lib/venues';
import './site.css';

/**
 * La Soul's website — what `/` shows, and what lasoul.net will serve.
 *
 * The menu stays its own app under /menu/<venue>; everything here links into
 * it rather than duplicating it. The venue's public facts (address, phone,
 * hours, socials) come from src/lib/venues.ts, so a fact that is not known yet
 * simply does not appear.
 */
const SiteHome = ({ venueSlug = DEFAULT_VENUE }: { venueSlug?: string }) => {
  const venue = VENUES[venueSlug] ?? VENUES[DEFAULT_VENUE];
  const { st, locale } = useSiteT();

  useSiteSeo({ venue, locale, title: st('seo_title'), description: st('seo_description'), imageAlt: st('hero_alt') });

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
        <SiteVisit venue={venue} />
      </main>
      <SiteFooter venue={venue} />
    </div>
  );
};

export default SiteHome;
