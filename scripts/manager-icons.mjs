/**
 * The Manager app's icons (public/manifest-manager*.webmanifest).
 *
 * The admin, added to a phone's Home Screen, is its own app: "La Soul
 * Manager" opens the admin, not the menu, and on iPhone it is the only way a
 * manager's phone rings for a reservation (Web Push works there only from a
 * Home Screen app). Its icon is the restaurant's own mark in other colours,
 * so it is told apart from the guests' app and the waiters' at a glance:
 *
 *   La Soul      the guests' and waiters' icon is white on sage; the
 *                manager's is the restaurant's ink on its cream.
 *   Vera Italia  ink on ivory for guests and waiters; ivory on brass for
 *                the manager.
 *
 * Run from the repository root:  node scripts/manager-icons.mjs
 * Its output is committed; run it again only when a brand icon changes.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const APPS = [
  { source: 'public/icons/maskable-512.png', out: 'public/icons', ground: '#F7F4EC', mark: '#1F2925' },
  { source: 'public/brand/vera/icon-512.png', out: 'public/brand/vera', ground: '#94702F', mark: '#F4EFE6' },
];

const rgb = (colour) => [1, 3, 5].map((i) => parseInt(colour.slice(i, i + 2), 16));

/**
 * The same icon in two other colours. Each brand icon is one mark on one
 * ground, so every pixel is somewhere between the two: it keeps its place
 * between them and moves to the new pair, and edges stay as smooth as they
 * were. (android/tools/make-assets.mjs draws the kitchen apps' icons the
 * same way.)
 */
async function redraw(file, ground, mark) {
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const corner = (6 * info.width + 6) * 3;
  const from = [data[corner], data[corner + 1], data[corner + 2]];
  let far = from;
  let farthest = 0;
  for (let i = 0; i < data.length; i += 3) {
    const d = (data[i] - from[0]) ** 2 + (data[i + 1] - from[1]) ** 2 + (data[i + 2] - from[2]) ** 2;
    if (d > farthest) { farthest = d; far = [data[i], data[i + 1], data[i + 2]]; }
  }
  const axis = far.map((v, c) => v - from[c]);
  const to = rgb(ground);
  const ink = rgb(mark);
  const drawn = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i += 3) {
    const along = ((data[i] - from[0]) * axis[0] + (data[i + 1] - from[1]) * axis[1] + (data[i + 2] - from[2]) * axis[2]) / farthest;
    const t = Math.max(0, Math.min(1, along));
    for (let c = 0; c < 3; c += 1) drawn[i + c] = Math.round(to[c] + t * (ink[c] - to[c]));
  }
  return sharp(drawn, { raw: { width: info.width, height: info.height, channels: 3 } }).png().toBuffer();
}

for (const app of APPS) {
  const icon = await redraw(path.join(ROOT, app.source), app.ground, app.mark);
  const out = (name) => path.join(ROOT, app.out, name);
  await sharp(icon).resize(512, 512).png().toFile(out('manager-512.png'));
  await sharp(icon).resize(192, 192).png().toFile(out('manager-192.png'));
  // iPhone's Home Screen icon: 180 px, no transparency (it has none), corners rounded by iOS.
  await sharp(icon).resize(180, 180).png().toFile(out('manager-apple-touch-icon.png'));
  console.log(`${app.out}: manager-192.png, manager-512.png, manager-apple-touch-icon.png`);
}
