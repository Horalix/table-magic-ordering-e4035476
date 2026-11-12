/**
 * Is this page running inside the Android waiter app (android/README.md)?
 *
 * The app is the waiter screen and nothing else: a waiter signs in, works
 * the shift and signs out. So inside it the screens drop what leads away
 * from the waiter screen — the floor monitor button, the manager's sign-in
 * link — and the sign-in sends a kitchen account back rather than on to the
 * kitchen screen. In a browser everything stays as it was.
 *
 * Chrome tells the page which app opened it: the first page's referrer is
 * "android-app://<package>/". Later pages of the same visit have an ordinary
 * referrer, so the answer is kept for the visit (session storage: the app's
 * own tab, never the browser's other tabs).
 */

/** The two apps' package names (android/app/build.gradle). */
export const WAITER_APP_PACKAGES = ['net.lasoul.waiter', 'net.veraitalia.waiter'];

const KEY = 'waiter-app';

const fromApp = (referrer: string) =>
  WAITER_APP_PACKAGES.some((id) => referrer === `android-app://${id}` || referrer.startsWith(`android-app://${id}/`));

export function inWaiterApp(
  referrer: string = typeof document === 'undefined' ? '' : document.referrer,
  storage: Pick<Storage, 'getItem' | 'setItem'> | null = typeof sessionStorage === 'undefined' ? null : sessionStorage,
): boolean {
  try {
    if (fromApp(referrer)) {
      storage?.setItem(KEY, '1');
      return true;
    }
    return storage?.getItem(KEY) === '1';
  } catch {
    // Storage switched off: the first page still knows, from its referrer.
    return fromApp(referrer);
  }
}
