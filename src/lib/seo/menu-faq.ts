/**
 * More of the questions people ask before they go — is there a kids' menu,
 * do they serve breakfast, what does a burger cost — answered from the live
 * menu at build time, for La Soul's home page.
 *
 * Only what the menu says: a question is asked only when the section it is
 * about exists, a price range is the real lowest and highest price in it,
 * and a dish is named only if it is on the menu. "Vegetarian" is said only of
 * dishes the menu marks so (dietary_tags); nothing is inferred from a name.
 *
 * The build computes them once (scripts/seo-prerender.ts) and writes them
 * twice: into the prerendered home pages and their FAQPage data, and into
 * /site-facts.json, which the live home page reads (useSiteFacts in
 * ./site-facts.ts) so the page a person sees, the page a crawler sees and
 * the structured data say the same words. One function makes them.
 *
 * Pure, relative imports only: the build imports this module outside the app.
 */
import type { Locale } from '../i18n';
import { CURATED_SIGNATURES } from '../../components/site/signature-list';
import type { SeoMenu, SeoMenuItem } from './menu-data';
import { kmPrice, listOf } from './page-copy';

export interface FaqEntry { q: string; a: string }
/** The questions in each language, in the order the page shows them. */
export type MenuFaq = Record<Locale, FaqEntry[]>;

const range = (items: SeoMenuItem[], locale: Locale): string => {
  const prices = items.map((i) => i.price);
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  return lo === hi ? kmPrice(lo, locale) : `${kmPrice(lo, locale).replace(' KM', '')}–${kmPrice(hi, locale)}`;
};

/** Up to three names, in menu order. */
const some = (items: SeoMenuItem[], locale: Locale) => listOf(items.slice(0, 3).map((i) => i.names[locale]), locale);

type Asked = 'kids' | 'breakfast' | 'pizza' | 'burger' | 'coffee' | 'cake' | 'vegetarian' | 'signatures';
type Words = (n: number, range: string, names: string) => FaqEntry;

const COPY: Record<Asked, Record<Locale, Words>> = {
  kids: {
    en: (n, r, names) => ({ q: 'Is there a kids’ menu at La Soul?', a: `Yes. The kids’ menu has ${n} dishes, ${r}: ${names}.` }),
    bs: (n, r, names) => ({ q: 'Ima li La Soul dječiji meni?', a: `Ima. Dječiji meni ima ${n} jela, ${r}: ${names}.` }),
    ar: (n, r, names) => ({ q: 'هل توجد قائمة للأطفال في La Soul؟', a: `نعم. أسعار قائمة الأطفال ${r}، ومنها ${names}.` }),
  },
  breakfast: {
    en: (n, r, names) => ({ q: 'Does La Soul serve breakfast?', a: `Yes. There are ${n} breakfast dishes on the menu, ${r}, among them ${names}.` }),
    bs: (n, r, names) => ({ q: 'Služi li La Soul doručak?', a: `Da. Doručak je na meniju, ${r}, među ostalim ${names}.` }),
    ar: (n, r, names) => ({ q: 'هل يقدّم La Soul الفطور؟', a: `نعم. أطباق الفطور في القائمة ${r}، منها ${names}.` }),
  },
  pizza: {
    en: (n, r, names) => ({ q: 'Does La Soul serve pizza?', a: `Yes. There are ${n} pizzas on the menu, ${r}, among them ${names}.` }),
    bs: (n, r, names) => ({ q: 'Ima li La Soul pizzu?', a: `Ima. Pizze na meniju koštaju ${r}, među njima ${names}.` }),
    ar: (n, r, names) => ({ q: 'هل يقدّم La Soul البيتزا؟', a: `نعم. أسعار البيتزا في القائمة ${r}، منها ${names}.` }),
  },
  burger: {
    en: (n, r, names) => ({ q: 'How much is a burger at La Soul?', a: `The ${n} burgers on the menu cost ${r}, among them ${names}.` }),
    bs: (n, r, names) => ({ q: 'Koliko košta burger u La Soulu?', a: `Burgeri na meniju koštaju ${r}, među njima ${names}.` }),
    ar: (n, r, names) => ({ q: 'كم سعر البرغر في La Soul؟', a: `أسعار البرغر في القائمة ${r}، منها ${names}.` }),
  },
  coffee: {
    en: (n, r, names) => ({ q: 'How much is a coffee at La Soul?', a: `Coffee costs ${r}, among them ${names}.` }),
    bs: (n, r, names) => ({ q: 'Koliko košta kafa u La Soulu?', a: `Kafa košta ${r}, među ostalim ${names}.` }),
    ar: (n, r, names) => ({ q: 'كم سعر القهوة في La Soul؟', a: `أسعار القهوة ${r}، منها ${names}.` }),
  },
  cake: {
    en: (n, r, names) => ({ q: 'How much is a cake at La Soul?', a: `Cakes and desserts cost ${r}, among them ${names}.` }),
    bs: (n, r, names) => ({ q: 'Koliko koštaju kolači u La Soulu?', a: `Kolači i deserti koštaju ${r}, među njima ${names}.` }),
    ar: (n, r, names) => ({ q: 'كم سعر الكيك في La Soul؟', a: `أسعار الكيك والحلويات ${r}، منها ${names}.` }),
  },
  vegetarian: {
    en: (n, _r, names) => ({ q: 'Are there vegetarian dishes at La Soul?', a: `Yes. ${n} dishes on the menu are marked vegetarian, among them ${names}.` }),
    bs: (n, _r, names) => ({ q: 'Ima li La Soul vegetarijanskih jela?', a: `Ima. Vegetarijanska jela na meniju su, među ostalim, ${names}.` }),
    ar: (n, _r, names) => ({ q: 'هل توجد أطباق نباتية في La Soul؟', a: `نعم. في القائمة أطباق موسومة بأنها نباتية، منها ${names}.` }),
  },
  signatures: {
    en: (_n, _r, names) => ({ q: 'What should I try at La Soul?', a: `The house signatures: ${names}.` }),
    bs: (_n, _r, names) => ({ q: 'Šta probati u La Soulu?', a: `Specijaliteti kuće: ${names}.` }),
    ar: (_n, _r, names) => ({ q: 'ماذا أجرّب في La Soul؟', a: `أطباق البيت المميزة: ${names}.` }),
  },
};

const sectionItems = (menu: SeoMenu, test: RegExp) =>
  menu.categories.flatMap((c) => c.sections.filter((s) => test.test(s.names.en)).flatMap((s) => s.items));
const categoryItems = (menu: SeoMenu, test: RegExp) =>
  menu.categories.filter((c) => test.test(c.names.en)).flatMap((c) => c.sections.flatMap((s) => s.items));

/** The questions the live menu can answer, in all three languages; none when there is no menu. */
export function menuFaq(menu: SeoMenu | null): MenuFaq {
  const out: MenuFaq = { en: [], bs: [], ar: [] };
  if (!menu) return out;
  const all = menu.categories.flatMap((c) => c.sections.flatMap((s) => s.items));
  const byId = new Map(all.map((i) => [i.id, i]));
  const signatures = CURATED_SIGNATURES.map((d) => byId.get(d.id)).filter((i): i is SeoMenuItem => !!i);
  const groups: [Asked, SeoMenuItem[]][] = [
    ['signatures', signatures],
    ['breakfast', sectionItems(menu, /^breakfast$/i)],
    ['kids', sectionItems(menu, /^kids/i)],
    ['pizza', categoryItems(menu, /pizza/i)],
    ['burger', sectionItems(menu, /^burgers?$/i)],
    ['coffee', sectionItems(menu, /^coffee$/i)],
    ['cake', categoryItems(menu, /^desserts?$/i)],
    ['vegetarian', all.filter((i) => i.dietaryTags.includes('vegetarian'))],
  ];
  for (const [asked, items] of groups) {
    if (!items.length) continue;
    for (const locale of ['en', 'bs', 'ar'] as Locale[]) {
      // The signatures with their prices; the rest by name, up to three.
      const names = asked === 'signatures'
        ? listOf(items.map((i) => `${i.names[locale]} (${kmPrice(i.price, locale)})`), locale)
        : some(items, locale);
      out[locale].push(COPY[asked][locale](items.length, range(items, locale), names));
    }
  }
  return out;
}

/** Where the build leaves them for the live home page (scripts/seo-prerender.ts). */
export const SITE_FACTS_PATH = '/site-facts.json';

let known: MenuFaq | null = null;
const listeners = new Set<() => void>();

/**
 * The menu's questions as this build or this page has them: set by the build
 * from the menu it read, and in the app once /site-facts.json has arrived
 * (./site-facts.ts). Null until then, and the page asks none of them.
 */
export const siteFacts = (): MenuFaq | null => known;

export function setSiteFacts(facts: MenuFaq | null): void {
  known = facts;
  listeners.forEach((l) => l());
}

export function onSiteFacts(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Accepts only the shape the build writes: three lists of question and answer. */
export function parseSiteFacts(data: unknown): MenuFaq | null {
  const ok = (list: unknown) => Array.isArray(list)
    && list.every((e) => e && typeof (e as FaqEntry).q === 'string' && typeof (e as FaqEntry).a === 'string');
  const d = data as Partial<MenuFaq> | null;
  return d && ok(d.en) && ok(d.bs) && ok(d.ar) ? { en: d.en as FaqEntry[], bs: d.bs as FaqEntry[], ar: d.ar as FaqEntry[] } : null;
}
