/**
 * @vitest-environment node
 *
 * The service worker's half of lock-screen alerts (public/sw-push.js), run as
 * the browser runs it: a push shows a notification with sound and vibration —
 * silent only while the waiter screen is open in front, which chimes itself —
 * and a tap opens the waiter screen or brings it forward.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const CODE = readFileSync(path.join(__dirname, '..', '..', 'public', 'sw-push.js'), 'utf8');
const ORIGIN = 'https://lasoulapp.netlify.app';

interface Page {
  url: string;
  visibilityState: 'visible' | 'hidden';
  postMessage: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
}

const page = (route: string, visibilityState: Page['visibilityState'] = 'visible'): Page => ({
  url: `${ORIGIN}${route}`, visibilityState, postMessage: vi.fn(), focus: vi.fn(async () => undefined),
});

function worker(pages: Page[]) {
  const listeners: Record<string, (event: unknown) => void> = {};
  const shown: { title: string; options: Record<string, unknown> }[] = [];
  const opened: string[] = [];
  const self = {
    addEventListener: (type: string, fn: (event: unknown) => void) => { listeners[type] = fn; },
    clients: { matchAll: async () => pages, openWindow: async (url: string) => { opened.push(url); } },
    registration: { showNotification: async (title: string, options: Record<string, unknown>) => { shown.push({ title, options }); } },
    location: { origin: ORIGIN },
  };
  vm.runInNewContext(CODE, { self, URL, Date });
  const fire = async (type: string, event: Record<string, unknown>) => {
    let work: Promise<unknown> = Promise.resolve();
    listeners[type]({ ...event, waitUntil: (p: Promise<unknown>) => { work = p; } });
    await work;
  };
  const push = (payload: unknown) => fire('push', {
    data: { json: () => (typeof payload === 'string' ? JSON.parse(payload) : payload), text: () => String(payload) },
  });
  const click = (url = '/waiter') => {
    const notification = { data: { url }, close: vi.fn() };
    return fire('notificationclick', { notification }).then(() => notification);
  };
  return { push, click, shown, opened };
}

const order = {
  kind: 'order', title: 'New order · Table 7', body: '2× Ćevapi · 24.00 KM · La Soul',
  tag: 'orders:o1', url: '/waiter', venue: 'La Soul', at: '2026-11-03T20:00:00.000Z',
};

describe('a push', () => {
  it('on a locked phone: a notification with sound and a buzz', async () => {
    const w = worker([]);
    await w.push(order);
    expect(w.shown).toHaveLength(1);
    expect(w.shown[0].title).toBe('New order · Table 7');
    expect(w.shown[0].options).toMatchObject({
      body: '2× Ćevapi · 24.00 KM · La Soul', tag: 'orders:o1', renotify: true, silent: false,
      vibrate: [200, 100, 200], icon: '/icons/icon-192.png', data: { url: '/waiter' },
      timestamp: Date.parse('2026-11-03T20:00:00.000Z'),
    });
  });

  it('buzzes longest for a guest waiting, and wears the restaurant\'s icon', async () => {
    const w = worker([]);
    await w.push({ ...order, kind: 'call', title: 'Calling you · Table 4', venue: 'Vera Italia' });
    expect(w.shown[0].options).toMatchObject({ vibrate: [400, 150, 400], icon: '/brand/vera/icon-192.png' });
  });

  it('with the waiter screen open in front: silent, and the screen is told to load it now', async () => {
    const screen = page('/waiter');
    const menu = page('/menu/lasoul/');
    const w = worker([screen, menu]);
    await w.push(order);
    expect(w.shown[0].options).toMatchObject({ silent: true, vibrate: undefined });
    expect(screen.postMessage).toHaveBeenCalledWith({ type: 'STAFF_PUSH', kind: 'order' });
    expect(menu.postMessage).not.toHaveBeenCalled();
  });

  it('with the waiter screen open behind something else: loud, and the screen still told', async () => {
    const screen = page('/waiter', 'hidden');
    const w = worker([screen]);
    await w.push(order);
    expect(w.shown[0].options).toMatchObject({ silent: false, vibrate: [200, 100, 200] });
    expect(screen.postMessage).toHaveBeenCalled();
  });

  it('still shows something when the message cannot be read', async () => {
    const w = worker([]);
    await w.push('not json');
    expect(w.shown).toHaveLength(1);
    expect(w.shown[0].title).toBe('New at your tables');
    expect(w.shown[0].options).toMatchObject({ body: 'not json', renotify: true, silent: false });
    expect(String(w.shown[0].options.tag)).toMatch(/^staff:/);
  });
});

describe('a tap on the notification', () => {
  it('brings an open waiter screen forward rather than opening another', async () => {
    const screen = page('/waiter', 'hidden');
    const w = worker([page('/menu/lasoul/'), screen]);
    const notification = await w.click();
    expect(notification.close).toHaveBeenCalled();
    expect(screen.focus).toHaveBeenCalled();
    expect(w.opened).toEqual([]);
  });

  it('opens the waiter screen when none is open', async () => {
    const w = worker([page('/menu/lasoul/'), page('/waiter/monitor')]);
    await w.click();
    expect(w.opened).toEqual([`${ORIGIN}/waiter`]);
  });
});

describe('a request for a table', () => {
  const reservation = {
    kind: 'reservation', title: 'New reservation · Sat 15 Nov, 19:30', body: 'Amina · 4 guests · La Soul',
    tag: 'reservations:r1', url: '/admin/reservations', venue: 'La Soul', at: '2026-11-13T18:00:00.000Z',
  };

  it('rings the admin, and is no business of an open waiter screen', async () => {
    const waiter = page('/waiter');
    const w = worker([waiter]);
    await w.push(reservation);
    expect(w.shown[0].title).toBe('New reservation · Sat 15 Nov, 19:30');
    expect(w.shown[0].options).toMatchObject({
      body: 'Amina · 4 guests · La Soul', silent: false, vibrate: [300, 100, 300, 100, 300],
      tag: 'reservations:r1', data: { url: '/admin/reservations' },
    });
    expect(waiter.postMessage).not.toHaveBeenCalled();
  });

  it('is silent while Admin → Reservations is open in front, which is told to load it', async () => {
    const admin = page('/admin/reservations');
    const w = worker([admin, page('/admin')]);
    await w.push(reservation);
    expect(w.shown[0].options).toMatchObject({ silent: true });
    expect(admin.postMessage).toHaveBeenCalledWith({ type: 'STAFF_PUSH', kind: 'reservation' });
  });

  it('an order is still loud while only the reservations page is open', async () => {
    const admin = page('/admin/reservations');
    const w = worker([admin]);
    await w.push(order);
    expect(w.shown[0].options).toMatchObject({ silent: false });
    expect(admin.postMessage).not.toHaveBeenCalled();
  });

  it('a tap opens Admin → Reservations, not the waiter screen that happens to be open', async () => {
    const waiter = page('/waiter');
    const w = worker([waiter]);
    await w.click('/admin/reservations');
    expect(waiter.focus).not.toHaveBeenCalled();
    expect(w.opened).toEqual([`${ORIGIN}/admin/reservations`]);

    const admin = page('/admin/reservations/', 'hidden');
    const again = worker([waiter, admin]);
    await again.click('/admin/reservations');
    expect(admin.focus).toHaveBeenCalled();
    expect(again.opened).toEqual([]);
  });
});
