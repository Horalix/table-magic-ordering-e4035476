import { Link } from 'react-router-dom';
import { useSiteT } from '@/lib/site-i18n';
import { menuBase, type Venue } from '@/lib/venues';
import { Container } from './SiteSection';

const SiteFooter = ({ venue }: { venue: Venue }) => {
  const { st } = useSiteT();
  const linkClass = 'text-[15px] text-ls-cream/80 transition-colors hover:text-ls-cream focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ls-sage focus-visible:ring-offset-2 focus-visible:ring-offset-ls-forest rounded-sm';
  return (
    <footer className="bg-ls-forest pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-16 text-ls-cream sm:pt-20">
      <Container>
        <div className="grid gap-12 border-b border-ls-cream/10 pb-12 sm:grid-cols-2 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <img src="/brand/wordmark-white.webp" alt="La Soul" width={960} height={124} loading="lazy" decoding="async" className="h-5 w-auto" />
            <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.26em] text-ls-sage rtl:text-[13px] rtl:tracking-normal">{st('tagline')}</p>
            <p className="mt-6 max-w-[22rem] text-[14px] leading-[1.7] text-ls-cream/60">
              {st('fact_halal')} · {st('fact_alcohol')} · {st('fact_fresh')}
            </p>
          </div>
          <address className="not-italic lg:col-span-4">
            <p className="text-[15px] leading-[1.7] text-ls-cream/80">
              {venue.address}
              <br />
              {venue.city}
            </p>
            <a href={`tel:${venue.phoneHref}`} dir="ltr" className={`mt-3 inline-block ${linkClass}`}>{venue.phone}</a>
          </address>
          <nav aria-label={st('footer_nav')} className="lg:col-span-3">
            <ul className="space-y-3">
              <li><Link to={menuBase(venue.slug)} className={linkClass}>{st('footer_menu')}</Link></li>
              <li><a href="#story" className={linkClass}>{st('nav_story')}</a></li>
              <li><a href="#visit" className={linkClass}>{st('nav_visit')}</a></li>
              <li><Link to="/privacy" className={linkClass}>{st('footer_privacy')}</Link></li>
            </ul>
          </nav>
        </div>
        <p className="pt-8 text-[13px] text-ls-cream/50">{st('footer_rights', { year: new Date().getFullYear() })}</p>
      </Container>
    </footer>
  );
};

export default SiteFooter;
