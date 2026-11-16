import imageManifest from '@/lib/image-manifest.json';

/** One dish's locally built files (scripts/fetch-images.mjs). */
export interface LocalImageEntry {
  widths: number[];
  /** The image_url the local files were built for. */
  src?: string;
  /** Square crops (sq-<n>.webp), cut around the dish. Absent on old builds. */
  squares?: number[];
  blur: string;
  ext: string;
  /**
   * A hash of the files themselves (scripts/image-versions.mjs). It goes on
   * every local address, so a re-shot photo or re-cut crop is a new address:
   * the service worker caches these CacheFirst, and the same file name with
   * new content would otherwise keep showing the old picture.
   */
  v?: string;
}

const manifest = imageManifest as Record<string, LocalImageEntry>;

/** `/menu/<folder>/<name>.webp`, with or without its `?v=` version. */
const LOCAL_FILE = /^\/menu\/([0-9a-z-]+)\/(?:sq-)?\d+\.webp(?:\?.*)?$/i;

/**
 * Which locally built ladder serves this image, if any. The row's own id
 * first, while `src` is the photo the files were built from or one of those
 * files; otherwise the folder `src` itself names. A newly uploaded photo
 * matches neither, and is shown as uploaded.
 */
export function resolveLocal(id: string | undefined, src: string | undefined): { key: string; entry: LocalImageEntry } | undefined {
  const folder = src?.match(LOCAL_FILE)?.[1];
  const own = id ? manifest[id] : undefined;
  if (own && id && (!own.src || !src || own.src === src || folder === id)) return { key: id, entry: own };
  if (folder && manifest[folder]) return { key: folder, entry: manifest[folder] };
  return undefined;
}

/**
 * Beyond twice the CSS size a photo looks no sharper on a phone, but a 3x
 * phone asks for half again as many pixels: a 320 px card fetched the
 * 1152 px file (≈200 KB) where 768 (≈90 KB) is already 2.4x. On screens of
 * 2.5 dppx and up, every width in `sizes` is stated at two-thirds, so the
 * browser picks files for about 2x. Below 2.5 dppx nothing changes.
 */
export function capDensity(sizes: string): string {
  const parts = sizes.split(',').map((p) => p.trim()).filter(Boolean);
  const capped = parts.map((part) => {
    const m = part.match(/^(\(.+\)\s+)?(\d+(?:\.\d+)?)(vw|px)$/);
    if (!m) return null;
    const [, cond, n, unit] = m;
    const value = `${Math.round(Number(n) * 2 / 3)}${unit}`;
    const media = cond ? `${cond.trim().replace(/\)$/, '')}) and (min-resolution: 2.5dppx)` : '(min-resolution: 2.5dppx)';
    return `${media} ${value}`;
  });
  if (capped.some((c) => c === null)) return sizes;
  return [...capped, ...parts].join(', ');
}

