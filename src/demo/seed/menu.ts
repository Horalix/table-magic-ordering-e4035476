/**
 * Casa Demo's menu (demo mode only): a fictional modern Mediterranean
 * restaurant in Sarajevo. Six categories, forty-six dishes and drinks, each in
 * English, Bosnian and Arabic, with allergens, dietary tags, prep times,
 * costs and the badges the menu shows.
 *
 * `id` doubles as the photo: each is the id of a folder in public/menu, the
 * app's prebuilt photo ladders (src/lib/image-manifest.json), chosen for
 * showing no restaurant's name. `weight` is how often the dish sells in the
 * seeded history, relative to the others.
 */

export interface DemoCategory {
  id: string;
  name: string;
  name_bs: string;
  name_ar: string;
}

export interface DemoSubcategory {
  id: string;
  category: string;
  name: string;
  name_bs: string;
  name_ar: string;
}

export type MealRole = 'starter' | 'main' | 'side' | 'dessert' | 'hot_drink' | 'cold_drink';

export interface DemoItem {
  id: string;
  sub: string;
  name: string;
  name_bs: string;
  name_ar: string;
  description: string;
  description_bs: string;
  description_ar: string;
  price: number;
  /** What it costs to make, in KM. */
  cost: number;
  station: 'kitchen' | 'bar';
  role: MealRole;
  prep: number;
  allergens: string[];
  diet: string[];
  badges: string[];
  portion?: string;
  weight: number;
  /** When in the day it sells: breakfast dishes in the morning, desserts after mains. */
  when: 'morning' | 'meal' | 'any' | 'sweet';
}

const cat = (n: number) => `ca7e0000-0000-4000-8000-00000000000${n}`;
const sub = (n: number) => `c5b00000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;

export const CATEGORIES: DemoCategory[] = [
  { id: cat(1), name: 'Brunch', name_bs: 'Brunch', name_ar: 'برانش' },
  { id: cat(2), name: 'Starters & Salads', name_bs: 'Predjela i salate', name_ar: 'المقبلات والسلطات' },
  { id: cat(3), name: 'Mains', name_bs: 'Glavna jela', name_ar: 'الأطباق الرئيسية' },
  { id: cat(4), name: 'Desserts', name_bs: 'Deserti', name_ar: 'الحلويات' },
  { id: cat(5), name: 'Coffee & Tea', name_bs: 'Kafa i čaj', name_ar: 'القهوة والشاي' },
  { id: cat(6), name: 'Cold Drinks', name_bs: 'Hladna pića', name_ar: 'المشروبات الباردة' },
];

export const SUBS = {
  eggs: sub(1), sweetBrunch: sub(2), smallPlates: sub(3), salads: sub(4), pasta: sub(5), burgers: sub(6),
  sides: sub(7), desserts: sub(8), coffee: sub(9), tea: sub(10), juices: sub(11), mocktails: sub(12),
} as const;

export const SUBCATEGORIES: DemoSubcategory[] = [
  { id: SUBS.eggs, category: cat(1), name: 'Eggs & Savoury', name_bs: 'Jaja i slano', name_ar: 'البيض والأطباق المالحة' },
  { id: SUBS.sweetBrunch, category: cat(1), name: 'Sweet & Sharing', name_bs: 'Slatko i za dijeljenje', name_ar: 'الحلو وأطباق المشاركة' },
  { id: SUBS.smallPlates, category: cat(2), name: 'Soups & Small Plates', name_bs: 'Supe i mala jela', name_ar: 'الشوربات والأطباق الصغيرة' },
  { id: SUBS.salads, category: cat(2), name: 'Salads', name_bs: 'Salate', name_ar: 'السلطات' },
  { id: SUBS.pasta, category: cat(3), name: 'Pasta & Risotto', name_bs: 'Tjestenine i rižota', name_ar: 'الباستا والريزوتو' },
  { id: SUBS.burgers, category: cat(3), name: 'Burgers & Grill', name_bs: 'Burgeri i roštilj', name_ar: 'البرغر والمشاوي' },
  { id: SUBS.sides, category: cat(3), name: 'Sides', name_bs: 'Prilozi', name_ar: 'الأطباق الجانبية' },
  { id: SUBS.desserts, category: cat(4), name: 'Desserts', name_bs: 'Deserti', name_ar: 'الحلويات' },
  { id: SUBS.coffee, category: cat(5), name: 'Coffee', name_bs: 'Kafa', name_ar: 'القهوة' },
  { id: SUBS.tea, category: cat(5), name: 'Tea & More', name_bs: 'Čaj i ostalo', name_ar: 'الشاي وغيره' },
  { id: SUBS.juices, category: cat(6), name: 'Juices & Lemonades', name_bs: 'Sokovi i limunade', name_ar: 'العصائر والليمونادة' },
  { id: SUBS.mocktails, category: cat(6), name: 'Mocktails & Soft Drinks', name_bs: 'Mocktaili i sokovi', name_ar: 'الموكتيلات والمشروبات الغازية' },
];

/** Ids the rest of the seed names: the combo and its parts, the featured dishes, the usual pairings. */
export const ITEM = {
  turkishEggs: '818ee57e-d8e8-45d9-b3e0-cb498b02c705',
  shakshuka: 'f90e4414-312d-4e3e-bae4-524d3e716296',
  benedict: '894b970d-ba31-4382-9495-3e256af09a93',
  avocadoToast: 'be3ebd70-3235-4abd-b2dc-e71dc0b5a30b',
  frenchToast: '7c9e6489-94ad-4ef5-a777-958f7f1bed9a',
  mezzeForTwo: '7382930d-240f-48c4-a3e1-5555e8561e60',
  mushroomSoup: 'c46956df-c2a2-42b1-bd6d-829eb079a901',
  mozzarellaSticks: 'a372aceb-d87e-427e-8631-57cfdaf5a461',
  sesameChicken: '699add79-5dc1-4cc6-a37e-225440eb8901',
  arancini: 'cd05010d-d313-4cc2-8485-60f7c93d0ff7',
  shopska: 'e5cb4265-b20c-4040-bb35-0a590ca91976',
  falafelBowl: '9e2930a8-10e8-4e7f-b710-6dc9c8b79fec',
  chickenCaesar: '3270f1bd-c977-4bbd-819e-f2054111b1b7',
  beetrootSalad: 'fa33c027-e841-4b73-a334-9c7fabe88abe',
  truffleRisotto: '82c96deb-f1c9-4904-84cf-0160c9b48191',
  pestoRisotto: 'f13a527b-ed1f-4b16-a4c0-7b14f70bbce7',
  arrabbiata: '153b5956-c40a-43c3-9a75-e9d5c8dbb9b3',
  fettuccine: '2606d83c-f867-44c8-9181-cc5f019f4a2c',
  casaBurger: '1dd974a0-8e3a-4a86-b0d3-d2cff08b06e1',
  chickenBurger: '57ffe3df-eed0-4842-8d8e-62a70672063b',
  smashBurger: 'd428cbc8-229b-4a68-9b60-c0b13f56a92e',
  sliderTrio: '32d1fe9b-ae30-49fb-8afb-37e0e5edaa29',
  burgerCombo: 'ca56673c-0329-4d5f-ba49-cb602e2cda71',
  fries: '78dfd2e2-d8a8-4df6-aa33-c5945daa166d',
  cheesecake: '09af75d1-cdfc-49b4-bdd8-85fafc5fc656',
  lavaCake: '8ecbbf48-1572-4f8f-afc8-81bbc0c43643',
  cremeBrulee: '0517de46-e686-4529-a965-7a4bd6f06bfd',
  churros: '4bdf76b3-b150-46f5-b059-0f228d48c56d',
  chocolateDome: 'f9ab0a76-39a6-4e37-ac19-96d66cf2d887',
  espresso: '6d045710-1c52-4676-8a29-8c1df58b07f5',
  cappuccino: '238b7bdb-fab3-4ed9-b7aa-59ab01c2de62',
  flatWhite: '9eead00b-463c-40f0-9529-9e5b36ced112',
  latte: '1d94a936-20c2-4d98-9a70-ed0751c154f5',
  icedLatte: 'cd4981aa-be02-4cb3-9efd-6478ca1182a7',
  matcha: '7a8b578e-d53f-4892-bbe1-771240aed585',
  hotChocolate: '0f2be686-a58a-4863-bd8a-0adf997afd45',
  hibiscusTea: '74d40491-629b-47e2-8aa8-9ab12a7bdc27',
  mintTea: 'a69d4ceb-4a8b-43e8-abd0-c000e2ab3013',
  orangeJuice: 'b0b3385b-b5a9-420e-acf1-d7ef563df8dd',
  lemonMint: '6407181b-495b-4a72-8c5a-92ba2a6ed742',
  strawberryLemonade: 'c9a69b0a-986d-49b9-a6d9-016439c61fcb',
  mojito: 'f14ddc91-1fc8-4885-b7d2-9071c935add6',
  raspberryMojito: '1d36f430-a209-459d-a0c5-bb18a2a2f85b',
  peachIcedTea: '37bf2c55-d3f1-4b8f-8507-db9ae8bbd051',
  water: '4e5bef1d-79b2-4a38-8364-aba876205e82',
  cola: '85eb8977-9bd9-4d8a-86b7-285060783db4',
} as const;

type Row = [
  id: string, sub: string, names: [string, string, string], descriptions: [string, string, string],
  price: number, cost: number, role: MealRole, prep: number, allergens: string[], diet: string[], badges: string[],
  weight: number, when: DemoItem['when'], portion?: string,
];

const ROWS: Row[] = [
  // ---- Brunch
  [ITEM.turkishEggs, SUBS.eggs, ['Turkish Eggs', 'Turska jaja', 'بيض تركي'],
    ['Poached eggs on garlic yoghurt with chilli butter and toasted sourdough.', 'Poširana jaja na jogurtu s bijelim lukom, čili puterom i tostiranim hljebom od kiselog tijesta.', 'بيض مسلوق على لبن بالثوم مع زبدة الفلفل الحار وخبز محمّص.'],
    13.5, 3.6, 'main', 9, ['eggs', 'dairy', 'gluten'], ['vegetarian'], ['house_favourite'], 7, 'morning', '2 eggs'],
  [ITEM.shakshuka, SUBS.eggs, ['Shakshuka', 'Šakšuka', 'شكشوكة'],
    ['Eggs baked in a spiced tomato and pepper sauce with feta, served in the pan with warm flatbread.', 'Jaja pečena u začinjenom sosu od paradajza i paprike s feta sirom, servirana u tavi uz topli somun.', 'بيض مطهو في صلصة الطماطم والفلفل المتبّلة مع جبنة الفيتا، يُقدَّم في المقلاة مع خبز ساخن.'],
    14.5, 3.9, 'main', 12, ['eggs', 'dairy', 'gluten'], ['vegetarian', 'spicy'], ['popular'], 9, 'morning'],
  [ITEM.benedict, SUBS.eggs, ['Eggs Benedict', 'Jaja Benedikt', 'بيض بنديكت'],
    ['Two poached eggs on toasted muffins with smoked turkey, hollandaise and a leaf salad.', 'Dva poširana jaja na tostiranim mafinima s dimljenom puretinom, holandez sosom i zelenom salatom.', 'بيضتان مسلوقتان على خبز المافن المحمّص مع الديك الرومي المدخّن وصلصة الهولنديز وسلطة خضراء.'],
    14, 4.2, 'main', 11, ['eggs', 'dairy', 'gluten'], [], [], 6, 'morning', '2 eggs'],
  [ITEM.avocadoToast, SUBS.eggs, ['Avocado Toast', 'Tost s avokadom', 'توست الأفوكادو'],
    ['Smashed avocado on rye with two poached eggs, pomegranate and pumpkin seeds.', 'Gnječeni avokado na raženom hljebu s dva poširana jaja, narom i sjemenkama bundeve.', 'أفوكادو مهروس على خبز الجاودار مع بيضتين مسلوقتين والرمان وبذور اليقطين.'],
    14, 4.4, 'main', 8, ['eggs', 'gluten'], ['vegetarian', 'dairy_free'], ['popular'], 8, 'morning'],
  [ITEM.frenchToast, SUBS.sweetBrunch, ['French Toast', 'Francuski tost', 'توست فرنسي'],
    ['Thick brioche toast with fresh berries, vanilla cream and maple syrup.', 'Debeli brioš tost sa svježim bobičastim voćem, kremom od vanilije i javorovim sirupom.', 'خبز بريوش سميك مع التوت الطازج وكريمة الفانيليا وشراب القيقب.'],
    13, 3.3, 'main', 10, ['eggs', 'dairy', 'gluten'], ['vegetarian'], [], 5, 'morning'],
  [ITEM.mezzeForTwo, SUBS.sweetBrunch, ['Mezze Breakfast for Two', 'Meze doručak za dvoje', 'فطور مزّة لشخصين'],
    ['A board to share: hummus, labneh, olives, falafel, cheeses, honey, jam and warm bread.', 'Daska za dijeljenje: humus, labneh, masline, falafel, sirevi, med, džem i topli hljeb.', 'طبق للمشاركة: حمّص، لبنة، زيتون، فلافل، أجبان، عسل، مربّى وخبز ساخن.'],
    29, 8.9, 'main', 14, ['dairy', 'gluten', 'sesame'], ['vegetarian'], ['signature'], 3, 'morning', 'For 2'],

  // ---- Starters & salads
  [ITEM.mushroomSoup, SUBS.smallPlates, ['Wild Mushroom Soup', 'Supa od šumskih gljiva', 'شوربة الفطر البرّي'],
    ['Velvety forest mushroom soup with thyme and toasted country bread.', 'Kremasta supa od šumskih gljiva s majčinom dušicom i tostiranim domaćim hljebom.', 'شوربة كريمية من فطر الغابة مع الزعتر وخبز ريفي محمّص.'],
    8.5, 1.9, 'starter', 6, ['dairy', 'gluten', 'celery'], ['vegetarian'], [], 6, 'meal'],
  [ITEM.mozzarellaSticks, SUBS.smallPlates, ['Crispy Mozzarella Sticks', 'Hrskavi štapići mozzarelle', 'أصابع الموزاريلا المقرمشة'],
    ['Golden mozzarella in a herb crumb with a smoked paprika dip.', 'Zlatna mozzarella u začinskim mrvicama s umakom od dimljene paprike.', 'موزاريلا ذهبية بفتات الأعشاب مع صلصة الفلفل المدخّن.'],
    10.5, 2.6, 'starter', 8, ['dairy', 'gluten', 'eggs'], ['vegetarian'], [], 5, 'meal', '5 pieces'],
  [ITEM.sesameChicken, SUBS.smallPlates, ['Honey Sesame Chicken', 'Piletina s medom i susamom', 'دجاج بالعسل والسمسم'],
    ['Crisp chicken bites glazed with honey, soy and sesame, with a yoghurt dip.', 'Hrskavi komadići piletine glazirani medom, sojom i susamom, uz umak od jogurta.', 'قطع دجاج مقرمشة مغطاة بالعسل والصويا والسمسم مع صلصة اللبن.'],
    13, 3.7, 'starter', 10, ['gluten', 'soy', 'sesame', 'dairy'], [], ['popular'], 7, 'meal'],
  [ITEM.arancini, SUBS.smallPlates, ['Truffle Arancini', 'Arancini s tartufima', 'أرانشيني بالكمأة'],
    ['Crisp risotto balls with a melting cheese centre and truffle cream.', 'Hrskave kuglice rižota s topljenim sirom u sredini i kremom od tartufa.', 'كرات ريزوتو مقرمشة بقلب من الجبن الذائب وكريمة الكمأة.'],
    11.5, 2.9, 'starter', 9, ['dairy', 'gluten', 'eggs'], ['vegetarian'], [], 4, 'meal', '5 pieces'],
  [ITEM.shopska, SUBS.salads, ['Šopska Salad', 'Šopska salata', 'سلطة شوبسكا'],
    ['Tomato, cucumber, peppers and onion under a snow of white cheese.', 'Paradajz, krastavac, paprika i luk pod bijelim sirom.', 'طماطم وخيار وفلفل وبصل مغطاة بالجبن الأبيض.'],
    10.5, 2.4, 'starter', 5, ['dairy'], ['vegetarian', 'gluten_free'], [], 6, 'meal'],
  [ITEM.falafelBowl, SUBS.salads, ['Falafel Bowl', 'Falafel zdjela', 'طبق الفلافل'],
    ['House falafel on leaves with tomato, cucumber, radish and tahini dressing.', 'Domaći falafel na salati s paradajzom, krastavcem, rotkvicom i tahini dresingom.', 'فلافل منزلية على الخس مع الطماطم والخيار والفجل وصلصة الطحينة.'],
    13, 3.1, 'main', 8, ['sesame', 'gluten'], ['vegan', 'dairy_free'], [], 5, 'meal'],
  [ITEM.chickenCaesar, SUBS.salads, ['Chicken Caesar', 'Cezar salata s piletinom', 'سلطة سيزر بالدجاج'],
    ['Grilled chicken breast, romaine, parmesan, croutons and our Caesar dressing.', 'Pileća prsa s roštilja, rimska salata, parmezan, krutoni i naš Cezar dresing.', 'صدر دجاج مشوي، خس روماني، بارميزان، خبز محمّص وصلصة السيزر الخاصة بنا.'],
    16.5, 4.9, 'main', 10, ['dairy', 'gluten', 'eggs', 'fish'], [], ['popular'], 9, 'meal'],
  [ITEM.beetrootSalad, SUBS.salads, ['Beetroot & Orange Salad', 'Salata od cvekle i narandže', 'سلطة الشمندر والبرتقال'],
    ['Roasted beetroot, orange, goat cheese and candied walnuts on mixed leaves.', 'Pečena cvekla, narandža, kozji sir i karamelizirani orasi na miješanoj salati.', 'شمندر مشوي وبرتقال وجبن الماعز وجوز مكرمل على أوراق مشكّلة.'],
    13.5, 3.4, 'starter', 7, ['dairy', 'nuts'], ['vegetarian', 'gluten_free', 'contains_nuts'], ['seasonal'], 3, 'meal'],

  // ---- Mains
  [ITEM.truffleRisotto, SUBS.pasta, ['Truffle Risotto', 'Rižoto s tartufima', 'ريزوتو بالكمأة'],
    ['Carnaroli rice with black truffle, parmesan and brown butter.', 'Carnaroli riža s crnim tartufom, parmezanom i smeđim puterom.', 'أرز كارنارولي مع الكمأة السوداء والبارميزان والزبدة البنّية.'],
    19, 5.8, 'main', 16, ['dairy', 'celery'], ['vegetarian', 'gluten_free'], ['signature', 'chef_pick'], 8, 'meal'],
  [ITEM.pestoRisotto, SUBS.pasta, ['Basil Pesto Risotto', 'Rižoto s pestom od bosiljka', 'ريزوتو ببيستو الريحان'],
    ['Creamy risotto folded with fresh basil pesto, pine nuts and lemon.', 'Kremasti rižoto sa svježim pestom od bosiljka, pinjolima i limunom.', 'ريزوتو كريمي مع بيستو الريحان الطازج والصنوبر والليمون.'],
    17, 4.6, 'main', 16, ['dairy', 'nuts', 'celery'], ['vegetarian', 'gluten_free', 'contains_nuts'], [], 3, 'meal'],
  [ITEM.arrabbiata, SUBS.pasta, ['Penne Arrabbiata', 'Penne arrabbiata', 'بيني أرابياتا'],
    ['Penne in a slow-cooked tomato sauce with garlic, chilli and basil.', 'Penne u dugo kuhanom sosu od paradajza s bijelim lukom, čilijem i bosiljkom.', 'بيني في صلصة طماطم مطهوة على مهل مع الثوم والفلفل الحار والريحان.'],
    12.5, 2.5, 'main', 11, ['gluten'], ['vegan', 'spicy', 'dairy_free'], [], 6, 'meal'],
  [ITEM.fettuccine, SUBS.pasta, ['Fettuccine ai Funghi', 'Fettuccine s gljivama', 'فيتوتشيني بالفطر'],
    ['Fresh fettuccine in a parmesan cream with sautéed mushrooms and thyme.', 'Svježe fettuccine u kremi od parmezana s pirjanim gljivama i majčinom dušicom.', 'فيتوتشيني طازجة في كريمة البارميزان مع الفطر السوتيه والزعتر.'],
    15, 3.8, 'main', 12, ['dairy', 'gluten', 'eggs'], ['vegetarian'], [], 7, 'meal'],
  [ITEM.casaBurger, SUBS.burgers, ['Casa Burger', 'Casa burger', 'برغر كازا'],
    ['Dry-aged beef, aged cheddar, caramelised onion, lettuce and house sauce in a brioche bun.', 'Odležana junetina, zreli cheddar, karamelizirani luk, salata i kućni sos u brioš pecivu.', 'لحم بقري معتّق، شيدر معتّق، بصل مكرمل، خس وصلصة البيت في خبز بريوش.'],
    16.5, 5.4, 'main', 14, ['gluten', 'dairy', 'eggs', 'mustard', 'sesame'], [], ['signature', 'popular'], 12, 'meal', '180 g'],
  [ITEM.chickenBurger, SUBS.burgers, ['Crispy Chicken Burger', 'Hrskavi pileći burger', 'برغر الدجاج المقرمش'],
    ['Buttermilk-fried chicken, cheddar, pickles and herb mayo.', 'Piletina pržena u mlaćenici, cheddar, kiseli krastavci i majoneza sa začinskim biljem.', 'دجاج مقلي بمخيض اللبن، شيدر، مخلل ومايونيز بالأعشاب.'],
    15.5, 4.6, 'main', 13, ['gluten', 'dairy', 'eggs'], [], [], 8, 'meal'],
  [ITEM.smashBurger, SUBS.burgers, ['Smash Cheeseburger', 'Smash cheeseburger', 'سماش تشيز برغر'],
    ['Two smashed beef patties, American cheese, onion and burger sauce.', 'Dvije smash pljeskavice od junetine, američki sir, luk i burger sos.', 'قطعتا لحم بقري مهروستان، جبن أمريكي، بصل وصلصة البرغر.'],
    14.5, 4.3, 'main', 12, ['gluten', 'dairy', 'eggs', 'mustard', 'sesame'], [], ['popular'], 9, 'meal', '2 × 80 g'],
  [ITEM.sliderTrio, SUBS.burgers, ['Slider Trio', 'Trio mini burgera', 'ثلاثي السلايدر'],
    ['Three mini burgers: beef, crispy chicken and falafel.', 'Tri mini burgera: junetina, hrskava piletina i falafel.', 'ثلاثة برغر صغيرة: لحم بقري، دجاج مقرمش وفلافل.'],
    17.5, 5.6, 'main', 14, ['gluten', 'dairy', 'eggs', 'sesame'], [], [], 4, 'meal', '3 pieces'],
  [ITEM.burgerCombo, SUBS.burgers, ['Burger Combo', 'Burger combo', 'وجبة البرغر'],
    ['Your burger with parmesan fries and a drink of your choice.', 'Vaš burger s pomfritom s parmezanom i pićem po izboru.', 'برغر من اختيارك مع بطاطا البارميزان ومشروب.'],
    21, 6.9, 'main', 14, ['gluten', 'dairy', 'eggs'], [], [], 6, 'meal'],
  [ITEM.fries, SUBS.sides, ['Parmesan Fries', 'Pomfrit s parmezanom', 'بطاطا مقلية بالبارميزان'],
    ['Skin-on fries with parmesan, herbs and garlic butter.', 'Pomfrit s korom, parmezanom, začinskim biljem i puterom s bijelim lukom.', 'بطاطا مقلية بقشرها مع البارميزان والأعشاب وزبدة الثوم.'],
    7.5, 1.6, 'side', 7, ['dairy'], ['vegetarian', 'gluten_free'], [], 10, 'meal'],

  // ---- Desserts
  [ITEM.cheesecake, SUBS.desserts, ['Basque Cheesecake', 'Baskijski cheesecake', 'تشيز كيك الباسك'],
    ['Burnt on top, creamy inside, with warm dark chocolate sauce.', 'Zapečen odozgo, kremast iznutra, s toplim sosom od tamne čokolade.', 'محروقة من الأعلى وكريمية من الداخل مع صلصة الشوكولاتة الداكنة الدافئة.'],
    11, 2.7, 'dessert', 4, ['dairy', 'eggs', 'gluten'], ['vegetarian'], ['signature', 'popular'], 9, 'sweet'],
  [ITEM.lavaCake, SUBS.desserts, ['Chocolate Lava Cake', 'Čokoladni lava kolač', 'كيكة الحمم بالشوكولاتة'],
    ['Warm chocolate cake with a molten centre and vanilla ice cream.', 'Topli čokoladni kolač s tekućom sredinom i sladoledom od vanilije.', 'كيكة شوكولاتة دافئة بقلب سائل مع آيس كريم الفانيليا.'],
    12, 3.0, 'dessert', 10, ['dairy', 'eggs', 'gluten'], ['vegetarian'], [], 6, 'sweet'],
  [ITEM.cremeBrulee, SUBS.desserts, ['Crème Brûlée', 'Crème brûlée', 'كريم بروليه'],
    ['Vanilla custard under a crackling caramel crust.', 'Krema od vanilije pod hrskavom karamel koricom.', 'كاسترد الفانيليا تحت قشرة كراميل مقرمشة.'],
    10.5, 2.2, 'dessert', 4, ['dairy', 'eggs'], ['vegetarian', 'gluten_free'], [], 5, 'sweet'],
  [ITEM.churros, SUBS.desserts, ['Churros & Chocolate', 'Churros i čokolada', 'تشوروز مع الشوكولاتة'],
    ['Cinnamon-sugar churros with chocolate and vanilla dips.', 'Churros s cimetom i šećerom uz umake od čokolade i vanilije.', 'تشوروز بالقرفة والسكر مع صلصتي الشوكولاتة والفانيليا.'],
    11.5, 2.3, 'dessert', 8, ['gluten', 'dairy', 'eggs'], ['vegetarian'], [], 4, 'sweet', '6 pieces'],
  [ITEM.chocolateDome, SUBS.desserts, ['Chocolate Dome', 'Čokoladna kupola', 'قبّة الشوكولاتة'],
    ['A dark chocolate dome over hazelnut mousse, melted at the table with warm caramel.', 'Kupola od tamne čokolade preko mousse-a od lješnjaka, topi se za stolom toplom karamelom.', 'قبّة من الشوكولاتة الداكنة فوق موس البندق، تُذاب على الطاولة بالكراميل الدافئ.'],
    14, 3.9, 'dessert', 7, ['dairy', 'eggs', 'nuts', 'gluten'], ['vegetarian', 'contains_nuts'], ['chef_pick'], 3, 'sweet'],

  // ---- Coffee & tea
  [ITEM.espresso, SUBS.coffee, ['Espresso', 'Espresso', 'إسبريسو'],
    ['A short, sweet shot of our house blend.', 'Kratki, slatkasti espresso naše kućne mješavine.', 'جرعة قصيرة من خلطة البيت.'],
    3, 0.5, 'hot_drink', 2, [], ['vegan', 'gluten_free', 'dairy_free'], [], 10, 'any'],
  [ITEM.cappuccino, SUBS.coffee, ['Cappuccino', 'Cappuccino', 'كابتشينو'],
    ['Espresso with steamed milk and a thick foam.', 'Espresso s toplim mlijekom i gustom pjenom.', 'إسبريسو مع الحليب المبخّر ورغوة كثيفة.'],
    4.5, 0.8, 'hot_drink', 3, ['dairy'], ['vegetarian', 'gluten_free'], ['popular'], 12, 'any'],
  [ITEM.flatWhite, SUBS.coffee, ['Flat White', 'Flat white', 'فلات وايت'],
    ['Double ristretto with silky microfoam.', 'Dvostruki ristretto sa svilenkastom mikropjenom.', 'ريستريتو مزدوج مع رغوة حريرية.'],
    5, 0.9, 'hot_drink', 3, ['dairy'], ['vegetarian', 'gluten_free'], [], 6, 'any'],
  [ITEM.latte, SUBS.coffee, ['Caffè Latte', 'Caffè latte', 'كافيه لاتيه'],
    ['Espresso with plenty of steamed milk.', 'Espresso s puno toplog mlijeka.', 'إسبريسو مع الكثير من الحليب المبخّر.'],
    5, 0.9, 'hot_drink', 3, ['dairy'], ['vegetarian', 'gluten_free'], [], 8, 'any'],
  [ITEM.icedLatte, SUBS.coffee, ['Iced Latte', 'Ledeni latte', 'لاتيه مثلّج'],
    ['Espresso over ice and cold milk.', 'Espresso preko leda i hladnog mlijeka.', 'إسبريسو فوق الثلج والحليب البارد.'],
    6, 1.0, 'cold_drink', 3, ['dairy'], ['vegetarian', 'gluten_free'], [], 6, 'any'],
  [ITEM.matcha, SUBS.tea, ['Matcha Latte', 'Matcha latte', 'ماتشا لاتيه'],
    ['Ceremonial matcha whisked into steamed milk.', 'Ceremonijalna matcha umućena u toplo mlijeko.', 'ماتشا احتفالية مخفوقة مع الحليب المبخّر.'],
    7, 1.6, 'hot_drink', 4, ['dairy'], ['vegetarian', 'gluten_free'], [], 4, 'any'],
  [ITEM.hotChocolate, SUBS.tea, ['Hot Chocolate', 'Topla čokolada', 'شوكولاتة ساخنة'],
    ['Dark Belgian chocolate melted into milk.', 'Tamna belgijska čokolada otopljena u mlijeku.', 'شوكولاتة بلجيكية داكنة مذابة في الحليب.'],
    6.5, 1.4, 'hot_drink', 4, ['dairy'], ['vegetarian', 'gluten_free'], [], 4, 'any'],
  [ITEM.hibiscusTea, SUBS.tea, ['Hibiscus Tea', 'Čaj od hibiskusa', 'شاي الكركديه'],
    ['A pot of ruby hibiscus, served over a candle.', 'Čajnik rubin-crvenog hibiskusa, serviran iznad svijeće.', 'إبريق من الكركديه الياقوتي يُقدَّم فوق شمعة.'],
    6, 0.9, 'hot_drink', 4, [], ['vegan', 'gluten_free', 'dairy_free'], [], 3, 'any', 'Pot'],
  [ITEM.mintTea, SUBS.tea, ['Mint Green Tea', 'Zeleni čaj s mentom', 'شاي أخضر بالنعناع'],
    ['Green tea with fresh mint leaves, by the pot.', 'Zeleni čaj sa svježim listovima mente, u čajniku.', 'شاي أخضر مع أوراق النعناع الطازجة في إبريق.'],
    6, 0.8, 'hot_drink', 4, [], ['vegan', 'gluten_free', 'dairy_free'], [], 4, 'any', 'Pot'],

  // ---- Cold drinks
  [ITEM.orangeJuice, SUBS.juices, ['Fresh Orange Juice', 'Cijeđena narandža', 'عصير برتقال طازج'],
    ['Squeezed to order.', 'Cijeđeno po narudžbi.', 'يُعصر عند الطلب.'],
    6, 1.7, 'cold_drink', 3, [], ['vegan', 'gluten_free', 'dairy_free'], [], 8, 'any', '300 ml'],
  [ITEM.lemonMint, SUBS.juices, ['Lemon & Mint Cooler', 'Limun i menta', 'ليمون بالنعناع'],
    ['Fresh lemon blended with mint and crushed ice.', 'Svježi limun miksan s mentom i drobljenim ledom.', 'ليمون طازج مخفوق مع النعناع والثلج المجروش.'],
    7, 1.4, 'cold_drink', 3, [], ['vegan', 'gluten_free', 'dairy_free'], ['popular'], 9, 'any', '400 ml'],
  [ITEM.strawberryLemonade, SUBS.juices, ['Strawberry Lemonade', 'Limunada od jagode', 'ليمونادة الفراولة'],
    ['House lemonade with crushed strawberries.', 'Kućna limunada s gnječenim jagodama.', 'ليمونادة البيت مع الفراولة المهروسة.'],
    7, 1.5, 'cold_drink', 3, [], ['vegan', 'gluten_free', 'dairy_free'], [], 6, 'any', '400 ml'],
  [ITEM.mojito, SUBS.mocktails, ['Virgin Mojito', 'Virgin mojito', 'موهيتو بدون كحول'],
    ['Lime, mint, cane sugar and soda over crushed ice. No alcohol.', 'Limeta, menta, trščani šećer i soda preko drobljenog leda. Bez alkohola.', 'ليمون أخضر ونعناع وسكر القصب وصودا على ثلج مجروش. بدون كحول.'],
    8, 1.6, 'cold_drink', 4, [], ['vegan', 'gluten_free', 'dairy_free'], [], 6, 'any', '400 ml'],
  [ITEM.raspberryMojito, SUBS.mocktails, ['Raspberry Mojito', 'Mojito od maline', 'موهيتو التوت'],
    ['Our virgin mojito with fresh raspberries.', 'Naš virgin mojito sa svježim malinama.', 'موهيتو بدون كحول مع توت العلّيق الطازج.'],
    8.5, 1.9, 'cold_drink', 4, [], ['vegan', 'gluten_free', 'dairy_free'], [], 4, 'any', '400 ml'],
  [ITEM.peachIcedTea, SUBS.mocktails, ['Peach Iced Tea', 'Ledeni čaj od breskve', 'شاي مثلّج بالخوخ'],
    ['Cold-brewed black tea with peach and lemon.', 'Hladno kuhani crni čaj s breskvom i limunom.', 'شاي أسود منقوع على البارد مع الخوخ والليمون.'],
    6.5, 1.1, 'cold_drink', 2, [], ['vegan', 'gluten_free', 'dairy_free'], [], 5, 'any', '400 ml'],
  [ITEM.water, SUBS.mocktails, ['Still Water', 'Negazirana voda', 'ماء'],
    ['Spring water, chilled.', 'Izvorska voda, rashlađena.', 'مياه نبع باردة.'],
    3, 0.6, 'cold_drink', 1, [], ['vegan', 'gluten_free', 'dairy_free'], [], 9, 'any', '330 ml'],
  [ITEM.cola, SUBS.mocktails, ['Coca-Cola', 'Coca-Cola', 'كوكا كولا'],
    ['The classic, in a glass bottle.', 'Klasik, u staklenoj boci.', 'الكلاسيكية في زجاجة.'],
    3.5, 0.9, 'cold_drink', 1, [], ['vegan', 'gluten_free', 'dairy_free'], [], 9, 'any', '250 ml'],
];

export const ITEMS: DemoItem[] = ROWS.map(([id, subId, names, descriptions, price, cost, role, prep, allergens, diet, badges, weight, when, portion]) => ({
  id, sub: subId, name: names[0], name_bs: names[1], name_ar: names[2],
  description: descriptions[0], description_bs: descriptions[1], description_ar: descriptions[2],
  price, cost, station: role === 'hot_drink' || role === 'cold_drink' ? 'bar' : 'kitchen', role, prep, allergens, diet, badges, portion, weight, when,
}));

export const itemById = new Map(ITEMS.map((item) => [item.id, item]));

/** Burger Combo: choose a burger, it comes with fries, choose a drink. */
export const COMBO = {
  item: ITEM.burgerCombo,
  slots: [
    { label: 'Burger', label_bs: 'Burger', label_ar: 'البرغر', options: [[ITEM.casaBurger, 0], [ITEM.chickenBurger, 0], [ITEM.smashBurger, 0]] },
    { label: 'Side', label_bs: 'Prilog', label_ar: 'الطبق الجانبي', options: [[ITEM.fries, 0]] },
    { label: 'Drink', label_bs: 'Piće', label_ar: 'المشروب', options: [[ITEM.cola, 0], [ITEM.water, 0], [ITEM.lemonMint, 2], [ITEM.strawberryLemonade, 2]] },
  ],
} as const;

/** What a guest is offered next to what (the manager's own pairings in Admin → Menu intelligence). */
export const PAIRINGS: [source: string, recommended: string, type: 'pair_with' | 'add_on' | 'upgrade_to'][] = [
  [ITEM.casaBurger, ITEM.fries, 'add_on'],
  [ITEM.casaBurger, ITEM.cola, 'pair_with'],
  [ITEM.smashBurger, ITEM.fries, 'add_on'],
  [ITEM.chickenBurger, ITEM.lemonMint, 'pair_with'],
  [ITEM.truffleRisotto, ITEM.beetrootSalad, 'pair_with'],
  [ITEM.fettuccine, ITEM.lemonMint, 'pair_with'],
  [ITEM.arrabbiata, ITEM.shopska, 'pair_with'],
  [ITEM.shakshuka, ITEM.orangeJuice, 'pair_with'],
  [ITEM.turkishEggs, ITEM.cappuccino, 'pair_with'],
  [ITEM.avocadoToast, ITEM.flatWhite, 'pair_with'],
  [ITEM.cheesecake, ITEM.espresso, 'pair_with'],
  [ITEM.lavaCake, ITEM.cappuccino, 'pair_with'],
  [ITEM.chickenCaesar, ITEM.peachIcedTea, 'pair_with'],
];

/** What follows what at a table, often enough to show up in the history as a pairing. */
export const COMPANIONS: Record<string, [item: string, chance: number][]> = {
  [ITEM.casaBurger]: [[ITEM.fries, 0.62], [ITEM.cola, 0.45]],
  [ITEM.smashBurger]: [[ITEM.fries, 0.58], [ITEM.cola, 0.4]],
  [ITEM.chickenBurger]: [[ITEM.fries, 0.5], [ITEM.lemonMint, 0.35]],
  [ITEM.truffleRisotto]: [[ITEM.mushroomSoup, 0.22], [ITEM.water, 0.3]],
  [ITEM.shakshuka]: [[ITEM.orangeJuice, 0.48], [ITEM.cappuccino, 0.4]],
  [ITEM.turkishEggs]: [[ITEM.cappuccino, 0.5], [ITEM.orangeJuice, 0.3]],
  [ITEM.avocadoToast]: [[ITEM.flatWhite, 0.45]],
  [ITEM.cheesecake]: [[ITEM.espresso, 0.5]],
  [ITEM.lavaCake]: [[ITEM.cappuccino, 0.35]],
};
