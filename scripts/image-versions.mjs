/**
 * image-versions.mjs — stamp every menu photo with a version of its files.
 *
 * Guest phones keep menu photos in the service worker's CacheFirst cache
 * (vite.config.ts), keyed by address, for 30 days. When the photos were
 * re-staged under the same file names, a phone that had already shown a dish
 * kept the old list thumbnail while a size it had never loaded came in new:
 * the list showed one photo and the dish sheet another.
 *
 * So each manifest entry carries `v`, a short hash of the files themselves —
 * every width and every square crop — and SmartImage asks for
 * `/menu/<id>/sq-360.webp?v=<v>`. A changed photo or crop gets a new address
 * and is fetched fresh; an unchanged one stays cached.
 *
 * Runs before every build (package.json) and at the end of `npm run images`,
 * so a photo replaced by hand still gets a new version.
 *
 * Run:  node scripts/image-versions.mjs
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = resolve(ROOT, 'public/menu');
const MANIFEST_PATH = resolve(ROOT, 'src/lib/image-manifest.json');

/** A short hash of every image in a dish's folder, file names included. */
export function contentVersion(dir) {
  const hash = createHash('sha1');
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.webp')).sort()) {
    hash.update(file).update(readFileSync(resolve(dir, file)));
  }
  return hash.digest('hex').slice(0, 10);
}

/** Sets `v` on every manifest entry with a folder; writes the manifest only when one changed. */
export function stampImageVersions() {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  let changed = 0;
  for (const [id, entry] of Object.entries(manifest)) {
    const dir = resolve(OUT_DIR, id);
    if (!existsSync(dir)) continue;
    const v = contentVersion(dir);
    if (entry.v !== v) {
      entry.v = v;
      changed++;
    }
  }
  if (changed) writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  return changed;
}

if (process.argv[1] && /image-versions\.mjs$/i.test(process.argv[1])) {
  const changed = stampImageVersions();
  console.log(`  image versions: ${changed ? `${changed} updated` : 'all current'}`);
}
