#!/usr/bin/env node
/**
 * vera-photos.mjs — Vera Italia's menu photographs.
 *
 *   node scripts/vera-photos.mjs [slug …]
 *
 * The kitchen photographed every dish in the restaurant on 29 October 2026
 * (242 phone photos, 4032×3024). One per dish — the three-quarter shots taken
 * at the restaurant's own walnut tables, with its backlit arches behind — is
 * cut square at full resolution into assets/vera-photos/src-v3/<slug>.jpg.
 *
 * This script does NOT restage them. Earlier rounds did (new tabletops,
 * napkins, olive branches, golden window shadows) and read as generated: the
 * set was invented, and the model's upscaled food looked waxy. Here the photo
 * stays the photo — same dish, plate, table, room and camera angle — and the
 * model only does what the restaurant's photographer and retoucher would:
 * better window light, a real lens's shallow focus on the room behind, true
 * colour, a wiped plate rim, distractions gone. scripts/vera-italia/
 * import-photos.mjs then adds fine grain and sharpening, the way a real file
 * is finished, and makes the chosen take the dish's image.
 *
 * Writes assets/vera-photos/out-v3/<slug>-<take>.png. assets/vera-photos/ is
 * git-ignored; what the app serves ends up in scripts/image-sources/ and
 * public/menu/.
 *
 * Model gpt-image-2.5 (sunburst), 2880×2880 — the pixel count of 4K.
 * Key: OPENAI_API_KEY from the environment, or from the file OPENAI_ENV_FILE
 * names (a .env with an OPENAI_API_KEY= line). Never printed.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'assets', 'vera-photos', 'src-v3');
const OUT = join(ROOT, 'assets', 'vera-photos', 'out-v3');
const MODEL = process.env.IMAGE_MODEL ?? 'gpt-image-2.5-sunburst';
const SIZE = process.env.IMAGE_SIZE ?? '2880x2880';
const PARALLEL = 3;

const BRIEF = `This is a real photograph, taken inside Vera Italia — a fine-dining Italian restaurant with travertine-plaster walls, softly backlit arched niches, walnut tables and terracotta and olive velvet chairs. Produce the photograph the restaurant's professional food photographer would have taken of exactly this moment.

THE SAME PHOTOGRAPH — keep all of this exactly as it is in Image 1:
- The dish: {TRUTH} Every ingredient, sauce, garnish, topping, char mark and crumb, where it sits, its colour, the portion size. Nothing edible added, removed, moved, enlarged, multiplied or tidied up.
- The plate, bowl, board, basket or stand: shape, glaze, speckles, colour, size.
- The table (the restaurant's own walnut), the room behind it, the camera position and the viewing angle.
- No props added: no napkins, cutlery, flowers, herbs, glasses or anything else that is not in Image 1.

WHAT THE PHOTOGRAPHER CHANGES — only this:
- Light: soft, clean daylight from a large window to one side, a white reflector opposite. Bright, even and natural; gentle soft shadows; a natural sheen on sauce and cheese. No harsh glare, no golden-hour glow, no patterned window or leaf shadows, no spotlight, no drama.
- Lens: a full-frame camera with an 85 mm lens at f/2.8. The food and the near half of the plate are tack sharp; the room behind falls away into smooth, natural optical blur — the backlit arches and walls become soft, warm, out-of-focus shapes. The table blurs gently with distance.
- Colour: true to life — whites neutral white, the walls warm cream, the walnut warm brown; food colours rich but natural. A gentle S-curve of contrast. No oversaturation, no orange or teal cast.
- Retouching: wipe smudges, drips and stray crumbs from the plate RIM only; remove distractions from the background (people, chair edges, bags, cables, signs, reflections of the photographer); keep the background the same room.
- Framing: square. The whole dish and its plate inside the frame with a little table showing around it; if the plate touches the edge of Image 1, step back slightly so the full plate fits, continuing the same table naturally.

IT MUST NOT LOOK GENERATED:
- Real photographic detail at full size: individual strands of grated cheese, small bubbles and blisters, flour dust and char on crust, the grain of the wood.
- Natural imperfections stay: uneven browning, irregular shapes, real crumbs on the food.
- No waxy, plastic or airbrushed surfaces, no painterly smoothing, no glowing edges, no HDR, no fake bokeh balls, no repeated patterns.`;

/** slug → what is on the plate (for the model to hold on to). */
export const DISHES = [
  { slug: 'bruschetta', truth: 'one long toasted baguette heaped with finely diced tomato, basil ribbons and dark balsamic glaze, on a long pale oval ceramic plate.' },
  { slug: 'feta-dip', truth: 'a navy-blue rectangular baking dish of baked creamy feta, browned at the edges, with halved cherry tomatoes, black and green olives and herbs; behind it a woven rattan basket lined with white paper holding toasted baguette slices.' },
  { slug: 'caprese', truth: 'a round speckled plate with alternating slices of red tomato and white mozzarella, whole basil leaves and lines of dark balsamic glaze.' },
  { slug: 'grilled-vegetables', truth: 'a round speckled plate of mixed leaves (rocket, red radicchio, iceberg) with grilled yellow and red bell pepper, purple onion, crumbled white feta and microgreens.' },
  { slug: 'arrabbiata', truth: 'penne in a red arrabbiata sauce with grated parmesan and a basil sprig, in the centre well of a very wide-rimmed plate with a cream, sand and pale-blue reactive glaze.' },
  { slug: 'pesto-fettuccine', truth: 'fettuccine in a creamy pale-green pesto alfredo with fine basil ribbons and a basil sprig, in the centre well of the same wide-rimmed glazed plate.' },
  { slug: 'alfredo-fettuccine', truth: 'fettuccine in a creamy white alfredo sauce with dark sautéed mushroom pieces, grated parmesan and a small tuft of purple-green microgreens, in the same wide-rimmed glazed plate.' },
  { slug: 'truffle-pasta', truth: 'fettuccine in a creamy alfredo sauce flecked with fine black truffle, grated parmesan and a small tuft of purple-green microgreens (no mushroom pieces), in the same wide-rimmed glazed plate.' },
  { slug: 'eggplant-spaghetti', truth: 'a pool of creamy pink-orange sauce over spaghetti, topped with dark glossy fried eggplant pieces and microgreens, in the same wide-rimmed glazed plate.' },
  { slug: 'pesto-risotto', truth: 'creamy pale-green pesto risotto with fine basil ribbons and a basil sprig, in the same wide-rimmed glazed plate.' },
  { slug: 'mushroom-risotto', truth: 'creamy white risotto with dark mushroom slices and a small tuft of microgreens, in the same wide-rimmed glazed plate.' },
  { slug: 'truffle-risotto', truth: 'creamy white risotto finely speckled with black truffle, a small tuft of red-purple microgreens in the centre, in the same wide-rimmed glazed plate.' },
  { slug: 'pink-risotto', truth: 'orange-pink risotto with halved cherry tomatoes, black olives, a dark balsamic-cream spiral and a small herb sprig, in the same wide-rimmed glazed plate.' },
  { slug: 'margherita', truth: 'a Neapolitan margherita with a puffy, leopard-spotted charred crust, tomato sauce, melted fior di latte and whole basil leaves, cut into wedges, on a round pale plate.' },
  { slug: 'pepperoni', truth: 'a Neapolitan pizza covered with round pepperoni slices over melted mozzarella and tomato sauce, puffy leopard-spotted crust, on a round pale plate.' },
  { slug: 'burrata-pizza', truth: 'a Neapolitan pizza with tomato sauce, white burrata and mozzarella pieces each topped with a halved cherry tomato, a spiral drizzle of green pesto and fresh basil in the centre, on a round pale plate.' },
  { slug: 'quattro-formaggi', truth: 'a white four-cheese Neapolitan pizza with golden-blistered melted cheese and specks of blue gorgonzola, puffy leopard-spotted crust, on a round pale plate.' },
  { slug: 'ricotta-honey-pizza', truth: 'a white Neapolitan pizza with golden melted mozzarella, small dollops of ricotta and chopped walnuts glazed with honey, puffy crust, on a round pale plate.' },
  { slug: 'short-rib-pizza', truth: 'a Neapolitan pizza with pulled beef short rib, melted mozzarella, BBQ sauce, wide shavings of grana padano and chopped chives, puffy charred crust, on a round pale plate.' },
  { slug: 'truffle-pizza', truth: 'a white Neapolitan pizza with a ring of dark cooked mushrooms around a creamy white truffle-cream centre with a small dark truffle dot, puffy charred crust, on a round pale plate.' },
  { slug: 'musakhan-pizza', truth: 'a white Neapolitan pizza with shredded chicken and caramelised onion, criss-crossed with white yoghurt and dark pomegranate-molasses drizzles and scattered red pomegranate seeds, on a round pale plate.' },
  { slug: 'zaatar-pizza', truth: "a Neapolitan pizza with a green za'atar base, rocket leaves, a tall white swirl of cream cheese in the centre and red pomegranate seeds, on a round pale plate standing on a walnut cake stand." },
  { slug: 'egg-spinach-pizza', truth: 'a white Neapolitan pizza with wilted spinach and a glossy golden-yellow egg and hollandaise centre, puffy charred crust, on a round pale plate standing on a walnut cake stand.' },
  { slug: 'ribeye-platter', truth: 'a rib-eye steak with entrecôte sauce and a rosemary sprig in an oval glass dish on a chrome warmer stand with a tea light; a long oval plate of thin fries with a small bowl of green entrecôte sauce; a round plate of iceberg and radicchio salad with candied walnuts; a woven basket of toasted baguette. Keep all four and their arrangement.' },
  { slug: 'pesto-burrata-pizza', truth: 'a Neapolitan pizza with a green pesto base, large pieces of white burrata and a basil sprig in the centre, puffy leopard-spotted crust, on a round pale plate standing on a walnut cake stand.' },
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
  const optional = { quality: 'high', input_fidelity: 'high', output_format: 'png' };
  for (let attempt = 1; attempt <= 6; attempt++) {
    const form = new FormData();
    form.append('model', MODEL);
    form.append('prompt', BRIEF.replace('{TRUTH}', d.truth));
    form.append('size', size);
    form.append('n', '1');
    for (const [k, v] of Object.entries(optional)) form.append(k, v);
    form.append('image[]', new Blob([readFileSync(join(SRC, `${d.slug}.jpg`))], { type: 'image/jpeg' }), `${d.slug}.jpg`);
    const res = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.data?.[0]?.b64_json) return Buffer.from(body.data[0].b64_json, 'base64');
    const msg = body.error?.message ?? `HTTP ${res.status}`;
    // Not every model takes every option (gpt-image-2.5 has no input_fidelity).
    const bad = Object.keys(optional).find((k) => res.status === 400 && msg.includes(k));
    if (bad) { delete optional[bad]; attempt--; continue; }
    if (res.status === 400 && /size|resolution/i.test(msg) && size !== '2048x2048') return generate(key, d, '2048x2048');
    if (res.status === 429 || res.status >= 500) { await new Promise((r) => setTimeout(r, 5000 * attempt)); continue; }
    throw new Error(msg);
  }
  throw new Error('gave up');
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
