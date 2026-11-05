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
 *   public/site/<name>-phone-<width>.webp
 *                                     the part a phone shows, where that is
 *                                     much less than the whole photograph
 *   public/site/og.jpg                1200×630 link-preview image
 *   src/components/site/site-images.json
 *                                     sizes and a tiny blurred placeholder per
 *                                     image, read by <SiteImage>
 *
 * To swap a photograph, put the new PNG in assets/site-src/raw/, point its
 * entry below at it and run the script again.
 *
 * Without the originals (a fresh clone), it only adds the files that are
 * missing, each made from the largest WebP of its photograph — the full size,
 * so nothing is upscaled — and leaves every existing file as it is.
 */
import { mkdirSync, writeFileSync, readFileSync, readdirSync, unlinkSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RAW = join(ROOT, 'assets', 'site-src', 'raw');
const OUT = join(ROOT, 'public', 'site');
const MANIFEST = join(ROOT, 'src', 'components', 'site', 'site-images.json');

/*
 * On a phone the menu cards are 4:3 (SiteMenuCards) and the tall photograph is
 * cropped to them at object-position 50% 62%: the phone showed half of what it
 * downloaded. It gets exactly that half as a file of its own (<SiteImage
 * phone>): the same picture, about 40% lighter. Quality 80, a step above the
 * ladder, because without the originals the crop is made from a WebP.
 */
const PHONE_CARD = { aspect: 4 / 3, y: 0.62, widths: [600, 800, 1024], quality: 80 };

/** name → source PNG and the widths a browser can choose from. */
const IMAGES = [
  // The hero is the page's largest paint: the phone crop is kept small.
  { name: 'hero-wide', src: 'hero-wide-v4.png', widths: [960, 1280, 1600, 2048], quality: 74 },
  { name: 'hero-tall', src: 'hero-tall-v2.png', widths: [480, 720, 960, 1152], quality: 72 },
  { name: 'story-burger', src: 'story-burger.png', widths: [360, 540, 720, 1024] },
  { name: 'story-cake', src: 'story-cake.png', widths: [360, 540, 720, 1024] },
  { name: 'cat-drinks', src: 'cat-drinks-v2.png', widths: [400, 600, 800, 1024], phone: PHONE_CARD },
  { name: 'cat-food', src: 'cat-food.png', widths: [400, 600, 800, 1024], phone: PHONE_CARD },
  { name: 'cat-desserts', src: 'cat-desserts.png', widths: [400, 600, 800, 1024], phone: PHONE_CARD },
  // 1088: a phone shows these about 980–1050 pixels wide, and the next step
  // up, 1280, carried 40% more pixels than it could use.
  { name: 'order-table', src: 'qr-table-final.png', widths: [640, 960, 1088, 1280, 1536] },
  { name: 'promise', src: 'promise.png', widths: [640, 960, 1088, 1280, 1536] },
  { name: 'visit', src: 'visit.png', widths: [640, 960, 1088, 1280, 1536] },
];

const fromRaw = IMAGES.every((img) => existsSync(join(RAW, img.src)));
const before = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : {};
mkdirSync(OUT, { recursive: true });
if (fromRaw) {
  for (const f of readdirSync(OUT)) if (/\.(webp|jpg)$/.test(f)) unlinkSync(join(OUT, f));
} else {
  console.log('No originals in assets/site-src/raw: adding only the missing files, from the largest WebP of each.');
}

/** Where a photograph is read from: its original, else its largest WebP (which is full size). */
function sourceOf(img) {
  if (fromRaw) return join(RAW, img.src);
  const known = before[img.name];
  if (!known) throw new Error(`no original and no WebP for ${img.name}`);
  return join(OUT, `${img.name}-${Math.max(...known.widths)}.webp`);
}

/** Writes one width, unless a file made from the original is already there. */
async function write(input, name, width, quality) {
  const out = join(OUT, `${name}-${width}.webp`);
  if (!fromRaw && existsSync(out)) return;
  await sharp(input).resize({ width }).webp({ quality, effort: 6, smartSubsample: true }).toFile(out);
}

async function blurOf(input, name) {
  if (!fromRaw && before[name]?.blur) return before[name].blur;
  const blur = await sharp(input).resize({ width: 16 }).webp({ quality: 40 }).toBuffer();
  return `data:image/webp;base64,${blur.toString('base64')}`;
}

const manifest = {};
for (const img of IMAGES) {
  const file = sourceOf(img);
  const meta = await sharp(file).metadata();
  const widths = img.widths.filter((w) => w <= meta.width);
  for (const w of widths) await write(file, img.name, w, img.quality ?? 76);
  manifest[img.name] = { width: meta.width, height: meta.height, widths, blur: await blurOf(file, img.name) };
  console.log(`  ✓ ${img.name}: ${widths.join(', ')}`);

  if (img.phone) {
    const { aspect, y, widths: phoneWidths, quality } = img.phone;
    const height = Math.round(meta.width / aspect);
    const top = Math.round(y * (meta.height - height));
    // Lossless in between, so the crop is encoded once.
    const crop = await sharp(file).extract({ left: 0, top, width: meta.width, height }).png().toBuffer();
    const name = `${img.name}-phone`;
    const pw = phoneWidths.filter((w) => w <= meta.width);
    for (const w of pw) await write(crop, name, w, quality);
    manifest[name] = { width: meta.width, height, widths: pw, blur: await blurOf(crop, name) };
    console.log(`  ✓ ${name}: ${pw.join(', ')}`);
  }
}

/*
 * Link previews (WhatsApp, Facebook, iMessage) want a 1.91:1 JPEG. The wide
 * hero already leaves its left side empty for a headline; the wordmark goes
 * there instead. Only from the original: og.jpg stays as it is otherwise.
 */
if (fromRaw) {
  const heroWide = join(RAW, IMAGES[0].src);
  const og = await sharp(heroWide).resize(1200, 630, { fit: 'cover', position: 'right' }).toBuffer();
  const mark = await sharp(join(ROOT, 'public', 'brand', 'wordmark-dark.webp')).resize({ width: 380 }).toBuffer();
  const markMeta = await sharp(mark).metadata();
  await sharp(og)
    .composite([{ input: mark, left: 92, top: Math.round((630 - markMeta.height) / 2) }])
    .jpeg({ quality: 82, mozjpeg: true })
    .toFile(join(OUT, 'og.jpg'));
  console.log('  ✓ og.jpg');
}

writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
console.log(`  ✓ ${MANIFEST}`);
