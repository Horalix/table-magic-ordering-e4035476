import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  answeredVenueId, chooseStaffVenue, currentVenueSlug, staffVenue, type StaffRoleRow,
} from '@/lib/current-venue';
import { HOME_VENUE } from '@/lib/home-venue';
import { DEFAULT_VENUE, VENUES, venueByDbId, type Venue } from '@/lib/venues';

export interface StaffVenue {
  /** The restaurant these screens show. */
  venue: Venue;
  /** The owner: an admin of no one restaurant, who picks which one to look at. */
  owner: boolean;
}

type RoleRow = StaffRoleRow;

/**
 * The restaurant the database answers an account's requests for on this
 * page (current_venue()), as a Venue: the one the page names if the account
 * works there, else the first of its roles — admin before staff — the same
 * order the database takes. An account that waits tables at one restaurant
 * and manages the other used to see one restaurant's name over the other's
 * data.
 */
export function venueOfRoles(rows: readonly RoleRow[], askedSlug: string | null): Venue | null {
  const asked = askedSlug ? VENUES[askedSlug]?.dbId ?? null : null;
  return venueByDbId(answeredVenueId(rows, asked, VENUES[DEFAULT_VENUE].dbId));
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
      // Anyone else works where the database already knows; a choice the
      // owner left on this device must not follow them. What this page still
      // names (this site's own restaurant) counts only where they work.
      chooseStaffVenue(null);
      const venue = venueOfRoles(rows, currentVenueSlug()) ?? VENUES[HOME_VENUE];
      // From now on these screens name it: the menus follow the page for
      // everyone (menu_venue(), 20261031100500), so La Soul's staff on Vera
      // Italia's site must not ask for Vera Italia's.
      chooseStaffVenue(venue.slug);
      setState({ owner, venue });
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
