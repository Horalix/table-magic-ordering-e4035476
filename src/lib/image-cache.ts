/**
 * Lightweight image prefetcher. Uses requestIdleCallback when available
 * so it never competes with critical work.
 */
const prefetched = new Set<string>();

type PriorityImage = HTMLImageElement & {
  fetchPriority?: 'high' | 'low' | 'auto';
};

export function prefetchImages(urls: (string | null | undefined)[]) {
  const list = urls.filter(Boolean) as string[];
  if (list.length === 0) return;

  const run = () => {
    for (const url of list) {
      if (prefetched.has(url)) continue;
      prefetched.add(url);
      const img: PriorityImage = new Image();
      img.decoding = 'async';
      img.fetchPriority = 'low';
      img.src = url;
    }
  };

  if (typeof window !== 'undefined' && window.requestIdleCallback) {
    window.requestIdleCallback(run, { timeout: 2000 });
  } else {
    setTimeout(run, 200);
  }
}
