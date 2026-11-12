import { useEffect, useState } from 'react';
import { HOME_VENUE } from '@/lib/home-venue';
import { reservationsOpen } from '@/lib/reservations';

/**
 * Whether this website may say a table can be asked for online: the link to
 * the booking page, the question among the home page's questions, the action
 * in its structured data (src/lib/seo/reservations.ts).
 *
 * False until the database says yes, so nothing is promised that the
 * restaurant does not do. And false for a restaurant shown on another
 * restaurant's site: /reserve/ is the booking page of the restaurant whose
 * site it is.
 */
export function useReservationsOffered(venueSlug: string): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (venueSlug !== HOME_VENUE) { setOpen(false); return; }
    let cancelled = false;
    void reservationsOpen(venueSlug).then((yes) => { if (!cancelled) setOpen(yes); });
    return () => { cancelled = true; };
  }, [venueSlug]);
  return open;
}
