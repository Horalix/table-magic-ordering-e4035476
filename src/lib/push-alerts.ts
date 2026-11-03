import { supabase } from '@/integrations/supabase/client';

/**
 * "Alerts on lock screen" on the waiter phone: Web Push.
 *
 * A locked phone, or the app in the background, runs no JavaScript, so the
 * waiter screen's own chime only sounds once somebody looks. With alerts on,
 * the database calls notify-staff the moment a guest at one of this waiter's
 * tables orders, calls or asks for the bill, and the phone shows a
 * notification with sound and vibration, locked or not (public/sw-push.js).
 *
 * The phone is kept in staff_push_subscriptions (20261103090000_staff_push.sql)
 * per restaurant; a waiter reads and removes only their own rows. Until that
 * migration and the function are live, everything here says "not set up yet"
 * instead of failing: the table and RPC are not in the generated types, so
 * they are reached untyped, as printers-api.ts does.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const untyped = supabase as unknown as { from: (table: string) => any; rpc: (fn: string, args?: Record<string, unknown>) => any };

export type AlertsState =
  /** Not known yet. */
  | 'checking'
  /** iPhone or iPad in a browser tab: Web Push only exists in the Home Screen app. */
  | 'needs-home-screen'
  /** No Web Push here (an old iPhone, a browser without it, no service worker). */
  | 'unsupported'
  /** The server side is not live yet (the function, its keys or the table). */
  | 'not-ready'
  /** Notifications are blocked for this site. */
  | 'blocked'
  | 'off'
  | 'on';

export function isIos(nav: Navigator = navigator): boolean {
  return /iPad|iPhone|iPod/.test(nav.userAgent) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);
}

/** Opened from the Home Screen (or installed), not in a browser tab. */
export function isStandalone(win: Window = window): boolean {
  return win.matchMedia?.('(display-mode: standalone)').matches === true
    || (win.navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** What this browser can do, before anything is asked of it. */
export function pushSupport(win: Window = window): 'ok' | 'needs-home-screen' | 'unsupported' {
  if (isIos(win.navigator) && !isStandalone(win)) return 'needs-home-screen';
  if (!('serviceWorker' in win.navigator) || !('PushManager' in win) || !('Notification' in win)) return 'unsupported';
  return 'ok';
}

function fromB64url(value: string): ArrayBuffer {
  const clean = value.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(clean + '='.repeat((4 - (clean.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

function sameKey(subscription: PushSubscription, key: string): boolean {
  const own = subscription.options?.applicationServerKey;
  if (!own) return true; // Not exposed by this browser: trust it.
  const a = new Uint8Array(own);
  const b = new Uint8Array(fromB64url(key));
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** The app's service worker, registered by app-update.ts; none in development. */
async function registration(): Promise<ServiceWorkerRegistration | null> {
  try {
    const found = await navigator.serviceWorker.getRegistration();
    if (found) return found;
    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000)),
    ]);
  } catch {
    return null;
  }
}

/** The public key phones subscribe with, from notify-staff; null until it is set up. */
async function serverKey(): Promise<string | null> {
  try {
    const { data, error } = await supabase.functions.invoke<{ configured?: boolean; publicKey?: string }>('notify-staff', { method: 'GET' });
    return !error && data?.configured && data.publicKey ? data.publicKey : null;
  } catch {
    return null;
  }
}

/** Everything a tap needs, fetched before the tap: iPhone asks for permission only straight from one. */
export interface AlertsSetup {
  registration: ServiceWorkerRegistration;
  key: string;
}

export interface AlertsReading {
  state: AlertsState;
  setup: AlertsSetup | null;
}

const save = async (subscription: PushSubscription, venueId: string) => {
  const { endpoint, keys } = subscription.toJSON() as { endpoint: string; keys?: { p256dh?: string; auth?: string } };
  const { error } = await untyped.rpc('staff_push_subscribe', {
    _endpoint: endpoint, _keys: { p256dh: keys?.p256dh, auth: keys?.auth }, _venue: venueId,
  });
  if (error) throw new Error(error.message);
};

/**
 * Where this phone stands, for this waiter at this restaurant. A phone that
 * has alerts on is noted as opened again, which keeps its waiter "on shift"
 * for tables nobody has.
 */
export async function readAlerts(venueId: string): Promise<AlertsReading> {
  const support = pushSupport();
  if (support !== 'ok') return { state: support, setup: null };
  const [reg, key] = await Promise.all([registration(), serverKey()]);
  if (!reg?.pushManager) return { state: 'unsupported', setup: null };
  if (!key) return { state: 'not-ready', setup: null };
  const setup = { registration: reg, key };
  if (Notification.permission === 'denied') return { state: 'blocked', setup };

  const subscription = Notification.permission === 'granted' ? await reg.pushManager.getSubscription() : null;
  if (!subscription || !sameKey(subscription, key)) return { state: 'off', setup };
  const { data, error } = await untyped.from('staff_push_subscriptions')
    .select('id').eq('endpoint', subscription.endpoint).eq('venue_id', venueId).maybeSingle();
  if (error) return { state: /PGRST205|42P01|does not exist/.test(`${error.code} ${error.message}`) ? 'not-ready' : 'off', setup };
  if (!data) return { state: 'off', setup };
  save(subscription, venueId).catch(() => undefined);
  return { state: 'on', setup };
}

/**
 * Turn alerts on: ask for permission (only ever from this tap), subscribe and
 * keep the phone. Call it straight from the tap, with the setup read before.
 */
export async function turnOnAlerts(setup: AlertsSetup, venueId: string): Promise<AlertsState> {
  const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'blocked' : 'off';
  const { pushManager } = setup.registration;
  let subscription = await pushManager.getSubscription();
  // Subscribed with keys since replaced: the push services would refuse it.
  if (subscription && !sameKey(subscription, setup.key)) {
    await subscription.unsubscribe();
    subscription = null;
  }
  subscription ??= await pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromB64url(setup.key) });
  await save(subscription, venueId);
  return 'on';
}

/** This phone stops getting alerts, for every restaurant. */
export async function turnOffAlerts(setup: AlertsSetup): Promise<void> {
  const subscription = await setup.registration.pushManager.getSubscription();
  if (!subscription) return;
  const { error } = await untyped.from('staff_push_subscriptions').delete().eq('endpoint', subscription.endpoint);
  if (error && !/PGRST205|42P01/.test(`${error.code}`)) throw new Error(error.message);
  await subscription.unsubscribe();
}

/**
 * Signing out: whoever signs in next on this phone does not get this
 * waiter's alerts. Best effort and quick: signing out never waits on it.
 */
export async function forgetThisPhone(): Promise<void> {
  if (pushSupport() !== 'ok') return;
  const work = (async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    const subscription = await reg?.pushManager?.getSubscription();
    if (!subscription) return;
    await untyped.from('staff_push_subscriptions').delete().eq('endpoint', subscription.endpoint);
    await subscription.unsubscribe();
  })().catch(() => undefined);
  await Promise.race([work, new Promise((resolve) => setTimeout(resolve, 2500))]);
}

/** A test alert to this phone, in `delaySeconds` — time to lock it. */
export async function sendTestAlert(setup: AlertsSetup, delaySeconds: number): Promise<void> {
  const subscription = await setup.registration.pushManager.getSubscription();
  if (!subscription) throw new Error('Alerts are not on for this phone');
  const { error } = await supabase.functions.invoke('notify-staff', {
    body: { action: 'test', endpoint: subscription.endpoint, delay_seconds: delaySeconds },
  });
  if (error) throw new Error(error.message);
}

/** What the service worker tells an open waiter screen when an alert arrives (public/sw-push.js). */
export const STAFF_PUSH_MESSAGE = 'STAFF_PUSH';
