/**
 * Vera Italia's own words, in the app's three languages. The dishes' names
 * and descriptions live in the database (scripts/vera-italia/menu.json);
 * this is everything around them — the menu's home and the website.
 */
import type { Locale } from '../../lib/i18n';

export type Copy = Record<Locale, string>;

export const pick = (c: Copy, locale: Locale) => c[locale] ?? c.en;

export const VERA = {
  tagline: { en: 'Cucina Italiana', bs: 'Cucina Italiana', ar: 'مطبخ إيطالي' },
  menu: { en: 'Il Menù', bs: 'Il Menù', ar: 'القائمة' },
  menuTitle: { en: 'Menu — Vera Italia', bs: 'Meni — Vera Italia', ar: 'القائمة — Vera Italia' },
  menuDescription: {
    en: 'Vera Italia’s menu: bruschetta and burrata, fettuccine and truffle risotto, ten Neapolitan pizzas and a rib-eye with entrecôte sauce.',
    bs: 'Meni restorana Vera Italia: bruschetta i burrata, fettuccine i rižoto s tartufom, deset napolitanskih pizza i rib-eye s entrecôte sosom.',
    ar: 'قائمة Vera Italia: بروسكيتا وبوراتا، فيتوتشيني وريزوتو بالكمأة، عشر بيتزا نابوليتانية وستيك ريب آي بصلصة الأنتريكوت.',
  },
  courses: { en: 'The courses', bs: 'Jela', ar: 'الأطباق' },
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
  seoTitle: { en: 'Vera Italia — Cucina Italiana', bs: 'Vera Italia — Cucina Italiana', ar: 'Vera Italia — مطبخ إيطالي' },
  seoDescription: {
    en: 'Vera Italia, an Italian restaurant: Neapolitan pizza from the dome oven, pasta and risotto in silky sauces, burrata and black truffle.',
    bs: 'Vera Italia, italijanski restoran: napolitanska pizza iz kupolaste peći, pasta i rižoto u svilenkastim sosovima, burrata i crni tartuf.',
    ar: 'Vera Italia، مطعم إيطالي: بيتزا نابوليتانية من الفرن ذي القبة، باستا وريزوتو بصلصات حريرية، بوراتا وكمأة سوداء.',
  },
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
    en: 'In a room of travertine and walnut, beneath softly glowing arches.',
    bs: 'U prostoru od travertina i oraha, ispod nježno osvijetljenih lukova.',
    ar: 'في قاعة من الترافرتين وخشب الجوز، تحت أقواس مضاءة بنعومة.',
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
    en: 'Our address and opening hours will be here very soon.',
    bs: 'Adresa i radno vrijeme bit će ovdje vrlo brzo.',
    ar: 'سنضيف عنواننا ومواعيد العمل هنا قريبًا جدًا.',
  },
} satisfies Record<string, Copy>;
