import { useLayoutEffect } from 'react';

/**
 * Asks the browser to show a page as it was drawn, never darkened.
 *
 * A browser can be set to darken every page itself: Chrome's "dark theme
 * for web pages" repaints a light page's backgrounds dark and its text light.
 * The entrance TV's browser was set so, and the menu board (/tv) came out
 * charcoal, its sage band murky. "only light" is the page saying it is
 * drawn for one look, which Chrome then leaves alone (e2e/tv-menu-dark.spec.ts).
 *
 * index.html says it before the first paint on the board's address, so the
 * screen never shows a darkened frame while the app loads; this keeps it so
 * while the board is up, however it was reached, and puts the page back as
 * it was when it closes.
 */
export const LIGHT_ONLY = 'only light';

export function useLightOnly() {
  useLayoutEffect(() => {
    let meta = document.head.querySelector<HTMLMetaElement>('meta[name="color-scheme"]');
    const previous = meta?.getAttribute('content') ?? null;
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'color-scheme';
      document.head.appendChild(meta);
    }
    meta.content = LIGHT_ONLY;
    const root = document.documentElement;
    const before = root.style.colorScheme;
    root.style.colorScheme = LIGHT_ONLY;
    return () => {
      root.style.colorScheme = before;
      const current = document.head.querySelector('meta[name="color-scheme"]');
      if (previous === null) current?.remove();
      else current?.setAttribute('content', previous);
    };
  }, []);
}
