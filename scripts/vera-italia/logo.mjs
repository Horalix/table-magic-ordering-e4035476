#!/usr/bin/env node
/**
 * Vera Italia's logo, drawn with gpt-image-2.5 (sunburst).
 *
 *   node scripts/vera-italia/logo.mjs [lockup|monogram|wordmark …]
 *
 * Writes assets/vera-photos/brand/<kind>-<take>.png (ink on white; the model
 * draws no transparency — git-ignored). The chosen takes become public/brand/vera/ with
 * scripts/vera-italia/brand-assets.mjs. Key as in scripts/vera-photos.mjs.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'assets', 'vera-photos', 'brand');

const ROOM = `Vera Italia is a fine-dining Italian restaurant: walls of warm travertine plaster with softly backlit arched niches, walnut wood, terracotta and olive-green velvet, brass details, Neapolitan pizza from a dome oven. Quiet, timeless luxury — think of the signage of an old Roman trattoria redrawn by a Milanese design studio.`;

const CRAFT = `CRAFT:
- Flat vector artwork, a single solid colour: deep espresso brown (#2B211B), on a plain, pure white background (#FFFFFF) — nothing else on it.
- No gradients, no shadows, no texture, no 3D, no mockup, no paper, no frame around the artwork, no extra text, no tagline other than the one asked for.
- Classical proportions, optically even letter spacing, crisp sharp edges, consistent stroke contrast; it must work tiny on a phone and large on a wall.
- Spelling exactly as written, capital letters only: the letters must be perfectly formed, nothing missing, nothing extra.
- Centred with generous empty margins on every side.`;

const KINDS = {
  lockup: {
    size: '1536x1024',
    prompt: `Design the primary logo of VERA ITALIA. ${ROOM}

THE LOGO, stacked and centred:
1. A slender arch, drawn as one fine line — the shape of the restaurant's arched niches (straight sides, a perfect semicircular top) — with the letters "V" and "I" inside it as an elegant monogram in a high-contrast classical Roman serif (Didone / Bodoni-like, hairline serifs).
2. Below the arch, the wordmark "VERA ITALIA" in widely letter-spaced classical Roman serif capitals, refined and high-contrast.
3. Below that, "CUCINA ITALIANA" in very small, very widely spaced capitals, set between two short fine horizontal hairlines.

${CRAFT}`,
  },
  wordmark: {
    size: '1536x1024',
    prompt: `Design the horizontal wordmark of VERA ITALIA. ${ROOM}

THE WORDMARK: the words "VERA ITALIA" on one line in widely letter-spaced, high-contrast classical Roman serif capitals (Didone / Bodoni-like, fine hairline serifs), with a small, fine-lined arch symbol (straight sides, semicircular top) as a quiet separator between "VERA" and "ITALIA". Nothing else.

${CRAFT}`,
  },
  monogram: {
    size: '1024x1024',
    prompt: `Design the monogram of VERA ITALIA, for the app icon and the browser tab. ${ROOM}

THE MONOGRAM: a slender arch outline (straight sides, a perfect semicircular top, drawn in one fine but sturdy line) enclosing the letters "V" and "I" in a high-contrast classical Roman serif, balanced and centred in the arch. The arch fills about 70% of the canvas height. Bold enough to read at 32 pixels.

${CRAFT}`,
  },
};

function apiKey() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  const file = process.env.OPENAI_ENV_FILE;
  if (file && existsSync(file)) return readFileSync(file, 'utf8').match(/^\s*OPENAI_API_KEY\s*=\s*"?([^"\r\n]+)"?/m)?.[1] ?? null;
  return null;
}

async function draw(key, kind) {
  const { size, prompt } = KINDS[kind];
  for (let attempt = 1; attempt <= 5; attempt++) {
    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: process.env.IMAGE_MODEL ?? 'gpt-image-2.5-sunburst', prompt, size, quality: 'high', output_format: 'png', n: 1 }),
    });
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
const kinds = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(KINDS);
await Promise.all(kinds.map(async (kind) => {
  const take = 1 + readdirSync(OUT).filter((f) => f.startsWith(`${kind}-`)).length;
  try {
    writeFileSync(join(OUT, `${kind}-${take}.png`), await draw(key, kind));
    console.log(`ok   ${kind}-${take}`);
  } catch (e) {
    console.log(`FAIL ${kind}: ${String(e.message).slice(0, 160)}`);
  }
}));
