import { useCallback, useEffect, useState } from 'react';

/**
 * Full screen for the menu board (/tv), from a tap on the screen itself.
 *
 * The entrance TV is a touch screen with a browser on it: the board came up
 * under the browser's address bar, and a browser goes full screen only from
 * a tap on the page. So the board shows a Full screen button while it is not
 * full screen (src/pages/TvMenu.tsx), and nothing once it is.
 *
 * A page that reloads leaves full screen — and the board reloads by itself
 * to take a new version of the app (src/lib/app-update.ts) — so the button
 * comes back until someone taps it again. Opened as the installed TV app
 * (useTvApp below), the board is full screen from the start, every time.
 */

type LegacyDocument = Document & {
  webkitFullscreenEnabled?: boolean;
  webkitFullscreenElement?: Element | null;
};
type LegacyElement = HTMLElement & { webkitRequestFullscreen?: () => void };

/** The page fills the screen: full screen, or opened as an app that is (its manifest's display "fullscreen"). */
export function isFullScreen(): boolean {
  const doc = document as LegacyDocument;
  return !!(doc.fullscreenElement ?? doc.webkitFullscreenElement) || !!window.matchMedia?.('(display-mode: fullscreen)').matches;
}

/** This browser can put a page full screen. */
export function canGoFullScreen(): boolean {
  const doc = document as LegacyDocument;
  const root = document.documentElement as LegacyElement;
  return !!(doc.fullscreenEnabled ?? doc.webkitFullscreenEnabled) && !!(root.requestFullscreen ?? root.webkitRequestFullscreen);
}

/** Puts the page full screen; only from a tap or a click. */
export async function enterFullScreen(): Promise<void> {
  const root = document.documentElement as LegacyElement;
  try {
    if (root.requestFullscreen) await root.requestFullscreen({ navigationUI: 'hide' });
    else root.webkitRequestFullscreen?.();
  } catch {
    // Refused (no tap, or the browser does not allow it here): the button stays.
  }
}

/** Whether to offer the Full screen button, and what it does. */
export function useFullScreen() {
  const [full, setFull] = useState(() => (typeof document === 'undefined' ? true : isFullScreen()));
  useEffect(() => {
    const update = () => setFull(isFullScreen());
    document.addEventListener('fullscreenchange', update);
    document.addEventListener('webkitfullscreenchange', update);
    const display = window.matchMedia?.('(display-mode: fullscreen)');
    display?.addEventListener?.('change', update);
    return () => {
      document.removeEventListener('fullscreenchange', update);
      document.removeEventListener('webkitfullscreenchange', update);
      display?.removeEventListener?.('change', update);
    };
  }, []);
  const enter = useCallback(() => { void enterFullScreen(); }, []);
  return { offer: !full && canGoFullScreen(), enter };
}

/**
 * The board as an app of its own on the TV: while it is up, the page names
 * the TV app's manifest (public/manifest-tv-<restaurant>.webmanifest), so
 * the browser's "Add to Home screen" / "Install app" makes an icon that opens
 * this board, full screen — not the guest menu the restaurant's own app
 * opens. The page's own manifest is put back when the board closes.
 */
export function useTvApp(manifest: string) {
  useEffect(() => {
    const link = document.head.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    if (!link) {
      const added = document.createElement('link');
      added.rel = 'manifest';
      added.href = manifest;
      document.head.appendChild(added);
      return () => added.remove();
    }
    const before = link.getAttribute('href');
    link.setAttribute('href', manifest);
    return () => {
      if (before === null) link.removeAttribute('href');
      else link.setAttribute('href', before);
    };
  }, [manifest]);
}
