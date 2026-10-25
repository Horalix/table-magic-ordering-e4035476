import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import LanguageSelector from '@/components/guest/LanguageSelector';
import { cn } from '@/lib/utils';
import { useSiteT } from '@/lib/site-i18n';
import { menuBase, type Venue } from '@/lib/venues';

/**
 * The website's header: transparent over the hero, a frosted cream bar once
 * the page has scrolled. The wordmark, three anchors, the language switch the
 * menu uses, and the way into the menu — which is what most visitors came for.
 */
const SiteHeader = ({ venue }: { venue: Venue }) => {
  const { st } = useSiteT();
  const [solid, setSolid] = useState(false);

  useEffect(() => {
    const onScroll = () => setSolid(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const links = [
    { href: '#menu', label: st('nav_menu') },
    { href: '#story', label: st('nav_story') },
    { href: '#visit', label: st('nav_visit') },
  ];

  return (
    <header
      className={cn(
        'fixed inset-x-0 top-0 z-50 pt-[env(safe-area-inset-top)] transition-[background-color,box-shadow] duration-500',
        solid ? 'bg-ls-cream/90 shadow-[0_1px_0_rgba(35,46,40,0.08)] backdrop-blur-md supports-[backdrop-filter]:bg-ls-cream/75' : 'bg-transparent',
      )}
    >
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:start-4 focus:top-3 focus:z-10 focus:rounded-full focus:bg-ls-forest focus:px-4 focus:py-2 focus:text-sm focus:text-ls-cream"
      >
        {st('skip_to_content')}
      </a>
      <div className="mx-auto grid h-16 max-w-[1240px] grid-cols-[1fr_auto] items-center gap-3 px-5 sm:px-8 md:h-[76px] md:grid-cols-[1fr_auto_1fr]">
        <Link
          to="/"
          aria-label={st('home_label')}
          onClick={() => window.scrollTo({ top: 0 })}
          className="justify-self-start rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ls-sage-deep focus-visible:ring-offset-4 focus-visible:ring-offset-ls-cream"
        >
          <img src="/brand/wordmark-dark.webp" alt="La Soul" width={960} height={124} className="h-[15px] w-auto sm:h-[18px] md:h-5" />
        </Link>

        <nav aria-label={st('nav_label')} className="hidden md:block">
          <ul className="flex items-center gap-9">
            {links.map((l) => (
              <li key={l.href}>
                <a
                  href={l.href}
                  className="relative py-2 text-[14px] font-medium text-ls-forest/80 transition-colors hover:text-ls-forest after:absolute after:inset-x-0 after:-bottom-0.5 after:h-px after:origin-left after:scale-x-0 after:bg-ls-forest/60 after:transition-transform after:duration-300 hover:after:scale-x-100 rtl:after:origin-right focus-visible:outline-none focus-visible:after:scale-x-100"
                >
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex items-center justify-self-end gap-2 sm:gap-3">
          <LanguageSelector variant="site" />
          <Link
            to={menuBase(venue.slug)}
            className="inline-flex h-11 items-center rounded-full bg-ls-forest px-4 text-[13px] font-semibold text-ls-cream shadow-[0_6px_20px_-10px_rgba(35,46,40,0.6)] transition-colors hover:bg-ls-forest-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ls-sage-deep focus-visible:ring-offset-2 focus-visible:ring-offset-ls-cream sm:px-5 sm:text-sm"
          >
            {st('header_cta')}
          </Link>
        </div>
      </div>
    </header>
  );
};

export default SiteHeader;
