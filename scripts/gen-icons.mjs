/**
 * Generate PWA app icons from public/lasoul-logo.svg.
 *   npm run icons
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
const BG = { r: 255, g: 255, b: 255, alpha: 1 };

if (!existsSync(SRC)) {
  console.error('  ✗ public/lasoul-logo.svg not found');
  process.exit(1);
}

await mkdir(OUT, { recursive: true });

async function render(size, file, { maskable = false } = {}) {
  const pad = Math.round(size * (maskable ? 0.18 : 0.12)); // maskable needs a safe zone
  const inner = size - pad * 2;
  const logo = await sharp(SRC)
    .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: BG } })
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
