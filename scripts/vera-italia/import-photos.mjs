#!/usr/bin/env node
/**
 * Vera Italia's re-shot photographs into the app.
 *
 *   node scripts/vera-italia/import-photos.mjs   then   npm run images
 *
 * For every dish in menu.json, takes the chosen re-shoot from
 * assets/vera-photos/out-v5/ (scripts/vera-photos.mjs; the newest take unless
 * CHOSEN names one), finishes it the way a photographer finishes a file —
 * down to 1400 px (the app's largest size is 1152), a light sharpen, and a fine, even luminance grain, which a
 * real sensor always has and a generated image never does — and writes
 * scripts/image-sources/<dish id>.webp. `npm run images` (scripts/
 * fetch-images.mjs) then cuts the app's sizes and square thumbnails from it.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const TAKES = join(ROOT, 'assets', 'vera-photos', 'out-v5');
const ORIGINALS = join(ROOT, 'assets', 'vera-photos', 'src-v5');
const SOURCES = join(ROOT, 'scripts', 'image-sources');
const SIZE = 1400;
/** Grain strength, in 8-bit levels (standard deviation). */
const GRAIN = 2.4;

/** slug → take, where the newest is not the best. */
const CHOSEN = {};

const menu = JSON.parse(readFileSync(join(HERE, 'menu.json'), 'utf8'));
const dishes = menu.categories.flatMap((c) => c.sections.flatMap((s) => s.items)).filter((it) => !it.no_photo);

function chosenTake(slug) {
  if (CHOSEN[slug]) return join(TAKES, `${slug}-${CHOSEN[slug]}.png`);
  const takes = readdirSync(TAKES).map((f) => f.match(new RegExp(`^${slug}-(\\d+)\\.png$`))).filter(Boolean).map((m) => Number(m[1]));
  return takes.length ? join(TAKES, `${slug}-${Math.max(...takes)}.png`) : null;
}

/** A seeded generator, so re-running the import gives the same file. */
function gaussian(seed) {
  let s = seed >>> 0;
  const next = () => ((s = (s * 1664525 + 1013904223) >>> 0) + 0.5) / 4294967296;
  return () => Math.sqrt(-2 * Math.log(next())) * Math.cos(2 * Math.PI * next());
}

async function finish(file, seed) {
  const { data, info } = await sharp(file)
    .resize(SIZE, SIZE, { kernel: 'lanczos3' })
    .sharpen({ sigma: 0.7, m1: 0.6, m2: 1.6 })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const noise = gaussian(seed);
  for (let i = 0; i < data.length; i += 3) {
    const n = noise() * GRAIN;
    data[i] = Math.max(0, Math.min(255, data[i] + n));
    data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + n));
    data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + n));
  }
  return sharp(data, { raw: info }).webp({ quality: 84, smartSubsample: true });
}

/**
 * A dish with no re-shoot yet: the real photograph itself, graded by hand —
 * a touch warmer, brighter and richer — and finished the same way.
 */
async function graded(slug) {
  const file = join(ORIGINALS, `${slug}.jpg`);
  if (!existsSync(file)) return null;
  return sharp(file)
    .modulate({ brightness: 1.05, saturation: 1.12 })
    .linear(1.06, -5)
    // A little warmer: red up, blue down (sharp's tint() would turn it monochrome).
    .recomb([[1.03, 0, 0], [0, 1, 0], [0, 0, 0.95]])
    .png().toBuffer();
}

let done = 0;
for (const [i, d] of dishes.entries()) {
  const take = chosenTake(d.slug);
  const source = take && existsSync(take) ? take : await graded(d.slug);
  if (!source) { console.log(`skip ${d.slug}: no photograph`); continue; }
  await (await finish(source, 0x5eed + i)).toFile(join(SOURCES, `${d.id}.webp`));
  console.log(`ok   ${d.slug} ← ${typeof source === 'string' ? source.slice(TAKES.length + 1) : 'the original, graded'}`);
  done++;
}
console.log(`${done} of ${dishes.length} photographs in scripts/image-sources/`);
