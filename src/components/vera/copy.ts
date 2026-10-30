/**
 * Vera Italia's own words, in the app's three languages. The dishes' names
 * and descriptions live in the database (scripts/vera-italia/menu.json);
 * this is everything around them — the menu's home and the website.
 */
import type { Locale } from '../../lib/i18n';

export type Copy = Record<Locale, string>;

export const pick = (c: Copy, locale: Locale) => c[locale] ?? c.en;

/** Courses and sections are numbered like a printed menu's. */
export const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

/**
 * Where it is, as each language says it: the city, "in the city" (Bosnian
 * declines it: u Sarajevu), the country. People search for an Italian
 * restaurant *in Sarajevo*, so the titles, the text and the answers say so.
 */
export const PLACE = {
  city: { en: 'Sarajevo', bs: 'Sarajevo', ar: 'سراييفو' },
  inCity: { en: 'in Sarajevo', bs: 'u Sarajevu', ar: 'في سراييفو' },
  country: { en: 'Bosnia and Herzegovina', bs: 'Bosna i Hercegovina', ar: 'البوسنة والهرسك' },
} satisfies Record<string, Copy>;

/** A course's title — "Pizza Napoletana in Sarajevo — Vera Italia" — the same in the app and on the prerendered page. */
export const courseTitle = (course: string, locale: Locale) => `${course} ${pick(PLACE.inCity, locale)} — Vera Italia`;

export const VERA = {
  tagline: { en: 'Cucina Italiana', bs: 'Cucina Italiana', ar: 'مطبخ إيطالي' },
  menu: { en: 'Il Menù', bs: 'Il Menù', ar: 'القائمة' },
  menuTitle: {
    en: 'Menu — Vera Italia, Italian Restaurant in Sarajevo',
    bs: 'Meni — Vera Italia, italijanski restoran u Sarajevu',
    ar: 'القائمة — Vera Italia، مطعم إيطالي في سراييفو',
  },
  menuDescription: {
    en: 'The menu of Vera Italia, an Italian restaurant in Sarajevo: bruschetta and burrata, fettuccine and truffle risotto, ten Neapolitan pizzas and a rib-eye.',
    bs: 'Meni restorana Vera Italia u Sarajevu: bruschetta i burrata, fettuccine i rižoto s tartufom, deset napolitanskih pizza i rib-eye s entrecôte sosom.',
    ar: 'قائمة Vera Italia، مطعم إيطالي في سراييفو: بروسكيتا وبوراتا، فيتوتشيني وريزوتو بالكمأة، عشر بيتزا نابوليتانية وستيك ريب آي.',
  },
  courses: { en: 'Le Portate', bs: 'Le Portate', ar: 'الأطباق' },
  specialita: { en: 'Specialità della Casa', bs: 'Specialità della Casa', ar: 'أطباق البيت' },
} satisfies Record<string, Copy>;

/** Each course on the menu's home: the dish whose photograph stands for it, and a line under its name. */
export const COURSES: Record<string, { cover: string; line: Copy; short: Copy }> = {
  'Antipasti & Insalate': {
    short: { en: 'Antipasti', bs: 'Antipasti', ar: 'المقبلات' },
    cover: 'b7a1d000-0000-4000-8000-000000000001', // Bruschetta
    line: { en: 'Bruschetta, baked feta, caprese', bs: 'Bruschetta, zapečena feta, caprese', ar: 'بروسكيتا، فيتا مخبوزة، كابريزي' },
  },
  'Pasta & Risotto': {
    short: { en: 'Pasta', bs: 'Pasta', ar: 'الباستا' },
    cover: 'b7a1d000-0000-4000-8000-000000000005', // Penne all'Arrabbiata
    line: { en: 'Fettuccine, penne and risotto', bs: 'Fettuccine, penne i rižoto', ar: 'فيتوتشيني وبيني وريزوتو' },
  },
  'Pizza Napoletana': {
    short: { en: 'Pizza', bs: 'Pizza', ar: 'البيتزا' },
    cover: 'b7a1d000-0000-4000-8000-000000000015', // Margherita
    line: { en: 'Ten pizzas from our oven', bs: 'Deset pizza iz naše peći', ar: 'عشر بيتزا من فرننا' },
  },
  Carne: {
    short: { en: 'Carne', bs: 'Carne', ar: 'اللحوم' },
    cover: 'b7a1d000-0000-4000-8000-000000000025', // Rib-eye Steak Platter
    line: { en: 'Rib-eye with entrecôte sauce', bs: 'Rib-eye s entrecôte sosom', ar: 'ريب آي بصلصة الأنتريكوت' },
  },
};

/** The website, /veraitalia/. Facts not yet known (address, hours, phone) are not written here: the page leaves them out. */
export const SITE = {
  seoTitle: {
    en: 'Vera Italia — Italian Restaurant & Pizza in Sarajevo',
    bs: 'Vera Italia — italijanski restoran i pizza u Sarajevu',
    ar: 'Vera Italia — مطعم إيطالي وبيتزا في سراييفو',
  },
  seoDescription: {
    en: 'Vera Italia is an Italian restaurant in Sarajevo: Neapolitan pizza from the dome oven, pasta and risotto in silky sauces, burrata and black truffle.',
    bs: 'Vera Italia je italijanski restoran u Sarajevu: napolitanska pizza iz kupolaste peći, pasta i rižoto u svilenkastim sosovima, burrata i crni tartuf.',
    ar: 'Vera Italia مطعم إيطالي في سراييفو: بيتزا نابوليتانية من الفرن ذي القبة، باستا وريزوتو بصلصات حريرية، بوراتا وكمأة سوداء.',
  },
  /** Under the name on the photograph. */
  place: { en: 'Italian restaurant · Sarajevo', bs: 'Italijanski restoran · Sarajevo', ar: 'مطعم إيطالي · سراييفو' },
  heroLine: { en: 'Pizza napoletana · Pasta · Risotto', bs: 'Pizza napoletana · Pasta · Risotto', ar: 'بيتزا نابوليتانية · باستا · ريزوتو' },
  viewMenu: { en: 'View the menu', bs: 'Pogledajte meni', ar: 'عرض القائمة' },
  openingSoon: { en: 'Opening soon', bs: 'Uskoro otvaramo', ar: 'نفتتح قريبًا' },
  welcome: { en: 'Benvenuti', bs: 'Benvenuti', ar: 'أهلًا بكم' },
  intro: {
    en: 'Neapolitan pizza from our oven, pasta and risotto in silky sauces, burrata and black truffle.',
    bs: 'Napolitanska pizza iz naše peći, pasta i rižoto u svilenkastim sosovima, burrata i crni tartuf.',
    ar: 'بيتزا نابوليتانية من فرننا، باستا وريزوتو بصلصات حريرية، بوراتا وكمأة سوداء.',
  },
  introRoom: {
    en: 'An Italian restaurant in Sarajevo, in a room of travertine and walnut beneath softly glowing arches.',
    bs: 'Italijanski restoran u Sarajevu, u prostoru od travertina i oraha, ispod nježno osvijetljenih lukova.',
    ar: 'مطعم إيطالي في سراييفو، في قاعة من الترافرتين وخشب الجوز، تحت أقواس مضاءة بنعومة.',
  },
  /** What sets it apart, said plainly: the answer to "which Italian restaurant in Sarajevo?". */
  apart: {
    en: 'Neapolitan pizza from a dome oven; burrata and black truffle; a room of travertine and walnut beneath glowing arches; and a menu in Bosnian, English and Arabic that you order from at your table.',
    bs: 'Napolitanska pizza iz kupolaste peći; burrata i crni tartuf; prostor od travertina i oraha ispod osvijetljenih lukova; i meni na bosanskom, engleskom i arapskom iz kojeg naručujete sa svog stola.',
    ar: 'بيتزا نابوليتانية من فرن ذي قبة؛ بوراتا وكمأة سوداء؛ قاعة من الترافرتين وخشب الجوز تحت أقواس مضيئة؛ وقائمة بالبوسنية والإنجليزية والعربية تطلب منها من طاولتك.',
  },
  fromKitchen: { en: 'Dalla cucina', bs: 'Dalla cucina', ar: 'من المطبخ' },
  signatures: { en: 'Signature dishes', bs: 'Specijaliteti kuće', ar: 'أطباقنا المميزة' },
  oven: { en: 'Il forno', bs: 'Il forno', ar: 'الفرن' },
  ovenTitle: { en: 'The dome oven', bs: 'Kupolasta peć', ar: 'الفرن ذو القبة' },
  ovenBody: {
    en: 'Every pizza bakes in the dome oven at the heart of the room: a puffy, leopard-spotted crust, soft in the middle.',
    bs: 'Svaka pizza peče se u kupolastoj peći u srcu restorana: prozračan rub s tamnim mrljama, mekana sredina.',
    ar: 'تُخبز كل بيتزا في الفرن ذي القبة في قلب المطعم: حافة منتفخة مبقّعة، ووسط طري.',
  },
  ovenAlt: {
    en: 'The white dome oven in its black arch at the pass, glass globe lamps above',
    bs: 'Bijela kupolasta peć u crnom luku iza pulta, iznad staklene viseće lampe',
    ar: 'الفرن الأبيض ذو القبة داخل قوس أسود خلف المنضدة، وفوقه مصابيح زجاجية',
  },
  menuTitle: { en: 'The menu', bs: 'Meni', ar: 'القائمة' },
  room: { en: 'Il locale', bs: 'Il locale', ar: 'المكان' },
  roomTitle: { en: 'The room', bs: 'Prostor', ar: 'القاعة' },
  roomBody: {
    en: 'Travertine walls, walnut, terracotta and olive velvet, and a line of light that runs across the ceiling.',
    bs: 'Zidovi od travertina, orah, baršun boje terakote i masline i linija svjetla koja se proteže stropom.',
    ar: 'جدران من الترافرتين، خشب الجوز، مخمل بلون التراكوتا والزيتون، وخط من الضوء يمتد عبر السقف.',
  },
  heroAlt: {
    en: 'Vera Italia’s dining room: backlit arches, glass globe lamps, an olive velvet banquette',
    bs: 'Sala restorana Vera Italia: osvijetljeni lukovi, staklene lampe, baršunasta klupa boje masline',
    ar: 'قاعة Vera Italia: أقواس مضاءة، مصابيح زجاجية، أريكة مخملية بلون الزيتون',
  },
  roomAlt: {
    en: 'The long room: arched mirrors framed in light, walnut tables and terracotta chairs',
    bs: 'Duga sala: lučna ogledala uokvirena svjetlom, stolovi od oraha i stolice boje terakote',
    ar: 'القاعة الطويلة: مرايا مقوّسة محاطة بالضوء، طاولات من الجوز وكراسٍ بلون التراكوتا',
  },
  visit: { en: 'Vieni a trovarci', bs: 'Vieni a trovarci', ar: 'زورونا' },
  visitSoon: {
    en: 'Our street address and opening hours will be here very soon.',
    bs: 'Tačna adresa i radno vrijeme bit će ovdje vrlo brzo.',
    ar: 'سنضيف عنواننا الكامل ومواعيد العمل هنا قريبًا جدًا.',
  },
} satisfies Record<string, Copy>;
