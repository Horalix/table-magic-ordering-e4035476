-- =====================================================================
-- Two restaurants, one database — the foundation (docs/two-restaurants.md)
-- =====================================================================
--
-- La Soul's owner opens Vera Italia. Both live in this database, and nothing
-- may cross between them: a guest orders only from the restaurant whose table
-- they scanned, staff see only their own restaurant, each restaurant's admin
-- manages only theirs, and the owner (super admin) manages both.
--
-- This file lays the foundation and changes nothing La Soul can see:
--
--   1. public.venues, with La Soul (every existing row) and Vera Italia.
--   2. user_roles.venue_id: staff and restaurant admins belong to one
--      restaurant; an admin with no restaurant is a super admin, which is what
--      every existing admin becomes.
--   3. venue_id on every restaurant-owned table. Rows that belong to something
--      else inherit it and cannot be given another; nothing may mix two
--      restaurants; a root row never changes restaurant.
--   4. Uniqueness per restaurant: table numbers, order numbers, the daily
--      close, featured dishes, settings (one row per restaurant).
--   5. Access rules on the row's restaurant, and a second check on every
--      signed-in write, whichever function it comes through.
--   6. The five functions the changed uniqueness touches: QR codes, the room
--      code, order numbers, the daily close.
--
-- Everything else keeps reading La Soul's settings row (id = 1) until the
-- functions learn about restaurants in the next phase.

-- ---------------------------------------------------------------------
-- 1. The restaurants
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.venues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]{2,40}$'),
  name text NOT NULL CHECK (btrim(name) <> ''),
  -- Not live: its menu address answers "not found" and it takes no orders.
  is_live boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON public.venues FROM PUBLIC;
GRANT SELECT ON public.venues TO anon, authenticated;
GRANT ALL ON public.venues TO service_role;

ALTER TABLE public.venues ENABLE ROW LEVEL SECURITY;

INSERT INTO public.venues(id, slug, name, is_live) VALUES
  ('a5000000-0000-4000-8000-000000000001', 'lasoul', 'La Soul', true),
  ('a5000000-0000-4000-8000-000000000002', 'veraitalia', 'Vera Italia', false)
ON CONFLICT (id) DO NOTHING;

/** La Soul: the restaurant every row belonged to before there were two. */
CREATE OR REPLACE FUNCTION public.default_venue()
RETURNS uuid
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT 'a5000000-0000-4000-8000-000000000001'::uuid;
$$;

-- ---------------------------------------------------------------------
-- 2. Roles with a restaurant
-- ---------------------------------------------------------------------

ALTER TABLE public.user_roles
  ADD COLUMN IF NOT EXISTS venue_id uuid REFERENCES public.venues(id) ON DELETE CASCADE;

-- Every waiter and kitchen account so far works at La Soul. Every admin so far
-- could see everything, and keeps that as a super admin (no restaurant).
UPDATE public.user_roles SET venue_id = public.default_venue()
 WHERE role = 'staff' AND venue_id IS NULL;

/**
 * Staff always belong to a restaurant. Until the app names one when it creates
 * a waiter, the restaurant is La Soul — the only one with staff.
 */
CREATE OR REPLACE FUNCTION public.default_staff_venue()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.role = 'staff' AND NEW.venue_id IS NULL THEN
    NEW.venue_id := public.default_venue();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS aa_default_staff_venue ON public.user_roles;
CREATE TRIGGER aa_default_staff_venue
  BEFORE INSERT OR UPDATE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.default_staff_venue();

/** The owner: an admin of no particular restaurant, so of every one. */
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
     WHERE user_id = auth.uid() AND role = 'admin'::public.app_role AND venue_id IS NULL
  );
$$;

/** May the signed-in user manage this restaurant? Its admin, or the super admin. */
CREATE OR REPLACE FUNCTION public.can_admin(_venue uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
     WHERE user_id = auth.uid() AND role = 'admin'::public.app_role
       AND (venue_id IS NULL OR venue_id = _venue)
  );
$$;

/** Does the signed-in user work at this restaurant? Its staff, its admin, or the super admin. */
CREATE OR REPLACE FUNCTION public.can_staff(_venue uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
     WHERE user_id = auth.uid()
       AND (venue_id = _venue OR (venue_id IS NULL AND role = 'admin'::public.app_role))
  );
$$;

REVOKE ALL ON FUNCTION public.is_super_admin() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_admin(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_staff(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_admin(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_staff(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "Anyone can view venues" ON public.venues;
CREATE POLICY "Anyone can view venues" ON public.venues
  FOR SELECT USING (true);
DROP POLICY IF EXISTS "Super admins manage venues" ON public.venues;
CREATE POLICY "Super admins manage venues" ON public.venues
  FOR ALL TO authenticated
  USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

-- ---------------------------------------------------------------------
-- 3. A restaurant on every restaurant-owned row
-- ---------------------------------------------------------------------

-- Root rows: created for a restaurant. Until the app names one, La Soul.
ALTER TABLE public.categories          ADD COLUMN IF NOT EXISTS venue_id uuid NOT NULL DEFAULT 'a5000000-0000-4000-8000-000000000001' REFERENCES public.venues(id);
ALTER TABLE public.sections            ADD COLUMN IF NOT EXISTS venue_id uuid NOT NULL DEFAULT 'a5000000-0000-4000-8000-000000000001' REFERENCES public.venues(id);
ALTER TABLE public.tables              ADD COLUMN IF NOT EXISTS venue_id uuid NOT NULL DEFAULT 'a5000000-0000-4000-8000-000000000001' REFERENCES public.venues(id);
ALTER TABLE public.waiters             ADD COLUMN IF NOT EXISTS venue_id uuid NOT NULL DEFAULT 'a5000000-0000-4000-8000-000000000001' REFERENCES public.venues(id);
ALTER TABLE public.printers            ADD COLUMN IF NOT EXISTS venue_id uuid NOT NULL DEFAULT 'a5000000-0000-4000-8000-000000000001' REFERENCES public.venues(id);
ALTER TABLE public.restaurant_settings ADD COLUMN IF NOT EXISTS venue_id uuid NOT NULL DEFAULT 'a5000000-0000-4000-8000-000000000001' REFERENCES public.venues(id);
ALTER TABLE public.shift_closes        ADD COLUMN IF NOT EXISTS venue_id uuid NOT NULL DEFAULT 'a5000000-0000-4000-8000-000000000001' REFERENCES public.venues(id);
ALTER TABLE public.order_code_counters ADD COLUMN IF NOT EXISTS venue_id uuid NOT NULL DEFAULT 'a5000000-0000-4000-8000-000000000001' REFERENCES public.venues(id);
-- Written by functions that will name the restaurant; empty meanwhile.
ALTER TABLE public.audit_log           ADD COLUMN IF NOT EXISTS venue_id uuid REFERENCES public.venues(id);
ALTER TABLE public.analytics_events    ADD COLUMN IF NOT EXISTS venue_id uuid REFERENCES public.venues(id);

-- Rows that belong to something else: the default only fills existing rows,
-- the inheritance trigger below decides for every new or changed one.
ALTER TABLE public.subcategories              ADD COLUMN IF NOT EXISTS venue_id uuid NOT NULL DEFAULT 'a5000000-0000-4000-8000-000000000001' REFERENCES public.venues(id);
ALTER TABLE public.menu_items                 ADD COLUMN IF NOT EXISTS venue_id uuid NOT NULL DEFAULT 'a5000000-0000-4000-8000-000000000001' REFERENCES public.venues(id);
ALTER TABLE public.menu_combo_slots           ADD COLUMN IF NOT EXISTS venue_id uuid NOT NULL DEFAULT 'a5000000-0000-4000-8000-000000000001' REFERENCES public.venues(id);
ALTER TABLE public.menu_combo_options         ADD COLUMN IF NOT EXISTS venue_id uuid NOT NULL DEFAULT 'a5000000-0000-4000-8000-000000000001' REFERENCES public.venues(id);
ALTER TABLE public.menu_item_availability_log ADD COLUMN IF NOT EXISTS venue_id uuid NOT NULL DEFAULT 'a5000000-0000-4000-8000-000000000001' REFERENCES public.venues(id);
ALTER TABLE public.section_assignments        ADD COLUMN IF NOT EXISTS venue_id uuid NOT NULL DEFAULT 'a5000000-0000-4000-8000-000000000001' REFERENCES public.venues(id);
ALTER TABLE public.table_sessions             ADD COLUMN IF NOT EXISTS venue_id uuid NOT NULL DEFAULT 'a5000000-0000-4000-8000-000000000001' REFERENCES public.venues(id);
ALTER TABLE public.orders                     ADD COLUMN IF NOT EXISTS venue_id uuid NOT NULL DEFAULT 'a5000000-0000-4000-8000-000000000001' REFERENCES public.venues(id);
ALTER TABLE public.order_items                ADD COLUMN IF NOT EXISTS venue_id uuid NOT NULL DEFAULT 'a5000000-0000-4000-8000-000000000001' REFERENCES public.venues(id);
ALTER TABLE public.waiter_calls               ADD COLUMN IF NOT EXISTS venue_id uuid NOT NULL DEFAULT 'a5000000-0000-4000-8000-000000000001' REFERENCES public.venues(id);
ALTER TABLE public.bill_requests              ADD COLUMN IF NOT EXISTS venue_id uuid NOT NULL DEFAULT 'a5000000-0000-4000-8000-000000000001' REFERENCES public.venues(id);
ALTER TABLE public.session_join_requests      ADD COLUMN IF NOT EXISTS venue_id uuid NOT NULL DEFAULT 'a5000000-0000-4000-8000-000000000001' REFERENCES public.venues(id);
ALTER TABLE public.ratings                    ADD COLUMN IF NOT EXISTS venue_id uuid NOT NULL DEFAULT 'a5000000-0000-4000-8000-000000000001' REFERENCES public.venues(id);
ALTER TABLE public.server_ratings             ADD COLUMN IF NOT EXISTS venue_id uuid NOT NULL DEFAULT 'a5000000-0000-4000-8000-000000000001' REFERENCES public.venues(id);
ALTER TABLE public.payment_transactions       ADD COLUMN IF NOT EXISTS venue_id uuid NOT NULL DEFAULT 'a5000000-0000-4000-8000-000000000001' REFERENCES public.venues(id);
ALTER TABLE public.order_refunds              ADD COLUMN IF NOT EXISTS venue_id uuid NOT NULL DEFAULT 'a5000000-0000-4000-8000-000000000001' REFERENCES public.venues(id);
ALTER TABLE public.order_ticket_events        ADD COLUMN IF NOT EXISTS venue_id uuid NOT NULL DEFAULT 'a5000000-0000-4000-8000-000000000001' REFERENCES public.venues(id);
-- A provider callback may name no order we know.
ALTER TABLE public.payment_callback_events    ADD COLUMN IF NOT EXISTS venue_id uuid REFERENCES public.venues(id);
UPDATE public.payment_callback_events e SET venue_id = o.venue_id
  FROM public.orders o WHERE o.id = e.order_id AND e.venue_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_orders_venue_created ON public.orders(venue_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_table_sessions_venue_active ON public.table_sessions(venue_id, is_active);
CREATE INDEX IF NOT EXISTS idx_order_items_venue ON public.order_items(venue_id);
CREATE INDEX IF NOT EXISTS idx_menu_items_venue ON public.menu_items(venue_id);
CREATE INDEX IF NOT EXISTS idx_categories_venue ON public.categories(venue_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_user_venue ON public.user_roles(user_id, venue_id);

/**
 * A row that belongs to something else takes that thing's restaurant, and
 * nothing else: TG_ARGV[0] is the parent table, TG_ARGV[1] the column naming
 * the parent row. Runs first (the "aa_" name) so every later trigger and
 * check sees the right restaurant.
 */
CREATE OR REPLACE FUNCTION public.inherit_venue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_parent uuid := (to_jsonb(NEW) ->> TG_ARGV[1])::uuid;
  v_venue uuid;
BEGIN
  IF v_parent IS NULL THEN
    RETURN NEW;
  END IF;
  EXECUTE format('SELECT venue_id FROM public.%I WHERE id = $1', TG_ARGV[0]) INTO v_venue USING v_parent;
  IF v_venue IS NOT NULL THEN
    NEW.venue_id := v_venue;
  END IF;
  RETURN NEW;
END;
$$;

/**
 * Nothing may mix two restaurants: every (column, table) pair in TG_ARGV names
 * a row this one points at, and that row must be of the same restaurant. Runs
 * after the inheritance ("ab_").
 */
CREATE OR REPLACE FUNCTION public.guard_same_venue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  i int := 0;
  v_ref uuid;
  v_venue uuid;
BEGIN
  WHILE i + 1 < TG_NARGS LOOP
    v_ref := (to_jsonb(NEW) ->> TG_ARGV[i])::uuid;
    IF v_ref IS NOT NULL THEN
      EXECUTE format('SELECT venue_id FROM public.%I WHERE id = $1', TG_ARGV[i + 1]) INTO v_venue USING v_ref;
      IF v_venue IS NOT NULL AND v_venue IS DISTINCT FROM NEW.venue_id THEN
        RAISE EXCEPTION 'Not available at this restaurant'
          USING ERRCODE = 'check_violation',
                DETAIL = format('%s.%s belongs to another restaurant', TG_TABLE_NAME, TG_ARGV[i]);
      END IF;
    END IF;
    i := i + 2;
  END LOOP;
  RETURN NEW;
END;
$$;

/** A root row never changes restaurant: its menu, orders and history would not follow. */
CREATE OR REPLACE FUNCTION public.freeze_venue()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.venue_id IS DISTINCT FROM OLD.venue_id THEN
    RAISE EXCEPTION 'A % row cannot move to another restaurant', TG_TABLE_NAME
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

/**
 * The second check on writes: a signed-in user changes a row only if they work
 * at its restaurant — whatever function the write comes through, including
 * those that bypass the access rules. Guests (no sign-in) arrive through
 * functions that check their table's token instead, and scheduled jobs and the
 * service role have no user; neither is checked here. Runs after the
 * inheritance and the mixing check ("ac_"), so it sees the final restaurant.
 */
CREATE OR REPLACE FUNCTION public.guard_venue_access()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()) THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.venue_id IS NOT NULL AND NOT public.can_staff(OLD.venue_id) THEN
    RAISE EXCEPTION 'You do not work at this restaurant' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.venue_id IS NOT NULL AND NOT public.can_staff(NEW.venue_id) THEN
    RAISE EXCEPTION 'You do not work at this restaurant' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

REVOKE ALL ON FUNCTION public.inherit_venue() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_same_venue() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.freeze_venue() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_venue_access() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.default_staff_venue() FROM PUBLIC, anon, authenticated;

-- Inheritance.
DROP TRIGGER IF EXISTS aa_inherit_venue ON public.subcategories;
CREATE TRIGGER aa_inherit_venue BEFORE INSERT OR UPDATE ON public.subcategories
  FOR EACH ROW EXECUTE FUNCTION public.inherit_venue('categories', 'category_id');
DROP TRIGGER IF EXISTS aa_inherit_venue ON public.menu_items;
CREATE TRIGGER aa_inherit_venue BEFORE INSERT OR UPDATE ON public.menu_items
  FOR EACH ROW EXECUTE FUNCTION public.inherit_venue('subcategories', 'subcategory_id');
DROP TRIGGER IF EXISTS aa_inherit_venue ON public.menu_combo_slots;
CREATE TRIGGER aa_inherit_venue BEFORE INSERT OR UPDATE ON public.menu_combo_slots
  FOR EACH ROW EXECUTE FUNCTION public.inherit_venue('menu_items', 'combo_item_id');
DROP TRIGGER IF EXISTS aa_inherit_venue ON public.menu_combo_options;
CREATE TRIGGER aa_inherit_venue BEFORE INSERT OR UPDATE ON public.menu_combo_options
  FOR EACH ROW EXECUTE FUNCTION public.inherit_venue('menu_combo_slots', 'slot_id');
DROP TRIGGER IF EXISTS aa_inherit_venue ON public.menu_item_availability_log;
CREATE TRIGGER aa_inherit_venue BEFORE INSERT OR UPDATE ON public.menu_item_availability_log
  FOR EACH ROW EXECUTE FUNCTION public.inherit_venue('menu_items', 'menu_item_id');
DROP TRIGGER IF EXISTS aa_inherit_venue ON public.section_assignments;
CREATE TRIGGER aa_inherit_venue BEFORE INSERT OR UPDATE ON public.section_assignments
  FOR EACH ROW EXECUTE FUNCTION public.inherit_venue('sections', 'section_id');
DROP TRIGGER IF EXISTS aa_inherit_venue ON public.table_sessions;
CREATE TRIGGER aa_inherit_venue BEFORE INSERT OR UPDATE ON public.table_sessions
  FOR EACH ROW EXECUTE FUNCTION public.inherit_venue('tables', 'table_id');
DROP TRIGGER IF EXISTS aa_inherit_venue ON public.orders;
CREATE TRIGGER aa_inherit_venue BEFORE INSERT OR UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.inherit_venue('table_sessions', 'table_session_id');
DROP TRIGGER IF EXISTS aa_inherit_venue ON public.order_items;
CREATE TRIGGER aa_inherit_venue BEFORE INSERT OR UPDATE ON public.order_items
  FOR EACH ROW EXECUTE FUNCTION public.inherit_venue('orders', 'order_id');
DROP TRIGGER IF EXISTS aa_inherit_venue ON public.waiter_calls;
CREATE TRIGGER aa_inherit_venue BEFORE INSERT OR UPDATE ON public.waiter_calls
  FOR EACH ROW EXECUTE FUNCTION public.inherit_venue('table_sessions', 'table_session_id');
DROP TRIGGER IF EXISTS aa_inherit_venue ON public.bill_requests;
CREATE TRIGGER aa_inherit_venue BEFORE INSERT OR UPDATE ON public.bill_requests
  FOR EACH ROW EXECUTE FUNCTION public.inherit_venue('table_sessions', 'table_session_id');
DROP TRIGGER IF EXISTS aa_inherit_venue ON public.session_join_requests;
CREATE TRIGGER aa_inherit_venue BEFORE INSERT OR UPDATE ON public.session_join_requests
  FOR EACH ROW EXECUTE FUNCTION public.inherit_venue('table_sessions', 'table_session_id');
DROP TRIGGER IF EXISTS aa_inherit_venue ON public.ratings;
CREATE TRIGGER aa_inherit_venue BEFORE INSERT OR UPDATE ON public.ratings
  FOR EACH ROW EXECUTE FUNCTION public.inherit_venue('table_sessions', 'table_session_id');
DROP TRIGGER IF EXISTS aa_inherit_venue ON public.server_ratings;
CREATE TRIGGER aa_inherit_venue BEFORE INSERT OR UPDATE ON public.server_ratings
  FOR EACH ROW EXECUTE FUNCTION public.inherit_venue('table_sessions', 'table_session_id');
DROP TRIGGER IF EXISTS aa_inherit_venue ON public.payment_transactions;
CREATE TRIGGER aa_inherit_venue BEFORE INSERT OR UPDATE ON public.payment_transactions
  FOR EACH ROW EXECUTE FUNCTION public.inherit_venue('orders', 'order_id');
DROP TRIGGER IF EXISTS aa_inherit_venue ON public.order_refunds;
CREATE TRIGGER aa_inherit_venue BEFORE INSERT OR UPDATE ON public.order_refunds
  FOR EACH ROW EXECUTE FUNCTION public.inherit_venue('orders', 'order_id');
DROP TRIGGER IF EXISTS aa_inherit_venue ON public.order_ticket_events;
CREATE TRIGGER aa_inherit_venue BEFORE INSERT OR UPDATE ON public.order_ticket_events
  FOR EACH ROW EXECUTE FUNCTION public.inherit_venue('orders', 'order_id');
DROP TRIGGER IF EXISTS aa_inherit_venue ON public.payment_callback_events;
CREATE TRIGGER aa_inherit_venue BEFORE INSERT OR UPDATE ON public.payment_callback_events
  FOR EACH ROW EXECUTE FUNCTION public.inherit_venue('orders', 'order_id');

-- Nothing mixes two restaurants.
DROP TRIGGER IF EXISTS ab_same_venue ON public.order_items;
CREATE TRIGGER ab_same_venue BEFORE INSERT OR UPDATE ON public.order_items
  FOR EACH ROW EXECUTE FUNCTION public.guard_same_venue('menu_item_id', 'menu_items');
DROP TRIGGER IF EXISTS ab_same_venue ON public.menu_combo_options;
CREATE TRIGGER ab_same_venue BEFORE INSERT OR UPDATE ON public.menu_combo_options
  FOR EACH ROW EXECUTE FUNCTION public.guard_same_venue('item_id', 'menu_items');
DROP TRIGGER IF EXISTS ab_same_venue ON public.tables;
CREATE TRIGGER ab_same_venue BEFORE INSERT OR UPDATE ON public.tables
  FOR EACH ROW EXECUTE FUNCTION public.guard_same_venue('section_id', 'sections');
DROP TRIGGER IF EXISTS ab_same_venue ON public.section_assignments;
CREATE TRIGGER ab_same_venue BEFORE INSERT OR UPDATE ON public.section_assignments
  FOR EACH ROW EXECUTE FUNCTION public.guard_same_venue('waiter_id', 'waiters');
DROP TRIGGER IF EXISTS ab_same_venue ON public.table_sessions;
CREATE TRIGGER ab_same_venue BEFORE INSERT OR UPDATE ON public.table_sessions
  FOR EACH ROW EXECUTE FUNCTION public.guard_same_venue('assigned_waiter_id', 'waiters');
DROP TRIGGER IF EXISTS ab_same_venue ON public.orders;
CREATE TRIGGER ab_same_venue BEFORE INSERT OR UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.guard_same_venue('assigned_waiter_id', 'waiters');
DROP TRIGGER IF EXISTS ab_same_venue ON public.server_ratings;
CREATE TRIGGER ab_same_venue BEFORE INSERT OR UPDATE ON public.server_ratings
  FOR EACH ROW EXECUTE FUNCTION public.guard_same_venue('waiter_id', 'waiters');

-- Root rows stay in their restaurant.
DROP TRIGGER IF EXISTS aa_freeze_venue ON public.categories;
CREATE TRIGGER aa_freeze_venue BEFORE UPDATE OF venue_id ON public.categories FOR EACH ROW EXECUTE FUNCTION public.freeze_venue();
DROP TRIGGER IF EXISTS aa_freeze_venue ON public.sections;
CREATE TRIGGER aa_freeze_venue BEFORE UPDATE OF venue_id ON public.sections FOR EACH ROW EXECUTE FUNCTION public.freeze_venue();
DROP TRIGGER IF EXISTS aa_freeze_venue ON public.tables;
CREATE TRIGGER aa_freeze_venue BEFORE UPDATE OF venue_id ON public.tables FOR EACH ROW EXECUTE FUNCTION public.freeze_venue();
DROP TRIGGER IF EXISTS aa_freeze_venue ON public.waiters;
CREATE TRIGGER aa_freeze_venue BEFORE UPDATE OF venue_id ON public.waiters FOR EACH ROW EXECUTE FUNCTION public.freeze_venue();
DROP TRIGGER IF EXISTS aa_freeze_venue ON public.printers;
CREATE TRIGGER aa_freeze_venue BEFORE UPDATE OF venue_id ON public.printers FOR EACH ROW EXECUTE FUNCTION public.freeze_venue();
DROP TRIGGER IF EXISTS aa_freeze_venue ON public.restaurant_settings;
CREATE TRIGGER aa_freeze_venue BEFORE UPDATE OF venue_id ON public.restaurant_settings FOR EACH ROW EXECUTE FUNCTION public.freeze_venue();
DROP TRIGGER IF EXISTS aa_freeze_venue ON public.shift_closes;
CREATE TRIGGER aa_freeze_venue BEFORE UPDATE OF venue_id ON public.shift_closes FOR EACH ROW EXECUTE FUNCTION public.freeze_venue();

-- The second check on every signed-in write.
DO $guard$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'categories', 'subcategories', 'menu_items', 'menu_combo_slots', 'menu_combo_options',
    'menu_item_availability_log', 'sections', 'tables', 'section_assignments', 'waiters', 'printers',
    'restaurant_settings', 'shift_closes', 'table_sessions', 'orders', 'order_items', 'waiter_calls',
    'bill_requests', 'session_join_requests', 'ratings', 'server_ratings', 'payment_transactions',
    'order_refunds', 'order_ticket_events', 'payment_callback_events'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS ac_venue_access ON public.%I', t);
    EXECUTE format(
      'CREATE TRIGGER ac_venue_access BEFORE INSERT OR UPDATE OR DELETE ON public.%I '
      'FOR EACH ROW EXECUTE FUNCTION public.guard_venue_access()', t);
  END LOOP;
END
$guard$;

-- ---------------------------------------------------------------------
-- 4. Unique per restaurant
-- ---------------------------------------------------------------------

-- Table numbers, the daily close, order numbers and featured dishes were
-- unique over the whole database; they become unique within a restaurant.
DO $uniq$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.relname::text AS tbl, i.relname::text AS idx, con.conname::text AS con
      FROM pg_index ix
      JOIN pg_class c ON c.oid = ix.indrelid
      JOIN pg_class i ON i.oid = ix.indexrelid
      LEFT JOIN pg_constraint con ON con.conindid = ix.indexrelid AND con.contype IN ('u', 'p')
     WHERE c.relnamespace = 'public'::regnamespace
       AND ix.indisunique
       AND (c.relname::text, (SELECT array_agg(a.attname::text ORDER BY a.attname)
                                FROM unnest(ix.indkey) k
                                JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k))
           IN (('tables', ARRAY['table_number']), ('shift_closes', ARRAY['day']),
               ('order_code_counters', ARRAY['day']), ('menu_items', ARRAY['featured_rank']))
  LOOP
    IF r.con IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', r.tbl, r.con);
    ELSE
      EXECUTE format('DROP INDEX public.%I', r.idx);
    END IF;
  END LOOP;
END
$uniq$;

-- The old names, so anything that recognises the error by its name still does.
CREATE UNIQUE INDEX IF NOT EXISTS tables_table_number_key ON public.tables(venue_id, table_number);
CREATE UNIQUE INDEX IF NOT EXISTS shift_closes_day_key ON public.shift_closes(venue_id, day);
CREATE UNIQUE INDEX IF NOT EXISTS menu_items_featured_rank_key
  ON public.menu_items(venue_id, featured_rank) WHERE featured_rank IS NOT NULL;
DO $pk$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.order_code_counters'::regclass AND contype = 'p') THEN
    ALTER TABLE public.order_code_counters ADD CONSTRAINT order_code_counters_pkey PRIMARY KEY (venue_id, day);
  END IF;
END
$pk$;

-- Settings: one row per restaurant instead of the single row id = 1. La Soul
-- keeps id 1, so everything still reading "id = 1" reads La Soul's.
DO $settings$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT con.conname::text AS con
      FROM pg_constraint con
     WHERE con.conrelid = 'public.restaurant_settings'::regclass
       AND con.contype = 'c'
       AND pg_get_constraintdef(con.oid) ~ '\(id = 1\)'
  LOOP
    EXECUTE format('ALTER TABLE public.restaurant_settings DROP CONSTRAINT %I', r.con);
  END LOOP;
END
$settings$;

CREATE UNIQUE INDEX IF NOT EXISTS restaurant_settings_venue_key ON public.restaurant_settings(venue_id);

-- Vera Italia's settings: the defaults, its own room code (the column default
-- makes a fresh one).
INSERT INTO public.restaurant_settings(id, venue_id)
SELECT 2, 'a5000000-0000-4000-8000-000000000002'
 WHERE NOT EXISTS (SELECT 1 FROM public.restaurant_settings WHERE venue_id = 'a5000000-0000-4000-8000-000000000002');

-- ---------------------------------------------------------------------
-- 5. Access rules on the row's restaurant
-- ---------------------------------------------------------------------
-- Same rules, same names; "staff" and "admin" now mean "of this row's
-- restaurant" (the super admin passes for both). Public reads of menus stay
-- public: anyone may read either restaurant's menu.

DROP POLICY IF EXISTS "Admins can delete categories" ON public.categories;
CREATE POLICY "Admins can delete categories" ON public.categories FOR DELETE TO authenticated USING (public.can_admin(venue_id));
DROP POLICY IF EXISTS "Admins can insert categories" ON public.categories;
CREATE POLICY "Admins can insert categories" ON public.categories FOR INSERT TO authenticated WITH CHECK (public.can_admin(venue_id));
DROP POLICY IF EXISTS "Admins can update categories" ON public.categories;
CREATE POLICY "Admins can update categories" ON public.categories FOR UPDATE TO authenticated USING (public.can_admin(venue_id)) WITH CHECK (public.can_admin(venue_id));

DROP POLICY IF EXISTS "Admins can delete subcategories" ON public.subcategories;
CREATE POLICY "Admins can delete subcategories" ON public.subcategories FOR DELETE TO authenticated USING (public.can_admin(venue_id));
DROP POLICY IF EXISTS "Admins can insert subcategories" ON public.subcategories;
CREATE POLICY "Admins can insert subcategories" ON public.subcategories FOR INSERT TO authenticated WITH CHECK (public.can_admin(venue_id));
DROP POLICY IF EXISTS "Admins can update subcategories" ON public.subcategories;
CREATE POLICY "Admins can update subcategories" ON public.subcategories FOR UPDATE TO authenticated USING (public.can_admin(venue_id)) WITH CHECK (public.can_admin(venue_id));

DROP POLICY IF EXISTS "Admins can delete menu items" ON public.menu_items;
CREATE POLICY "Admins can delete menu items" ON public.menu_items FOR DELETE TO authenticated USING (public.can_admin(venue_id));
DROP POLICY IF EXISTS "Admins can insert menu items" ON public.menu_items;
CREATE POLICY "Admins can insert menu items" ON public.menu_items FOR INSERT TO authenticated WITH CHECK (public.can_admin(venue_id));
DROP POLICY IF EXISTS "Admins can update menu items" ON public.menu_items;
CREATE POLICY "Admins can update menu items" ON public.menu_items FOR UPDATE TO authenticated USING (public.can_admin(venue_id)) WITH CHECK (public.can_admin(venue_id));

DROP POLICY IF EXISTS "Admins manage combo options" ON public.menu_combo_options;
CREATE POLICY "Admins manage combo options" ON public.menu_combo_options FOR ALL TO authenticated USING (public.can_admin(venue_id)) WITH CHECK (public.can_admin(venue_id));
DROP POLICY IF EXISTS "Admins manage combo slots" ON public.menu_combo_slots;
CREATE POLICY "Admins manage combo slots" ON public.menu_combo_slots FOR ALL TO authenticated USING (public.can_admin(venue_id)) WITH CHECK (public.can_admin(venue_id));

DROP POLICY IF EXISTS "Staff read availability history" ON public.menu_item_availability_log;
CREATE POLICY "Staff read availability history" ON public.menu_item_availability_log FOR SELECT TO authenticated USING (public.can_staff(venue_id));

DROP POLICY IF EXISTS "Admins manage sections" ON public.sections;
CREATE POLICY "Admins manage sections" ON public.sections FOR ALL TO authenticated USING (public.can_admin(venue_id)) WITH CHECK (public.can_admin(venue_id));

DROP POLICY IF EXISTS "Staff can manage tables" ON public.tables;
CREATE POLICY "Staff can manage tables" ON public.tables FOR ALL TO authenticated USING (public.can_staff(venue_id)) WITH CHECK (public.can_staff(venue_id));

DROP POLICY IF EXISTS "Admins can manage section assignments" ON public.section_assignments;
CREATE POLICY "Admins can manage section assignments" ON public.section_assignments FOR ALL TO authenticated USING (public.can_admin(venue_id)) WITH CHECK (public.can_admin(venue_id));
DROP POLICY IF EXISTS "Staff can view section assignments" ON public.section_assignments;
CREATE POLICY "Staff can view section assignments" ON public.section_assignments FOR SELECT TO authenticated USING (public.can_staff(venue_id));

DROP POLICY IF EXISTS "Admins can manage waiters" ON public.waiters;
CREATE POLICY "Admins can manage waiters" ON public.waiters FOR ALL TO authenticated USING (public.can_admin(venue_id)) WITH CHECK (public.can_admin(venue_id));
DROP POLICY IF EXISTS "Staff can view waiters" ON public.waiters;
CREATE POLICY "Staff can view waiters" ON public.waiters FOR SELECT TO authenticated USING (public.can_staff(venue_id));

DROP POLICY IF EXISTS "Admins manage printers" ON public.printers;
CREATE POLICY "Admins manage printers" ON public.printers FOR ALL TO authenticated USING (public.can_admin(venue_id)) WITH CHECK (public.can_admin(venue_id));

DROP POLICY IF EXISTS "Admins manage settings" ON public.restaurant_settings;
CREATE POLICY "Admins manage settings" ON public.restaurant_settings FOR ALL TO authenticated USING (public.can_admin(venue_id)) WITH CHECK (public.can_admin(venue_id));
DROP POLICY IF EXISTS "Staff can view settings" ON public.restaurant_settings;
CREATE POLICY "Staff can view settings" ON public.restaurant_settings FOR SELECT TO authenticated USING (public.can_staff(venue_id));

DROP POLICY IF EXISTS "Staff read shift closes" ON public.shift_closes;
CREATE POLICY "Staff read shift closes" ON public.shift_closes FOR SELECT TO authenticated USING (public.can_staff(venue_id));

DROP POLICY IF EXISTS "Staff can manage table sessions" ON public.table_sessions;
CREATE POLICY "Staff can manage table sessions" ON public.table_sessions FOR ALL TO authenticated USING (public.can_staff(venue_id)) WITH CHECK (public.can_staff(venue_id));
DROP POLICY IF EXISTS "Staff can manage orders" ON public.orders;
CREATE POLICY "Staff can manage orders" ON public.orders FOR ALL TO authenticated USING (public.can_staff(venue_id)) WITH CHECK (public.can_staff(venue_id));
DROP POLICY IF EXISTS "Staff can manage order items" ON public.order_items;
CREATE POLICY "Staff can manage order items" ON public.order_items FOR ALL TO authenticated USING (public.can_staff(venue_id)) WITH CHECK (public.can_staff(venue_id));
DROP POLICY IF EXISTS "Staff can manage waiter calls" ON public.waiter_calls;
CREATE POLICY "Staff can manage waiter calls" ON public.waiter_calls FOR ALL TO authenticated USING (public.can_staff(venue_id)) WITH CHECK (public.can_staff(venue_id));
DROP POLICY IF EXISTS "Staff can manage bill requests" ON public.bill_requests;
CREATE POLICY "Staff can manage bill requests" ON public.bill_requests FOR ALL TO authenticated USING (public.can_staff(venue_id)) WITH CHECK (public.can_staff(venue_id));
DROP POLICY IF EXISTS "Staff can manage join requests" ON public.session_join_requests;
CREATE POLICY "Staff can manage join requests" ON public.session_join_requests FOR ALL TO authenticated USING (public.can_staff(venue_id)) WITH CHECK (public.can_staff(venue_id));
DROP POLICY IF EXISTS "Staff can manage ticket events" ON public.order_ticket_events;
CREATE POLICY "Staff can manage ticket events" ON public.order_ticket_events FOR ALL TO authenticated USING (public.can_staff(venue_id)) WITH CHECK (public.can_staff(venue_id));

DROP POLICY IF EXISTS "Staff can view ratings" ON public.ratings;
CREATE POLICY "Staff can view ratings" ON public.ratings FOR SELECT TO authenticated USING (public.can_staff(venue_id));
DROP POLICY IF EXISTS "Staff can view server ratings" ON public.server_ratings;
CREATE POLICY "Staff can view server ratings" ON public.server_ratings FOR SELECT TO authenticated USING (public.can_staff(venue_id));

DROP POLICY IF EXISTS "Admins can manage payment transactions" ON public.payment_transactions;
CREATE POLICY "Admins can manage payment transactions" ON public.payment_transactions FOR ALL TO authenticated USING (public.can_admin(venue_id)) WITH CHECK (public.can_admin(venue_id));
DROP POLICY IF EXISTS "Admins manage refunds" ON public.order_refunds;
CREATE POLICY "Admins manage refunds" ON public.order_refunds FOR SELECT TO authenticated USING (public.can_admin(venue_id));
DROP POLICY IF EXISTS "Admins read callback events" ON public.payment_callback_events;
CREATE POLICY "Admins read callback events" ON public.payment_callback_events FOR SELECT TO authenticated
  USING (public.is_super_admin() OR (venue_id IS NOT NULL AND public.can_admin(venue_id)));

DROP POLICY IF EXISTS "Admins read audit log" ON public.audit_log;
CREATE POLICY "Admins read audit log" ON public.audit_log FOR SELECT TO authenticated
  USING (public.is_super_admin() OR (venue_id IS NOT NULL AND public.can_admin(venue_id)));

-- Roles: the super admin manages everyone's; a restaurant's admin manages
-- their own restaurant's, and can never make a super admin.
DROP POLICY IF EXISTS "Admins can manage roles" ON public.user_roles;
CREATE POLICY "Admins can manage roles" ON public.user_roles FOR ALL TO authenticated
  USING (public.is_super_admin() OR (venue_id IS NOT NULL AND public.can_admin(venue_id)))
  WITH CHECK (public.is_super_admin() OR (venue_id IS NOT NULL AND public.can_admin(venue_id)));
DROP POLICY IF EXISTS "Admins can view roles" ON public.user_roles;
CREATE POLICY "Admins can view roles" ON public.user_roles FOR SELECT TO authenticated
  USING (public.is_super_admin() OR (venue_id IS NOT NULL AND public.can_admin(venue_id)));
-- Everyone may see their own roles: the app needs to know where they work.
DROP POLICY IF EXISTS "Users read their own roles" ON public.user_roles;
CREATE POLICY "Users read their own roles" ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- 6. The functions the changed uniqueness touches
-- ---------------------------------------------------------------------

/**
 * A QR code names its table. A table's own sticker carries the table's token;
 * a room code carries its restaurant's, and the guest says the table. With two
 * restaurants a table number alone names two tables, so the token decides.
 */
CREATE OR REPLACE FUNCTION public.resolve_table_for_token(_table_number integer, _token text)
RETURNS public.tables
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_table public.tables;
BEGIN
  IF _token IS NULL OR btrim(_token) = '' THEN
    RETURN NULL;
  END IF;

  -- Per-table sticker.
  SELECT * INTO v_table FROM public.tables
   WHERE table_number = _table_number AND qr_token = _token;
  IF FOUND THEN
    RETURN v_table;
  END IF;

  -- Room code: it names the restaurant; the table number is what the guest told us.
  SELECT t.* INTO v_table
    FROM public.restaurant_settings s
    JOIN public.tables t ON t.venue_id = s.venue_id AND t.table_number = _table_number
   WHERE s.venue_qr_token = _token;
  IF FOUND THEN
    RETURN v_table;
  END IF;

  RETURN NULL;
END;
$$;

/**
 * The room code, checked before the guest types a table: valid or not, its
 * restaurant's ordering state, and the highest table number there.
 */
CREATE OR REPLACE FUNCTION public.guest_check_venue_token(_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_settings public.restaurant_settings;
  v_valid boolean := true;
BEGIN
  SELECT * INTO v_settings FROM public.restaurant_settings
   WHERE _token IS NOT NULL AND venue_qr_token = _token;
  IF NOT FOUND THEN
    v_valid := false;
    SELECT * INTO v_settings FROM public.restaurant_settings WHERE venue_id = public.default_venue();
  END IF;

  RETURN jsonb_build_object(
    'valid', v_valid,
    'venue', (SELECT slug FROM public.venues WHERE id = v_settings.venue_id),
    'ordering_enabled', COALESCE(v_settings.ordering_enabled, true),
    'paused_message', v_settings.ordering_paused_message,
    -- So the entry screen can reject "table 97" before a round trip.
    'max_table_number', (SELECT max(table_number) FROM public.tables WHERE venue_id = v_settings.venue_id)
  );
END;
$$;

-- Order numbers count per restaurant: both start at #001 each day.
DROP FUNCTION IF EXISTS public.next_order_code();
CREATE OR REPLACE FUNCTION public.next_order_code(_venue uuid DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_value int;
BEGIN
  INSERT INTO public.order_code_counters(venue_id, day, last_value)
  VALUES (COALESCE(_venue, public.default_venue()), CURRENT_DATE, 1)
  ON CONFLICT (venue_id, day) DO UPDATE SET last_value = public.order_code_counters.last_value + 1
  RETURNING last_value INTO v_value;

  RETURN lpad(((v_value - 1) % 999 + 1)::text, 3, '0');
END;
$$;

REVOKE ALL ON FUNCTION public.next_order_code(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.next_order_code(uuid) TO service_role;

-- The daily close: one per restaurant per day, by that restaurant's admin.
DROP FUNCTION IF EXISTS public.close_shift(date, numeric, numeric, text, text, boolean);
CREATE OR REPLACE FUNCTION public.close_shift(
  _day date DEFAULT NULL,
  _counted_cash numeric DEFAULT NULL,
  _counted_terminal numeric DEFAULT NULL,
  _terminal_batch_reference text DEFAULT NULL,
  _notes text DEFAULT NULL,
  _acknowledge_issues boolean DEFAULT false,
  _venue uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_venue uuid := COALESCE(_venue, public.default_venue());
  v_day date := COALESCE(_day, public.business_day());
  v_snapshot jsonb;
  v_id uuid;
  v_cash numeric;
  v_terminal numeric;
  v_online numeric;
BEGIN
  -- Closing the day is a manager's act — that restaurant's manager. A waiter
  -- with a phone must not be able to sign off the drawer.
  IF NOT public.can_admin(v_venue) THEN
    RAISE EXCEPTION 'Only a manager can close the day' USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_snapshot := public.day_reconciliation(v_day);

  v_cash := COALESCE((v_snapshot ->> 'paid_cash')::numeric, 0);
  v_terminal := COALESCE((v_snapshot ->> 'paid_pos_terminal')::numeric, 0);
  v_online := COALESCE((v_snapshot ->> 'paid_online')::numeric, 0);

  INSERT INTO public.shift_closes(
    venue_id, day, closed_by, expected_cash, expected_terminal, expected_online,
    counted_cash, counted_terminal, terminal_batch_reference, notes,
    acknowledged_issues, snapshot
  )
  VALUES (
    v_venue, v_day, auth.uid(), v_cash, v_terminal, v_online,
    _counted_cash, _counted_terminal, nullif(btrim(coalesce(_terminal_batch_reference, '')), ''),
    nullif(btrim(coalesce(_notes, '')), ''), COALESCE(_acknowledge_issues, false), v_snapshot
  )
  ON CONFLICT (venue_id, day) DO UPDATE SET
    closed_by = EXCLUDED.closed_by,
    closed_at = now(),
    expected_cash = EXCLUDED.expected_cash,
    expected_terminal = EXCLUDED.expected_terminal,
    expected_online = EXCLUDED.expected_online,
    counted_cash = EXCLUDED.counted_cash,
    counted_terminal = EXCLUDED.counted_terminal,
    terminal_batch_reference = EXCLUDED.terminal_batch_reference,
    notes = EXCLUDED.notes,
    acknowledged_issues = EXCLUDED.acknowledged_issues,
    snapshot = EXCLUDED.snapshot
  RETURNING id INTO v_id;

  PERFORM public.write_audit('shift.closed', 'shift', v_id, NULL,
    jsonb_build_object(
      'venue_id', v_venue,
      'day', v_day,
      'expected_cash', v_cash,
      'counted_cash', _counted_cash,
      'cash_difference', COALESCE(_counted_cash, 0) - v_cash,
      'expected_terminal', v_terminal,
      'counted_terminal', _counted_terminal,
      'acknowledged_issues', COALESCE(_acknowledge_issues, false)
    ), _notes);

  RETURN jsonb_build_object(
    'id', v_id,
    'day', v_day,
    'expected_cash', v_cash,
    'expected_terminal', v_terminal,
    'expected_online', v_online,
    -- Reported, never corrected. If the drawer is short, that is the finding.
    'cash_difference', CASE WHEN _counted_cash IS NULL THEN NULL ELSE _counted_cash - v_cash END,
    'terminal_difference', CASE WHEN _counted_terminal IS NULL THEN NULL ELSE _counted_terminal - v_terminal END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.close_shift(date, numeric, numeric, text, text, boolean, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_shift(date, numeric, numeric, text, text, boolean, uuid) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.shift_close_for(date);
CREATE OR REPLACE FUNCTION public.shift_close_for(_day date DEFAULT NULL, _venue uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_venue uuid := COALESCE(_venue, public.default_venue());
  v_day date := COALESCE(_day, public.business_day());
  v_row public.shift_closes;
BEGIN
  IF NOT public.can_staff(v_venue) THEN
    RAISE EXCEPTION 'Only staff can read a shift close' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_row FROM public.shift_closes WHERE venue_id = v_venue AND day = v_day;
  IF NOT FOUND THEN RETURN NULL; END IF;

  RETURN jsonb_build_object(
    'id', v_row.id,
    'day', v_row.day,
    'closed_at', v_row.closed_at,
    'closed_by', v_row.closed_by,
    'expected_cash', v_row.expected_cash,
    'counted_cash', v_row.counted_cash,
    'expected_terminal', v_row.expected_terminal,
    'counted_terminal', v_row.counted_terminal,
    'terminal_batch_reference', v_row.terminal_batch_reference,
    'notes', v_row.notes,
    'acknowledged_issues', v_row.acknowledged_issues
  );
END;
$$;

REVOKE ALL ON FUNCTION public.shift_close_for(date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shift_close_for(date, uuid) TO authenticated, service_role;
