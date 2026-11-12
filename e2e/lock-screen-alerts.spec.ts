import { test, expect } from './staff-fixtures';
import type { Page } from '@playwright/test';

/**
 * "Alerts on lock screen" on the waiter phone (src/lib/push-alerts.ts).
 *
 * The browser's push machinery is played by a stand-in (the suite blocks real
 * service workers, and a real push service is no part of a test): the
 * permission prompt, the phone's push subscription and its service worker.
 * What is checked is the app's side — it asks for permission only on a tap,
 * keeps the phone for the waiter's restaurant, forgets it on the way out, and
 * says plainly what to do on an iPhone, a blocked phone or before setup.
 */

const LA_SOUL = 'a5000000-0000-4000-8000-000000000001';
/** A real P-256 public key (RFC 8291's example server key). */
const VAPID = 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8';
const PHONE = 'https://fcm.googleapis.com/fcm/send/this-phone';
const KEYS = { p256dh: `B${'q'.repeat(86)}`, auth: 'a'.repeat(22) };
const IPHONE_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

const json = (body: unknown, status = 200) => ({
  status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body),
});

interface PhoneSetup {
  /** Notification.permission when the page opens. */
  permission?: 'default' | 'granted' | 'denied';
  /** What the waiter answers at the prompt. */
  answer?: 'granted' | 'denied' | 'default';
  /** The phone already has a push subscription. */
  subscribed?: boolean;
  /** Opened from the Home Screen. */
  standalone?: boolean;
}

/** The phone's push machinery, played in the page. */
async function phone(page: Page, setup: PhoneSetup = {}) {
  await page.addInitScript(({ permission, answer, subscribed, standalone, endpoint, keys, vapid }) => {
    type Sub = { endpoint: string; options: { applicationServerKey: ArrayBuffer }; toJSON(): unknown; unsubscribe(): Promise<boolean> };
    const w = window as unknown as { __push: Record<string, unknown> & { sub: Sub | null } };
    const bytes = (b64: string) => Uint8Array.from(atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0));
    const b64url = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const state = { permission, answer, asks: 0, subscribes: [] as unknown[], unsubscribes: 0 };
    const makeSub = (): Sub => ({
      endpoint,
      options: { applicationServerKey: bytes(vapid).buffer },
      toJSON: () => ({ endpoint, expirationTime: null, keys }),
      unsubscribe: async () => { state.unsubscribes += 1; w.__push.sub = null; return true; },
    });
    w.__push = Object.assign(state, { sub: subscribed ? makeSub() : null });

    class FakeNotification {
      static get permission() { return state.permission; }
      static async requestPermission() { state.asks += 1; state.permission = state.answer; return state.answer; }
    }
    Object.defineProperty(window, 'Notification', { value: FakeNotification, configurable: true, writable: true });
    if (!('PushManager' in window)) Object.defineProperty(window, 'PushManager', { value: function PushManager() {}, configurable: true });

    const registration = {
      pushManager: {
        getSubscription: async () => w.__push.sub,
        subscribe: async (opts: { userVisibleOnly: boolean; applicationServerKey: ArrayBuffer }) => {
          state.subscribes.push({ userVisibleOnly: opts.userVisibleOnly, key: b64url(opts.applicationServerKey) });
          w.__push.sub = makeSub();
          return w.__push.sub;
        },
      },
    };
    const container = navigator.serviceWorker;
    if (container) {
      Object.defineProperty(container, 'getRegistration', { value: async () => registration, configurable: true });
      Object.defineProperty(container, 'ready', { get: () => Promise.resolve(registration), configurable: true });
    } else {
      Object.defineProperty(navigator, 'serviceWorker', {
        value: { getRegistration: async () => registration, ready: Promise.resolve(registration), addEventListener() {}, removeEventListener() {} },
        configurable: true,
      });
    }
    const media = window.matchMedia.bind(window);
    window.matchMedia = (query: string) => (query.includes('display-mode: standalone')
      ? { matches: standalone, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false } as MediaQueryList
      : media(query));
  }, {
    permission: setup.permission ?? 'default', answer: setup.answer ?? 'granted', subscribed: setup.subscribed ?? false,
    standalone: setup.standalone ?? true, endpoint: PHONE, keys: KEYS, vapid: VAPID,
  });
}

const pushState = (page: Page) => page.evaluate(() => {
  const { asks, subscribes, unsubscribes, sub } = (window as unknown as { __push: Record<string, unknown> }).__push;
  return { asks, subscribes, unsubscribes, subscribed: !!sub };
});

/** Marko, a La Soul waiter, and the server side of alerts: set up, with what the app sent it. */
async function asMarko(page: Page, { saved = false, configured = true } = {}) {
  const server = { rpc: [] as Record<string, unknown>[], deletes: [] as string[], function: [] as Record<string, unknown>[], saved };
  await page.route('**/rest/v1/waiters**', (route) => route.fulfill(json(
    route.request().url().includes('user_id=eq')
      ? { id: 'waiter-1', user_id: 'staff-user-1', display_name: 'Marko' }
      : [{ id: 'waiter-1', user_id: 'staff-user-1', display_name: 'Marko' }],
  )));
  if (configured) {
    await page.route('**/functions/v1/notify-staff', async (route) => {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } });
      if (route.request().method() === 'GET') return route.fulfill(json({ configured: true, publicKey: VAPID }));
      server.function.push(route.request().postDataJSON());
      return route.fulfill(json({ queued: true, delay_seconds: 10 }, 202));
    });
  }
  await page.route('**/rest/v1/rpc/staff_push_subscribe', (route) => {
    server.rpc.push(route.request().postDataJSON());
    server.saved = true;
    return route.fulfill(json({ subscribed: true, venue_id: LA_SOUL }));
  });
  await page.route('**/rest/v1/staff_push_subscriptions**', (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'DELETE') {
      server.deletes.push(url.searchParams.get('endpoint') ?? '');
      server.saved = false;
      return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
    }
    const mine = server.saved && url.searchParams.get('endpoint') === `eq.${PHONE}` && url.searchParams.get('venue_id') === `eq.${LA_SOUL}`;
    return route.fulfill(json(mine ? [{ id: 'sub-1' }] : []));
  });
  return server;
}

const alertsSwitch = (page: Page) => page.getByRole('switch', { name: 'Alerts on lock screen' });
const card = (page: Page) => page.getByTestId('lock-screen-alerts');
/** The card sits above "Attention needed" (something to do) or below the tables. */
const cardIsOnTop = async (page: Page) => {
  const [a, b] = await Promise.all([card(page).boundingBox(), page.getByText('Attention needed').boundingBox()]);
  return (a?.y ?? 0) < (b?.y ?? 0);
};

test.describe('turning alerts on', () => {
  test('asks for permission only when tapped, then keeps this phone for this restaurant', async ({ page }) => {
    await phone(page);
    const server = await asMarko(page);
    await page.goto('/waiter');
    await expect(alertsSwitch(page)).toBeVisible();
    await expect(alertsSwitch(page)).not.toBeChecked();
    await expect(card(page)).toContainText('even with the phone locked');
    expect(await cardIsOnTop(page)).toBe(true);
    // Opening the screen asks nothing of the phone.
    expect(await pushState(page)).toMatchObject({ asks: 0, subscribes: [] });

    await alertsSwitch(page).click();
    await expect(alertsSwitch(page)).toBeChecked();
    expect(await pushState(page)).toMatchObject({ asks: 1, subscribes: [{ userVisibleOnly: true, key: VAPID }] });
    expect(server.rpc).toEqual([{ _endpoint: PHONE, _keys: KEYS, _venue: LA_SOUL }]);
    await expect(page.getByText('Alerts on lock screen are on')).toBeVisible();
    // Done: it moves out of the way, below the tables.
    await expect.poll(() => cardIsOnTop(page)).toBe(false);
  });

  test('a phone that has them on shows them on, and its opening is noted', async ({ page }) => {
    await phone(page, { permission: 'granted', subscribed: true });
    const server = await asMarko(page, { saved: true });
    await page.goto('/waiter');
    await expect(alertsSwitch(page)).toBeChecked();
    await expect(card(page)).toContainText('even when it is locked');
    await expect.poll(() => server.rpc).toEqual([{ _endpoint: PHONE, _keys: KEYS, _venue: LA_SOUL }]);
    expect(await pushState(page)).toMatchObject({ asks: 0, subscribes: [] });
  });

  test('a subscription this waiter never turned on here shows off, and is not taken over', async ({ page }) => {
    // Another waiter's, on a phone the floor shares: a tap is needed.
    await phone(page, { permission: 'granted', subscribed: true });
    const server = await asMarko(page, { saved: false });
    await page.goto('/waiter');
    await expect(alertsSwitch(page)).not.toBeChecked();
    expect(server.rpc).toEqual([]);
  });

  test('turning them off forgets this phone', async ({ page }) => {
    await phone(page, { permission: 'granted', subscribed: true });
    const server = await asMarko(page, { saved: true });
    await page.goto('/waiter');
    await expect(alertsSwitch(page)).toBeChecked();
    await alertsSwitch(page).click();
    await expect(alertsSwitch(page)).not.toBeChecked();
    expect(server.deletes).toEqual([`eq.${PHONE}`]);
    expect(await pushState(page)).toMatchObject({ unsubscribes: 1, subscribed: false });
  });

  test('a test alert comes in ten seconds, time to lock the phone', async ({ page }) => {
    await phone(page, { permission: 'granted', subscribed: true });
    const server = await asMarko(page, { saved: true });
    await page.goto('/waiter');
    await page.getByRole('button', { name: 'Send a test' }).click();
    await expect(page.getByText('Test alert in 10 seconds — lock the phone now')).toBeVisible();
    expect(server.function).toEqual([{ action: 'test', endpoint: PHONE, delay_seconds: 10 }]);
  });

  test('signing out forgets this phone, so the next waiter on it does not get these alerts', async ({ page }) => {
    await phone(page, { permission: 'granted', subscribed: true });
    const server = await asMarko(page, { saved: true });
    await page.goto('/waiter');
    await expect(alertsSwitch(page)).toBeChecked();
    await page.getByRole('button', { name: 'Sign out' }).click();
    // Sign out asks first (a mistaken tap mid-service would stop the alerts).
    await page.getByRole('alertdialog').getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/waiter\/login/);
    expect(server.deletes).toEqual([`eq.${PHONE}`]);
    expect(await pushState(page)).toMatchObject({ unsubscribes: 1 });
  });

  test('"Not now" moves it below the tables, and it stays there', async ({ page }) => {
    await phone(page);
    await asMarko(page);
    await page.goto('/waiter');
    await expect(alertsSwitch(page)).toBeVisible();
    expect(await cardIsOnTop(page)).toBe(true);
    await page.getByRole('button', { name: 'Not now' }).click();
    await expect.poll(() => cardIsOnTop(page)).toBe(false);
    await page.reload();
    await expect(alertsSwitch(page)).toBeVisible();
    expect(await cardIsOnTop(page)).toBe(false);
    expect(await pushState(page)).toMatchObject({ asks: 0 });
  });
});

test.describe('when it cannot be turned on', () => {
  test('said no at the prompt: says where to allow them, and the switch rests', async ({ page }) => {
    await phone(page, { answer: 'denied' });
    const server = await asMarko(page);
    await page.goto('/waiter');
    await alertsSwitch(page).click();
    await expect(card(page)).toContainText('Notifications are blocked');
    await expect(alertsSwitch(page)).toBeDisabled();
    expect(server.rpc).toEqual([]);
  });

  test('blocked before: no prompt at all', async ({ page }) => {
    await phone(page, { permission: 'denied' });
    await asMarko(page);
    await page.goto('/waiter');
    await expect(card(page)).toContainText('Notifications are blocked');
    await expect(alertsSwitch(page)).toBeDisabled();
    expect(await pushState(page)).toMatchObject({ asks: 0 });
  });

  test('before the restaurant has set it up: says so, at the bottom, and asks nothing', async ({ page }) => {
    await phone(page);
    await asMarko(page, { configured: false });
    await page.goto('/waiter');
    await expect(card(page)).toContainText('Lock-screen alerts are not switched on for La Soul yet.');
    await expect(alertsSwitch(page)).toBeDisabled();
    expect(await cardIsOnTop(page)).toBe(false);
    expect(await pushState(page)).toMatchObject({ asks: 0 });
  });
});

test.describe('on an iPhone in Safari', () => {
  test.use({ userAgent: IPHONE_SAFARI });

  test('says to add the app to the Home Screen first (iOS 16.4 or later), and asks nothing', async ({ page }) => {
    await phone(page, { standalone: false });
    await asMarko(page);
    await page.goto('/waiter');
    await expect(card(page)).toContainText('Add to Home Screen');
    await expect(card(page)).toContainText('iOS 16.4 or later');
    await expect(alertsSwitch(page)).toBeDisabled();
    expect(await cardIsOnTop(page)).toBe(true);
    expect(await pushState(page)).toMatchObject({ asks: 0 });
  });

  test('the app added to the Home Screen from here opens the waiter screen, not the menu', async ({ page }) => {
    await phone(page, { standalone: false });
    await asMarko(page);
    await page.goto('/waiter');
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest-waiter.webmanifest');
    await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute('content', 'Waiter');
    expect(await (await page.request.get('/manifest-waiter.webmanifest')).json())
      .toMatchObject({ start_url: '/waiter', scope: '/', display: 'standalone', short_name: 'Waiter' });
    // A guest page still installs the menu.
    await page.goto('/menu/lasoul/');
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest');
  });

  test('from the Home Screen it turns on like anywhere else', async ({ page }) => {
    await phone(page, { standalone: true });
    const server = await asMarko(page);
    await page.goto('/waiter');
    await alertsSwitch(page).click();
    await expect(alertsSwitch(page)).toBeChecked();
    expect(server.rpc).toHaveLength(1);
  });
});
