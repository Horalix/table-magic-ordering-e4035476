/**
 * photo-prompts.mjs — one image-editing prompt per menu photo.
 *
 *   npm run photos:prompts      (after npm run photos:export)
 *
 * Writes, under assets/menu-photos/:
 *   PROMPTS.md                         every prompt, in menu order, with the how-to
 *   originals/…/<photo>.prompt.txt     the same prompt next to its photo
 *   _STYLE-REFERENCE.jpg               the house-style photo to attach every time
 *
 * The prompts are for ChatGPT image editing: attach the dish's own photo
 * (the truth) and the style reference (the look), paste the prompt. They are
 * written to keep the real product exactly as served and change only the set,
 * the light and the photographic quality — the menu must show what arrives.
 */
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = resolve(ROOT, 'assets/menu-photos');
const index = JSON.parse(readFileSync(join(ASSETS, 'index.json'), 'utf8'));
const byNo = new Map(index.map((r) => [r.no, r]));

// The desserts were shot on La Soul's own set and are the best photos on the
// menu; the Lava Cake is the clearest example of it.
const REFERENCE_NAME = 'Lava Cake';

/* ---- Owner-confirmed facts that the live text does not show yet -------- */
const DESCRIPTION_FIX = {
  'Butter Croissant': 'A classic all-butter croissant, flaky and golden, with a honeycomb crumb inside; served with homemade strawberry jam.',
  'Shopska Salad': 'Diced tomato, yellow bell pepper, cucumber and onion with olive oil and white vinegar, topped with crumbled feta and chopped parsley.',
};

/* ---- How each kind of photo needs to change ---------------------------- */
const PACKAGED = new Set(['Apple Juice', 'Blueberry Juice', 'Bottled Water', 'Cherry Juice', 'Coca-Cola', 'Coca-Cola Zero',
  'Fanta', 'Peach Juice', 'Red Bull', 'Sky Cola', 'Sky Cola Zero', 'Sparkling Water', 'Sprite', 'Strawberry Juice', 'Vitamin Mix']);
const ON_STYLE_SECTIONS = new Set(['Desserts', 'Pasta', 'Risotto']);
const ON_STYLE_EXTRA = new Set(['White Sauce Pasta', 'White Sauce Pasta Combo', 'Granola Bowl']);

const ANGLE = {
  tallGlass: 'camera almost at table height (about 15–20° above the table), so the full height of the glass, its layers and the garnish read clearly',
  cup: 'camera at about 45°, so the latte art or the surface of the drink is visible and the cup still has its shape',
  burger: 'camera at the height of the burger (about 10–15°), a slight three-quarter side view, so every layer of the stack is visible, skewer upright',
  plate: 'camera at about 45–55°, three-quarter view, as on the dessert photos',
  bowl: 'camera at about 60–70°, looking into the bowl so the contents read clearly',
  flat: 'camera directly above (90°, flat lay), every small dish fully in frame',
  packaged: 'camera at about 10–15°, straight-on to the label',
};

const angleFor = (r) => {
  const n = r.name; const s = r.section;
  if (PACKAGED.has(n)) return ANGLE.packaged;
  if (/Platter|Picnic Box/.test(n)) return ANGLE.flat;
  if (['Burgers', 'Sliders'].includes(s) || /Burger|Slider/.test(n)) return ANGLE.burger;
  if (['Coffee', 'Hot Drinks', 'Tea', 'Filter Coffee'].includes(s)) return ANGLE.cup;
  if (r.category === 'Drinks') return ANGLE.tallGlass;
  if (['Salads', 'Soups', 'Pasta', 'Risotto', 'Fries'].includes(s) || /Bowl|Fries/.test(n)) return ANGLE.bowl;
  return ANGLE.plate;
};

/* ---- Dish-specific notes, by photo number ------------------------------ */
// "PHOTO NEEDED": the photo belongs to another dish. Editing it would show a
// guest something they will not get, so the honest fix is a real photo.
const dup = (of, what) => `PHOTO NEEDED — this is the same picture as #${of}. ${what} Take a quick phone photo of the real one as it is served (any light, any background) and run this prompt on THAT photo instead. Do not generate this dish from #${of}'s picture.`;

const NOTES = {
  1: 'Served in the kraft paper cup on the LA SOUL napkin — keep both, and the spoon.',
  3: 'The full Arabic coffee service: the silver dallah, the small cups, the dates on the tray. Keep every piece and its position.',
  4: dup(3, 'Arabic Coffee White is a different drink.'),
  5: 'Keep the exact colour layers (blue at the bottom through green to yellow), the ice and the lime.',
  6: 'Keep the bright blue colour, the mint sprig, the straw and the faceted glass.',
  9: 'Camomile: keep the tea a clear golden yellow. #24 Green Tea uses an almost identical photo — the two must not end up looking the same.',
  16: 'Cold brew in the small glass bottle with the tumbler on the wooden tray — keep both and the tray.',
  19: 'English Breakfast: keep the dark amber colour of the tea in the glass teapot.',
  24: 'Green tea: keep it pale green-gold, never amber. If this photo is really the camomile, photograph the real green tea first.',
  25: 'Keep the deep ruby colour and the tall faceted glass.',
  37: 'Keep the chocolate drizzle lines inside the glass and the topping exactly as they are.',
  38: 'Keep the gold siphon stand, the glass globe and the small tea glass — this set is the point of the photo.',
  40: 'Mango mojito: keep the golden-yellow colour, the mint, the straw.',
  45: dup(40, 'Passion Fruit Lemonade is a different drink from the Mango Mojito.'),
  46: dup(40, 'Passion Fruit Mojito is a different drink from the Mango Mojito.'),
  53: 'Served in the LA SOUL-branded cup on the wooden coaster — keep the cup print exactly and the latte art.',
  64: dup(25, 'Strawberry Iced Tea is a different drink from the Hibiscus Iced Tea.'),
  69: 'V60 Cold: the coffee server and glasses on the wooden tray. A cold V60 is served over ice — if the real one has ice in the glass, that must show; otherwise keep it as it is.',
  70: dup(69, 'V60 Hot and V60 Cold need their own photos (the cold one is served over ice).'),
  74: dup(76, 'A double espresso is a bigger serving than a single.'),
  80: dup(78, 'A flat white is a different (larger) drink than a piccolo.'),
  83: dup(82, 'A caffe latte is a different drink from a cappuccino.'),
  84: 'Keep the Chemex with its wooden collar, the glass and the tray.',
  89: 'Flat lay: keep every small bowl, its contents and its position in the wicker tray exactly.',
  90: 'Flat lay: keep every small bowl, its contents and its position in the wicker tray exactly. Show the whole tray.',
  91: 'Remove the QR-code stand and the bottles from the background.',
  92: 'Remove the QR-code stand and any clutter from the background.',
  96: dup(95, 'The combo is served with fries and a drink; this picture shows only the strips.'),
  103: 'Keep the cast-iron pan on the LA SOUL wooden board.',
  112: 'Remove ALL text and graphics: the "MIDNIGHT slider" title, the LA SOUL logo and the address line — this is a poster, the menu needs a photo. Keep the two sliders exactly.',
  113: 'Keep the three different buns (golden, red, green) and their order on the board.',
  124: 'Replace the flat pink studio backdrop with the La Soul set; keep the cast-iron pan on its wooden board.',
  126: 'Keep the wire fry basket on the board and the dipping sauce.',
  128: 'Keep the wire fry basket, the paper and both sauces.',
  129: 'Keep the cast-iron pan and the bread basket.',
  133: dup(98, 'The truffle version is a different dish from the classic Egg Benedict.'),
  142: dup(141, 'The combo is served with something more than the pasta alone.'),
  145: 'The croissant is made with butter. Keep the chocolate dip and the LA SOUL board.',
  158: 'Flat lay of the four cups — keep all four, their order and their toppings.',
  165: 'Keep the pouring cocoa and the espresso kettle — this action shot is part of the dish. Only polish.',
};

/* ---- The prompt -------------------------------------------------------- */
const STYLE = `LA SOUL HOUSE STYLE (match Image 2):
- Set: warm sand-beige tabletop; a soft cream linen cloth loosely draped at the back edge; one small sprig of dried baby's-breath (gypsophila) out of focus in a back corner. Nothing else unless it belongs to the dish.
- Light: soft natural window daylight from the upper left, gentle soft shadows falling to the lower right, a faint dappled leaf shadow across the surface. No flash, no studio glare.
- Colour: warm-neutral and creamy, true-to-life food colours, gentle contrast, white plates stay white. Not saturated, not orange, not dark or moody.
- Lens: looks like a full-frame camera with a 50–85 mm lens at about f/4 — the whole dish sharp, the background softly out of focus.`;

const FIDELITY = `THE PRODUCT MUST STAY REAL (most important):
- Image 1 is exactly what the guest receives. Keep from Image 1: the plate / bowl / glass / cup / pan (shape, colour, pattern, size), the portion, every ingredient, sauce, garnish and topping and where it sits, the layers, the latte art, the colour of the food and drink.
- Do not add, remove, enlarge, multiply or "improve" any food. No extra garnish, no extra steam, no extra ice, no drips that are not there.
- Image 2 is only for the set, light and colour. Never copy its food, plate or props.`;

const REALISM = `MAKE IT LOOK PHOTOGRAPHED, NOT GENERATED:
- Real texture and small real imperfections: crumbs, uneven browning, real foam bubbles, condensation droplets on cold glasses, natural sauce edges.
- Physically correct contact shadows and reflections; the dish sits on the table, never floats.
- No plastic shine, no over-smoothing, no glowing edges, no fake bokeh balls, no HDR look, no unnatural symmetry.
- No text, no watermarks, no extra logos, no people, no hands, no cutlery clutter.`;

const OUTPUT = `OUTPUT: one photograph, square 1:1, the highest resolution available (2048 × 2048 if possible, never below 1024 × 1024), PNG. The dish centred with an even margin all round (it fills about 60% of the width), nothing important near the edges — the app also crops it to 4:3 and to small squares.`;

function changeFor(r) {
  const n = r.name;
  if (PACKAGED.has(n)) {
    return `WHAT TO CHANGE: This is a branded product shot on white. Stand the same ${/Juice|Mix/.test(n) && !/Fresh/.test(n) ? 'bottle' : /Water|Kiseljak/.test(n) ? 'bottle' : 'can or bottle'} on the La Soul set, with a clear glass of the same drink beside it (with ice where that drink is served cold), plus the fruit from Image 1 if there is any.
BRAND LABEL: keep the label, logo and every word on it exactly as in Image 1 — same letters, same colours, same proportions, perfectly legible. If you cannot keep the label exact, do not redraw it; reject the result.`;
  }
  if (ON_STYLE_SECTIONS.has(r.section) || ON_STYLE_EXTRA.has(n)) {
    return `WHAT TO CHANGE: This photo is already on the La Soul set — keep the set, props and angle. Only: match the white balance and brightness to Image 2, recover fine detail and sharpness at full resolution (Image 1 is ${r.width} px wide), remove any smudges or stray crumbs on the plate rim, straighten, and reframe to a square with an even margin.`;
  }
  return 'WHAT TO CHANGE: Re-stage the same dish on the La Soul set: replace the current background, table and props with the set described below, relight it as described, and present it at the camera angle below. Remove anything in the background that is not part of the order.';
}

function promptFor(r, refFile) {
  const description = DESCRIPTION_FIX[r.name] ?? r.description;
  const note = NOTES[r.no];
  const parts = [
    `Edit a menu photo for La Soul, a café & burger boutique in Sarajevo (fully halal, no alcohol).`,
    `Image 1 = the dish as it is really served: "${r.name}" (${r.category} › ${r.section}).${description ? `\nOn the menu: ${description}` : ''}`,
    `Image 2 = the La Soul house-style reference (${refFile}). Use it only for the set, light and colour.`,
    note ? `NOTE FOR THIS DISH: ${note}` : '',
    changeFor(r),
    `CAMERA: ${angleFor(r)}.`,
    FIDELITY,
    STYLE,
    REALISM,
    OUTPUT,
  ];
  return parts.filter(Boolean).join('\n\n');
}

/* ---- Write ------------------------------------------------------------- */
const ref = index.find((r) => r.name === REFERENCE_NAME);
if (!ref || !existsSync(join(ASSETS, ref.file))) throw new Error(`style reference "${REFERENCE_NAME}" not exported`);
const refFile = '_STYLE-REFERENCE.jpg';
copyFileSync(join(ASSETS, ref.file), join(ASSETS, refFile));

const needed = index.filter((r) => NOTES[r.no]?.startsWith('PHOTO NEEDED'));
const lowRes = index.filter((r) => r.width && r.width < 900 && !needed.includes(r));

const md = [];
md.push(`# La Soul menu photos — editing prompts

${index.length} photos, one prompt each, in menu order. Generated by \`npm run photos:prompts\`.

## How to use (per photo)
1. Open ChatGPT (a model that can edit images) and start a new chat every ~10 photos so it does not drift.
2. Attach **two images**, in this order:
   - **Image 1:** the dish's photo from \`originals/\` (the file named in its heading).
   - **Image 2:** \`${refFile}\` (the ${REFERENCE_NAME} — La Soul's own set and light).
3. Paste the dish's prompt (also saved next to the photo as \`.prompt.txt\`).
4. **Check the result against the real dish before keeping it** (checklist below). If anything about the food changed, reply: *"Keep the food exactly as in Image 1 — you changed ___. Only the set, light and quality may change."*
5. Download the PNG and save it into \`improved/\` with **the same file name** (the \`__xxxxxxxx\` at the end is how the app knows which dish it is; folders and extension don't matter).
6. When a batch is done: \`npm run photos:import\` → check the menu → commit → publish.

## Before keeping a result — check
- Same plate/glass/cup, same portion, same ingredients and garnish, same colours as the real dish.
- Brand labels (Coca-Cola, Kuća prirode, Red Bull…) exactly right and readable.
- Looks like a photograph: real texture, real shadow under the dish, no plastic shine, no text.
- Matches the dessert photos (warm beige set, soft daylight from the left).
- Square, dish centred, nothing important at the edges, at least 1024 px (2048 if the tool allows).

## Photograph these first (${needed.length})
These photos belong to a different dish. The menu must show what the guest gets, so take a quick phone photo of each as served (any light — the prompt fixes the rest), put it in \`originals/\` in place of the old file, then use the prompt.
${needed.map((r) => `- #${r.no} **${r.name}** — ${NOTES[r.no].replace(/^PHOTO NEEDED — /, '').split('. Take a quick')[0]}.`).join('\n')}

## Low resolution today (${lowRes.length})
These originals are under 900 px wide (the bottled-drink packshots are 290–400 px). The edit brings them to full resolution; for the branded ones a fresh photo of the product is even better.
${lowRes.map((r) => `#${r.no} ${r.name} (${r.width}px)`).join(' · ')}

---
`);

for (const r of index) {
  if (!r.file) continue;
  const p = promptFor(r, refFile);
  writeFileSync(join(ASSETS, r.file.replace(/\.[^.]+$/, '.prompt.txt')), p + '\n', 'utf8');
  md.push(`## #${r.no} ${r.name}\n\n**Image 1:** \`${r.file}\`${NOTES[r.no]?.startsWith('PHOTO NEEDED') ? '  \n**⚠ Photograph the real dish first.**' : ''}\n\n\`\`\`text\n${p}\n\`\`\`\n`);
}
writeFileSync(join(ASSETS, 'PROMPTS.md'), md.join('\n'), 'utf8');

/* ---- The brief for an agent with an image tool (Codex imagegen) --------- */
const tasks = index.filter((r) => r.file).map((r) => ({
  no: r.no,
  name: r.name,
  input_photo: r.file,
  style_reference: refFile,
  prompt_file: r.file.replace(/\.[^.]+$/, '.prompt.txt'),
  output: 'improved/' + r.file.replace(/^originals\//, '').replace(/\.[^.]+$/, '.png'),
  skip: NOTES[r.no]?.startsWith('PHOTO NEEDED') ? 'PHOTO NEEDED: this picture shows a different dish; leave it for the owner to photograph' : null,
}));
writeFileSync(join(ASSETS, 'tasks.json'), JSON.stringify(tasks, null, 2) + '\n', 'utf8');

writeFileSync(join(ASSETS, 'CODEX.md'), `# Brief: improve La Soul's menu photos with your image generation tool

You are improving the real menu photos of La Soul, a café & burger boutique in Sarajevo, so they all look like one professional shoot. Use your **built-in image generation tool (imagegen)** — no API keys, no scripts that call paid APIs.

## The one rule that matters
Every result must show **the real product exactly as the guest receives it**: same plate/glass/cup, same portion, same ingredients, garnish, layers and colours. Only the set, the light, the framing and the photographic quality change. A beautiful image of something La Soul does not serve is a failure.

So **always edit the original photo — never generate a dish from text alone.** If your image tool cannot take the original photo as an input image, stop and say so instead of generating from the prompt text.

## Files (all paths relative to this folder)
- \`tasks.json\` — ${tasks.length} tasks in menu order: \`input_photo\`, \`style_reference\`, \`prompt_file\`, \`output\`, \`skip\`.
- \`originals/…\` — the real photos (read-only: never modify, move or rename anything here).
- \`_STYLE-REFERENCE.jpg\` — La Soul's own set and light (a dessert photo). Style only.
- \`<photo>.prompt.txt\` — the full prompt for that photo (next to it in \`originals/\`).
- \`improved/\` — where every result goes.

## For each task in tasks.json, in order
1. **Skip** it if \`skip\` is set, or if \`output\` already exists (the run can be resumed at any time).
2. Read \`prompt_file\` in full.
3. Call your image generation tool **in edit mode** with two input images, in this order:
   - **Image 1:** \`input_photo\` (the dish — the truth)
   - **Image 2:** \`_STYLE-REFERENCE.jpg\` (the look)
   and the prompt text exactly as written. Request a **square 1:1** image at the **largest size the tool offers** (at least 1024 × 1024).
4. **Save** the result as PNG to exactly \`output\` (create folders as needed). Do not change the file name: the \`__xxxxxxxx\` ending is how the app matches the photo to the dish.
5. **Check it** — open the result next to Image 1 and verify every point:
   - same vessel, same portion, same ingredients/garnish/sauce in the same places, same food colours, latte art kept;
   - brand labels (Coca-Cola, Fanta, Sprite, Red Bull, Sky, Kiseljak, Kuća prirode…) exactly right and readable;
   - on the La Soul set: warm beige surface, soft daylight from the upper left, matches the style reference;
   - looks like a real photograph: real texture, shadow under the dish, no plastic shine, no text or watermarks, no hands;
   - square, dish centred, nothing important cut at the edges, at least 1024 px.
6. If any point fails, regenerate (up to 3 attempts in total), adding one line at the end of the prompt that names the exact problem, e.g. *"CORRECTION: you removed the avocado slices — keep every ingredient exactly as in Image 1."* Keep the best attempt only.
7. Append one line to \`improved/_log.csv\` (create it with the header \`no,name,attempts,status,notes\`): \`status\` = \`ok\`, \`check\` (saved but you are not fully sure — say why), or \`failed\` (nothing saved — say why).

## Work in batches
Do 10–15 photos per batch, then report: which were saved, which are \`check\` or \`failed\` and why. Then continue with the next batch until every task is done.

## When everything is done
Report the totals, the list of \`check\`/\`failed\` items with reasons, and the ${needed.length} skipped PHOTO NEEDED items. Do not touch any other file in this folder or the repository.
`, 'utf8');
console.log(`  ✓ ${index.length} prompts → assets/menu-photos/PROMPTS.md (+ a .prompt.txt beside each photo)`);
console.log(`  ✓ style reference → assets/menu-photos/${refFile}`);
console.log(`  ! photograph first: ${needed.map((r) => `#${r.no} ${r.name}`).join(', ')}`);
