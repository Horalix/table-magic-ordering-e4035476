/**
 * Cut the La Soul brand assets out of the original logo.
 *   npm run brand
 *
 * The source (scripts/brand/lasoul-logo.svg) is a 5400×7200 poster: three
 * PNGs — the arches, the wordmark and an olive branch — placed on a mostly
 * empty canvas. Shrunk into a 44px box as a whole, every line came out about
 * a pixel wide and the logo was effectively invisible; it also cost 1.2 MB on
 * the guest menu. Each piece is cut out here instead, recoloured flat (white
 * for the sage band, brand dark for light surfaces) and sized for its job.
 *
 * Outputs
 *   public/brand/{wordmark,emblem,arch,lockup}-{white,dark}.webp, branch-white.webp
 *   public/icons/{icon-192,icon-512,maskable-512,apple-touch-icon}.png
 *   public/favicon.ico
 */
import sharp from 'sharp';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = resolve(ROOT, 'scripts/brand/lasoul-logo.svg');
const BRAND = resolve(ROOT, 'public/brand');
const ICONS = resolve(ROOT, 'public/icons');
const SAGE = { r: 0x7e, g: 0x9b, b: 0x79 };
const COLORS = { white: { r: 255, g: 255, b: 255 }, dark: { r: 35, g: 46, b: 40 } };

await mkdir(BRAND, { recursive: true });
await mkdir(ICONS, { recursive: true });

// ---- Pull the three layers out of the SVG --------------------------------
const svg = await readFile(SRC, 'utf8');
const layers = [...svg.matchAll(/<image x="(\d+)"(?: y="(\d+)")? width="(\d+)" height="(\d+)" xlink:href="data:[^;]+;base64,([A-Za-z0-9+/=]+)"/g)]
  .map(([, x, y, w, h, b64]) => ({ x: +x, y: +(y ?? 0), w: +w, h: +h, png: Buffer.from(b64, 'base64') }));
if (layers.length !== 3) throw new Error(`expected 3 layers in ${SRC}, found ${layers.length}`);
// Identify by shape rather than order: the wordmark is the wide strip, the
// arches the tall one, the branch what is left.
const word = layers.find((l) => l.w / l.h > 4);
const arches = layers.find((l) => l.h / l.w > 1.3);
const branch = layers.find((l) => l !== word && l !== arches);

const blank = (width, height) =>
  sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } });

/** Keep the artwork's alpha, replace its colour with one flat brand colour. */
async function tint(buf, color) {
  const { width, height } = await sharp(buf).metadata();
  const alpha = await sharp(buf).ensureAlpha().extractChannel(3).toBuffer();
  return sharp({ create: { width, height, channels: 3, background: color } }).joinChannel(alpha).png().toBuffer();
}

async function emit(name, buf, resize, colors, quality = 92) {
  for (const c of colors) {
    const out = resolve(BRAND, `${name}-${c}.webp`);
    const sized = await sharp(buf).resize(resize).png().toBuffer();
    await sharp(await tint(sized, COLORS[c])).webp({ quality, alphaQuality: 100, effort: 6 }).toFile(out);
    console.log(`  ✓ brand/${name}-${c}.webp`);
  }
}

// The square emblem: the arches with the wordmark across them, in the
// logo's own arrangement, without the branch (its lowest leaves reach in).
const side = arches.w;
const archTop = await sharp(arches.png).extract({ left: 0, top: 0, width: side, height: Math.min(side, arches.h) }).png().toBuffer();
const emblem = await blank(side, side)
  .composite([
    { input: archTop, left: 0, top: 0 },
    { input: word.png, left: word.x - arches.x, top: word.y - arches.y },
  ])
  .png().toBuffer();

// Just the arches, down to where the wordmark would cross them.
const archOnly = await sharp(arches.png)
  .extract({ left: 0, top: 0, width: arches.w, height: Math.round(word.y - arches.y + word.h * 0.15) })
  .trim().png().toBuffer();

// The whole logo, trimmed of its empty canvas.
const full = await blank(5400, 7200)
  .composite(layers.map((l) => ({ input: l.png, left: l.x, top: l.y })))
  .png().toBuffer();
const lockup = await sharp(full).trim().png().toBuffer();

await emit('wordmark', await sharp(word.png).trim().png().toBuffer(), { width: 960 }, ['white', 'dark']);
await emit('emblem', emblem, { width: 480 }, ['white', 'dark']);
await emit('arch', archOnly, { width: 360 }, ['white', 'dark']);
await emit('lockup', lockup, { height: 960 }, ['white', 'dark']);
await emit('branch', await sharp(branch.png).trim().png().toBuffer(), { width: 720 }, ['white'], 85);

// ---- App icons ----------------------------------------------------------
// The emblem fills the icon; the old icons scaled the whole poster into it.
const whiteEmblem = await tint(emblem, COLORS.white);
async function icon(size, file, inset) {
  const inner = Math.round(size * (1 - inset * 2));
  const art = await sharp(whiteEmblem).resize(inner, inner).png().toBuffer();
  const buf = await sharp({ create: { width: size, height: size, channels: 4, background: { ...SAGE, alpha: 1 } } })
    .composite([{ input: art, gravity: 'center' }])
    .png().toBuffer();
  if (file) {
    await writeFile(resolve(ICONS, file), buf);
    console.log(`  ✓ icons/${file}`);
  }
  return buf;
}
await icon(192, 'icon-192.png', 0.12);
await icon(512, 'icon-512.png', 0.12);
await icon(512, 'maskable-512.png', 0.2); // inside the 80% maskable safe zone
await icon(180, 'apple-touch-icon.png', 0.12);

// favicon.ico: an ICO container holding PNGs (supported everywhere current).
// Tab-sized icons get the bare arches; a wordmark at 16px is noise.
async function tabIcon(size) {
  const art = await sharp(await tint(archOnly, COLORS.white))
    .resize(Math.round(size * 0.78), Math.round(size * 0.78), { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png().toBuffer();
  const r = Math.round(size * 0.22);
  const mask = Buffer.from(`<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${r}" fill="#fff"/></svg>`);
  return sharp({ create: { width: size, height: size, channels: 4, background: { ...SAGE, alpha: 1 } } })
    .composite([{ input: art, gravity: 'center' }, { input: mask, blend: 'dest-in' }])
    .png().toBuffer();
}
const sizes = [16, 32, 48, 256];
const pngs = await Promise.all(sizes.map(tabIcon));
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
sizes.forEach((s, i) => {
  const e = 6 + 16 * i;
  header.writeUInt8(s >= 256 ? 0 : s, e);
  header.writeUInt8(s >= 256 ? 0 : s, e + 1);
  header.writeUInt16LE(1, e + 4); // planes
  header.writeUInt16LE(32, e + 6); // bpp
  header.writeUInt32LE(pngs[i].length, e + 8);
  header.writeUInt32LE(offset, e + 12);
  offset += pngs[i].length;
});
await writeFile(resolve(ROOT, 'public/favicon.ico'), Buffer.concat([header, ...pngs]));
console.log('  ✓ favicon.ico');
