/*
 * Part of the service worker (vite.config.ts → workbox.importScripts).
 *
 * A new version normally waits until the open pages take it, at a moment that
 * interrupts nobody (src/lib/app-update.ts). A page from an older version may
 * never do so: before 1 November 2026 the app missed a new version that began
 * downloading while it opened. A phone that had veraitalia.net open before
 * Vera Italia's menu went live then answered every Google result with "Page
 * not found", and "Back to Menu" with the same, for good.
 *
 * So when this version installs, it asks every open page whether it applies
 * new versions itself (APP_UPDATES?). A page that answers is left to choose
 * its moment. A page that does not is one of those old ones: this version
 * takes over at once and reloads that page, which then opens on it.
 */
const ASK = 'APP_UPDATES?';
/** Long enough for a page that is still opening to start listening. */
const WAIT_MS = 5000;

function answers(page) {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(false), WAIT_MS);
    channel.port1.onmessage = () => { clearTimeout(timer); resolve(true); };
    try {
      page.postMessage({ type: ASK }, [channel.port2]);
    } catch {
      clearTimeout(timer);
      resolve(false);
    }
  });
}

/** The open pages that cannot take a new version by themselves. */
async function oldPages() {
  const pages = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const replies = await Promise.all(pages.map(answers));
  return pages.filter((_, i) => !replies[i]);
}

/** Found while installing; asked again if the worker was stopped in between. */
let found = null;

/** Runs once this version is active and answering pages' requests. */
function onceActive(then) {
  const me = self.registration.active;
  if (!me || me.state === 'activated') return then();
  me.addEventListener('statechange', () => { if (me.state === 'activated') then(); });
}

self.addEventListener('install', (event) => {
  found = oldPages();
  event.waitUntil(found.then((old) => (old.length ? self.skipWaiting() : undefined)));
});

self.addEventListener('activate', (event) => {
  const old = found ?? oldPages();
  found = null;
  // A page can only be reloaded by the version that controls it, and only
  // once that version answers requests, which is after this event: waiting
  // for the reload inside it would leave each waiting for the other.
  event.waitUntil(old.then((pages) => (pages.length ? self.clients.claim() : undefined)));
  void old.then((pages) => {
    if (!pages.length) return;
    onceActive(() => pages.forEach((page) => { page.navigate(page.url).catch(() => undefined); }));
  });
});
