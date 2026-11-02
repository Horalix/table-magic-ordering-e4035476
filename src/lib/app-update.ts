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
 *  - a version that arrives while the app is still opening, before anyone has
 *    touched it, is taken at once: a guest who has just scanned the table's
 *    code sees the current menu from the first screen, not the previous
 *    release's photos until their first tap;
 *  - otherwise a waiting version is applied on the next page change, or when a guest
 *    returns to the tab (never on the cart, where a card payment may be in
 *    flight), or on a staff screen nobody has touched for a while — never
 *    while someone is typing or has a dialog open.
 *
 * The cart and the table session are persisted, so a reload loses nothing.
 *
 * A page still running an older version of this file may never take a new
 * version (before 1 November 2026 it could miss one), and nothing here can
 * change that page. So a new version's service worker sees to it
 * (public/sw-rescue.js): it asks every open page
 * whether it applies new versions itself, and takes over and reloads any page
 * that does not answer. This one answers. If such a takeover catches this page
 * too, the version it was loaded from is gone, so it reloads at the same safe
 * moments as for a waiting version.
 */

const CHECK_EVERY_MS = 5 * 60_000;
const STAFF_IDLE_MS = 90_000;
const STAFF_PATH = /^\/(admin|kitchen|waiter)(\/|$)/;
/** How long after the page opens a new version still counts as arriving "while it opens". */
const FRESH_START_MS = 15_000;
/** How long a waiting version gets to take over once asked, before the page reloads to let it. */
const TAKEOVER_MS = 2_000;

let updateSW: ((reloadPage?: boolean) => Promise<void>) | null = null;
let checkForUpdate: () => void = () => {};
let waiting = false;
/** A newer version took over this page without being asked: it reloads at the next safe moment. */
let takenOver = false;
/** This page asked the waiting version to take over (and reloads when it has). */
let applying = false;
let started = false;
let touchedSinceLoad = false;
/** A "not found" page is on screen. */
let missingPage = false;

/** Register the service worker and start looking for new versions. Once per page. */
export function startAppUpdates(): void {
  if (started || typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
  started = true;
  const touched = () => { touchedSinceLoad = true; };
  window.addEventListener('pointerdown', touched, { once: true, passive: true });
  window.addEventListener('keydown', touched, { once: true });
  // "Do you take new versions yourself?" (public/sw-rescue.js) — yes.
  navigator.serviceWorker.addEventListener('message', (event: MessageEvent) => {
    if ((event.data as { type?: unknown } | null)?.type === 'APP_UPDATES?') event.ports[0]?.postMessage({ type: 'APP_UPDATES' });
  });
  navigator.serviceWorker.startMessages?.();
  let controller = navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (controller && !applying) {
      takenOver = true;
      newVersionReady();
    }
    controller = navigator.serviceWorker.controller;
  });
  // A part of the app not opened yet belongs to the version that was replaced
  // and is gone: open the new version instead, once.
  window.addEventListener('vite:preloadError', (event) => {
    if (reloadedForMissingPart()) return;
    event.preventDefault();
    window.location.reload();
  });
  updateSW = registerSW({
    immediate: true,
    onNeedRefresh: newVersionReady,
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      // The browser looks for a new version as the page loads, and is often
      // downloading it before the page has registered. workbox-window only
      // announces a download that starts after that, so this one waited for
      // the next visit: the phone showed the old version once more.
      const next = registration.installing ?? registration.waiting;
      if (next && navigator.serviceWorker.controller) {
        if (next.state === 'installed') newVersionReady();
        else next.addEventListener('statechange', () => { if (next.state === 'installed') newVersionReady(); });
      }
      checkForUpdate = () => { if (navigator.onLine) void registration.update().catch(() => { /* next time */ }); };
      setInterval(checkForUpdate, CHECK_EVERY_MS);
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkForUpdate(); });
    },
  });
}

const MISSING_PART_KEY = 'app-update:missing-part';

/** Reloaded for a missing part in the last 30 seconds: reloading again would only loop. */
function reloadedForMissingPart(): boolean {
  try {
    const last = Number(sessionStorage.getItem(MISSING_PART_KEY) ?? 0);
    if (Date.now() - last < 30_000) return true;
    sessionStorage.setItem(MISSING_PART_KEY, String(Date.now()));
  } catch {
    // Storage off: reload anyway; a loop needs the part to be missing twice.
  }
  return false;
}

/** A new version is downloaded and waiting, or has taken over already. */
function newVersionReady(): void {
  if (!takenOver) waiting = true;
  // On "not found", or still opening and untouched: nothing to lose, so take it now.
  const opening = performance.now() < FRESH_START_MS && !touchedSinceLoad;
  if ((missingPage || opening) && !window.location.pathname.startsWith('/cart') && !busy()) {
    applyWaitingUpdate();
  }
}

/**
 * A "not found" page may be one a newer version has. A phone still on the
 * version from before Vera Italia opened answered its menu, and every dish
 * link from Google, "not found" — and "back to the menu" led to the same
 * page. Look for a new version now and take it the moment it is in. Returns
 * the cleanup for when the page goes.
 */
export function lookForMissingPage(): () => void {
  missingPage = true;
  if (!applyWaitingUpdate()) checkForUpdate();
  return () => { missingPage = false; };
}

/** Take the waiting version now: the new worker takes over and the page reloads. */
export function applyWaitingUpdate(): boolean {
  if (takenOver) {
    takenOver = false;
    window.location.reload();
    return true;
  }
  if (!waiting || !updateSW) return false;
  waiting = false;
  applying = true;
  // workbox-window reloads only for a version it announced itself.
  navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), { once: true });
  // Chrome and Edge hold the new version back while the old one is still
  // serving this page the menu data it keeps a copy of (vite.config.ts,
  // menu-data-by-venue) — up to five minutes, after which it takes over and
  // the line above reloaded the page in the middle of whatever the guest was
  // doing by then. Reloading now, at this safe moment, lets the old version
  // go: the new one takes over a moment later, and the reloaded page moves
  // onto it (takenOver).
  setTimeout(() => window.location.reload(), TAKEOVER_MS);
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
