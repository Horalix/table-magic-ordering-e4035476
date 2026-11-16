import { useEffect, useLayoutEffect, useRef } from 'react';
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useLanguageStore } from '../i18n';
import { HOME_VENUE } from '../home-venue';
import { ownSiteElsewhere } from '../venues';
import { addressLocale, localePath, unprefixed } from './locale-path';

/**
 * The pages at /bs/… and /ar/… (src/App.tsx): the same screens as at the
 * address without the prefix, in the language the address names
 * (./locale-path.ts).
 *
 * - Before the first paint the language becomes the address's, whatever the
 *   phone had saved, as the website's /bs/ and /ar/ always did
 *   (src/pages/site/SiteHome.tsx): a shared Bosnian link opens in Bosnian,
 *   and a crawler that runs the app reads the page its HTML promised.
 * - After that the address follows the language: switching to Arabic on
 *   /bs/menu/lasoul/ moves to /ar/menu/lasoul/ (replace, query and hash
 *   kept); to English, to the address without a prefix.
 * - Only this site's own restaurant has prefixed pages; another restaurant's
 *   menu forwards to its own site (OnItsOwnSite, which keeps the prefix), or
 *   is shown at its unprefixed address.
 */
export default function AddressLanguage() {
  const { pathname, search, hash } = useLocation();
  const navigate = useNavigate();
  const wanted = addressLocale(pathname);
  const locale = useLanguageStore((s) => s.locale);

  useLayoutEffect(() => {
    if (useLanguageStore.getState().locale !== wanted) useLanguageStore.getState().setLocale(wanted);
  }, [wanted]);

  const settled = useRef(false);
  useEffect(() => {
    // The first render follows the address; after that the address follows the language.
    if (!settled.current) { settled.current = true; return; }
    if (locale !== addressLocale(window.location.pathname)) {
      navigate(`${localePath(window.location.pathname, locale)}${window.location.search}${window.location.hash}`, { replace: true });
    }
  }, [locale, navigate]);

  const venue = /^\/(?:bs|ar)\/menu\/([^/]+)/.exec(pathname)?.[1];
  if (venue && venue !== HOME_VENUE && !ownSiteElsewhere(venue)) {
    return <Navigate to={`${unprefixed(pathname)}${search}${hash}`} replace />;
  }
  return <Outlet />;
}
