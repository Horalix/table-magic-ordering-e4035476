/**
 * fetch-images.mjs — Build-time menu image pipeline.
 *
 * Pulls every `categories` + `menu_items` image out of Supabase, downloads
 * it once, and produces optimized local WebP assets so the guest app serves
 * images from its own origin (instant, cache-friendly) instead of hitting an
 * external CDN on every view.
 *
 * Output:
 *   public/menu/<id>/<width>.webp     — responsive WebP ladder
 *   public/menu/<id>/.hash            — source hash sidecar (idempotency)
 *   src/lib/image-manifest.json       — { [id]: { widths, blur, ext } }
 *
 * Run:  npm run images
 * Requires .env with VITE_SUPABASE_URL + VITE_SUPABASE_PUBLISHABLE_KEY.
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

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT_DIR = resolve(ROOT, 'public/menu');
const MANIFEST_PATH = resolve(ROOT, 'src/lib/image-manifest.json');

// Responsive width ladder. Covers list thumbnails (80px @1x/2x → 96/192)
// through the full-width detail sheet (~512px @2x → 1152). Each is capped
// at the source width so we never upscale.
const WIDTHS = [96, 192, 384, 768, 1152];
const QUALITY = 80;
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

/** Process a single row → writes assets, returns manifest entry or null. */
async function processRow(row, manifest, counters) {
  const { id, image_url } = row;
  if (!image_url) return;

  const hash = sha1(image_url);
  const dir = resolve(OUT_DIR, id);

  // Skip if unchanged AND assets already present.
  if (manifest[id] && (await readHash(id)) === hash && existsSync(dir)) {
    counters.skipped++;
    return;
  }

  try {
    const res = await fetch(image_url, { redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const input = Buffer.from(await res.arrayBuffer());

    const meta = await sharp(input).metadata();
    const srcW = meta.width || Math.max(...WIDTHS);

    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });

    const widths = WIDTHS.filter((w) => w <= srcW);
    if (widths.length === 0) widths.push(srcW); // tiny source → at least one

    await Promise.all(
      widths.map((w) =>
        sharp(input)
          .resize(w, null, { withoutEnlargement: true })
          .webp({ quality: QUALITY })
          .toFile(resolve(dir, `${w}.webp`)),
      ),
    );

    // LQIP — tiny blurred base64 for elegant blur-up.
    const lqip = await sharp(input)
      .resize(16, null, { withoutEnlargement: true })
      .webp({ quality: 40 })
      .toBuffer();
    const blur = `data:image/webp;base64,${lqip.toString('base64')}`;

    await writeFile(resolve(dir, '.hash'), hash, 'utf8');

    manifest[id] = { widths, blur, ext: 'webp' };
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
  console.log(`  ${rows.length} images referenced in Supabase\n`);

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

  // Stable key order keeps the committed manifest diff-friendly.
  const sorted = Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)));
  await writeFile(MANIFEST_PATH, JSON.stringify(sorted, null, 2) + '\n', 'utf8');

  console.log('\n');
  console.log(`  ✓ downloaded ${counters.downloaded}  ·  skipped ${counters.skipped}  ·  failed ${counters.failed}`);
  console.log(`  ✓ manifest → src/lib/image-manifest.json (${Object.keys(sorted).length} entries)`);
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
