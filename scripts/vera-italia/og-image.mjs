#!/usr/bin/env node
/**
 * Vera Italia's link-preview image: public/site/vera/og.jpg, 1200×630.
 *
 *   node scripts/vera-italia/og-image.mjs
 *
 * What WhatsApp, Instagram, Facebook, Google and the AI engines show for a
 * link to its site (src/lib/seo/vera-seo.ts): the dining room, darkened
 * toward the edges, with the cream lockup in the middle. JPEG, the one
 * format every preview reads.
 */
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const W = 1200;
const H = 630;

const room = await sharp(join(ROOT, 'public/site/vera/room-2-2400.webp'))
  .resize(W, H, { fit: 'cover', position: 'centre' })
  .toBuffer();

const shade = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <radialGradient id="g" cx="50%" cy="50%" r="75%">
      <stop offset="0%" stop-color="#1c1410" stop-opacity="0.45"/>
      <stop offset="100%" stop-color="#1c1410" stop-opacity="0.78"/>
    </radialGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#g)"/>
</svg>`);

const lockup = await sharp(join(ROOT, 'public/brand/vera/lockup-cream.webp')).resize({ width: 430 }).toBuffer();
const { height: lh = 0 } = await sharp(lockup).metadata();

await sharp(room)
  .composite([
    { input: shade },
    { input: lockup, left: Math.round((W - 430) / 2), top: Math.round((H - lh) / 2) },
  ])
  .jpeg({ quality: 86, mozjpeg: true })
  .toFile(join(ROOT, 'public/site/vera/og.jpg'));

console.log('public/site/vera/og.jpg');
