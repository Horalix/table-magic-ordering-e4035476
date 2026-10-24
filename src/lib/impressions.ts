import { useCallback, useEffect, useRef } from 'react';
import { track } from '@/lib/analytics';

/**
 * "Which dishes do guests look at and not order?"
 *
 * That question needs a denominator: `item_viewed`, fired from here, is the
 * views column behind the funnel in Menu Intelligence — add rate, order rate,
 * abandon rate and the "looked at, not ordered" list.
 *
 * A *view* means the card was actually on screen for long enough to be read,
 * not merely rendered. A category page is one continuous scroll that renders
 * every dish in the category at once, most of them below the fold, and a fast
 * flick past a card is not a look, so both are excluded:
 *
 *   - at least half the card must be inside the viewport,
 *   - for 400 ms without interruption,
 *   - once per item per visit, so scrolling back and forth does not inflate it.
 *
 * The result is a denominator a manager can act on: "180 people looked at the
 * risotto and 4 ordered it" is a description or price problem.
 *
 * One IntersectionObserver is shared by every card on the page. They all ask
 * the same question with the same threshold, and a long menu would otherwise
 * create one observer per dish.
 */

const DWELL_MS = 400;
const VISIBLE_RATIO = 0.5;

/** Deduped for the life of the tab — a visit, not a session. */
const seen = new Set<string>();

interface Watch {
  itemId: string;
  timer?: ReturnType<typeof setTimeout>;
}

const watched = new Map<Element, Watch>();
let shared: IntersectionObserver | null = null;

function isVisible(entry: IntersectionObserverEntry): boolean {
  // isIntersecting alone is true at 1% visible; a card scrolling OUT past the
  // threshold reports isIntersecting with a ratio just under it.
  return entry.isIntersecting && entry.intersectionRatio >= VISIBLE_RATIO;
}

function onEntries(entries: IntersectionObserverEntry[]): void {
  /*
   * One callback can carry several entries for the same card — in, then out,
   * during a fast scroll. Only the LAST one is its current state; acting on
   * the first would start a dwell timer for a card that has already left.
   */
  const latest = new Map<Element, IntersectionObserverEntry>();
  for (const entry of entries) latest.set(entry.target, entry);

  for (const [element, entry] of latest) {
    const watch = watched.get(element);
    if (!watch) continue;
    clearTimeout(watch.timer);
    watch.timer = undefined;
    if (!isVisible(entry)) continue;

    watch.timer = setTimeout(() => {
      if (!seen.has(watch.itemId)) {
        seen.add(watch.itemId);
        track('item_viewed', { item_id: watch.itemId });
      }
      unwatch(element);
    }, DWELL_MS);
  }
}

function observer(): IntersectionObserver {
  if (!shared) shared = new IntersectionObserver(onEntries, { threshold: VISIBLE_RATIO });
  return shared;
}

function watch(element: Element, itemId: string): void {
  watched.set(element, { itemId });
  observer().observe(element);
}

function unwatch(element: Element): void {
  const current = watched.get(element);
  if (current) clearTimeout(current.timer);
  watched.delete(element);
  shared?.unobserve(element);
}

/** Test seam. */
export function __resetImpressionsForTests(): void {
  seen.clear();
  for (const element of [...watched.keys()]) unwatch(element);
  shared?.disconnect();
  shared = null;
}

/**
 * Ref callback for a dish card. Attach it to the card's outermost element;
 * the hook reports one `item_viewed` per item per visit.
 */
export function useItemImpression(itemId: string | null | undefined) {
  const nodeRef = useRef<Element | null>(null);

  useEffect(() => () => {
    if (nodeRef.current) unwatch(nodeRef.current);
    nodeRef.current = null;
  }, []);

  return useCallback((node: HTMLElement | null) => {
    if (nodeRef.current) unwatch(nodeRef.current);
    nodeRef.current = null;

    if (!node || !itemId || seen.has(itemId)) return;
    if (typeof IntersectionObserver === 'undefined') return;

    nodeRef.current = node;
    watch(node, itemId);
  }, [itemId]);
}
