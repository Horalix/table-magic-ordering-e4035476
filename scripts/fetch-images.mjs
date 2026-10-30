/**
 * fetch-images.mjs — Build-time menu image pipeline.
 *
 * Pulls every `categories` + `menu_items` image out of Supabase, downloads
 * it once, and produces optimized local WebP assets so the guest app serves
 * images from its own origin (instant, cache-friendly) instead of hitting an
 * external CDN on every view.
 *
 * Output:
 *   public/menu/<id>/<width>.webp     — responsive WebP ladder, plus the
 *                                       source's own width when it falls
 *                                       between two rungs (never above 1152)
 *   public/menu/<id>/sq-<size>.webp   — square crops for list thumbnails,
 *                                       cut around the dish (sharp's
 *                                       attention strategy) and sharpened
 *   public/menu/<id>/.hash            — source hash sidecar (idempotency)
 *   src/lib/image-manifest.json       — { [id]: { widths, squares, blur, ext, src, v } }
 *                                       (v: a hash of the files, set by
 *                                       scripts/image-versions.mjs)
 *
 * Run:  npm run images            (only rows whose image changed)
 *       npm run images -- --force (rebuild every row)
 * Requires .env with VITE_SUPABASE_URL + VITE_SUPABASE_PUBLISHABLE_KEY.
 *
 * Better originals: a file at scripts/image-sources/<row id>.<jpg|jpeg|png|webp>
 * is used instead of the row's image_url. Several photos in storage are
 * ~190px thumbnails of pictures the old menu site still had at 400-900px;
 * those originals live there until someone re-uploads them in Admin -> Menu.
 *
 * Re-running is cheap: rows whose source URL is unchanged are skipped.
 * Items NOT present in the manifest still render at runtime via SmartImage's
 * CDN fallback, so the app never shows a broken image between runs.
 */
import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { stampImageVersions } from './image-versions.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT_DIR = resolve(ROOT, 'public/menu');
const SOURCES_DIR = resolve(ROOT, 'scripts/image-sources');
const FORCE = process.argv.includes('--force');
const MANIFEST_PATH = resolve(ROOT, 'src/lib/image-manifest.json');

// Responsive width ladder. Covers list thumbnails (80px @1x/2x → 96/192)
// through the full-width detail sheet (~512px @2x → 1152). Each is capped
// at the source width so we never upscale.
const WIDTHS = [96, 192, 384, 768, 1152];
// Square thumbnails. A landscape photo object-cover'd into a square box only
// uses its middle, so a 192px-wide variant in a 96px box on a 2x phone was
// really 153px tall and stretched; these are cut square at the size a phone
// actually draws (80-112px boxes at 2x and 3x).
const SQUARES = [160, 240, 360];
// How much of a square studio shot a list thumbnail shows (see processRow).
const THUMB_ZOOM = 0.78;
const THUMB_ZOOM_EXCEPTIONS = {
  '5a674711-02e2-416e-99de-7fa1e76003aa': 1, // Breakfast Platter (flat lay)
  '7382930d-240f-48c4-a3e1-5555e8561e60': 1, // Breakfast Platter for Two (flat lay)
  'c98d1f5e-bbc2-47c2-b4ab-48ec64383283': 1, // Picnic Box Set (flat lay)
  '4bdf76b3-b150-46f5-b059-0f228d48c56d': 0.92, // Churros: the long tray needs the width
  '99162c3d-f38b-4720-9cbf-97066369220d': 1, // Sky Cola Zero: the can fills the frame top to bottom
};
// Vera Italia's photographs are overhead, the plate centred with stone all
// round and no props above it: thumbnails zoom less, and on the middle, so
// the whole plate stays in them (items can set their own in menu.json).
const VERA_THUMB_ZOOM = 0.9;
const THUMB_MIDDLE = new Set();
// Where across a landscape photo the square thumbnail is centred (0 = left
// edge, 1 = right), for photos where the attention crop picks the props: the
// Chemex stands at the right of its tray, and the crop chose the two glasses.
const THUMB_CENTRE = {
  '7c1e2a40-5b0d-4c8e-9a51-1f6d3e2b9c01': 0.73, // Chemex Hot
};
// Downscaling softens edges; a light unsharp mask on the small sizes keeps a
// burger looking like a burger at thumbnail size.
const SHARPEN = { sigma: 0.6, m1: 0.5, m2: 2.5 };
const QUALITY = 80;
// The largest variant ever written. A 3x phone showing a full-width dish
// needs ~1125px, which the 1152 rung already covers; anything wider is
// bytes nobody sees.
const MAX_WIDTH = 1152;
const CONCURRENCY = 6;

/* ---- env -------------------------------------------------------------- */
// dotenv-free loader (no extra dep); falls back to existing process.env.
function loadDotEnv() {
  const envPath = resolve(ROOT, '.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    const key = m[1];
    const val = m[2].trim().replace(/^["']|["']$/g, '');
    if (!(key in process.env)) process.env[key] = val;
  }
}
loadDotEnv();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error(
    '\n  ✗ Missing Supabase env. Ensure .env has VITE_SUPABASE_URL and ' +
      'VITE_SUPABASE_PUBLISHABLE_KEY.\n',
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

/* ---- helpers ---------------------------------------------------------- */
const sha1 = (s) => createHash('sha1').update(s).digest('hex');

async function readHash(id) {
  try {
    return await readFile(resolve(OUT_DIR, id, '.hash'), 'utf8');
  } catch {
    return null;
  }
}

/** A hand-supplied original for this row, if there is one. */
function localSource(id) {
  for (const ext of ['jpg', 'jpeg', 'png', 'webp']) {
    const file = resolve(SOURCES_DIR, `${id}.${ext}`);
    if (existsSync(file)) return file;
  }
  return null;
}

/*
 * Which uploaded photo each prepared original replaced (id → image_url).
 * A prepared file stands in for THAT photo only: once someone uploads a new
 * photo in Admin → Menu, image_url changes and the upload wins. Without this
 * the prepared file was used forever and a manager's new photo never showed.
 * Files from before this record existed adopt the current image_url.
 */
const OVERRIDES_PATH = resolve(SOURCES_DIR, 'overrides.json');
let overrides = {};
try { overrides = JSON.parse(readFileSync(OVERRIDES_PATH, 'utf8')); } catch { /* none yet */ }
let overridesChanged = false;

function currentOverride(id, imageUrl) {
  const file = localSource(id);
  if (!file) return null;
  if (!(id in overrides)) { overrides[id] = imageUrl; overridesChanged = true; }
  if (overrides[id] !== imageUrl) {
    console.log(`\n  · ${id}: a new photo was uploaded in the admin; the prepared one is no longer used`);
    return null;
  }
  return file;
}

/** Process a single row → writes assets, returns manifest entry or null. */
async function processRow(row, manifest, counters) {
  const { id, image_url } = row;
  if (!image_url) return;

  const override = currentOverride(id, image_url);
  const hash = override ? sha1(`file:${sha1(readFileSync(override).toString('base64'))}`) : sha1(image_url);
  const dir = resolve(OUT_DIR, id);

  // Skip if unchanged AND assets already present.
  if (!FORCE && manifest[id] && (await readHash(id)) === hash && existsSync(dir)) {
    manifest[id].src = image_url;
    counters.skipped++;
    return;
  }

  try {
    let input;
    if (override) {
      input = readFileSync(override);
    } else {
      const res = await fetch(image_url, { redirect: 'follow' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      input = Buffer.from(await res.arrayBuffer());
    }

    const meta = await sharp(input).rotate().metadata();
    const srcW = meta.width || Math.max(...WIDTHS);
    const srcH = meta.height || srcW;

    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });

    const widths = WIDTHS.filter((w) => w <= srcW);
    // The source's own width when it sits between two rungs. Without it a
    // 1000px photo topped out at 768 and a 660px one at 384 — half its
    // detail thrown away before any phone asked for it.
    const top = Math.min(srcW, MAX_WIDTH);
    if (!widths.includes(top) && top > (widths[widths.length - 1] ?? 0)) widths.push(top);

    await Promise.all(
      widths.map((w) => {
        let img = sharp(input).rotate().resize(w, null, { withoutEnlargement: true });
        if (w <= 384) img = img.sharpen(SHARPEN);
        return img.webp({ quality: w <= 384 ? 82 : QUALITY }).toFile(resolve(dir, `${w}.webp`));
      }),
    );

    // Square studio shots (the re-staged photos in scripts/image-sources/)
    // frame the dish with set dressing in the top corners — right for the
    // dish sheet, wasted pixels in a 108px list thumbnail, and the same linen
    // and flowers repeated down a list. Their thumbnails zoom in on the dish:
    // a centred box of THUMB_ZOOM of the frame, sitting a little low because
    // the props are at the top. Flat lays fill the frame and are left alone.
    const studio = override && srcW >= 1000 && Math.abs(srcW - srcH) / srcW < 0.03;
    const zoom = studio ? (THUMB_ZOOM_EXCEPTIONS[id] ?? THUMB_ZOOM) : 1;
    let thumbSource = input;
    if (zoom < 1) {
      const box = Math.round(Math.min(srcW, srcH) * zoom);
      const left = Math.round((srcW - box) / 2);
      const top = Math.min(srcH - box, Math.max(0, Math.round(srcH * (THUMB_MIDDLE.has(id) ? 0.5 : 0.56) - box / 2)));
      thumbSource = await sharp(input).rotate().extract({ left, top, width: box, height: box }).toBuffer();
    } else if (THUMB_CENTRE[id] !== undefined && srcW > srcH) {
      const left = Math.min(srcW - srcH, Math.max(0, Math.round(srcW * THUMB_CENTRE[id] - srcH / 2)));
      thumbSource = await sharp(input).rotate().extract({ left, top: 0, width: srcH, height: srcH }).toBuffer();
    }

    const side = Math.round(Math.min(srcW, srcH) * zoom);
    const squares = SQUARES.filter((sq) => sq <= side);
    if (squares.length === 0) squares.push(side);
    await Promise.all(
      squares.map((sq) =>
        sharp(thumbSource)
          .rotate()
          .resize(sq, sq, { fit: 'cover', position: sharp.strategy.attention })
          .sharpen(SHARPEN)
          .webp({ quality: 82 })
          .toFile(resolve(dir, `sq-${sq}.webp`)),
      ),
    );

    // LQIP — tiny blurred base64 for elegant blur-up.
    const lqip = await sharp(input)
      .resize(16, null, { withoutEnlargement: true })
      .webp({ quality: 40 })
      .toBuffer();
    const blur = `data:image/webp;base64,${lqip.toString('base64')}`;

    await writeFile(resolve(dir, '.hash'), hash, 'utf8');

    // `src`: the image_url these files were built for. The app only uses
    // them while the row still points at that photo (see SmartImage).
    manifest[id] = { widths, squares, blur, ext: 'webp', src: image_url };
    counters.downloaded++;
    process.stdout.write('.');
  } catch (e) {
    counters.failed++;
    counters.errors.push(`${id}: ${e.message}`);
    process.stdout.write('x');
  }
}

/* ---- main ------------------------------------------------------------- */
async function main() {
  console.log('\n  La Soul — fetching & optimizing menu images\n');

  await mkdir(OUT_DIR, { recursive: true });

  // Load existing manifest (so unchanged rows can be skipped).
  let manifest = {};
  try {
    manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
  } catch {
    /* first run */
  }

  const [{ data: items, error: e1 }, { data: cats, error: e2 }] = await Promise.all([
    supabase.from('menu_items').select('id, image_url').not('image_url', 'is', null),
    supabase.from('categories').select('id, image_url').not('image_url', 'is', null),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;

  const rows = [...(items ?? []), ...(cats ?? [])];
  console.log(`  ${rows.length} images referenced in Supabase${FORCE ? ' (rebuilding all)' : ''}\n`);
  // Vera Italia's dishes, from its menu file, until its menu migration is
  // live (20261030120000_vera_italia_menu.sql); then the database lists
  // them too. Without this the pruning below would delete their photos.
  const known = new Set(rows.map((r) => r.id));
  const vera = JSON.parse(readFileSync(resolve(__dirname, 'vera-italia/menu.json'), 'utf8'));
  for (const it of vera.categories.flatMap((c) => c.sections.flatMap((s) => s.items))) {
    if (!it.no_photo && !known.has(it.id)) rows.push({ id: it.id, image_url: `/menu/${it.id}/1152.webp` });
    THUMB_ZOOM_EXCEPTIONS[it.id] = it.thumb_zoom ?? VERA_THUMB_ZOOM;
    THUMB_MIDDLE.add(it.id);
  }

  const counters = { downloaded: 0, skipped: 0, failed: 0, errors: [] };

  // Concurrency-limited worker pool.
  let cursor = 0;
  const worker = async () => {
    while (cursor < rows.length) {
      const row = rows[cursor++];
      await processRow(row, manifest, counters);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  // Prune manifest entries whose row disappeared from Supabase.
  const liveIds = new Set(rows.map((r) => r.id));
  for (const id of Object.keys(manifest)) {
    if (!liveIds.has(id)) {
      delete manifest[id];
      await rm(resolve(OUT_DIR, id), { recursive: true, force: true });
    }
  }

  if (overridesChanged) {
    const sortedOverrides = Object.fromEntries(Object.entries(overrides).sort(([a], [b]) => a.localeCompare(b)));
    await writeFile(OVERRIDES_PATH, JSON.stringify(sortedOverrides, null, 2) + '\n', 'utf8');
  }

  // Stable key order keeps the committed manifest diff-friendly.
  const sorted = Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)));
  await writeFile(MANIFEST_PATH, JSON.stringify(sorted, null, 2) + '\n', 'utf8');
  // New files, new addresses: phones cache these by address (image-versions.mjs).
  const versioned = stampImageVersions();

  console.log('\n');
  console.log(`  ✓ downloaded ${counters.downloaded}  ·  skipped ${counters.skipped}  ·  failed ${counters.failed}`);
  console.log(`  ✓ manifest → src/lib/image-manifest.json (${Object.keys(sorted).length} entries)`);
  console.log(`  ✓ ${versioned} photo version(s) updated`);
  if (counters.errors.length) {
    console.log('\n  Errors (first 10):');
    counters.errors.slice(0, 10).forEach((e) => console.log(`    - ${e}`));
  }
  console.log('');
}

main().catch((err) => {
  console.error('\n  ✗ Image fetch failed:', err.message, '\n');
  process.exit(1);
});
