#!/usr/bin/env node
/**
 * category-photos.mjs — each category's picture on the menu home: one
 * photograph of several of its dishes together, for La Soul and Vera Italia.
 *
 *   node scripts/category-photos.mjs [key …]     a new take of each (all when none named)
 *   node scripts/category-photos.mjs --import    the newest take of each → public/covers/
 *
 * The references are the dishes' own finished menu photographs
 * (public/menu/<id>/1152.webp), so every dish in the picture is one the
 * kitchen serves, on its own plate or glass; the model only brings them
 * together on one table, in the restaurant's own style — La Soul's warm linen
 * and leaf-shadowed daylight at a three-quarter angle, Vera Italia's
 * travertine straight overhead. The owner asked for this on 31 October 2026,
 * instead of three separate photographs side by side.
 *
 * Writes assets/category-photos/<key>-<take>.png (git-ignored); --import
 * writes public/covers/<key>-<640|1080|1600>.webp, 3:2, which
 * src/pages/GuestMenu.tsx and src/components/vera/VeraMenu.tsx show.
 *
 * Model gpt-image-2.5 (sunburst). Key: OPENAI_API_KEY from the environment.
 * Never printed.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'assets', 'category-photos');
const COVERS = join(ROOT, 'public', 'covers');
const MODEL = process.env.IMAGE_MODEL ?? 'gpt-image-2.5-sunburst';
const SIZE = process.env.IMAGE_SIZE ?? '3072x2048';
const PARALLEL = Number(process.env.IMAGE_PARALLEL ?? 4);
const WIDTHS = [640, 1080, 1600];

const STYLE = {
  lasoul: {
    who: 'La Soul, a café and burger boutique in Sarajevo',
    camera: 'A three-quarter view from about 35 degrees above the table, as in the references; 50 mm, f/5.6; every dish sharp.',
    surface: 'the same warm beige linen tablecloth as in the references, with soft natural folds',
    light: 'warm daylight through a window with plants, casting soft dappled leaf shadows across the table — exactly the light of the references',
    props: 'a sprig of dried baby’s breath at one back corner, partly out of frame. Nothing else.',
    colour: 'a warm, creamy beige palette, true to life, gentle contrast',
  },
  veraitalia: {
    who: 'Vera Italia, a fine-dining Italian restaurant in Sarajevo',
    camera: 'Straight overhead, the camera perfectly level above the table (a true flat lay), as in the references; medium format, 80 mm, f/8; everything sharp.',
    surface: 'honed travertine stone, warm ivory with faint natural veins and small open pores, as in the references',
    light: 'soft natural window light from the left, bright and airy, with soft realistic shadows falling to the right',
    props: 'at most one folded oatmeal linen napkin with a brass fork at one edge, partly cut off by the edge. Nothing else.',
    colour: 'clean, warm-neutral, true to life; whites white',
  },
};

/** The categories: the dishes in each picture, the first the hero (the same as the menu home's chosen dishes). */
export const CATEGORIES = [
  { key: 'lasoul-food', venue: 'lasoul', name: 'Food', dishes: [
    ['1dd974a0-8e3a-4a86-b0d3-d2cff08b06e1', 'the La Soul Burger, with its wooden skewer'],
    ['3f002619-22fe-4b7e-91c3-3722c678665e', 'the Truffle Egg Benedict on its plate with the salad'],
    ['ba488833-a8d2-4b27-8027-fbe131888eb5', 'the Truffle Pasta in its bowl'],
  ] },
  { key: 'lasoul-drinks', venue: 'lasoul', name: 'Drinks', dishes: [
    ['df6a0352-89e5-4be6-8694-79fe8a6ac5bf', 'the Spanish Latte in its ceramic cup, with its latte art'],
    ['1d36f430-a209-459d-a0c5-bb18a2a2f85b', 'the Raspberry Mojito in its tall glass, with its straw and mint'],
    ['b0b3385b-b5a9-420e-acf1-d7ef563df8dd', 'the Fresh Orange Juice in its glass, with its orange slice'],
  ] },
  { key: 'lasoul-desserts', venue: 'lasoul', name: 'Desserts', dishes: [
    ['09af75d1-cdfc-49b4-bdd8-85fafc5fc656', 'the San Sebastian Cheesecake slice on its plate, with its little pot of sauce'],
    ['8ecbbf48-1572-4f8f-afc8-81bbc0c43643', 'the Lava Cake on its plate, with its scoop of ice cream'],
    ['0517de46-e686-4529-a965-7a4bd6f06bfd', 'the Crème Brûlée in its ramekin on its plate'],
  ] },
  { key: 'veraitalia-antipasti', venue: 'veraitalia', name: 'Antipasti & Insalate', dishes: [
    ['b7a1d000-0000-4000-8000-000000000003', 'the Insalata Caprese on its round plate'],
    ['b7a1d000-0000-4000-8000-000000000001', 'the Bruschetta on its long oval plate'],
    ['b7a1d000-0000-4000-8000-000000000002', 'the Baked Feta Dip in its navy baking dish, with its basket of toasted bread'],
  ] },
  { key: 'veraitalia-pasta', venue: 'veraitalia', name: 'Pasta & Risotto', dishes: [
    ['b7a1d000-0000-4000-8000-000000000005', 'the Penne all’Arrabbiata on its wide-rimmed plate'],
    ['b7a1d000-0000-4000-8000-000000000008', 'the Truffle Pasta on its wide-rimmed plate'],
    ['b7a1d000-0000-4000-8000-000000000010', 'the Pesto Risotto on its wide-rimmed plate'],
  ] },
  { key: 'veraitalia-pizza', venue: 'veraitalia', name: 'Pizza Napoletana', dishes: [
    ['b7a1d000-0000-4000-8000-000000000015', 'the Margherita'],
    ['b7a1d000-0000-4000-8000-000000000019', 'the Truffle Pizza'],
    ['b7a1d000-0000-4000-8000-000000000018', 'the Burrata Pizza'],
  ] },
  { key: 'veraitalia-carne', venue: 'veraitalia', name: 'Carne', dishes: [
    ['b7a1d000-0000-4000-8000-000000000025', 'the Rib-eye Steak Platter — the steak in its oval glass dish, the fries, the salad, the bread basket and the green sauce, all of it'],
  ] },
];

const BRIEF = (c) => {
  const s = STYLE[c.venue];
  const list = c.dishes.map(([, what], i) => `- Image ${i + 1}: ${what}.`).join('\n');
  const one = c.dishes.length === 1;
  return `These are the real menu photographs of ${one ? 'a dish' : `${c.dishes.length} dishes`} from ${s.who}. Produce ONE photograph for the "${c.name}" section of its menu: ${one ? 'this dish' : 'these dishes together on one table'}, the picture its photographer would deliver for the cover of that section.

THE DISHES — keep each EXACTLY as in its image: every ingredient, sauce, garnish, topping, crumb and its colour; the portion; the plate, bowl, glass, cup or basket with its shape, glaze, colour and any printing on it.
${list}
Nothing edible added, removed, swapped or multiplied. No other food, drink, plate or glass.

COMPOSITION:
- Landscape frame, 3:2.${one ? `
- The whole dish inside the frame, centred, with an even border of the surface around it; nothing touches or crosses an edge.` : `
- Image 1's dish is the hero, a little forward and the largest presence; the others beside and behind it, as a photographer would group them — close, a natural arrangement, never in a row.
- Every dish whole and fully recognisable; they may sit close but none hides another. Real relative sizes: a glass or cup is smaller than a plate.
- Nothing of the hero touches an edge; the others may be slightly cut by the frame at the back or sides.`}
- ${s.camera}

THE STYLE:
- Surface: ${s.surface}.
- Light: ${s.light}.
- Props: ${s.props}
- Colour: ${s.colour}.
- No text, no added logos, no hands, no people.

THE CRAFT:
- A real photograph, not a render: real detail at full size, natural imperfections, a fine natural grain. No waxy or plastic surfaces, no glow, no HDR, no CGI look.`;
};

async function reference(id) {
  const file = join(ROOT, 'public', 'menu', id, '1152.webp');
  if (!existsSync(file)) throw new Error(`no photograph for ${id}`);
  return sharp(file).jpeg({ quality: 94 }).toBuffer();
}

async function generate(key, c, size) {
  const images = await Promise.all(c.dishes.map(([id]) => reference(id)));
  const optional = { quality: 'high', output_format: 'png' };
  let last = '';
  for (let attempt = 1; attempt <= 6; attempt++) {
    const form = new FormData();
    form.append('model', MODEL);
    form.append('prompt', BRIEF(c));
    form.append('size', size);
    form.append('n', '1');
    for (const [k, v] of Object.entries(optional)) form.append(k, v);
    images.forEach((img, i) => form.append('image[]', new Blob([img], { type: 'image/jpeg' }), `dish-${i + 1}.jpg`));
    const res = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.data?.[0]?.b64_json) return Buffer.from(body.data[0].b64_json, 'base64');
    const msg = body.error?.message ?? `HTTP ${res.status}`;
    const bad = Object.keys(optional).find((k) => res.status === 400 && msg.includes(k));
    if (bad) { delete optional[bad]; attempt--; continue; }
    if (res.status === 400 && /size|resolution/i.test(msg) && size !== '1536x1024') return generate(key, c, '1536x1024');
    if (res.status === 429 || res.status >= 500) { last = `${res.status} ${msg}`; await new Promise((r) => setTimeout(r, 5000 * attempt)); continue; }
    throw new Error(msg);
  }
  throw new Error(`gave up: ${last}`);
}

const takes = (key) => readdirSync(OUT).map((f) => f.match(new RegExp(`^${key}-(\\d+)\\.png$`))?.[1]).filter(Boolean).map(Number);

/** The newest take of each category, cut 3:2 at the widths the menu home asks for. */
async function importCovers() {
  mkdirSync(COVERS, { recursive: true });
  for (const c of CATEGORIES) {
    const t = takes(c.key);
    if (!t.length) { console.log(`skip ${c.key}: no take`); continue; }
    const file = join(OUT, `${c.key}-${Math.max(...t)}.png`);
    for (const w of WIDTHS) {
      await sharp(file).resize(w, Math.round((w * 2) / 3), { fit: 'cover', position: 'centre' })
        .webp({ quality: 84 }).toFile(join(COVERS, `${c.key}-${w}.webp`));
    }
    console.log(`ok   ${c.key}  ← take ${Math.max(...t)}`);
  }
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  if (process.argv.includes('--import')) return importCovers();
  const key = process.env.OPENAI_API_KEY;
  if (!key) { console.error('No OPENAI_API_KEY in the environment.'); process.exit(1); }
  const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const todo = CATEGORIES.filter((c) => !only.length || only.includes(c.key));
  let next = 0;
  const worker = async () => {
    while (next < todo.length) {
      const c = todo[next++];
      const take = (takes(c.key).length ? Math.max(...takes(c.key)) : 0) + 1;
      const started = Date.now();
      try {
        writeFileSync(join(OUT, `${c.key}-${take}.png`), await generate(key, c, SIZE));
        console.log(`ok   ${c.key}-${take}  ${Math.round((Date.now() - started) / 1000)}s`);
      } catch (e) {
        console.log(`FAIL ${c.key}: ${String(e.message).slice(0, 160)}`);
      }
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, worker));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
