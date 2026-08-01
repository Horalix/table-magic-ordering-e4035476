import { useCallback, useEffect, useRef } from 'react';
import { track } from '@/lib/analytics';

/**
 * "Which dishes do guests look at and not order?"
 *
 * That question needs a denominator, and until now there wasn't one:
 * `item_viewed` was declared in the analytics vocabulary and never fired, so
 * every item's view count was zero and the whole funnel in Menu Intelligence —
 * add rate, order rate, abandon rate, the "looked at, not ordered" panel — was
 * permanently blank.
 *
 * A *view* here means the card was actually on screen for long enough to be
 * read, not merely mounted. The menu pager keeps neighbouring pages in the DOM,
 * and a fast scroll past a card is not a look, so both are excluded:
 *
 *   - IntersectionObserver with a 50% threshold, so half the card must be visible
 *   - a 400 ms dwell before it counts
 *   - once per item per visit, so scrolling back and forth does not inflate it
 *
 * The result is a denominator a manager can act on: "180 people looked at the
 * risotto and 4 ordered it" is a description or price problem.
 */

const DWELL_MS = 400;
const VISIBLE_RATIO = 0.5;

/** Deduped for the life of the tab — a visit, not a session. */
const seen = new Set<string>();

/** Test seam. */
export function __resetImpressionsForTests(): void {
  seen.clear();
}

export function useItemImpression(itemId: string | null | undefined) {
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const observerRef = useRef<IntersectionObserver>();

  useEffect(() => () => {
    clearTimeout(timerRef.current);
    observerRef.current?.disconnect();
  }, []);

  return useCallback((node: HTMLElement | null) => {
    observerRef.current?.disconnect();
    clearTimeout(timerRef.current);

    if (!node || !itemId || seen.has(itemId)) return;
    if (typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;

        if (entry.isIntersecting) {
          timerRef.current = setTimeout(() => {
            if (seen.has(itemId)) return;
            seen.add(itemId);
            track('item_viewed', { item_id: itemId });
            observer.disconnect();
          }, DWELL_MS);
        } else {
          clearTimeout(timerRef.current);
        }
      },
      { threshold: VISIBLE_RATIO },
    );

    observer.observe(node);
    observerRef.current = observer;
  }, [itemId]);
}
