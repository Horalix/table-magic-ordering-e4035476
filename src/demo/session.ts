/**
 * Sign-in without passwords (demo mode only).
 *
 * The Supabase client keeps "the session" in one storage slot, so one browser
 * is one person. A demo needs the opposite: the kitchen display, a waiter's
 * phone and the owner's admin open side by side, each as its own account.
 * This storage gives each staff area of the app (src/demo/brand.ts,
 * areaForPath) its own slot, and fills an empty slot with that area's demo
 * account — so opening /kitchen simply is the kitchen tablet, signed in.
 *
 * Signing out is remembered per area: the sign-in page then shows the demo's
 * one-tap buttons (src/demo/ui/DemoLogin.tsx) instead of signing straight
 * back in.
 */
import { ACCOUNTS, areaForPath, type DemoArea } from './brand';
import { sessionPayload } from './backend/auth';

const SIGNED_OUT = 'tableflow-demo.signed-out.';

const currentArea = (): DemoArea | null => (typeof location === 'undefined' ? null : areaForPath(location.pathname));

export function demoSessionFor(area: DemoArea) {
  const account = ACCOUNTS[area];
  return sessionPayload({ id: account.id, email: account.email, created_at: '2026-01-05T09:00:00.000Z', raw_user_meta_data: {} });
}

/** Signs the area's demo account back in after a sign-out. */
export function clearSignedOut(area: DemoArea): void {
  try { localStorage.removeItem(SIGNED_OUT + area); } catch { /* storage off: nothing was remembered */ }
}

export const isSignedOut = (area: DemoArea): boolean => {
  try { return localStorage.getItem(SIGNED_OUT + area) === '1'; } catch { return false; }
};

/** The `auth.storage` the Supabase client is given in demo mode (src/integrations/supabase/client.ts). */
export const demoAuthStorage = {
  getItem(key: string): string | null {
    const area = currentArea();
    if (!area) return null;
    const slot = `${key}:${area}`;
    const stored = localStorage.getItem(slot);
    if (stored || !key.endsWith('-auth-token') || isSignedOut(area)) return stored;
    const session = JSON.stringify(demoSessionFor(area));
    localStorage.setItem(slot, session);
    return session;
  },
  setItem(key: string, value: string): void {
    const area = currentArea();
    if (!area) return;
    localStorage.setItem(`${key}:${area}`, value);
    if (key.endsWith('-auth-token')) clearSignedOut(area);
  },
  removeItem(key: string): void {
    const area = currentArea();
    if (!area) return;
    localStorage.removeItem(`${key}:${area}`);
    if (key.endsWith('-auth-token')) localStorage.setItem(SIGNED_OUT + area, '1');
  },
};
