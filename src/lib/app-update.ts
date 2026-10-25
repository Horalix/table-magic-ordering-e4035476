import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';

/**
 * New versions of the app reach every phone and tablet promptly, at a moment
 * that interrupts nobody.
 *
 * The service worker serves the app from its cache so the menu opens
 * instantly and offline. Left on `autoUpdate`, a phone only noticed a new
 * release on its own schedule and then kept showing the old one until the next
 * full load — "sometimes it shows the old site". Now:
 *
 *  - every open screen asks for a new version every few minutes and whenever
 *    it comes back to the foreground;
 *  - a waiting version is applied on the next page change, or when a guest
 *    returns to the tab (never on the cart, where a card payment may be in
 *    flight), or on a staff screen nobody has touched for a while — never
 *    while someone is typing or has a dialog open.
 *
 * The cart and the table session are persisted, so a reload loses nothing.
 */

const CHECK_EVERY_MS = 5 * 60_000;
const STAFF_IDLE_MS = 90_000;
const STAFF_PATH = /^\/(admin|kitchen|waiter)(\/|$)/;

let updateSW: ((reloadPage?: boolean) => Promise<void>) | null = null;
let waiting = false;
let started = false;

/** Register the service worker and start looking for new versions. Once per page. */
export function startAppUpdates(): void {
  if (started || typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
  started = true;
  updateSW = registerSW({
    immediate: true,
    onNeedRefresh() { waiting = true; },
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      const check = () => { if (navigator.onLine) void registration.update().catch(() => { /* next time */ }); };
      setInterval(check, CHECK_EVERY_MS);
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
    },
  });
}

/** Take the waiting version now: the new worker takes over and the page reloads. */
export function applyWaitingUpdate(): boolean {
  if (!waiting || !updateSW) return false;
  waiting = false;
  void updateSW(true);
  return true;
}

/** Someone is mid-way through something a reload would lose. */
function busy(): boolean {
  if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return true;
  const el = document.activeElement;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || (el as HTMLElement).isContentEditable);
}

/** Applies a waiting version at the safe moments described above. Render once, inside the router. */
export function AppUpdater(): null {
  const { pathname } = useLocation();
  const first = useRef(true);

  // A page change is the natural moment: the screen is being replaced anyway.
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    applyWaitingUpdate();
  }, [pathname]);

  useEffect(() => {
    let lastTouch = Date.now();
    const touched = () => { lastTouch = Date.now(); };
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (window.location.pathname.startsWith('/cart') || busy()) return;
      applyWaitingUpdate();
    };
    // Kitchen tablets and floor monitors never change page: apply when idle.
    const idle = setInterval(() => {
      if (!STAFF_PATH.test(window.location.pathname)) return;
      if (Date.now() - lastTouch < STAFF_IDLE_MS || busy()) return;
      applyWaitingUpdate();
    }, 15_000);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pointerdown', touched, { passive: true });
    window.addEventListener('keydown', touched);
    return () => {
      clearInterval(idle);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pointerdown', touched);
      window.removeEventListener('keydown', touched);
    };
  }, []);

  return null;
}
