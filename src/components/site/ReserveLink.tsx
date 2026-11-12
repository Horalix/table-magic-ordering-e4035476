import React from 'react';
import { Link } from 'react-router-dom';
import type { Locale } from '@/lib/i18n';
import { rcopy } from '@/lib/reservation-copy';
import { RESERVE_PATH } from '@/lib/seo/reservations';
import { useReservationsOffered } from '@/hooks/useReservationsOffered';

/**
 * "Reserve a table" on a restaurant's website: a link to the booking page
 * that is there only while the restaurant takes requests online (Admin →
 * Reservations). Off, or before the database knows reservations at all,
 * nothing is drawn, so the website never offers what the restaurant does not.
 */
const ReserveLink = ({ venueSlug, locale, className, children }: {
  venueSlug: string; locale: Locale; className?: string; children?: React.ReactNode;
}) => {
  const open = useReservationsOffered(venueSlug);
  if (!open) return null;
  return (
    <Link to={RESERVE_PATH} data-testid="reserve-link" className={className}>
      {children}
      {rcopy('title', locale)}
    </Link>
  );
};

export default ReserveLink;
