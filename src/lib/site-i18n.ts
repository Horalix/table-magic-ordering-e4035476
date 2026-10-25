import { useMemo } from 'react';
import { useLanguageStore } from '@/lib/i18n';
import { siteT, type SiteKey } from '@/lib/site-copy';

export { SITE_STRINGS, siteT, type SiteKey } from '@/lib/site-copy';

/**
 * The website's words in the guest's language, reactively.
 *
 * The translator is `st`, not `t`: src/lib/i18n.test.ts checks that every
 * literal key passed to a function named `t` exists in the menu's table, and
 * these keys live here instead.
 */
export function useSiteT() {
  const locale = useLanguageStore((s) => s.locale);
  return useMemo(() => ({
    locale,
    rtl: locale === 'ar',
    st: (key: SiteKey, vars?: Record<string, string | number>) => siteT(key, locale, vars),
  }), [locale]);
}
