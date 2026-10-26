/**
 * `/menu/<id>/<name>.webp?v=<version>` — one of a dish's locally built images.
 *
 * The version is a hash of the files (scripts/image-versions.mjs). Phones keep
 * these in the service worker's CacheFirst cache by address, so a re-shot
 * photo or re-cut crop under the same file name kept showing the old picture
 * until the version went into the address.
 */
export const localImageFile = (id: string, entry: { v?: string }) => (name: string) =>
  `/menu/${id}/${name}.webp${entry.v ? `?v=${entry.v}` : ''}`;
