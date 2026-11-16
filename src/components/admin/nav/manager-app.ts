import { useEffect, useState } from 'react';
import { isIos, isStandalone } from '@/lib/push-alerts';

/**
 * The Manager app: the admin, opened from a phone's Home Screen
 * (docs/reservations.md, "The Manager app"). There is no App Store app; this
 * is what makes the Home Screen one behave like an app: knowing it is one,
 * the number on its icon, and the browser's own "Install" where it has one.
 */

/** True when the admin was opened from the Home Screen (or installed), not in a browser tab. */
export function useStandalone(): boolean {
  const [standalone, setStandalone] = useState(() => isStandalone());
  useEffect(() => {
    const query = window.matchMedia?.('(display-mode: standalone)');
    if (!query) return;
    const onChange = () => setStandalone(isStandalone());
    query.addEventListener?.('change', onChange);
    return () => query.removeEventListener?.('change', onChange);
  }, []);
  return standalone;
}

type BadgeNavigator = Navigator & {
  setAppBadge?: (count?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

/**
 * The number on the app's icon: guests waiting for an answer about a table.
 * Only an installed app has an icon to put it on (iPhone also wants
 * notifications allowed); anywhere else this does nothing, quietly.
 */
export function setIconBadge(count: number): void {
  const nav = navigator as BadgeNavigator;
  try {
    if (count > 0) void nav.setAppBadge?.(count)?.catch(() => undefined);
    else void nav.clearAppBadge?.()?.catch(() => undefined);
  } catch {
    // Not supported, or not allowed: the count is still in the app.
  }
}

/** Safari on an iPhone or iPad, in a tab: where "Add to Home Screen" is in the Share menu. */
export function isIosBrowserTab(): boolean {
  return isIos() && !isStandalone();
}

/** Mac, iPhone and iPad say ⌘K; everything else Ctrl K. */
export function searchShortcut(): string {
  const platform = typeof navigator === 'undefined' ? '' : `${navigator.platform} ${navigator.userAgent}`;
  return /Mac|iPhone|iPad|iPod/i.test(platform) ? '⌘K' : 'Ctrl K';
}

/** True inside the frame the Manager app opens the kitchen and floor screens in (ScreenFrame.tsx). */
export function inScreenFrame(): boolean {
  try {
    return window.self !== window.top && window.parent.location.origin === window.location.origin;
  } catch {
    return false;
  }
}

/** What a framed admin page tells the app around it: leave the frame and open this page. */
export const LEAVE_FRAME = 'admin:leave-screen-frame';
