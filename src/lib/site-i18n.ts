import { useMemo } from 'react';
import { useLanguageStore, type Locale } from '@/lib/i18n';

/**
 * The words on the public website (lasoul.net, the `/` route), in the three
 * languages the guest menu speaks.
 *
 * Kept apart from src/lib/i18n.ts on purpose: that table belongs to the
 * ordering app and is edited by other work, and the website's copy is long-form
 * and changes for different reasons. Both read the same language store, so the
 * switch in the website header and the one in the menu are one setting.
 *
 * Copy rules: say only what is true of La Soul today — no founders, years,
 * awards, numbers or quotes that nobody has confirmed.
 */
type Entry = Record<Locale, string>;

const S = {
  // Header and navigation
  skip_to_content: { en: 'Skip to content', bs: 'Preskoči na sadržaj', ar: 'انتقل إلى المحتوى' },
  home_label: { en: 'La Soul — home', bs: 'La Soul — početna', ar: 'La Soul — الصفحة الرئيسية' },
  nav_label: { en: 'Main', bs: 'Glavna navigacija', ar: 'التنقل الرئيسي' },
  nav_menu: { en: 'Menu', bs: 'Meni', ar: 'القائمة' },
  nav_story: { en: 'Our story', bs: 'Naša priča', ar: 'قصتنا' },
  nav_visit: { en: 'Visit', bs: 'Posjetite nas', ar: 'زورونا' },
  header_cta: { en: 'View menu', bs: 'Pogledaj meni', ar: 'عرض القائمة' },

  // Hero
  tagline: { en: 'Cake & Burger Boutique', bs: 'Cake & Burger Boutique', ar: 'بوتيك الكيك والبرغر' },
  city: { en: 'Sarajevo', bs: 'Sarajevo', ar: 'سراييفو' },
  hero_title: {
    en: 'Burgers and cakes, made with soul.',
    bs: 'Burgeri i kolači pravljeni s dušom.',
    ar: 'برغر وكيك، مُحضَّرة بكل شغف.',
  },
  hero_sub: {
    en: 'A fully halal, alcohol-free café in Sarajevo. Burgers, cakes and coffee, made fresh — and ordered right from your table.',
    bs: 'Potpuno halal kafe bez alkohola u Sarajevu. Burgeri, kolači i kafa, svježe pripremljeni — i naručeni direktno sa vašeg stola.',
    ar: 'مقهى حلال بالكامل وخالٍ من الكحول في سراييفو. برغر وكيك وقهوة تُحضَّر طازجة، وتطلبها مباشرةً من طاولتك.',
  },
  hero_cta: { en: 'View the menu', bs: 'Pogledajte meni', ar: 'تصفّح القائمة' },
  hero_find: { en: 'Find us', bs: 'Pronađite nas', ar: 'كيف تصل إلينا' },
  hero_alt: {
    en: 'The La Soul burger, a slice of San Sebastian cheesecake and a Spanish latte on a sunlit table',
    bs: 'La Soul burger, komad San Sebastian cheesecakea i španski latte na stolu obasjanom suncem',
    ar: 'برغر La Soul وقطعة تشيز كيك سان سيباستيان ولاتيه إسباني على طاولة يغمرها ضوء الشمس',
  },

  // Facts (hero strip and story)
  fact_halal: { en: 'Fully halal', bs: 'Potpuno halal', ar: 'حلال بالكامل' },
  fact_alcohol: { en: 'Alcohol-free', bs: 'Bez alkohola', ar: 'خالٍ من الكحول' },
  fact_fresh: { en: 'Made fresh', bs: 'Svježe pripremljeno', ar: 'يُحضَّر طازجًا' },

  // Story
  story_eyebrow: { en: 'Our story', bs: 'Naša priča', ar: 'قصتنا' },
  story_title: {
    en: 'A cake & burger boutique in Sarajevo',
    bs: 'Butik kolača i burgera u Sarajevu',
    ar: 'بوتيك للكيك والبرغر في سراييفو',
  },
  story_p1: {
    en: 'La Soul is where a proper burger and a beautiful slice of cake share the same table. Come for breakfast, stay for coffee, finish with something sweet.',
    bs: 'La Soul je mjesto gdje pravi burger i lijep komad kolača dijele isti sto. Dođite na doručak, ostanite na kafi, a završite nečim slatkim.',
    ar: 'في La Soul يجتمع برغر حقيقي وقطعة كيك جميلة على طاولة واحدة. تعالَ للفطور، وابقَ للقهوة، واختم بشيء حلو.',
  },
  story_p2: {
    en: 'Everything we serve is halal, nothing on our menu contains alcohol, and every dish is made fresh — from the first espresso of the morning to the last slice of cake.',
    bs: 'Sve što služimo je halal, ništa na našem meniju ne sadrži alkohol, a svako jelo pripremamo svježe — od prvog jutarnjeg espressa do posljednjeg komada kolača.',
    ar: 'كل ما نقدّمه حلال، ولا يحتوي أي صنف في قائمتنا على الكحول، وكل طبق يُحضَّر طازجًا — من أول إسبريسو في الصباح حتى آخر قطعة كيك.',
  },
  story_cake_alt: {
    en: 'Saffron milk cake and a chocolate lava cake with vanilla ice cream',
    bs: 'Mliječni kolač sa šafranom i čokoladni lava kolač sa sladoledom od vanilije',
    ar: 'كيكة الحليب بالزعفران ولافا كيك بالشوكولاتة مع آيس كريم الفانيليا',
  },
  story_burger_alt: {
    en: 'The Solar Gravity burger with seasoned truffle fries',
    bs: 'Solar Gravity burger sa začinjenim pomfritom s tartufom',
    ar: 'برغر سولار جرافيتي مع بطاطس متبّلة بالكمأة',
  },

  // Signatures
  sig_eyebrow: { en: 'From the menu', bs: 'Iz menija', ar: 'من القائمة' },
  sig_title: { en: 'House signatures', bs: 'Specijaliteti kuće', ar: 'أطباقنا المميزة' },
  sig_sub: {
    en: 'A first taste of the menu. Tap a dish to find it there.',
    bs: 'Prvi pogled na naš meni. Dodirnite jelo da ga pronađete u meniju.',
    ar: 'لمحة أولى عن قائمتنا. اضغط على أي طبق لتجده فيها.',
  },
  sig_all: { en: 'See the full menu', bs: 'Pogledajte cijeli meni', ar: 'شاهد القائمة كاملة' },
  sig_new: { en: 'New', bs: 'Novo', ar: 'جديد' },
  sig_featured: { en: 'Featured', bs: 'Izdvojeno', ar: 'مختار' },

  // Categories
  cat_drinks: { en: 'Drinks', bs: 'Pića', ar: 'المشروبات' },
  cat_food: { en: 'Food', bs: 'Hrana', ar: 'الطعام' },
  cat_desserts: { en: 'Desserts', bs: 'Deserti', ar: 'الحلويات' },
  cat_drinks_desc: { en: 'Coffee, tea, frappés and fresh juice', bs: 'Kafa, čaj, frappe i svježi sokovi', ar: 'قهوة وشاي وفرابيه وعصائر طازجة' },
  cat_food_desc: { en: 'Breakfast, burgers, pasta and more', bs: 'Doručak, burgeri, tjestenina i još mnogo toga', ar: 'فطور وبرغر وباستا والمزيد' },
  cat_desserts_desc: { en: 'Cakes, puddings and sweet cups', bs: 'Kolači, pudinzi i slatke čaše', ar: 'كيك وبودينغ وحلويات في أكواب' },

  // The menu
  menu_eyebrow: { en: 'The menu', bs: 'Meni', ar: 'القائمة' },
  menu_title: { en: 'Coffee, food and something sweet', bs: 'Kafa, hrana i nešto slatko', ar: 'قهوة وطعام وشيء حلو' },
  menu_sub: {
    en: 'The whole menu with photos and allergens, in English, Bosnian and Arabic.',
    bs: 'Cijeli meni s fotografijama i alergenima, na bosanskom, engleskom i arapskom.',
    ar: 'القائمة كاملة مع الصور ومسببات الحساسية، بالعربية والبوسنية والإنجليزية.',
  },
  menu_open: { en: 'Open {name}', bs: 'Otvori: {name}', ar: 'افتح {name}' },

  // Order from your table
  order_eyebrow: { en: 'At your table', bs: 'Za vašim stolom', ar: 'على طاولتك' },
  order_title: { en: 'Order from your table', bs: 'Naručite sa svog stola', ar: 'اطلب من طاولتك' },
  order_sub: {
    en: 'Scan the code on your table and your phone becomes the menu.',
    bs: 'Skenirajte kod na stolu i vaš telefon postaje meni.',
    ar: 'امسح الرمز على طاولتك ليصبح هاتفك هو القائمة.',
  },
  step1_title: { en: 'Scan', bs: 'Skenirajte', ar: 'امسح الرمز' },
  step1_body: {
    en: 'Point your phone’s camera at the QR code on your table.',
    bs: 'Usmjerite kameru telefona na QR kod na stolu.',
    ar: 'وجّه كاميرا هاتفك نحو رمز QR الموجود على طاولتك.',
  },
  step2_title: { en: 'Order', bs: 'Naručite', ar: 'اطلب' },
  step2_body: {
    en: 'Choose from the full menu in your language. Your order goes straight to the kitchen.',
    bs: 'Birajte iz cijelog menija na svom jeziku. Narudžba ide pravo u kuhinju.',
    ar: 'اختر من القائمة كاملة بلغتك، ويصل طلبك مباشرةً إلى المطبخ.',
  },
  step3_title: { en: 'Pay at the table', bs: 'Platite za stolom', ar: 'ادفع على الطاولة' },
  step3_body: {
    en: 'Pay your waiter at the table whenever you’re ready.',
    bs: 'Platite konobaru za stolom kad god budete spremni.',
    ar: 'ادفع للنادل على طاولتك متى كنت مستعدًا.',
  },
  order_note: {
    en: 'You can browse the menu from anywhere. Ordering opens when you scan the code at your table.',
    bs: 'Meni možete pregledati s bilo kojeg mjesta. Naručivanje je moguće kada skenirate kod na stolu.',
    ar: 'يمكنك تصفّح القائمة من أي مكان، ويُتاح الطلب عند مسح الرمز على طاولتك.',
  },
  order_alt: {
    en: 'The La Soul menu open on a phone, beside a cappuccino and a butter croissant',
    bs: 'La Soul meni otvoren na telefonu, pored cappuccina i kroasana s puterom',
    ar: 'قائمة La Soul مفتوحة على هاتف بجانب كابتشينو وكرواسون بالزبدة',
  },

  // Promise
  promise_eyebrow: { en: 'Our promise', bs: 'Naše obećanje', ar: 'وعدنا' },
  promise_title: { en: 'Halal, honest and made fresh', bs: 'Halal, iskreno i svježe', ar: 'حلال وطازج، بكل أمانة' },
  promise_halal_title: { en: 'Halal, all of it', bs: 'Sve je halal', ar: 'كل شيء حلال' },
  promise_halal_body: {
    en: 'Every dish and every drink on our menu is halal.',
    bs: 'Svako jelo i svako piće na našem meniju je halal.',
    ar: 'كل طبق وكل مشروب في قائمتنا حلال.',
  },
  promise_alcohol_title: { en: 'No alcohol, ever', bs: 'Nikad alkohol', ar: 'بلا كحول أبدًا' },
  promise_alcohol_body: {
    en: 'Nothing we serve contains alcohol — not in the drinks, not in the desserts.',
    bs: 'Ništa što služimo ne sadrži alkohol — ni u pićima, ni u desertima.',
    ar: 'لا شيء مما نقدّمه يحتوي على الكحول، لا في المشروبات ولا في الحلويات.',
  },
  promise_fresh_title: { en: 'Made fresh', bs: 'Svježe pripremljeno', ar: 'يُحضَّر طازجًا' },
  promise_fresh_body: {
    en: 'Burgers, cakes and coffee, prepared fresh in Sarajevo.',
    bs: 'Burgeri, kolači i kafa, svježe pripremljeni u Sarajevu.',
    ar: 'برغر وكيك وقهوة تُحضَّر طازجة في سراييفو.',
  },
  promise_allergens_title: { en: 'Allergens, clearly', bs: 'Jasno navedeni alergeni', ar: 'مسببات الحساسية بوضوح' },
  promise_allergens_body: {
    en: 'The menu lists allergens for our dishes, and our team is happy to help.',
    bs: 'Meni navodi alergene za naša jela, a naše osoblje će vam rado pomoći.',
    ar: 'تعرض القائمة مسببات الحساسية لأطباقنا، ويسعد فريقنا بمساعدتك.',
  },
  promise_alt: {
    en: 'Fresh ingredients on linen: saffron, pistachios, dates, eggs, lemon and mint',
    bs: 'Svježi sastojci na lanenom stolnjaku: šafran, pistaći, datule, jaja, limun i nana',
    ar: 'مكونات طازجة على قماش الكتان: زعفران وفستق وتمر وبيض وليمون ونعناع',
  },

  // Visit
  visit_eyebrow: { en: 'Visit', bs: 'Posjetite nas', ar: 'زورونا' },
  visit_title: { en: 'Come and find us', bs: 'Dođite kod nas', ar: 'يسعدنا أن تزورنا' },
  visit_sub: {
    en: 'Drop in for a coffee, stay for dessert.',
    bs: 'Svratite na kafu, ostanite na desertu.',
    ar: 'مرّ لاحتساء القهوة، وابقَ للحلوى.',
  },
  visit_address: { en: 'Address', bs: 'Adresa', ar: 'العنوان' },
  visit_phone: { en: 'Phone', bs: 'Telefon', ar: 'الهاتف' },
  visit_hours: { en: 'Opening hours', bs: 'Radno vrijeme', ar: 'ساعات العمل' },
  visit_follow: { en: 'Follow us', bs: 'Pratite nas', ar: 'تابعونا' },
  visit_directions: { en: 'Directions', bs: 'Kako do nas', ar: 'الاتجاهات' },
  visit_call: { en: 'Call us', bs: 'Pozovite nas', ar: 'اتصل بنا' },
  new_tab: { en: '(opens in a new tab)', bs: '(otvara se u novoj kartici)', ar: '(يفتح في علامة تبويب جديدة)' },
  visit_alt: {
    en: 'Arabic coffee in a silver dallah with dates, in afternoon light',
    bs: 'Arapska kafa u srebrnoj dželvi s datulama, na popodnevnom svjetlu',
    ar: 'قهوة عربية في دلّة فضية مع التمر تحت ضوء العصر',
  },

  // Footer
  footer_nav: { en: 'Footer', bs: 'Podnožje', ar: 'تذييل الصفحة' },
  footer_privacy: { en: 'Privacy', bs: 'Privatnost', ar: 'الخصوصية' },
  footer_menu: { en: 'Menu', bs: 'Meni', ar: 'القائمة' },
  footer_rights: { en: '© {year} La Soul', bs: '© {year} La Soul', ar: '© {year} La Soul' },

  // Search engines and link previews
  seo_title: {
    en: 'La Soul — Cake & Burger Boutique in Sarajevo',
    bs: 'La Soul — Cake & Burger Boutique u Sarajevu',
    ar: 'La Soul — بوتيك الكيك والبرغر في سراييفو',
  },
  seo_description: {
    en: 'A fully halal, alcohol-free café in Sarajevo: burgers, cakes and coffee, made fresh. See the menu and order from your table.',
    bs: 'Potpuno halal kafe bez alkohola u Sarajevu: burgeri, kolači i kafa, svježe pripremljeni. Pogledajte meni i naručite sa svog stola.',
    ar: 'مقهى حلال بالكامل وخالٍ من الكحول في سراييفو: برغر وكيك وقهوة تُحضَّر طازجة. تصفّح القائمة واطلب من طاولتك.',
  },
} satisfies Record<string, Entry>;

export type SiteKey = keyof typeof S;

/** Every string, for tests that check the three languages are complete. */
export const SITE_STRINGS: Readonly<Record<SiteKey, Entry>> = S;

export function siteT(key: SiteKey, locale: Locale, vars?: Record<string, string | number>): string {
  const entry = S[key];
  let text = entry[locale] || entry.en;
  if (vars) for (const [k, v] of Object.entries(vars)) text = text.split(`{${k}}`).join(String(v));
  return text;
}

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
