/**
 * Is this page running inside one of the Android staff apps (android/README.md)?
 *
 * Each app is one screen and nothing else.
 *
 * The waiter app: a waiter signs in, works the shift and signs out. Inside
 * it the screens drop what leads away from the waiter screen — the floor
 * monitor button, the manager's sign-in link — and the sign-in sends a
 * kitchen account back rather than on to the kitchen screen.
 *
 * The kitchen app: the kitchen screen on the kitchen's tablet. Inside it
 * every sign-in goes on to the kitchen screen, and the links to the manager's
 * pages are gone.
 *
 * In a browser everything stays as it was.
 *
 * Chrome tells the page which app opened it: the first page's referrer is
 * "android-app://<package>/". Later pages of the same visit have an ordinary
 * referrer, so the answer is kept for the visit (session storage: the app's
 * own tab, never the browser's other tabs).
 */

/** The apps' package names (android/app/build.gradle). */
export const WAITER_APP_PACKAGES = ['net.lasoul.waiter', 'net.veraitalia.waiter'];
export const KITCHEN_APP_PACKAGES = ['net.lasoul.kitchen', 'net.veraitalia.kitchen'];

type VisitStorage = Pick<Storage, 'getItem' | 'setItem'> | null;

const pageReferrer = () => (typeof document === 'undefined' ? '' : document.referrer);
const visitStorage = (): VisitStorage => (typeof sessionStorage === 'undefined' ? null : sessionStorage);

function openedBy(packages: string[], key: string, referrer: string, storage: VisitStorage): boolean {
  const fromApp = packages.some((id) => referrer === `android-app://${id}` || referrer.startsWith(`android-app://${id}/`));
  try {
    if (fromApp) {
      storage?.setItem(key, '1');
      return true;
    }
    return storage?.getItem(key) === '1';
  } catch {
    // Storage switched off: the first page still knows, from its referrer.
    return fromApp;
  }
}

export function inWaiterApp(referrer: string = pageReferrer(), storage: VisitStorage = visitStorage()): boolean {
  return openedBy(WAITER_APP_PACKAGES, 'waiter-app', referrer, storage);
}

export function inKitchenApp(referrer: string = pageReferrer(), storage: VisitStorage = visitStorage()): boolean {
  return openedBy(KITCHEN_APP_PACKAGES, 'kitchen-app', referrer, storage);
}
