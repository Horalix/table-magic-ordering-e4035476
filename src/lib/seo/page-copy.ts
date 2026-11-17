/**
 * The fixed words around the dishes on the pages crawlers read without
 * running the app (./static-pages.ts): "Allergens", "Open … on the menu",
 * "Also called", the price line. Each page is in one language now
 * (./locale-path.ts), so these are too.
 *
 * Vocabulary as the app and the website already use it (src/lib/i18n.ts,
 * src/lib/site-copy.ts): "meni", "konobar", "alergeni"; Bosnian as written in
 * Sarajevo (ijekavica), Arabic Modern Standard. Say only what is true.
 *
 * Pure data, relative imports only: the build imports this module outside the app.
 */
import type { Locale } from '../i18n';

type Entry = Record<Locale, string>;

const P = {
  prices: { en: 'Prices in KM (BAM)', bs: 'Cijene su u KM (BAM)', ar: 'الأسعار بالمارك البوسني (KM)' },
  allergens: {
    en: 'Allergens: {list}. Please tell your waiter about any allergy.',
    bs: 'Alergeni: {list}. Molimo da konobaru kažete za svaku alergiju.',
    ar: 'مسببات الحساسية: {list}. يُرجى إخبار النادل بأي حساسية.',
  },
  ready_in: { en: 'ready in about {n} minutes', bs: 'gotovo za otprilike {n} minuta', ar: 'جاهز خلال {n} دقيقة تقريبًا' },
  open_on_menu: { en: 'Open {dish} on the menu', bs: 'Otvorite {dish} na meniju', ar: 'افتح {dish} في القائمة' },
  all_of: { en: 'All {category}', bs: 'Sve iz kategorije {category}', ar: 'كل ما في قسم {category}' },
  more_of: { en: 'More {section} at {venue}', bs: 'Još iz ponude: {section}', ar: 'المزيد من {section} في {venue}' },
  also_called: { en: 'Also called: {names}', bs: 'Poznato i kao: {names}', ar: 'يُعرف أيضًا باسم: {names}' },
  photo_alt: { en: '{dish} at {venue}, {city}', bs: '{dish} — {venue}, {city}', ar: '{dish} — {venue}، {city}' },
  vegetarian: { en: 'vegetarian', bs: 'vegetarijansko', ar: 'نباتي' },
  breadcrumb: { en: 'Breadcrumb', bs: 'Putanja', ar: 'مسار التنقل' },
  languages: { en: 'Languages', bs: 'Jezici', ar: 'اللغات' },
  country: { en: 'Bosnia and Herzegovina', bs: 'Bosna i Hercegovina', ar: 'البوسنة والهرسك' },
} satisfies Record<string, Entry>;

export type PageCopyKey = keyof typeof P;

/** Every string, for the test that checks the three languages are complete. */
export const PAGE_STRINGS: Readonly<Record<PageCopyKey, Entry>> = P;

export function pageT(key: PageCopyKey, locale: Locale, vars?: Record<string, string | number>): string {
  let text = P[key][locale] || P[key].en;
  if (vars) for (const [k, v] of Object.entries(vars)) text = text.split(`{${k}}`).join(String(v));
  return text;
}

/** The menu's allergen codes, named in each language (the app's own words: src/lib/i18n.ts). */
const ALLERGENS: Record<string, Entry> = {
  gluten: { en: 'gluten', bs: 'gluten', ar: 'الغلوتين' },
  dairy: { en: 'milk and dairy', bs: 'mlijeko i mliječni proizvodi', ar: 'الحليب ومشتقاته' },
  eggs: { en: 'eggs', bs: 'jaja', ar: 'البيض' },
  fish: { en: 'fish', bs: 'riba', ar: 'السمك' },
  shellfish: { en: 'shellfish', bs: 'rakovi i školjke', ar: 'القشريات والمحار' },
  nuts: { en: 'tree nuts', bs: 'orašasti plodovi', ar: 'المكسرات' },
  peanuts: { en: 'peanuts', bs: 'kikiriki', ar: 'الفول السوداني' },
  soy: { en: 'soy', bs: 'soja', ar: 'الصويا' },
  sesame: { en: 'sesame', bs: 'susam', ar: 'السمسم' },
  celery: { en: 'celery', bs: 'celer', ar: 'الكرفس' },
  mustard: { en: 'mustard', bs: 'senf (gorušica)', ar: 'الخردل' },
  sulphites: { en: 'sulphites', bs: 'sulfiti', ar: 'الكبريتيت' },
  lupin: { en: 'lupin', bs: 'lupina', ar: 'الترمس' },
  molluscs: { en: 'molluscs', bs: 'mekušci', ar: 'الرخويات' },
};

export const allergenName = (code: string, locale: Locale): string => ALLERGENS[code]?.[locale] ?? code;

/** "15.50 KM"; in Bosnian "15,50 KM", as prices are written there. */
export const kmPrice = (n: number, locale: Locale): string => {
  const s = n.toFixed(2);
  return `${locale === 'bs' ? s.replace('.', ',') : s} KM`;
};

/** A list in a language: "a, b and c", "a, b i c", "a، b وc". */
export function listOf(parts: string[], locale: Locale): string {
  if (parts.length < 2) return parts.join('');
  const sep = locale === 'ar' ? '، ' : ', ';
  const and = { en: ' and ', bs: ' i ', ar: ' و' }[locale];
  return `${parts.slice(0, -1).join(sep)}${and}${parts[parts.length - 1]}`;
}
