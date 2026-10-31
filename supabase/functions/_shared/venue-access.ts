/**
 * Which restaurant an admin's request to an Edge Function acts on
 * (docs/two-restaurants.md).
 *
 * The admin functions (create-waiter, delete-waiter, translate-menu,
 * migrate-images) act with the service role, which passes every access rule
 * in the database — so the restaurant they act on is decided here, not there.
 * Pure: each function reads the caller's roles and the restaurants and hands
 * them in; supabase/tests/admin-separation.test.ts pins the decisions.
 *
 *  - The owner (an admin of no one restaurant) names the restaurant: `venue`
 *    in the body, or the x-venue header — a slug or an id. Naming none, or one
 *    that does not exist, is refused: the service role would otherwise act on
 *    La Soul (or both) without anyone having asked for it.
 *  - A restaurant's admin acts on their own restaurant. A restaurant named
 *    that they do not manage is ignored rather than refused: the app sends the
 *    restaurant of the page, which on the other restaurant's site can be the
 *    other one. An account that manages two restaurants without being the
 *    owner must name one of them.
 *  - Anyone else is refused.
 */

export interface RoleRow {
  role: string;
  venue_id: string | null;
}

export interface VenueRow {
  id: string;
  slug: string;
}

export type AdminVenue =
  | { ok: true; venueId: string; slug: string; owner: boolean }
  | { ok: false; status: 400 | 403; error: string };

/** The owner: an admin of no one restaurant. */
export function isOwner(roles: readonly RoleRow[]): boolean {
  return roles.some((r) => r.role === "admin" && r.venue_id === null);
}

/** May these roles manage this restaurant? Its admin, or the owner. */
export function managesVenue(roles: readonly RoleRow[], venueId: string | null | undefined): boolean {
  return isOwner(roles) || (!!venueId && roles.some((r) => r.role === "admin" && r.venue_id === venueId));
}

/** The restaurant a request names, from the body first, then the x-venue header. */
export function namedVenue(body: unknown, req: Request): string | null {
  const fromBody = (body as { venue?: unknown } | null | undefined)?.venue;
  const named = typeof fromBody === "string" && fromBody.trim() ? fromBody : req.headers.get("x-venue");
  return named && named.trim() ? named.trim() : null;
}

/**
 * delete-waiter removes the waiter's role at their restaurant, then asks this:
 * may the sign-in itself go? Only with the last of the account's roles and
 * waiter rows — the same person may wait tables at the other restaurant, or
 * manage one — never when a count could not be read, and never the caller's
 * own account.
 */
export function mayRemoveLogin(left: {
  roles: number | null;
  waiters: number | null;
  userId: string;
  callerId: string;
}): boolean {
  return left.roles === 0 && left.waiters === 0 && left.userId !== left.callerId;
}

export function resolveAdminVenue(
  roles: readonly RoleRow[],
  named: string | null | undefined,
  venues: readonly VenueRow[],
): AdminVenue {
  const adminRows = roles.filter((r) => r.role === "admin");
  if (!adminRows.length) return { ok: false, status: 403, error: "Admin only" };

  const wanted = (named ?? "").trim();
  const asked = wanted ? venues.find((v) => v.slug === wanted || v.id === wanted) : undefined;

  if (isOwner(roles)) {
    if (!wanted) return { ok: false, status: 400, error: "Say which restaurant this is for" };
    if (!asked) return { ok: false, status: 400, error: `Unknown restaurant: ${wanted}` };
    return { ok: true, venueId: asked.id, slug: asked.slug, owner: true };
  }

  const managed = [...new Set(adminRows.map((r) => r.venue_id).filter((v): v is string => !!v))];
  const pick = asked && managed.includes(asked.id) ? asked.id : managed.length === 1 ? managed[0] : null;
  const venue = pick ? venues.find((v) => v.id === pick) : undefined;
  if (!venue) return { ok: false, status: 400, error: "Say which restaurant this is for" };
  return { ok: true, venueId: venue.id, slug: venue.slug, owner: false };
}
