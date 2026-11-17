import { useEffect, useSyncExternalStore } from 'react';
import { DEMO_BUILD } from '../home-venue';
import { SITE_FACTS_PATH, onSiteFacts, parseSiteFacts, setSiteFacts, siteFacts, type MenuFaq } from './menu-faq';

let asked = false;

/**
 * The questions the live menu answered when the site was last published
 * (./menu-faq.ts), read from /site-facts.json. The home page shows them, and
 * puts them in its FAQPage data, only once they are here: the prerendered
 * page for the same address carries the same words, so a crawler that runs
 * the app finds what one that does not found. A file that cannot be read
 * leaves the questions out, never half of them.
 */
export function useSiteFacts(): MenuFaq | null {
  const facts = useSyncExternalStore(onSiteFacts, siteFacts, siteFacts);
  useEffect(() => {
    if (asked || DEMO_BUILD) return;
    asked = true;
    fetch(SITE_FACTS_PATH, { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { const parsed = parseSiteFacts(data); if (parsed) setSiteFacts(parsed); })
      .catch(() => undefined);
  }, []);
  return facts;
}
