/**
 * menu-photos.mjs — round-trip the menu photos through a human (or an image
 * editor) and back into the app.
 *
 *   npm run photos:export   every dish's best current photo, one file per
 *                           dish, under assets/menu-photos/originals/, named
 *                           "<NN Category>/<NN Section>/<NNN> <Dish>__<id8>.<ext>",
 *                           plus index.csv and contact sheets.
 *   npm run photos:import   every file under assets/menu-photos/improved/ whose
 *                           name still ends in "__<id8>" becomes that dish's
 *                           source (scripts/image-sources/<id>.<ext>), then the
 *                           image pipeline rebuilds those dishes.
 *
 * "Best current photo" is the override in scripts/image-sources/ when there
 * is one (the larger originals recovered from the old site), else the row's
 * image_url. Only the 8-character id suffix matters on import, so the file
 * can be renamed, re-encoded (PNG/JPG/WebP) or moved between folders freely.
 *
 * assets/menu-photos/ is git-ignored: it is a working folder, not the source
 * of truth. The improved files that matter end up in scripts/image-sources/.
 * Requires .env with VITE_SUPABASE_URL + VITE_SUPABASE_PUBLISHABLE_KEY.
 */
import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import { mkdir, writeFile, readdir, copyFile, rm } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, extname, basename } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = resolve(ROOT, 'assets/menu-photos');
const ORIGINALS = join(ASSETS, 'originals');
const IMPROVED = join(ASSETS, 'improved');
const SOURCES = resolve(ROOT, 'scripts/image-sources');
const EXTS = ['jpg', 'jpeg', 'png', 'webp'];

// Added by 20261024120000_menu_prices_and_new_items.sql; until that migration
// is applied they exist only here.
const PENDING_ITEMS = [
  { id: '7c1e2a40-5b0d-4c8e-9a51-1f6d3e2b9c01', name: 'Chemex Hot', section: 'Filter Coffee', category: 'Drinks', image_url: 'https://menu.lasoul.net/img/drink/chemex.jpg' },
  { id: '7c1e2a40-5b0d-4c8e-9a51-1f6d3e2b9c02', name: 'Healthy Beef Burger', section: 'Burgers', category: 'Food', image_url: 'https://menu.lasoul.net/img/food/healthybeefburger.jpg' },
  { id: '7c1e2a40-5b0d-4c8e-9a51-1f6d3e2b9c03', name: 'Healthy Chicken Burger', section: 'Burgers', category: 'Food', image_url: 'https://menu.lasoul.net/img/food/healthychickenburger.jpg' },
  { id: '7c1e2a40-5b0d-4c8e-9a51-1f6d3e2b9c04', name: 'Banana Pudding', section: 'Desserts', category: 'Desserts', image_url: 'https://menu.lasoul.net/img/bananapudding.jpg' },
];

function loadEnv() {
  const env = { ...process.env };
  const file = resolve(ROOT, '.env');
  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/);
      if (m && !env[m[1]]) env[m[1]] = m[2];
    }
  }
  return env;
}

const pad = (n, w) => String(n).padStart(w, '0');
const safe = (s) => s.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ');
const localSource = (id) => EXTS.map((e) => join(SOURCES, `${id}.${e}`)).find((f) => existsSync(f));

/** Laplacian variance on a 512px grey copy: a rough, comparable sharpness score. */
async function sharpness(buf) {
  const { data, info } = await sharp(buf).resize({ width: 512, withoutEnlargement: true }).greyscale()
    .raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  let sum = 0; let sq = 0; let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const l = data[i - w] + data[i + w] + data[i - 1] + data[i + 1] - 4 * data[i];
      sum += l; sq += l * l; n++;
    }
  }
  const mean = sum / n;
  return Math.round(sq / n - mean * mean);
}

async function loadMenu() {
  const env = loadEnv();
  const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY ?? env.VITE_SUPABASE_ANON_KEY);
  const [{ data: cats, error: e1 }, { data: subs, error: e2 }, { data: items, error: e3 }] = await Promise.all([
    supabase.from('categories').select('id, name, sort_order, image_url'),
    supabase.from('subcategories').select('id, name, category_id, sort_order'),
    supabase.from('menu_items').select('id, name, description, subcategory_id, sort_order, image_url, is_available'),
  ]);
  if (e1 || e2 || e3) throw e1 || e2 || e3;
  const catOrder = [...cats].sort((a, b) => a.sort_order - b.sort_order);
  const subById = new Map(subs.map((s) => [s.id, s]));
  const catById = new Map(cats.map((c) => [c.id, c]));
  const rows = items.map((it) => {
    const sub = subById.get(it.subcategory_id);
    const cat = sub ? catById.get(sub.category_id) : null;
    return { ...it, section: sub?.name ?? 'Other', sectionSort: sub?.sort_order ?? 999, category: cat?.name ?? 'Other' };
  });
  for (const p of PENDING_ITEMS) {
    if (rows.some((r) => r.id === p.id)) continue;
    const sub = subs.find((s) => s.name === p.section);
    rows.push({ ...p, description: '', sort_order: 999, sectionSort: sub?.sort_order ?? 999, is_available: true, pending: true });
  }
  return { rows, catOrder, subs };
}

async function exportPhotos() {
  const { rows, catOrder } = await loadMenu();
  await rm(ORIGINALS, { recursive: true, force: true });
  await mkdir(IMPROVED, { recursive: true });
  const catIndex = new Map(catOrder.map((c, i) => [c.name, i + 1]));
  const sectionsByCat = new Map();
  for (const r of rows) {
    const list = sectionsByCat.get(r.category) ?? new Map();
    list.set(r.section, Math.min(list.get(r.section) ?? 999, r.sectionSort));
    sectionsByCat.set(r.category, list);
  }
  const sectionIndex = (cat, sec) => [...sectionsByCat.get(cat).entries()].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0])).findIndex(([s]) => s === sec) + 1;

  rows.sort((a, b) => (catIndex.get(a.category) ?? 99) - (catIndex.get(b.category) ?? 99)
    || a.sectionSort - b.sectionSort || (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name));

  const index = [];
  let n = 0;
  for (const r of rows) {
    n++;
    const override = localSource(r.id);
    let buf = null; let from = '';
    try {
      if (override) { buf = readFileSync(override); from = 'override'; }
      else if (r.image_url) {
        const res = await fetch(r.image_url, { redirect: 'follow' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        buf = Buffer.from(await res.arrayBuffer()); from = 'image_url';
      }
    } catch (e) { from = `failed: ${e.message}`; }

    const dir = join(ORIGINALS, `${pad(catIndex.get(r.category) ?? 99, 2)} ${safe(r.category)}`,
      `${pad(sectionIndex(r.category, r.section), 2)} ${safe(r.section)}`);
    await mkdir(dir, { recursive: true });
    const stem = `${pad(n, 3)} ${safe(r.name)}__${r.id.slice(0, 8)}`;
    let file = ''; let meta = {}; let sharp_ = '';
    if (buf) {
      meta = await sharp(buf).metadata();
      const ext = meta.format === 'jpeg' ? 'jpg' : meta.format;
      file = join(dir, `${stem}.${ext}`);
      await writeFile(file, buf);
      sharp_ = await sharpness(buf);
    }
    index.push({
      no: n, id: r.id, category: r.category, section: r.section, name: r.name.trim(),
      file: file ? file.slice(ASSETS.length + 1).replace(/\\/g, '/') : '', width: meta.width ?? '', height: meta.height ?? '',
      kb: buf ? Math.round(buf.length / 1024) : '', sharpness: sharp_, source: from, available: r.is_available !== false,
      pending: Boolean(r.pending), description: (r.description ?? '').replace(/\s+/g, ' ').trim(),
    });
    process.stdout.write(`\r  ${n}/${rows.length}`);
  }
  const cols = Object.keys(index[0]);
  const csv = [cols.join(','), ...index.map((r) => cols.map((c) => `"${String(r[c]).replace(/"/g, '""')}"`).join(','))].join('\n');
  await writeFile(join(ASSETS, 'index.csv'), csv + '\n', 'utf8');
  await writeFile(join(ASSETS, 'index.json'), JSON.stringify(index, null, 2) + '\n', 'utf8');
  await contactSheets(index);
  console.log(`\n  ✓ ${index.filter((r) => r.file).length} photos → assets/menu-photos/originals/`);
  const missing = index.filter((r) => !r.file);
  if (missing.length) console.log(`  ! no photo for: ${missing.map((r) => r.name).join(', ')}`);
}

/** Numbered thumbnails, 30 to a sheet, for reviewing the whole menu at once. */
async function contactSheets(index) {
  const withFile = index.filter((r) => r.file);
  const T = 220; const COLS = 6; const PER = 30; const LABEL = 34;
  for (let s = 0; s * PER < withFile.length; s++) {
    const page = withFile.slice(s * PER, (s + 1) * PER);
    const rowsN = Math.ceil(page.length / COLS);
    const comps = [];
    for (const [i, r] of page.entries()) {
      const x = (i % COLS) * (T + 10) + 10; const y = Math.floor(i / COLS) * (T + LABEL + 10) + 10;
      const thumb = await sharp(join(ASSETS, r.file)).resize(T, T, { fit: 'cover' }).toBuffer();
      const label = `${r.no} ${r.name}`.replace(/&/g, '&amp;').replace(/</g, '&lt;').slice(0, 30);
      comps.push({ input: thumb, left: x, top: y });
      comps.push({ input: Buffer.from(`<svg width="${T}" height="${LABEL}"><text x="0" y="22" font-family="Arial" font-size="15" fill="#eee">${label}</text></svg>`), left: x, top: y + T });
    }
    await sharp({ create: { width: COLS * (T + 10) + 10, height: rowsN * (T + LABEL + 10) + 10, channels: 3, background: '#222' } })
      .composite(comps).jpeg({ quality: 82 }).toFile(join(ASSETS, `contact-sheet-${s + 1}.jpg`));
  }
}

async function importPhotos() {
  if (!existsSync(IMPROVED)) { console.log('  Nothing to import: assets/menu-photos/improved/ does not exist.'); return; }
  const { rows } = await loadMenu();
  const byPrefix = new Map(rows.map((r) => [r.id.slice(0, 8), r.id]));
  const files = [];
  const walk = async (d) => {
    for (const e of await readdir(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (EXTS.includes(extname(e.name).slice(1).toLowerCase())) files.push(p);
    }
  };
  await walk(IMPROVED);
  await mkdir(SOURCES, { recursive: true });
  let done = 0; const skipped = [];
  for (const f of files) {
    const m = basename(f, extname(f)).match(/__([0-9a-f]{8})$/i);
    const id = m && byPrefix.get(m[1].toLowerCase());
    if (!id) { skipped.push(basename(f)); continue; }
    const meta = await sharp(f).metadata();
    if ((meta.width ?? 0) < 1000) { skipped.push(`${basename(f)} (only ${meta.width}px wide; save at least 1024px, 2048 is best)`); continue; }
    for (const e of EXTS) await rm(join(SOURCES, `${id}.${e}`), { force: true });
    const ext = meta.format === 'jpeg' ? 'jpg' : meta.format;
    await copyFile(f, join(SOURCES, `${id}.${ext}`));
    done++;
  }
  console.log(`  ✓ ${done} improved photo(s) → scripts/image-sources/`);
  if (skipped.length) console.log(`  ! skipped:\n    ${skipped.join('\n    ')}`);
  if (done) {
    console.log('  Rebuilding the image ladder…');
    const r = spawnSync(process.execPath, [resolve(ROOT, 'scripts/fetch-images.mjs')], { stdio: 'inherit' });
    if (r.status !== 0) process.exit(r.status ?? 1);
  }
}

const cmd = process.argv[2];
if (cmd === 'export') await exportPhotos();
else if (cmd === 'import') await importPhotos();
else { console.log('  usage: node scripts/menu-photos.mjs export|import'); process.exit(1); }
