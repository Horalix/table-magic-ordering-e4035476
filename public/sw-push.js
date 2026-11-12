/*
 * Part of the service worker (vite.config.ts → workbox.importScripts).
 *
 * Lock-screen alerts for waiters. A locked phone, or the app in the
 * background, runs no page JavaScript, but the service worker still wakes for
 * a push: notify-staff sends one the moment a guest at one of the waiter's
 * tables orders, calls or asks for the bill (src/lib/push-alerts.ts), and
 * this shows it with the phone's notification sound and a vibration.
 *
 * And reservation alerts for admins: a guest asked for a table, and the
 * admin who turned on "Alert this phone" is told the same way.
 *
 * A tap opens the screen the alert belongs to (the waiter screen, or Admin →
 * Reservations), or brings an open one to the front.
 *
 * Every push shows a notification: Chrome shows a vaguer one of its own when
 * a push shows none, and Safari takes the subscription away. With the alert's
 * own screen open and in front, the notification is silent, because that
 * screen chimes itself, and the screen is told to load the news at once.
 */
const WAITER = '/waiter';
const RESERVATIONS = '/admin/reservations';

/** Buzz patterns by what happened: a guest waiting buzzes longest. */
const VIBRATE = {
  order: [200, 100, 200],
  held: [200, 100, 200, 100, 200],
  call: [400, 150, 400],
  pay: [400, 150, 400],
  bill: [300, 100, 300, 100, 300],
  reservation: [300, 100, 300, 100, 300],
  test: [200, 100, 200],
};

/** Vera Italia's waiters may use La Soul's site and the other way round: the icon follows the restaurant. */
function iconFor(venue) {
  return /vera/i.test(venue || '') ? '/brand/vera/icon-192.png' : '/icons/icon-192.png';
}

function pathOf(url) {
  try {
    return new URL(url, self.location.origin).pathname.replace(/\/+$/, '');
  } catch {
    return '';
  }
}

/** The screen an alert belongs to: Admin → Reservations for a request for a table, the waiter screen for all else. */
function homeOf(url) {
  return pathOf(url || WAITER) === RESERVATIONS ? RESERVATIONS : WAITER;
}

function isScreen(page, home) {
  return pathOf(page.url) === home;
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
    const home = homeOf(data.url);
    const pages = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const screens = pages.filter((page) => isScreen(page, home));
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
  const asked = (event.notification.data && event.notification.data.url) || WAITER;
  const home = homeOf(asked);
  const target = new URL(asked, self.location.origin).href;
  event.waitUntil((async () => {
    const pages = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const screen = pages.find((page) => isScreen(page, home));
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
