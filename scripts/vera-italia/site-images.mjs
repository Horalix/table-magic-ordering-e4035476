#!/usr/bin/env node
/**
 * Vera Italia's website photographs of the room, as responsive WebP ladders.
 *
 *   node scripts/vera-italia/site-images.mjs
 *
 * Source: the newest re-shoot in assets/vera-photos/room-out/ (scripts/
 * vera-italia/room-photos.mjs) when there is one, else the owner's own photo
 * in assets/vera-photos/room-src/, graded by hand — a touch brighter, warmer
 * and crisper. Writes public/site/vera/<name>-<width>.webp and
 * src/components/vera/room-images.json (widths, size, a tiny blurred
 * placeholder).
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = join(ROOT, 'assets', 'vera-photos', 'room-src');
const SHOTS = join(ROOT, 'assets', 'vera-photos', 'room-out');
const OUT = join(ROOT, 'public', 'site', 'vera');
const MANIFEST = join(ROOT, 'src', 'components', 'vera', 'room-images.json');
const WIDTHS = [640, 960, 1280, 1600, 2400];

/** name → what it shows (for the alt text in the page). */
const ROOMS = ['room-1', 'room-2', 'room-3'];

function source(name) {
  if (existsSync(SHOTS)) {
    const takes = readdirSync(SHOTS).map((f) => f.match(new RegExp(`^${name}-(\\d+)\\.png$`))).filter(Boolean).map((m) => Number(m[1]));
    if (takes.length) return { file: join(SHOTS, `${name}-${Math.max(...takes)}.png`), shot: true };
  }
  return { file: join(SRC, `${name}.jpg`), shot: false };
}

mkdirSync(OUT, { recursive: true });
const manifest = {};
for (const name of ROOMS) {
  const { file, shot } = source(name);
  let img = sharp(file);
  if (!shot) {
    img = img
      .modulate({ brightness: 1.05, saturation: 1.06 })
      .linear(1.05, -4)
      .recomb([[1.02, 0, 0], [0, 1, 0], [0, 0, 0.96]])
      .sharpen({ sigma: 0.8, m1: 0.5, m2: 1.4 });
  }
  const base = await img.png().toBuffer();
  const { width, height } = await sharp(base).metadata();
  const widths = WIDTHS.filter((w) => w <= width);
  for (const w of widths) {
    await sharp(base).resize(w).webp({ quality: w >= 1600 ? 76 : 80 }).toFile(join(OUT, `${name}-${w}.webp`));
  }
  const lqip = await sharp(base).resize(20).webp({ quality: 40 }).toBuffer();
  manifest[name] = { widths, width, height, blur: `data:image/webp;base64,${lqip.toString('base64')}` };
  console.log(`${name}  ${width}×${height}  ${widths.join(', ')}${shot ? '' : '  (the original, graded)'}`);
}
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
