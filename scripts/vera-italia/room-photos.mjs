#!/usr/bin/env node
/**
 * Vera Italia's room, for its website.
 *
 *   node scripts/vera-italia/room-photos.mjs [room-1 …]
 *
 * The owner's three photographs of the finished restaurant (October 2026:
 * the dome oven at the pass, the dining room with its backlit arches, the
 * long room with the arched mirrors) are in assets/vera-photos/room-src/.
 * As with the dishes (scripts/vera-photos.mjs), nothing is restaged: the
 * model does what an interior photographer would — straight verticals,
 * balanced exposure, the room tidied — and writes
 * assets/vera-photos/room-out/<name>-<take>.png at 2880×2160.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = join(ROOT, 'assets', 'vera-photos', 'room-src');
const OUT = join(ROOT, 'assets', 'vera-photos', 'room-out');
const MODEL = process.env.IMAGE_MODEL ?? 'gpt-image-2.5-sunburst';

const ROOMS = {
  'room-1': 'the pass: a white dome pizza oven (Morello Forni) set in a black arched recess, a stainless pizza counter with a glass sneeze guard in front, glass globe pendant lamps, a slatted walnut ceiling, travertine plaster walls with a flowing line of LED light, an arched niche with lit shelves and a walnut door on the left, a small olive tree.',
  'room-2': 'the dining room: travertine plaster walls with three backlit arched niches, glass globe pendant lamps, square walnut tables, terracotta, cream and olive velvet chairs, a long olive-green banquette with terracotta, ochre and cream cushions, flowing lines of LED light in the ceiling.',
  'room-3': 'the long dining room: arched mirrors framed in light along the travertine wall, glass globe pendant lamps, walnut tables, terracotta and cream velvet chairs, an olive-green banquette with ochre and terracotta cushions, a walnut slatted wall on the right, olive trees, glass doors at the end, flowing lines of LED light in the ceiling.',
};

const brief = (what) => `This is a real photograph of the interior of Vera Italia, a fine-dining Italian restaurant: ${what}

Produce the photograph a professional interior and architecture photographer would take of exactly this room from exactly this position.

KEEP EXACTLY: the room, its layout and proportions, every piece of furniture, lamp, oven, counter, plant, mirror and arch and where it stands, all materials and colours, the camera position and the field of view. Nothing new is added — no extra furniture, plants, decor, food, people or signage.

WHAT THE PHOTOGRAPHER CHANGES — only this:
- Exposure: a carefully balanced, natural exposure (as if blended from bracketed shots by hand): the glowing arches and LED lines stay luminous but not blown out, the shadows under tables and in the oven recess keep their detail. Evening mood, warm and inviting, but clean and bright enough to see every material.
- White balance: warm-neutral. Travertine reads warm cream, walnut warm brown, terracotta and olive velvet true to colour; LED light warm white; no green or magenta cast.
- Geometry: verticals perfectly vertical and horizontals level (tilt-shift perspective correction), lens distortion removed.
- Tidying: remove people, reflections of the photographer, stray papers, stickers and labels on equipment, cables, smudges on glass; align chairs neatly to their tables; nothing else moves.

IT MUST NOT LOOK GENERATED: crisp real detail at full size — the texture of the plaster, the grain of the walnut, the weave of the velvet, the glass of the lamps; a very fine natural grain; no waxy smoothing, no HDR halos, no glowing outlines, no CGI look.`;

function apiKey() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  const file = process.env.OPENAI_ENV_FILE;
  if (file && existsSync(file)) return readFileSync(file, 'utf8').match(/^\s*OPENAI_API_KEY\s*=\s*"?([^"\r\n]+)"?/m)?.[1] ?? null;
  return null;
}

async function shoot(key, name) {
  const optional = { quality: 'high', output_format: 'png' };
  for (let attempt = 1; attempt <= 5; attempt++) {
    const form = new FormData();
    form.append('model', MODEL);
    form.append('prompt', brief(ROOMS[name]));
    form.append('size', '2880x2160');
    form.append('n', '1');
    for (const [k, v] of Object.entries(optional)) form.append(k, v);
    form.append('image[]', new Blob([readFileSync(join(SRC, `${name}.jpg`))], { type: 'image/jpeg' }), `${name}.jpg`);
    const res = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.data?.[0]?.b64_json) return Buffer.from(body.data[0].b64_json, 'base64');
    if (res.status === 429 || res.status >= 500) { await new Promise((r) => setTimeout(r, 5000 * attempt)); continue; }
    throw new Error(body.error?.message ?? `HTTP ${res.status}`);
  }
  throw new Error('gave up');
}

const key = apiKey();
if (!key) { console.error('No OPENAI_API_KEY (environment, or OPENAI_ENV_FILE).'); process.exit(1); }
mkdirSync(OUT, { recursive: true });
const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(ROOMS);
await Promise.all(names.map(async (name) => {
  const take = 1 + readdirSync(OUT).filter((f) => f.startsWith(`${name}-`)).length;
  try {
    writeFileSync(join(OUT, `${name}-${take}.png`), await shoot(key, name));
    console.log(`ok   ${name}-${take}`);
  } catch (e) {
    console.log(`FAIL ${name}: ${String(e.message).slice(0, 160)}`);
  }
}));
