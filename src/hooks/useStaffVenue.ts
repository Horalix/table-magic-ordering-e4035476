import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { chooseStaffVenue, staffVenue } from '@/lib/current-venue';
import { HOME_VENUE } from '@/lib/home-venue';
import { VENUES, venueByDbId, type Venue } from '@/lib/venues';

export interface StaffVenue {
  /** The restaurant these screens show. */
  venue: Venue;
  /** The owner: an admin of no one restaurant, who picks which one to look at. */
  owner: boolean;
}

interface RoleRow {
  role: string;
  /** Absent on a database from before the second restaurant. */
  venue_id?: string | null;
}

/**
 * Which restaurant a signed-in account is looking at (docs/two-restaurants.md):
 * the one they work at, or, for the owner, the one picked in the admin —
 * La Soul until they pick. Null while their roles load.
 */
export function useStaffVenue(userId: string | null): StaffVenue | null {
  const [state, setState] = useState<StaffVenue | null>(null);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void (async () => {
      const { data } = await supabase.from('user_roles').select('*').eq('user_id', userId);
      if (cancelled) return;
      const rows = (data ?? []) as unknown as RoleRow[];
      const owner = rows.some((r) => r.role === 'admin' && 'venue_id' in r && r.venue_id === null);
      if (owner) {
        // Until they pick, the restaurant whose site this is.
        setState({ owner, venue: VENUES[staffVenue() ?? HOME_VENUE] ?? VENUES[HOME_VENUE] });
        return;
      }
      // Anyone else works at one restaurant, which the database already knows;
      // a choice the owner left on this device must not follow them.
      chooseStaffVenue(null);
      const own = rows.map((r) => venueByDbId(r.venue_id)).find(Boolean);
      setState({ owner, venue: own ?? VENUES[HOME_VENUE] });
    })();
    return () => { cancelled = true; };
  }, [userId]);

  return state;
}

/**
 * The owner switches restaurant. Every screen loaded the other restaurant's
 * rows, so the page starts again rather than mixing the two.
 */
export function switchStaffVenue(slug: string): void {
  chooseStaffVenue(slug);
  window.location.reload();
}
