#!/usr/bin/env node
/**
 * Vera Italia's logo files, from the chosen drawings.
 *
 *   node scripts/vera-italia/brand-assets.mjs
 *
 * scripts/vera-italia/logo.mjs draws the logo in espresso ink on white
 * (assets/vera-photos/brand/, git-ignored). This lifts the ink off the white
 * into a clean alpha channel — ink coverage from lightness, so every
 * anti-aliased edge keeps its softness — trims it, and writes, into
 * public/brand/vera/:
 *
 *   lockup-{ink,cream}.webp     arch monogram over VERA ITALIA / CUCINA ITALIANA
 *   wordmark-{ink,cream}.webp   VERA ⌂ ITALIA on one line
 *   monogram-{ink,cream}.webp   the arch with VI
 *   icon-192.png, icon-512.png, apple-touch-icon.png, favicon-32.png
 *                               the monogram on travertine, for the home screen and tab
 */
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = join(ROOT, 'assets', 'vera-photos', 'brand');
const OUT = join(ROOT, 'public', 'brand', 'vera');

/** The chosen take of each drawing. */
const CHOSEN = { lockup: 'lockup-2.png', wordmark: 'wordmark-2.png', monogram: 'monogram-1.png' };
const INK = { r: 0x2b, g: 0x21, b: 0x1b };     // espresso
const CREAM = { r: 0xf4, g: 0xef, b: 0xe6 };   // travertine
const TRAVERTINE = '#f4efe6';

/** Ink coverage 0-255 from how dark each pixel is against the white it was drawn on. */
async function inkMask(file) {
  const { data, info } = await sharp(join(SRC, file)).flatten({ background: '#ffffff' }).greyscale().raw().toBuffer({ resolveWithObject: true });
  const inkLum = 0.2126 * INK.r + 0.7152 * INK.g + 0.0722 * INK.b;
  const alpha = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i++) {
    const a = (255 - data[i]) / (255 - inkLum);
    // Paper noise below ~4% is not ink.
    alpha[i] = a < 0.04 ? 0 : Math.min(255, Math.round(a * 255));
  }
  return { alpha, width: info.width, height: info.height };
}

async function colourise({ alpha, width, height }, c) {
  const rgba = Buffer.alloc(width * height * 4);
  for (let p = 0; p < width * height; p++) {
    rgba[p * 4] = c.r; rgba[p * 4 + 1] = c.g; rgba[p * 4 + 2] = c.b; rgba[p * 4 + 3] = alpha[p];
  }
  // Trim to the artwork, then a margin of 2% so nothing is cut at the edge.
  const trimmed = await sharp(rgba, { raw: { width, height, channels: 4 } }).trim({ threshold: 1 }).png().toBuffer({ resolveWithObject: true });
  const pad = Math.round(Math.max(trimmed.info.width, trimmed.info.height) * 0.02);
  return sharp(trimmed.data).extend({ top: pad, bottom: pad, left: pad, right: pad, background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
}

mkdirSync(OUT, { recursive: true });
for (const [name, file] of Object.entries(CHOSEN)) {
  const mask = await inkMask(file);
  for (const [tone, c] of [['ink', INK], ['cream', CREAM]]) {
    const png = await colourise(mask, c);
    const out = join(OUT, `${name}-${tone}.webp`);
    const meta = await sharp(png).webp({ quality: 92, alphaQuality: 100 }).toFile(out);
    console.log(`${name}-${tone}.webp  ${meta.width}×${meta.height}`);
    if (name === 'monogram' && tone === 'ink') {
      for (const [icon, size, inset] of [['icon-512.png', 512, 0.2], ['icon-192.png', 192, 0.2], ['apple-touch-icon.png', 180, 0.16], ['favicon-32.png', 32, 0.06]]) {
        const inner = Math.round(size * (1 - inset * 2));
        const mark = await sharp(png).resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
        await sharp({ create: { width: size, height: size, channels: 4, background: TRAVERTINE } })
          .composite([{ input: mark, gravity: 'center' }]).png().toFile(join(OUT, icon));
        console.log(icon);
      }
    }
  }
}
