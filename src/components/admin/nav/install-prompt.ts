/**
 * The browser's own "Install app", kept for the admin's install hint
 * (InstallHint.tsx).
 *
 * Chrome (Android, and on a computer) announces once, soon after a page
 * loads, that the app can be installed. The admin is loaded a moment later
 * than that, so this listens from the start (src/hooks/useVenue.ts imports
 * it) and keeps the offer for when the hint asks. Only on admin pages: the
 * guests' menu has its own button and its own listener
 * (src/components/guest/InstallPrompt.tsx).
 */

export interface InstallOffer extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let offer: InstallOffer | null = null;
const listeners = new Set<() => void>();
const tell = () => listeners.forEach((listener) => listener());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    if (!/^\/admin(\/|$)/.test(window.location.pathname)) return;
    // Our own button instead of the browser's bar at the bottom of the page.
    event.preventDefault();
    offer = event as InstallOffer;
    tell();
  });
  window.addEventListener('appinstalled', () => {
    offer = null;
    tell();
  });
}

export function installOffer(): InstallOffer | null {
  return offer;
}

/** Tells `listener` when an offer arrives or is used up. Returns how to stop. */
export function onInstallOffer(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Shows the browser's install sheet. True when the manager went through with it. */
export async function acceptInstallOffer(): Promise<boolean> {
  const current = offer;
  if (!current) return false;
  try {
    await current.prompt();
    const { outcome } = await current.userChoice;
    // An offer can be shown once; a cancelled one is offered again by the browser later.
    offer = null;
    tell();
    return outcome === 'accepted';
  } catch {
    offer = null;
    tell();
    return false;
  }
}
