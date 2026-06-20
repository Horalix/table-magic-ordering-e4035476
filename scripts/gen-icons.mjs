/**
 * Generate PWA app icons from public/lasoul-logo.svg.
 *   npm run icons
 * The brand logo is light/cream (shown white-on-sage in the app), so we paint
 * the logo white and place it on a sage background for a legible icon.
 * Outputs public/icons/{icon-192,icon-512,maskable-512,apple-touch-icon}.png
 */
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = resolve(ROOT, 'public/lasoul-logo.svg');
const OUT = resolve(ROOT, 'public/icons');
const SAGE = { r: 0x7e, g: 0x9b, b: 0x79, alpha: 1 };

if (!existsSync(SRC)) {
  console.error('  ✗ public/lasoul-logo.svg not found');
  process.exit(1);
}
await mkdir(OUT, { recursive: true });

// Rasterize the logo, then force every non-transparent pixel to white so it
// reads clearly on the sage background.
async function whiteLogo(inner) {
  const { data, info } = await sharp(SRC)
    .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 255; data[i + 1] = 255; data[i + 2] = 255; // keep alpha as-is
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
}

async function render(size, file, { maskable = false } = {}) {
  const pad = Math.round(size * (maskable ? 0.22 : 0.16)); // safe zone / breathing room
  const logo = await whiteLogo(size - pad * 2);
  await sharp({ create: { width: size, height: size, channels: 4, background: SAGE } })
    .composite([{ input: logo, gravity: 'center' }])
    .png()
    .toFile(resolve(OUT, file));
  console.log(`  ✓ ${file}`);
}

await render(192, 'icon-192.png');
await render(512, 'icon-512.png');
await render(512, 'maskable-512.png', { maskable: true });
await render(180, 'apple-touch-icon.png');

console.log('  ✓ icons → public/icons/');
