/**
 * Lightweight image prefetcher. Uses requestIdleCallback when available
 * so it never competes with critical work.
 */
const prefetched = new Set<string>();

export function prefetchImages(urls: (string | null | undefined)[]) {
  const list = urls.filter(Boolean) as string[];
  if (list.length === 0) return;

  const run = () => {
    for (const url of list) {
      if (prefetched.has(url)) continue;
      prefetched.add(url);
      const img = new Image();
      img.decoding = 'async';
      // @ts-ignore
      img.fetchpriority = 'low';
      img.src = url;
    }
  };

  // @ts-ignore
  if (typeof window !== 'undefined' && window.requestIdleCallback) {
    // @ts-ignore
    window.requestIdleCallback(run, { timeout: 2000 });
  } else {
    setTimeout(run, 200);
  }
}
