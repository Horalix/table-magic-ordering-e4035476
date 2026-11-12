/**
 * The words a reservation is described by, in a module with no imports of
 * its own: the guest's wording (./reservation-copy.ts) is also read by the
 * build, outside the app (src/lib/seo/reservations.ts), and must not bring
 * the database client with it.
 */

/** Where a request stands (public.reservations.status). */
export type ReservationStatus = 'pending' | 'confirmed' | 'declined' | 'cancelled' | 'expired';

/** Why a request was not taken, in the database's words (RESERVATION:<word>), or `unknown`. */
export type Refusal = 'disabled' | 'name' | 'phone' | 'party' | 'time' | 'hours' | 'soon' | 'far' | 'repeat' | 'busy' | 'unknown';
