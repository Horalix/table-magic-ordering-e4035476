import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getServiceStatus } from '@/lib/guest-api';
import { currentVenueSlug } from '@/lib/current-venue';

/**
 * Whether the restaurant shows its menu and nothing else (Admin → Service,
 * "Menu only"): no ordering, no calling the waiter, no bill, no checking in at
 * a table. A restaurant goes live on its own address this way before the
 * owner has decided to take orders through the app, and the menu must then
 * not promise any of it — not even "scan the code on your table to order".
 *
 * true or false once known, null while this phone has never been told. The
 * last answer is kept per restaurant, so a returning guest's menu does not
 * show the ordering buttons for a moment and then take them away. The
 * database refuses orders, calls, bills and new tables on its own
 * (20261103120000_menu_only.sql), so a stale answer here can only ever hide
 * or show a button, never let an order through.
 */

const storageKey = (venue: string) => `menu-only:${venue}`;

function remembered(venue: string): boolean | undefined {
  try {
    const value = localStorage.getItem(storageKey(venue));
    return value === null ? undefined : value === '1';
  } catch {
    return undefined;
  }
}

export function useMenuOnly(): boolean | null {
  const venue = currentVenueSlug() ?? '-';
  const { data } = useQuery({
    queryKey: ['service-status', 'menu-only', venue],
    queryFn: async () => (await getServiceStatus()).menu_only === true,
    initialData: () => remembered(venue),
    // What the phone remembers is shown at once and checked straight away.
    initialDataUpdatedAt: 0,
    staleTime: 60_000,
    retry: 1,
  });

  useEffect(() => {
    if (data === undefined) return;
    try { localStorage.setItem(storageKey(venue), data ? '1' : '0'); } catch { /* storage blocked: asked again next time */ }
  }, [data, venue]);

  return data ?? null;
}
