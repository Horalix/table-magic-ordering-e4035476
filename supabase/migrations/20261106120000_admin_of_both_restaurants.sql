-- =====================================================================
-- One person can run both restaurants (docs/two-restaurants.md).
--
-- user_roles has been unique on (user_id, role) since the first schema: one
-- admin role per account. So the owner could not make the same person the
-- admin of La Soul and of Vera Italia; the Team page answered "already the
-- admin of La Soul. Revoke that first".
--
-- Nothing else stood in the way. Every access rule asks "an admin of THIS
-- restaurant?" over all of an account's rows (can_admin, can_staff: EXISTS),
-- and the app names the restaurant each request is for (x-venue,
-- current_venue()), which counts only where the account works. A second
-- admin row is all it takes.
--
-- Now an account has one row per role and restaurant, and the owner's row
-- (an admin of no one restaurant, venue_id NULL) stays one per account. A
-- waiter is still placed at one restaurant by create-waiter, as before.
--
-- Nothing is deleted or changed: every row that exists already fits. Safe to
-- run twice.
-- =====================================================================

-- The old rule, by what it covers rather than by name.
DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT con.conname
      FROM pg_constraint con
     WHERE con.conrelid = 'public.user_roles'::regclass
       AND con.contype = 'u'
       AND (SELECT array_agg(att.attname::text ORDER BY att.attname)
              FROM unnest(con.conkey) AS k(attnum)
              JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = k.attnum)
           = ARRAY['role', 'user_id']
  LOOP
    EXECUTE format('ALTER TABLE public.user_roles DROP CONSTRAINT %I', c.conname);
  END LOOP;
END;
$$;

-- One row per account, role and restaurant…
CREATE UNIQUE INDEX IF NOT EXISTS user_roles_one_per_restaurant
  ON public.user_roles (user_id, role, venue_id)
  WHERE venue_id IS NOT NULL;

-- …and one owner's row per account.
CREATE UNIQUE INDEX IF NOT EXISTS user_roles_one_without_restaurant
  ON public.user_roles (user_id, role)
  WHERE venue_id IS NULL;
