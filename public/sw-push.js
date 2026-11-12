/*
 * Part of the service worker (vite.config.ts → workbox.importScripts).
 *
 * Lock-screen alerts for waiters. A locked phone, or the app in the
 * background, runs no page JavaScript, but the service worker still wakes for
 * a push: notify-staff sends one the moment a guest at one of the waiter's
 * tables orders, calls or asks for the bill (src/lib/push-alerts.ts), and
 * this shows it with the phone's notification sound and a vibration.
 *
 * A tap opens the waiter screen, or brings an open one to the front.
 *
 * Every push shows a notification: Chrome shows a vaguer one of its own when
 * a push shows none, and Safari takes the subscription away. With the waiter
 * screen open and in front, the notification is silent, because the screen
 * chimes itself, and the screen is told to load the news at once.
 */
const WAITER = '/waiter';

/** Buzz patterns by what happened: a guest waiting buzzes longest. */
const VIBRATE = {
  order: [200, 100, 200],
  held: [200, 100, 200, 100, 200],
  call: [400, 150, 400],
  pay: [400, 150, 400],
  bill: [300, 100, 300, 100, 300],
  test: [200, 100, 200],
};

/** Vera Italia's waiters may use La Soul's site and the other way round: the icon follows the restaurant. */
function iconFor(venue) {
  return /vera/i.test(venue || '') ? '/brand/vera/icon-192.png' : '/icons/icon-192.png';
}

function isWaiterScreen(page) {
  try {
    const path = new URL(page.url).pathname.replace(/\/+$/, '');
    return path === WAITER;
  } catch {
    return false;
  }
}

function read(event) {
  if (!event.data) return {};
  try {
    return event.data.json() || {};
  } catch {
    return { body: event.data.text() };
  }
}

self.addEventListener('push', (event) => {
  const data = read(event);
  event.waitUntil((async () => {
    const pages = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const screens = pages.filter(isWaiterScreen);
    screens.forEach((page) => { try { page.postMessage({ type: 'STAFF_PUSH', kind: data.kind || null }); } catch { /* closing */ } });
    const watching = screens.some((page) => page.visibilityState === 'visible');
    const kind = VIBRATE[data.kind] ? data.kind : 'order';
    await self.registration.showNotification(data.title || 'New at your tables', {
      body: data.body || 'Open the waiter screen to see it',
      // One per event; renotify so a second alert with the same tag still rings.
      tag: data.tag || `staff:${Date.now()}`,
      renotify: true,
      icon: iconFor(data.venue),
      vibrate: watching ? undefined : VIBRATE[kind],
      silent: watching,
      timestamp: data.at ? Date.parse(data.at) || Date.now() : Date.now(),
      data: { url: data.url || WAITER },
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || WAITER, self.location.origin).href;
  event.waitUntil((async () => {
    const pages = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const screen = pages.find(isWaiterScreen);
    if (screen) {
      try {
        await screen.focus();
        screen.postMessage({ type: 'STAFF_PUSH', kind: null });
        return;
      } catch {
        // Not allowed to come forward: open a fresh one.
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(target);
  })());
});
