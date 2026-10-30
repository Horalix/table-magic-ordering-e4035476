#!/usr/bin/env node
/**
 * vera-photos.mjs — Vera Italia's menu photographs.
 *
 *   node scripts/vera-photos.mjs [slug …]
 *
 * The kitchen photographed every dish in the restaurant on 29 October 2026
 * (242 phone photos, 4032×3024). For each dish its OVERHEAD shot is cut square
 * at full resolution into assets/vera-photos/src-v5/<slug>.jpg.
 *
 * The style is the owner's choice from a board of four (30 October 2026):
 * the way the best Italian restaurants put dishes on their menus — Gucci
 * Osteria's editorial still lifes, the overhead pizza of Naples — straight
 * overhead, the whole plate in the frame with even space around it, on the
 * travertine of the restaurant's own walls, in soft window light, with very
 * little styling that changes by course so a list never looks templated.
 * The dish and its plate stay exactly the kitchen's; everything else is the
 * photographer's. Earlier rounds — staged sets, the phone's own low angle,
 * evening relighting — are in this file's git history.
 *
 * Writes assets/vera-photos/out-v5/<slug>-<take>.png; scripts/vera-italia/
 * import-photos.mjs finishes the newest take (grain, sharpening) into the app.
 * assets/vera-photos/ is git-ignored.
 *
 * Model gpt-image-2.5 (sunburst), 2880×2880 — the pixel count of 4K.
 * Key: OPENAI_API_KEY from the environment, or from the file OPENAI_ENV_FILE
 * names (a .env with an OPENAI_API_KEY= line). Never printed.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'assets', 'vera-photos', 'src-v5');
const OUT = join(ROOT, 'assets', 'vera-photos', 'out-v5');
const MODEL = process.env.IMAGE_MODEL ?? 'gpt-image-2.5-sunburst';
const SIZE = process.env.IMAGE_SIZE ?? '2880x2880';
const PARALLEL = Number(process.env.IMAGE_PARALLEL ?? 3);

const BRIEF = (truth, styling, margin) => `This is a real overhead photograph of a dish from Vera Italia, a fine-dining Italian restaurant. Produce the menu photograph the restaurant's photographer would deliver for this exact dish — the kind of picture the best Italian restaurants in the world put on their menus.

KEEP EXACTLY, from Image 1:
- The dish: ${truth} Every ingredient, sauce, garnish, topping, char mark and crumb, where it sits, its colour, the portion size. Nothing edible added, removed, moved, enlarged, multiplied or tidied up.
- The plate (and dish, basket or board): shape, glaze, speckles, colour, size.

CAMERA AND FRAMING:
- Straight overhead, the camera perfectly level above the plate (a true flat lay).
- Square frame. The whole plate is inside the frame, centred, filling about 68% of the frame's width, with an even border of stone all around it. Nothing of the plate touches or crosses an edge. Where Image 1 is tighter, step back and continue the surface.${margin ? `
- The plain beige margin around Image 1 is not part of the scene: it only marks how far the stone extends. Fill it with the same travertine, seamlessly, and keep the plate at exactly the size and place it has in Image 1.` : ''}
- Medium-format camera, 80 mm, f/8: everything on the plate sharp edge to edge.

THE STYLE — editorial daylight:
- Surface: honed travertine stone, warm ivory with faint natural veins and small open pores — the stone of the restaurant's own walls.
- Light: soft natural window light from the left, the way a magazine shoots by a big north-facing window: bright, airy, gentle. Soft, realistic shadows fall to the right of the plate.
- Styling: ${styling}
- Colour: clean, warm-neutral, true to life; whites white; a gentle contrast curve.

IT MUST LOOK PHOTOGRAPHED, NOT GENERATED:
- Real detail at full size: strands of grated cheese, bubbles in sauce, flour dust and leopard spots on crust, the pores of mozzarella, the veins of basil leaves, the pores of the stone.
- Natural imperfections stay. No waxy, plastic or airbrushed surfaces, no painterly smoothing, no glow or halo, no HDR, no CGI look. A fine, natural grain.`;

/** Very little, and different by course, so a list of dishes never looks templated. */
const STYLING = {
  antipasti: 'a small brass dish of golden olive oil at one edge of the frame, partly cut off by the edge, and a folded oatmeal linen napkin at the opposite corner. Nothing else.',
  insalate: 'a folded oatmeal linen napkin at one edge of the frame, partly cut off by the edge, with a brass fork resting on it. Nothing else.',
  primi: 'a folded oatmeal linen napkin at one edge of the frame, partly cut off by the edge, with a brass fork resting on it. Nothing else.',
  pizza: 'none — only the pizza on its plate on the stone, as the great pizzerie of Naples photograph theirs.',
  carne: 'a folded oatmeal linen napkin with a brass steak knife at one edge of the frame, partly cut off by the edge. Nothing else.',
};

/**
 * How much of the frame the kitchen's shot is shrunk to before it is sent.
 * Its pizza photographs are tight — the pie fills the phone's frame — and
 * told to step back the model keeps that scale, so the pizzas came back
 * touching the edges. Shown smaller on a plain margin, it fills the margin
 * with stone and the whole plate stays in frame.
 */
const ROOM = { pizza: 0.66 };
const MARGIN = { r: 222, g: 210, b: 192 };

async function source(d) {
  const file = join(SRC, `${d.slug}.jpg`);
  const room = d.room ?? ROOM[d.course];
  if (!room) return readFileSync(file);
  const { width: side } = await sharp(file).metadata();
  const inner = Math.round(side * room);
  const before = Math.floor((side - inner) / 2);
  const after = side - inner - before;
  return sharp(file)
    .resize(inner, inner)
    .extend({ top: before, bottom: after, left: before, right: after, background: MARGIN })
    .jpeg({ quality: 94 })
    .toBuffer();
}

/** slug → course, and what is on the plate (for the model to hold on to). */
export const DISHES = [
  { slug: 'bruschetta', course: 'antipasti', truth: 'one long toasted baguette heaped with finely diced tomato, basil ribbons and dark balsamic glaze, on a long pale oval ceramic plate.' },
  { slug: 'feta-dip', course: 'antipasti', truth: 'a navy-blue rectangular baking dish with handles of baked creamy feta, browned at the edges, with halved cherry tomatoes, black and green olives and herbs; beside it a woven rattan basket lined with white paper holding toasted baguette slices. Keep both and their arrangement.' },
  { slug: 'caprese', course: 'insalate', truth: 'a round speckled plate with alternating slices of red tomato and white mozzarella, whole basil leaves and lines of dark balsamic glaze.' },
  { slug: 'grilled-vegetables', course: 'insalate', truth: 'a round speckled plate of mixed leaves (rocket, red radicchio, iceberg) with grilled yellow and red bell pepper, purple onion, crumbled white feta and microgreens.' },
  { slug: 'arrabbiata', course: 'primi', truth: 'penne in a red arrabbiata sauce with grated parmesan and a basil sprig, in the centre well of a very wide-rimmed plate with a cream, sand and pale-blue reactive glaze.' },
  { slug: 'pesto-fettuccine', course: 'primi', truth: 'fettuccine in a creamy pale-green pesto alfredo with fine basil ribbons and a basil sprig, in the centre well of the same wide-rimmed glazed plate.' },
  { slug: 'alfredo-fettuccine', course: 'primi', truth: 'fettuccine in a creamy white alfredo sauce with dark sautéed mushroom pieces, grated parmesan and a small tuft of purple-green microgreens, in the centre well of the same wide-rimmed glazed plate.' },
  { slug: 'truffle-pasta', course: 'primi', truth: 'fettuccine in a creamy alfredo sauce flecked with fine black truffle, grated parmesan and a small tuft of purple-green microgreens (no mushroom pieces), in the centre well of the same wide-rimmed glazed plate.' },
  { slug: 'eggplant-spaghetti', course: 'primi', truth: 'a pool of creamy pink-orange sauce over spaghetti, topped with dark glossy fried eggplant pieces and microgreens, in the centre well of the same wide-rimmed glazed plate.' },
  { slug: 'pesto-risotto', course: 'primi', truth: 'creamy pale-green pesto risotto with fine basil ribbons and a basil sprig, in the centre well of the same wide-rimmed glazed plate.' },
  { slug: 'mushroom-risotto', course: 'primi', truth: 'creamy white risotto with dark mushroom slices and a small tuft of microgreens, in the centre well of the same wide-rimmed glazed plate.' },
  { slug: 'truffle-risotto', course: 'primi', truth: 'creamy white risotto finely speckled with black truffle, a small tuft of red-purple microgreens in the centre, in the centre well of the same wide-rimmed glazed plate.' },
  { slug: 'pink-risotto', course: 'primi', truth: 'orange-pink risotto with halved cherry tomatoes, black olives, a dark balsamic-cream spiral and a small herb sprig, in the centre well of the same wide-rimmed glazed plate.' },
  { slug: 'margherita', course: 'pizza', truth: 'a Neapolitan margherita with a puffy, leopard-spotted charred crust, tomato sauce, melted fior di latte and whole basil leaves, cut into wedges, on a round pale plate.' },
  { slug: 'pepperoni', course: 'pizza', truth: 'a Neapolitan pizza covered with round pepperoni slices over melted mozzarella and tomato sauce, puffy leopard-spotted crust, cut into wedges, on a round pale plate.' },
  { slug: 'burrata-pizza', course: 'pizza', truth: 'a Neapolitan pizza with tomato sauce, white burrata and mozzarella pieces each topped with a halved cherry tomato, a spiral drizzle of green pesto and fresh basil in the centre, on a round pale plate.' },
  { slug: 'quattro-formaggi', course: 'pizza', truth: 'a white four-cheese Neapolitan pizza with golden-blistered melted cheese and specks of blue gorgonzola, puffy leopard-spotted crust, cut into wedges, on a round pale plate.' },
  { slug: 'ricotta-honey-pizza', course: 'pizza', truth: 'a white Neapolitan pizza with golden melted mozzarella, small dollops of ricotta and chopped walnuts glazed with honey, puffy crust, cut into wedges, on a round pale plate.' },
  { slug: 'short-rib-pizza', course: 'pizza', truth: 'a Neapolitan pizza with pulled beef short rib, melted mozzarella, BBQ sauce, wide shavings of grana padano and chopped chives, puffy charred crust, cut into wedges, on a round pale plate.' },
  { slug: 'truffle-pizza', course: 'pizza', truth: 'a white Neapolitan pizza with a ring of dark cooked mushrooms around a creamy white truffle-cream centre with a small dark truffle dot, puffy charred crust, cut into wedges, on a round pale plate.' },
  { slug: 'musakhan-pizza', course: 'pizza', truth: 'a white Neapolitan pizza with shredded chicken and caramelised onion, criss-crossed with white yoghurt and dark pomegranate-molasses drizzles and scattered red pomegranate seeds, cut into wedges, on a round pale plate.' },
  { slug: 'zaatar-pizza', course: 'pizza', truth: "a Neapolitan pizza with a green za'atar herb base, rocket leaves, a white swirl of cream cheese in the centre and red pomegranate seeds, puffy charred crust, on a round pale plate." },
  { slug: 'egg-spinach-pizza', course: 'pizza', truth: 'a white Neapolitan pizza with wilted spinach and a glossy golden-yellow egg and hollandaise centre, puffy charred crust, on a round pale plate.' },
  { slug: 'pesto-burrata-pizza', course: 'pizza', truth: 'a Neapolitan pizza with a green pesto base, large pieces of white burrata and a basil sprig in the centre, puffy leopard-spotted crust, on a round pale plate.' },
  { slug: 'ribeye-platter', course: 'carne', truth: 'a rib-eye steak with entrecôte sauce and a rosemary sprig in an oval glass dish on a chrome warmer stand; a long oval plate of thin fries with a small bowl of green entrecôte sauce; a round plate of iceberg and radicchio salad with candied walnuts; a woven basket of toasted baguette. Keep all four, their arrangement, and all of them inside the frame.' },
];

function apiKey() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  const file = process.env.OPENAI_ENV_FILE;
  if (file && existsSync(file)) {
    const m = readFileSync(file, 'utf8').match(/^\s*OPENAI_API_KEY\s*=\s*"?([^"\r\n]+)"?/m);
    if (m) return m[1];
  }
  return null;
}

async function generate(key, d, size) {
  const image = await source(d);
  const margin = !!(d.room ?? ROOM[d.course]);
  const optional = { quality: 'high', input_fidelity: 'high', output_format: 'png' };
  let last = '';
  for (let attempt = 1; attempt <= 6; attempt++) {
    const form = new FormData();
    form.append('model', MODEL);
    form.append('prompt', BRIEF(d.truth, STYLING[d.course], margin));
    form.append('size', size);
    form.append('n', '1');
    for (const [k, v] of Object.entries(optional)) form.append(k, v);
    form.append('image[]', new Blob([image], { type: 'image/jpeg' }), `${d.slug}.jpg`);
    const res = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.data?.[0]?.b64_json) return Buffer.from(body.data[0].b64_json, 'base64');
    const msg = body.error?.message ?? `HTTP ${res.status}`;
    // Not every model takes every option (gpt-image-2.5 has no input_fidelity).
    const bad = Object.keys(optional).find((k) => res.status === 400 && msg.includes(k));
    if (bad) { delete optional[bad]; attempt--; continue; }
    if (res.status === 400 && /size|resolution/i.test(msg) && size !== '2048x2048') return generate(key, d, '2048x2048');
    if (res.status === 429 || res.status >= 500) { last = `${res.status} ${msg}`; await new Promise((r) => setTimeout(r, 5000 * attempt)); continue; }
    throw new Error(msg);
  }
  throw new Error(`gave up: ${last}`);
}

function nextTake(slug) {
  const taken = readdirSync(OUT).map((f) => f.match(new RegExp(`^${slug}-(\\d+)\\.png$`))?.[1]).filter(Boolean).map(Number);
  return taken.length ? Math.max(...taken) + 1 : 1;
}

async function main() {
  const key = apiKey();
  if (!key) { console.error('No OPENAI_API_KEY (environment, or OPENAI_ENV_FILE).'); process.exit(1); }
  mkdirSync(OUT, { recursive: true });
  const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const todo = DISHES.filter((d) => !only.length || only.includes(d.slug));
  let next = 0;
  const worker = async () => {
    while (next < todo.length) {
      const d = todo[next++];
      const take = nextTake(d.slug);
      const started = Date.now();
      try {
        const png = await generate(key, d, SIZE);
        writeFileSync(join(OUT, `${d.slug}-${take}.png`), png);
        console.log(`ok   ${d.slug}-${take}  ${Math.round((Date.now() - started) / 1000)}s`);
      } catch (e) {
        console.log(`FAIL ${d.slug}: ${String(e.message).slice(0, 160)}`);
      }
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, worker));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
