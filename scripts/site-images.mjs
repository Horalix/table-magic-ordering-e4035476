#!/usr/bin/env node
/**
 * The website's photographs, as responsive WebP ladders.
 *
 *   node scripts/site-images.mjs
 *
 * Reads the chosen full-size images from assets/site-src/raw/ (generated with
 * gpt-image-2 from La Soul's real dish photos; that folder is git-ignored
 * because it holds prompts and multi-megabyte PNGs) and writes:
 *
 *   public/site/<name>-<width>.webp   one file per width in the ladder
 *   public/site/og.jpg                1200×630 link-preview image
 *   src/components/site/site-images.json
 *                                     sizes and a tiny blurred placeholder per
 *                                     image, read by <SiteImage>
 *
 * To swap a photograph, put the new PNG in assets/site-src/raw/, point its
 * entry below at it and run the script again.
 */
import { mkdirSync, writeFileSync, readdirSync, unlinkSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RAW = join(ROOT, 'assets', 'site-src', 'raw');
const OUT = join(ROOT, 'public', 'site');
const MANIFEST = join(ROOT, 'src', 'components', 'site', 'site-images.json');

/** name → source PNG and the widths a browser can choose from. */
const IMAGES = [
  // The hero is the page's largest paint: the phone crop is kept small.
  { name: 'hero-wide', src: 'hero-wide-v4.png', widths: [960, 1280, 1600, 2048], quality: 74 },
  { name: 'hero-tall', src: 'hero-tall-v2.png', widths: [480, 720, 960, 1152], quality: 72 },
  { name: 'story-burger', src: 'story-burger.png', widths: [360, 540, 720, 1024] },
  { name: 'story-cake', src: 'story-cake.png', widths: [360, 540, 720, 1024] },
  { name: 'cat-drinks', src: 'cat-drinks-v2.png', widths: [400, 600, 800, 1024] },
  { name: 'cat-food', src: 'cat-food.png', widths: [400, 600, 800, 1024] },
  { name: 'cat-desserts', src: 'cat-desserts.png', widths: [400, 600, 800, 1024] },
  { name: 'order-table', src: 'qr-table-final.png', widths: [640, 960, 1280, 1536] },
  { name: 'promise', src: 'promise.png', widths: [640, 960, 1280, 1536] },
  { name: 'visit', src: 'visit.png', widths: [640, 960, 1280, 1536] },
];

mkdirSync(OUT, { recursive: true });
for (const f of readdirSync(OUT)) if (/\.(webp|jpg)$/.test(f)) unlinkSync(join(OUT, f));

const manifest = {};
for (const img of IMAGES) {
  const file = join(RAW, img.src);
  if (!existsSync(file)) throw new Error(`missing ${file}`);
  const meta = await sharp(file).metadata();
  const widths = img.widths.filter((w) => w <= meta.width);
  for (const w of widths) {
    await sharp(file)
      .resize({ width: w })
      .webp({ quality: img.quality ?? 76, effort: 6, smartSubsample: true })
      .toFile(join(OUT, `${img.name}-${w}.webp`));
  }
  const blur = await sharp(file).resize({ width: 16 }).webp({ quality: 40 }).toBuffer();
  manifest[img.name] = {
    width: meta.width,
    height: meta.height,
    widths,
    blur: `data:image/webp;base64,${blur.toString('base64')}`,
  };
  console.log(`  ✓ ${img.name}: ${widths.join(', ')}`);
}

/*
 * Link previews (WhatsApp, Facebook, iMessage) want a 1.91:1 JPEG. The wide
 * hero already leaves its left side empty for a headline; the wordmark goes
 * there instead.
 */
const heroWide = join(RAW, IMAGES[0].src);
const og = await sharp(heroWide).resize(1200, 630, { fit: 'cover', position: 'right' }).toBuffer();
const mark = await sharp(join(ROOT, 'public', 'brand', 'wordmark-dark.webp')).resize({ width: 380 }).toBuffer();
const markMeta = await sharp(mark).metadata();
await sharp(og)
  .composite([{ input: mark, left: 92, top: Math.round((630 - markMeta.height) / 2) }])
  .jpeg({ quality: 82, mozjpeg: true })
  .toFile(join(OUT, 'og.jpg'));
console.log('  ✓ og.jpg');

writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
console.log(`  ✓ ${MANIFEST}`);
