import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Locale } from '@/lib/i18n';
import { rcopy } from '@/lib/reservation-copy';
import { readReservationOptions } from '@/lib/reservations';

/** Asked once per page load and restaurant, however many links the page has. */
const asked = new Map<string, Promise<boolean>>();

function takesReservations(venueSlug: string): Promise<boolean> {
  let answer = asked.get(venueSlug);
  if (!answer) {
    answer = readReservationOptions(venueSlug).then((o) => o.enabled, () => false);
    asked.set(venueSlug, answer);
  }
  return answer;
}

/**
 * "Reserve a table" on a restaurant's website: a link to /reserve that is
 * there only while the restaurant takes requests online (Admin →
 * Reservations). Off, or before the database knows reservations at all,
 * nothing is drawn, so the website never offers what the restaurant does not.
 */
const ReserveLink = ({ venueSlug, locale, className, children }: {
  venueSlug: string; locale: Locale; className?: string; children?: React.ReactNode;
}) => {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void takesReservations(venueSlug).then((yes) => { if (!cancelled) setOpen(yes); });
    return () => { cancelled = true; };
  }, [venueSlug]);
  if (!open) return null;
  return (
    <Link to="/reserve" data-testid="reserve-link" className={className}>
      {children}
      {rcopy('title', locale)}
    </Link>
  );
};

export default ReserveLink;
