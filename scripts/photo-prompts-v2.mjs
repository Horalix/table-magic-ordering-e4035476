/**
 * photo-prompts-v2.mjs — round 2 of the menu photos: one set per category,
 * framed for exactly how the app crops each photo, plus the home heroes.
 *
 *   npm run photos:round2      (after photos:export; uses round-1 edits in improved/)
 *
 * Writes assets/menu-photos/round2/:
 *   CODEX-ROUND2.md                  the brief for an agent with an image tool
 *   tasks.json                       set plates → heroes → dishes, in order
 *   prompts/*.txt                    one prompt per task
 * Results go to assets/menu-photos/improved-v2/ and come back with
 *   npm run photos:import -- improved-v2
 *
 * Why a round 2: round 1 put every dish on the same set with the same linen
 * fold and flower sprig, so a list read as templated, and drinks sat small in
 * the frame. Here each category has its own set — all lit and graded alike,
 * so the menu still reads as one shoot — small props rotate between dishes,
 * and the framing follows the app's three crops (below).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = resolve(ROOT, 'assets/menu-photos');
const OUT = join(ASSETS, 'round2');
const index = JSON.parse(readFileSync(join(ASSETS, 'index.json'), 'utf8'));
const byNo = new Map(index.map((r) => [r.no, r]));

/* ---- How the app shows a photo (keep in sync with the code) -------------
 * List rows and grid cards: square thumbnails cut from the central 78% of the
 *   frame, centred slightly low (scripts/fetch-images.mjs THUMB_ZOOM).
 * Dish sheet: 800×520 (≈3:2) object-cover — the top and bottom ~17% are cut.
 * Home category cards: 16:9 with a dark gradient over the bottom and the
 *   category name bottom-left (bottom-right in Arabic), a chevron opposite.
 */
const FRAMING = `FRAMING — THE APP CROPS THIS PHOTO THREE WAYS, SO:
- Output a square 1:1 photo, the highest resolution the tool offers.
- The whole dish (glass, cup, plate, board) sits inside the central 75% of the frame, centred left-to-right, its centre a little below the middle. That central square is the list thumbnail.
- The dish page shows a wide 3:2 band through the middle: nothing important in the top 17% or the bottom 17% of the frame.
- Size: a plate or bowl fills about 70% of the frame width; a glass, cup, bottle or burger stands about 55–60% of the frame height. Big enough to read at thumbnail size, never touching the edges.
- Props stay small and in the outer margin, where it is fine for the app to cut them.
- Directly behind the dish the background is calm and simple — no busy pattern behind the rim of a glass or the top of a bun.`;

const REAL = `THE PRODUCT MUST STAY REAL (most important):
- {TRUTH}
- Keep: the glass / cup / plate / bowl / board (shape, colour, pattern, size relative to the food), the portion, every ingredient, sauce, garnish and topping and where it sits, the layers, latte art, foam, the exact colours of food and drink.
- Do not add, remove, enlarge, multiply or "improve" anything edible: no extra garnish, fruit slices, steam, ice or drips that Image 1 does not show. If Image 1 does not show the top of a glass, keep the top plain rather than inventing a garnish.`;

const LOOK = `ONE SHOOT, MANY SETS — LIGHT AND COLOUR ARE THE SAME ON EVERY PHOTO:
- Light: soft natural daylight from the upper left, shadows falling gently to the lower right. No flash, no studio glare, no dark moody look.
- Colour: warm-neutral, creamy, true-to-life, gentle contrast; whites stay white. It must sit well inside an app whose colours are cream (#F7F4EC) and sage green (#7E9B79).
- Lens: full-frame camera, 50–85 mm, about f/4 — the dish fully sharp, the background softly out of focus (smooth natural blur, never fake bokeh balls).
- It must look photographed, not generated: real texture and small real imperfections (crumbs, uneven browning, real foam bubbles, condensation on cold glasses), correct contact shadow under the dish, no plastic shine, no over-smoothing, no glowing edges, no HDR.
- No text, watermarks or added logos (keep any LA SOUL print that is already on the cup, napkin, paper or board in Image 1), no people, no hands, no cutlery clutter.`;

/* ---- One set per category ---------------------------------------------- */
const SETS = {
  coffee: {
    title: 'Coffee & tea — warm oak',
    surface: 'a warm light-oak wooden tabletop with a fine natural grain, matte',
    backdrop: 'a soft cream plaster wall a little behind, gently out of focus',
    props: [
      'a folded cream linen napkin at the back-left edge',
      'a small ceramic saucer with three or four coffee beans at the back-right, out of focus',
      'no prop — only the window light and a faint leafy shadow across the wood',
    ],
    camera: 'about 40–45° above the table so the latte art or the surface of the drink shows, the cup still keeping its shape',
  },
  cold: {
    title: 'Cold & fresh — pale sage stone',
    surface: "a pale, desaturated sage-green honed stone surface (the app's sage at about a quarter strength)",
    backdrop: 'a seamless backdrop fading from pale sage to cream, smooth and out of focus',
    props: [
      "a few loose ice cubes on the stone at the back-right — only if the drink is served with ice",
      "a small sprig of the drink's own garnish (mint, citrus) lying at the back-left — only an ingredient the drink really contains",
      "no prop — only crisp window light and the glass's own coloured shadow on the stone",
    ],
    camera: 'nearly at table height (about 15–20°) so the full height of the glass, its layers and garnish read clearly, with fresh condensation on the glass',
  },
  bottled: {
    title: 'Bottled & canned — pale sage stone',
    surface: "a pale, desaturated sage-green honed stone surface (the app's sage at about a quarter strength)",
    backdrop: 'a seamless backdrop fading from pale sage to cream, smooth and out of focus',
    props: [
      'a clear glass of the same drink with ice beside the bottle or can, slightly behind it',
      'the fruit from Image 1 (if any) beside the bottle; otherwise a clear glass with ice',
    ],
    camera: 'about 10–15°, straight-on to the label',
  },
  breakfast: {
    title: 'Breakfast — cream linen, morning light',
    surface: 'a cream linen tablecloth with a subtle weave',
    backdrop: 'bright, airy morning window light behind, softly out of focus',
    props: [
      'a small glass of water at the back-right, out of focus',
      'a folded white LA SOUL paper napkin at the back-left — only a plain napkin if Image 1 has none',
      'no prop — just the morning light',
    ],
    camera: 'about 55–65° above the table, looking into the plate (flat-lay platters straight from above)',
  },
  grill: {
    title: 'Burgers, sliders & fries — warm sand stone',
    surface: 'a warm sand-beige stone counter',
    backdrop: 'a warm beige wall behind with a faint leafy shadow, out of focus',
    props: [
      'a small ramekin of the sauce from the order at the back-left — only if Image 1 shows one',
      'a folded LA SOUL printed paper liner under the dish only if Image 1 has it; otherwise nothing',
      'no prop — warm light raking across the stone',
    ],
    camera: 'at the height of the food (about 10–15°) for burgers and sliders so every layer of the stack shows, skewer upright; about 35–45° for fries and bowls',
  },
  fresh: {
    title: 'Salads & soups — light travertine',
    surface: 'a light, warm travertine stone surface',
    backdrop: 'a cream wall behind, softly out of focus',
    props: [
      'a sage-green linen napkin folded at the back-left edge',
      'a small dish of the dressing or bread from the order at the back-right — only if Image 1 shows it',
      'no prop — bright soft daylight only',
    ],
    camera: 'about 60–70° above the table, looking into the bowl or plate',
  },
};

// Sections that already have their own professional set stay as they are.
const KEEP = new Set(['Desserts', 'Pasta', 'Risotto']);
const SET_FOR_SECTION = {
  Coffee: 'coffee', 'Filter Coffee': 'coffee', 'Hot Drinks': 'coffee', Tea: 'coffee',
  'Iced Coffee': 'cold', 'Iced Tea': 'cold', Lemonade: 'cold', Mojito: 'cold', 'Fresh Juice': 'cold',
  'Special Drinks': 'cold', Frappe: 'cold', Other: 'bottled',
  Breakfast: 'breakfast',
  Burgers: 'grill', Sliders: 'grill', Fries: 'grill', Appetizer: 'grill', 'Kids Menu': 'grill',
  Salads: 'fresh', Soups: 'fresh',
};
// Hand-made drinks that live in "Other" are drinks, not packaged products.
const NOT_PACKAGED = new Set(['Nescafe']);

const LABEL_RULE = `BRAND LABEL: the brand logo and product name on the bottle or can must stay exactly as in Image 1 — same letters, colours and proportions, perfectly legible. Tiny legal or nutrition print is never readable at menu size: it may be soft or illegible, but must never turn into different readable words.`;

// Dish-specific notes carried over from round 1, plus what round 1 showed.
const NOTES = {
  1: 'Served in the kraft paper cup on the LA SOUL napkin — keep both and the spoon.',
  3: 'The full Arabic coffee service: silver dallah, small cups, dates on the wooden tray — keep every piece and its position.',
  5: 'Keep the exact colour layers (blue at the bottom through green to yellow), the ice and the lime.',
  9: 'Camomile: keep the tea a clear golden yellow (Green Tea, #24, must look different: pale green-gold).',
  16: 'Cold brew in the small glass bottle with the tumbler on the wooden tray — keep both and the tray.',
  24: 'Green tea: pale green-gold, never amber or yellow like the camomile.',
  25: 'Image 1 does not show the top of the glass: keep the top plain — no citrus slice.',
  37: 'Image 1 does not show the top of the glass: keep the topping exactly as Image 2 shows only if Image 1 hints at it; otherwise plain.',
  38: 'Keep the gold siphon stand, the glass globe and the small tea glass — this set is the point of the photo.',
  39: 'Image 1 does not show the top of the glass: no lemon slice unless Image 1 shows one.',
  47: 'Image 1 does not show the top of the glass: no citrus slice unless Image 1 shows one.',
  53: 'Keep the LA SOUL-branded cup and the wooden coaster exactly, and the latte art.',
  68: 'Image 1 does not show the top of the glass: no orange slice unless Image 1 shows one.',
  69: 'V60 Cold: keep the coffee server, the glasses and the wooden tray; ice only if Image 1 shows ice.',
  84: 'Keep the Chemex with its wooden collar, the glass and the tray.',
  89: 'Flat lay straight from above: keep every small bowl, its contents and its position in the wicker tray; the tray fills about 85% of the frame.',
  90: 'Flat lay straight from above: keep every small bowl, its contents, both bread baskets and positions; the tray fills about 85% of the frame.',
  91: 'No QR-code stand, bottles or clutter anywhere.',
  92: 'No QR-code stand, bottles or clutter anywhere.',
  103: 'Keep the cast-iron pan on the LA SOUL wooden board.',
  112: 'No text or graphics at all — this was a poster; keep the two sliders exactly.',
  113: 'Keep the three different buns (golden, red, green) and their order on the board.',
  124: 'Keep the cast-iron pan on its wooden board.',
  126: 'Keep the wire fry basket on the board and the dipping sauce.',
  128: 'Keep the wire fry basket, the paper and both sauces.',
  129: 'Keep the cast-iron pan and the bread basket.',
  140: 'Keep the whole burger and board inside the frame with an even margin (round 1 cut the board edge).',
};

const NEEDS_PHOTO = new Set([4, 45, 46, 64, 70, 74, 80, 83, 96, 133, 142]);

/* ---- Home heroes -------------------------------------------------------- */
const HEROES = [
  { key: 'food', set: 'grill', dishes: [108, 128], line: 'the La Soul Burger standing upright with its skewer, the Seasoned Truffle Fries in their wire basket beside it, slightly behind' },
  { key: 'drinks', set: 'cold', dishes: [79, 66, 23], line: 'three drinks in a loose diagonal group: the Spanish Latte (warm, in its cup) at the front-left, the Strawberry Lemonade in its tall glass in the middle, the Fresh Orange Juice behind on the right' },
  { key: 'desserts', set: 'dessert', dishes: [156, 164, 162], line: 'three desserts on their own plates: the Lava Cake in front, the Tiramisu Cup and the San Sebastian Cheesecake slightly behind on either side' },
];

const HERO_FRAMING = `FRAMING FOR THE HOME SCREEN CARD:
- Output a wide 16:9 photo (if the tool can only do 3:2, keep everything important inside the central 16:9 band — the app crops it).
- The app darkens the bottom of this image and writes the category name in the bottom-left corner (bottom-right in Arabic), with a small round arrow in the opposite corner. So: the products sit in the upper two-thirds, centred, the bottom third is calm table surface, and both bottom corners are empty.
- The group fills about 60% of the width, every item fully visible, nothing touching the edges, a calm background behind the group.
- Seen at phone width (about 360 px wide) it must still read instantly as "${'{category}'}".`;

/* ---- Build -------------------------------------------------------------- */
const current = (r) => {
  const f = join(ASSETS, 'improved', r.file.replace(/^originals\//, '').replace(/\.[^.]+$/, '.png'));
  return existsSync(f) ? f.slice(ASSETS.length + 1).replace(/\\/g, '/') : null;
};
const setPlate = (key) => `round2/sets/${key}.png`;

const tasks = [];
// 1. Empty set plates first: every dish in a category is then shot "on" the
//    same plate, which is what makes a category look like one shoot.
for (const [key, s] of Object.entries(SETS)) {
  const prompt = [
    `Create an EMPTY set photograph for La Soul, a café & burger boutique in Sarajevo — the backdrop for its "${s.title}" menu photos. No food, no drinks, no dishes: only the set.`,
    `Image 1 is La Soul's own dessert photo, for the light and the colour grade only.`,
    `SET: ${s.surface}; ${s.backdrop}. Leave the centre of the surface completely empty — a dish will be placed there later.`,
    `CAMERA: ${s.camera}.`,
    LOOK,
    'OUTPUT: square 1:1, the highest resolution the tool offers. Calm and simple; it must look like a real place, photographed.',
  ].join('\n\n');
  tasks.push({ kind: 'set', key, inputs: ['_STYLE-REFERENCE.jpg'], prompt_file: `round2/prompts/set-${key}.txt`, prompt, output: setPlate(key) });
}

// 2. Heroes.
// Desserts already have La Soul's own set: the cover is shot on it too.
const DESSERT_SET = { title: 'Desserts', surface: "La Soul's warm beige dessert-shoot set exactly as in the last image (linen, dried baby's-breath, soft window light)", backdrop: 'the same soft beige backdrop' };
for (const h of HEROES) {
  const s = SETS[h.set] ?? DESSERT_SET;
  const imgs = h.dishes.map((n) => current(byNo.get(n)) ?? byNo.get(n).file);
  const prompt = [
    `Create the "${h.key[0].toUpperCase()}${h.key.slice(1)}" cover photo for the home screen of La Soul's menu app (a café & burger boutique in Sarajevo, fully halal).`,
    `Images 1–${imgs.length} are real La Soul products, exactly as served: ${h.dishes.map((n) => byNo.get(n).name).join(', ')}. Image ${imgs.length + 1} is the empty set to place them on.`,
    `SCENE: ${h.line}, on ${s.surface}, ${s.backdrop}.`,
    REAL.replace('{TRUTH}', 'Each product image is the truth for that product.'),
    HERO_FRAMING.replace('{category}', h.key),
    LOOK,
  ].join('\n\n');
  tasks.push({ kind: 'hero', key: h.key, inputs: [...imgs, h.set === 'dessert' ? '_STYLE-REFERENCE.jpg' : setPlate(h.set)], prompt_file: `round2/prompts/hero-${h.key}.txt`, prompt, output: `improved-v2/heroes/${h.key}.png` });
}

// 3. Dishes.
let rot = 0;
for (const r of index) {
  if (!r.file || KEEP.has(r.section) || NEEDS_PHOTO.has(r.no)) continue;
  let setKey = SET_FOR_SECTION[r.section] ?? 'grill';
  if (setKey === 'bottled' && NOT_PACKAGED.has(r.name)) setKey = 'coffee';
  const s = SETS[setKey];
  const prop = s.props[rot++ % s.props.length];
  const v1 = current(r);
  const inputs = [r.file, ...(v1 ? [v1] : []), setPlate(setKey)];
  const setImage = v1 ? 'Image 3' : 'Image 2';
  const prompt = [
    `Re-photograph one dish for La Soul's menu app (a café & burger boutique in Sarajevo, fully halal, no alcohol): "${r.name}" (${r.category} › ${r.section}).${r.description ? `\nOn the menu: ${r.description}` : ''}`,
    `${setImage} is the empty "${s.title}" set that every dish in this part of the menu is photographed on — place the dish on exactly this set, same surface, backdrop, light and colour.`,
    NOTES[r.no] ? `NOTE FOR THIS DISH: ${NOTES[r.no]}` : '',
    setKey === 'bottled' && !NOT_PACKAGED.has(r.name) ? LABEL_RULE : '',
    REAL.replace('{TRUTH}', v1
      ? 'Image 1 is the dish exactly as La Soul serves it. Image 2 is a cleaner, sharper edit of the same dish — use it for detail, but where they differ, Image 1 is the truth.'
      : 'Image 1 is the dish exactly as La Soul serves it — the truth.'),
    `SET: ${s.surface}; ${s.backdrop}. Prop: ${prop}.`,
    `CAMERA: ${s.camera}.`,
    FRAMING,
    LOOK,
  ].filter(Boolean).join('\n\n');
  tasks.push({
    kind: 'dish', no: r.no, name: r.name, set: setKey, inputs,
    prompt_file: `round2/prompts/${String(r.no).padStart(3, '0')}.txt`, prompt,
    output: 'improved-v2/' + r.file.replace(/^originals\//, '').replace(/\.[^.]+$/, '.png'),
  });
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 'prompts'), { recursive: true });
mkdirSync(join(OUT, 'sets'), { recursive: true });
for (const t of tasks) writeFileSync(join(ASSETS, t.prompt_file), t.prompt + '\n', 'utf8');
writeFileSync(join(OUT, 'tasks.json'), JSON.stringify(tasks.map(({ prompt, ...t }) => t), null, 2) + '\n', 'utf8');

const counts = tasks.reduce((m, t) => ({ ...m, [t.kind]: (m[t.kind] ?? 0) + 1 }), {});
writeFileSync(join(OUT, 'CODEX-ROUND2.md'), `# Round 2 brief: La Soul menu photos — one set per category, framed for the app

Use your **built-in image generation tool (imagegen)** in edit mode. No paid APIs.

Round 1 put every dish on the same set with the same linen fold and flower, so lists looked templated, and drinks sat small in the frame. Round 2 gives each category its own set (all with the same light and colour grade, so the menu is still one shoot), rotates small props, and frames every photo for exactly how the app crops it. Desserts, pasta and risotto keep their photos — they already match.

## The one rule that matters
Every photo must show **the real product exactly as the guest receives it**. Image 1 of every dish is the original photo — the truth. Never generate a dish from text alone; never add garnish, fruit, ice or steam that Image 1 does not show. If the tool cannot take input images, stop and say so.

## Order of work (\`round2/tasks.json\`, ${tasks.length} tasks)
1. **${counts.set} set plates** (\`kind: "set"\`): empty sets, no food. Generate each, then check: calm, real-looking, the centre empty, same light and warmth as \`_STYLE-REFERENCE.jpg\`. These are the backdrops every dish in that category is placed on — get them right first; regenerate until each is clean. Save to \`output\`.
2. **${counts.hero} home heroes** (\`kind: "hero"\`): the Food / Drinks / Desserts cover cards on the home screen. Inputs: the real product photos plus the category's set plate. Wide 16:9, products in the upper two-thirds, bottom third calm and both bottom corners empty (the app writes the category name there).
3. **${counts.dish} dishes** (\`kind: "dish"\`), in order.

## For each task
1. Skip it if \`output\` already exists (the run can resume any time).
2. Read \`prompt_file\` in full.
3. Call your image tool in edit mode with the images in \`inputs\`, **in that order** (Image 1, Image 2, …), and the prompt text exactly. Request the size the prompt asks for at the largest resolution the tool offers.
4. Save as PNG to exactly \`output\` (create folders). Keep the file name — the \`__xxxxxxxx\` ending is how the app finds the dish.
5. Check, and regenerate (up to 3 attempts, adding one \`CORRECTION:\` line naming the exact problem) if any point fails:
   - same vessel, portion, ingredients, garnish, colours as Image 1; nothing invented;
   - on the right set for its category (compare with the set plate); same light and warmth as the other photos;
   - **framing**: the whole dish inside the central 75% of the square, centred, slightly low; nothing important in the top or bottom 17%; glasses/burgers about 55–60% of the frame height, plates about 70% of the width;
   - brand logos exact (fine print may be soft, never different words);
   - looks photographed: real texture, shadow under the dish, no text, no hands.
6. Append to \`improved-v2/_log.csv\` (header \`task,name,attempts,status,notes\`): \`ok\`, \`check\` (saved, say why unsure) or \`failed\` (nothing saved, say why).

Work in batches of 10–15 and report after each batch. When finished, report totals and every \`check\`/\`failed\` with reasons. Never modify \`originals/\`, \`improved/\` or any other file.

## Sets
${Object.entries(SETS).map(([k, s]) => `- **${s.title}** (\`${k}\`): ${s.surface}; ${s.backdrop}.`).join('\n')}

Then, in the project: \`npm run photos:import -- improved-v2\` (dishes and the three hero covers).
`, 'utf8');

console.log(`  ✓ round 2: ${counts.set} set plates, ${counts.hero} heroes, ${counts.dish} dishes → assets/menu-photos/round2/`);
