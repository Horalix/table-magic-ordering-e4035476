-- =====================================================================
-- A restaurant's admin manages that restaurant, and nothing of the other
-- (docs/two-restaurants.md)
-- =====================================================================
--
-- The foundation (20261028090000) and the context (20261028100000) made every
-- row, access rule and report belong to one restaurant. An audit of the admin
-- found the places that still asked "is this an admin anywhere?" where they
-- meant "is this an admin of this row's restaurant?", and the readers and jobs
-- that still spanned both. This file closes them:
--
--   1. The five manager functions decide on the row's restaurant:
--      admin_set_waiter_pin, admin_save_combo, rotate_table_qr_token,
--      record_order_refund and cancel_order's manager override. An account
--      that waits tables at La Soul and manages Vera Italia is a waiter at
--      La Soul — it cannot refund, void or re-sticker La Soul's.
--      A restaurant's admin grants and revokes only staff roles at their own
--      restaurant; admin roles are the owner's to give.
--   2. Menu photos: a file under '<restaurant slug>/' is that restaurant's
--      admin's to change (and the owner's); a file at the root, as every
--      photo so far is, only the owner's. Reading stays public.
--   3. analytics_events and the audit log follow the restaurant being shown,
--      like every other list. guest_profiles (one row per phone, both
--      restaurants' spend together) is the owner's alone. The suggestion
--      counters (suggestion_stats, suggestion_conversions,
--      menu_item_affinity) are read by staff of their dish's restaurant.
--   4. The jobs that rewrite both restaurants at once — pruning analytics and
--      the suggestion ledger, rebuilding guest profiles and what the
--      suggestions learned — are the owner's, the scheduler's (pg_cron) and
--      the service role's. The nightly job itself is the scheduler's: run by
--      a signed-in person it covered one restaurant and marked the night done
--      for both. A restaurant's staff still refresh the suggestions, paced
--      to once every ten minutes (the staff screens are the scheduler where
--      there is no pg_cron).
--   5. experiment_srm answers only staff of the experiment's restaurant;
--      get_waiter_id answers only signed-in staff, for their own restaurant.
--
-- Safe to run twice: every function is CREATE OR REPLACE, every policy is
-- dropped before it is made. Each function starts from its latest definition
-- in the chain; the only changes are the checks described above.

-- ---------------------------------------------------------------------
-- 0. Who may run what spans both restaurants
-- ---------------------------------------------------------------------

/**
 * The owner, the service role, or the scheduler — never a restaurant's own
 * staff. Same branches as is_trusted_caller() (20260804090500_maintenance.sql)
 * with the owner in place of "any staff member", each COALESCEd to false so a
 * NULL cannot make a caller's `IF NOT ...` fail open.
 */
CREATE OR REPLACE FUNCTION public.is_owner_or_scheduler()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(public.is_super_admin(), false)
      OR COALESCE(COALESCE(
           NULLIF(current_setting('request.jwt.claim.role', true), ''),
           NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
         ) = 'service_role', false)
      OR (session_user::text IN ('postgres', 'supabase_admin')
          AND COALESCE(current_setting('lasoul.scheduled_job', true), '') = 'on');
$$;

REVOKE ALL ON FUNCTION public.is_owner_or_scheduler() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_owner_or_scheduler() TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 1. Manager functions decide on the row's restaurant
-- ---------------------------------------------------------------------

-- Latest: 20260518183006. The waiter's restaurant's admin, or the owner.
CREATE OR REPLACE FUNCTION public.admin_set_waiter_pin(_waiter_id uuid, _pin text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_venue uuid;
BEGIN
  SELECT venue_id INTO v_venue FROM public.waiters WHERE id = _waiter_id;
  IF NOT FOUND OR NOT public.can_admin(v_venue) THEN
    RAISE EXCEPTION 'Admin only' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _pin !~ '^[0-9]{4}$' THEN
    RAISE EXCEPTION 'PIN must be exactly 4 digits';
  END IF;
  UPDATE public.waiters
     SET pin_hash = extensions.crypt(_pin, extensions.gen_salt('bf')),
         pin_set_at = now()
   WHERE id = _waiter_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_waiter_pin(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_waiter_pin(uuid, text) TO authenticated;

-- Latest: 20261026100000_promotions.sql. The combo dish's restaurant's admin;
-- its choices are of the same restaurant (ab_same_venue on menu_combo_options).
CREATE OR REPLACE FUNCTION public.admin_save_combo(_combo_item_id uuid, _slots jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_slot jsonb;
  v_idx bigint;
  v_opt jsonb;
  v_oidx bigint;
  v_slot_id uuid;
  v_item_id uuid;
  v_label text;
  v_surcharge numeric;
  v_name text;
  v_venue uuid;
  v_count int := 0;
BEGIN
  SELECT venue_id INTO v_venue FROM public.menu_items WHERE id = _combo_item_id;
  IF FOUND AND NOT public.can_admin(v_venue) THEN
    RAISE EXCEPTION 'Admin only' USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- Gone: only someone who manages a restaurant learns that.
  IF NOT FOUND AND NOT EXISTS (SELECT 1 FROM public.user_roles
                                WHERE user_id = auth.uid() AND role = 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Admin only' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT name INTO v_name FROM public.menu_items WHERE id = _combo_item_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That dish no longer exists' USING ERRCODE = 'no_data_found';
  END IF;

  IF _slots IS NULL OR jsonb_typeof(_slots) <> 'array' THEN
    RAISE EXCEPTION 'Combo parts must be a list';
  END IF;
  IF jsonb_array_length(_slots) > 6 THEN
    RAISE EXCEPTION 'A combo can have at most 6 parts';
  END IF;

  IF jsonb_array_length(_slots) > 0 AND EXISTS (
    SELECT 1 FROM public.menu_combo_options o
      JOIN public.menu_combo_slots s ON s.id = o.slot_id
     WHERE o.item_id = _combo_item_id AND s.combo_item_id <> _combo_item_id
  ) THEN
    RAISE EXCEPTION '% is a choice inside another combo, so it cannot be a combo itself', v_name;
  END IF;

  DELETE FROM public.menu_combo_slots WHERE combo_item_id = _combo_item_id;

  FOR v_slot, v_idx IN SELECT value, ordinality FROM jsonb_array_elements(_slots) WITH ORDINALITY LOOP
    v_label := nullif(btrim(COALESCE(v_slot->>'label', '')), '');
    IF v_label IS NULL THEN
      RAISE EXCEPTION 'Every part of a combo needs a name (part %)', v_idx;
    END IF;
    IF jsonb_typeof(v_slot->'options') IS DISTINCT FROM 'array'
       OR jsonb_array_length(v_slot->'options') = 0 THEN
      RAISE EXCEPTION '"%" needs at least one dish to choose from', v_label;
    END IF;
    IF jsonb_array_length(v_slot->'options') > 60 THEN
      RAISE EXCEPTION '"%" has too many choices (at most 60)', v_label;
    END IF;

    INSERT INTO public.menu_combo_slots(combo_item_id, sort_order, label, label_bs, label_ar)
    VALUES (_combo_item_id, v_idx::smallint, left(v_label, 40),
            nullif(left(btrim(COALESCE(v_slot->>'label_bs', '')), 40), ''),
            nullif(left(btrim(COALESCE(v_slot->>'label_ar', '')), 40), ''))
    RETURNING id INTO v_slot_id;

    FOR v_opt, v_oidx IN SELECT value, ordinality FROM jsonb_array_elements(v_slot->'options') WITH ORDINALITY LOOP
      v_item_id := (v_opt->>'item_id')::uuid;
      IF v_item_id = _combo_item_id THEN
        RAISE EXCEPTION 'A combo cannot be a choice inside itself';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.menu_items WHERE id = v_item_id) THEN
        RAISE EXCEPTION 'A dish chosen for "%" no longer exists', v_label USING ERRCODE = 'no_data_found';
      END IF;
      IF EXISTS (SELECT 1 FROM public.menu_combo_slots WHERE combo_item_id = v_item_id) THEN
        RAISE EXCEPTION 'A combo cannot be a choice inside another combo ("%")', v_label;
      END IF;
      v_surcharge := round(COALESCE(nullif(v_opt->>'surcharge', '')::numeric, 0), 2);
      IF v_surcharge < 0 OR v_surcharge > 100 THEN
        RAISE EXCEPTION 'An extra charge must be between 0 and 100 KM';
      END IF;
      INSERT INTO public.menu_combo_options(slot_id, item_id, surcharge, sort_order)
      VALUES (v_slot_id, v_item_id, v_surcharge, v_oidx::smallint)
      ON CONFLICT (slot_id, item_id) DO NOTHING;
    END LOOP;
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('combo_item_id', _combo_item_id, 'slots', v_count);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_save_combo(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_save_combo(uuid, jsonb) TO authenticated;

-- Latest: 20260801181519. The table's restaurant's admin.
CREATE OR REPLACE FUNCTION public.rotate_table_qr_token(_table_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token text := encode(gen_random_bytes(32), 'hex');
  v_venue uuid;
BEGIN
  SELECT venue_id INTO v_venue FROM public.tables WHERE id = _table_id;
  IF FOUND AND NOT public.can_admin(v_venue) THEN
    RAISE EXCEPTION 'Only a manager can rotate a table QR' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT FOUND THEN
    IF NOT EXISTS (SELECT 1 FROM public.user_roles
                    WHERE user_id = auth.uid() AND role = 'admin'::public.app_role) THEN
      RAISE EXCEPTION 'Only a manager can rotate a table QR' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RAISE EXCEPTION 'Table not found';
  END IF;

  -- The audit entry is the table's restaurant's, whatever the app is showing.
  PERFORM public.use_venue(v_venue);

  UPDATE public.tables SET qr_token = v_token WHERE id = _table_id;

  PERFORM public.write_audit('qr.table_rotated', 'table', _table_id);
  RETURN v_token;
END;
$$;

REVOKE ALL ON FUNCTION public.rotate_table_qr_token(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rotate_table_qr_token(uuid) TO authenticated;

-- Latest: 20260801181252. The order's restaurant's manager.
CREATE OR REPLACE FUNCTION public.record_order_refund(
  _order_id uuid,
  _amount numeric,
  _method text,
  _reason text,
  _mark_completed boolean DEFAULT false,
  _provider_reference text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders;
  v_amount numeric(10,2) := round(COALESCE(_amount, 0)::numeric, 2);
  v_refundable numeric(10,2);
  v_method text := CASE WHEN _method IN ('card_online', 'cash', 'pos_terminal') THEN _method ELSE NULL END;
  v_id uuid;
BEGIN
  -- Nobody who manages no restaurant gets further than this.
  IF NOT EXISTS (SELECT 1 FROM public.user_roles
                  WHERE user_id = auth.uid() AND role = 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only a manager can refund an order' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_method IS NULL THEN RAISE EXCEPTION 'Invalid refund method'; END IF;
  IF nullif(trim(coalesce(_reason, '')), '') IS NULL THEN RAISE EXCEPTION 'A refund reason is required'; END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = _order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;

  -- Someone who does not work at this order's restaurant learns nothing of it;
  -- someone who does must manage it: an admin elsewhere is not a manager here.
  IF NOT public.can_staff(v_order.venue_id) THEN
    RAISE EXCEPTION 'You do not work at this restaurant' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT public.can_admin(v_order.venue_id) THEN
    RAISE EXCEPTION 'Only a manager can refund an order' USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM public.use_venue(v_order.venue_id);

  IF v_order.payment_status NOT IN ('paid', 'partially_refunded') THEN
    RAISE EXCEPTION 'Only a paid order can be refunded';
  END IF;

  v_refundable := v_order.total - v_order.refunded_amount;
  IF v_amount <= 0 OR v_amount > v_refundable THEN
    RAISE EXCEPTION 'Refund must be between 0 and % KM', v_refundable;
  END IF;

  INSERT INTO public.order_refunds(order_id, amount, method, reason, status, provider_reference, requested_by, completed_by, completed_at)
  VALUES (_order_id, v_amount, v_method, left(trim(_reason), 500),
          CASE WHEN _mark_completed THEN 'completed' ELSE 'requested' END,
          nullif(trim(coalesce(_provider_reference, '')), ''),
          auth.uid(),
          CASE WHEN _mark_completed THEN auth.uid() ELSE NULL END,
          CASE WHEN _mark_completed THEN now() ELSE NULL END)
  RETURNING id INTO v_id;

  IF _mark_completed THEN
    PERFORM set_config('lasoul.financial_ctx', 'on', true);
    UPDATE public.orders
       SET refunded_amount = refunded_amount + v_amount,
           payment_status = CASE WHEN refunded_amount + v_amount >= total THEN 'refunded' ELSE 'partially_refunded' END
     WHERE id = _order_id;
  END IF;

  PERFORM public.write_audit(
    CASE WHEN _mark_completed THEN 'refund.completed' ELSE 'refund.requested' END,
    'order', _order_id, to_jsonb(v_order),
    jsonb_build_object('refund_id', v_id, 'amount', v_amount, 'method', v_method), _reason);

  RETURN jsonb_build_object('refund_id', v_id, 'amount', v_amount,
    'status', CASE WHEN _mark_completed THEN 'completed' ELSE 'requested' END);
END;
$$;

REVOKE ALL ON FUNCTION public.record_order_refund(uuid, numeric, text, text, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_order_refund(uuid, numeric, text, text, boolean, text) TO authenticated;

-- Latest: 20260801181252. Staff of the order's restaurant cancel; past the
-- kitchen or the till, its manager.
CREATE OR REPLACE FUNCTION public.cancel_order(
  _order_id uuid,
  _reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders;
  v_is_admin boolean;
BEGIN
  IF NOT public.is_staff_member() THEN
    RAISE EXCEPTION 'Only staff can cancel an order' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF nullif(trim(coalesce(_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'A cancellation reason is required';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = _order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  IF NOT public.can_staff(v_order.venue_id) THEN
    RAISE EXCEPTION 'You do not work at this restaurant' USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- The manager's override is this restaurant's manager's.
  v_is_admin := public.can_admin(v_order.venue_id);
  PERFORM public.use_venue(v_order.venue_id);

  IF v_order.status = 'cancelled' THEN
    RETURN jsonb_build_object('status', 'already_cancelled');
  END IF;

  -- Once the kitchen has started, or money has moved, a manager must decide.
  IF NOT v_is_admin AND (v_order.status IN ('preparing', 'ready', 'served') OR v_order.payment_status = 'paid') THEN
    RAISE EXCEPTION 'A manager must cancel an order that is in production or already paid'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  PERFORM set_config('lasoul.financial_ctx', 'on', true);

  UPDATE public.orders
     SET status = 'cancelled',
         cancelled_at = now(),
         cancelled_by = auth.uid(),
         cancel_reason = left(trim(_reason), 500)
   WHERE id = _order_id;

  UPDATE public.order_ticket_events
     SET status = 'cancelled', updated_at = now()
   WHERE order_id = _order_id AND status IN ('queued', 'exported');

  PERFORM public.write_audit('order.cancelled', 'order', _order_id,
    to_jsonb(v_order), jsonb_build_object('status', 'cancelled'), _reason);

  RETURN jsonb_build_object('status', 'cancelled',
    'requires_refund', v_order.payment_status = 'paid',
    'total', v_order.total);
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_order(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_order(uuid, text) TO authenticated;

-- Roles: the owner manages everyone's. A restaurant's admin manages the staff
-- (waiter and kitchen) roles of their own restaurant, and no admin role at
-- all: making, moving or removing an admin is the owner's. Everyone still
-- reads their own roles, and an admin still sees their restaurant's
-- ("Admins can view roles", "Users read their own roles", unchanged).
DROP POLICY IF EXISTS "Admins can manage roles" ON public.user_roles;
CREATE POLICY "Admins can manage roles" ON public.user_roles FOR ALL TO authenticated
  USING (public.is_super_admin()
         OR (venue_id IS NOT NULL AND role <> 'admin'::public.app_role AND public.can_admin(venue_id)))
  WITH CHECK (public.is_super_admin()
              OR (venue_id IS NOT NULL AND role <> 'admin'::public.app_role AND public.can_admin(venue_id)));

-- ---------------------------------------------------------------------
-- 2. Menu photos: a restaurant's folder is its admin's
-- ---------------------------------------------------------------------

/**
 * May the signed-in user change this file in menu-images? A file under
 * '<slug>/' belongs to that restaurant: its admin or the owner. Anything else
 * — every photo uploaded before this, at the root, or a folder that names no
 * restaurant — is the owner's alone. (split_part rather than
 * storage.foldername: the same rule reads the same everywhere.)
 */
CREATE OR REPLACE FUNCTION public.can_manage_menu_image(_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE WHEN f.venue IS NOT NULL THEN public.can_admin(f.venue)
              ELSE public.is_super_admin() END
    FROM (SELECT (SELECT v.id FROM public.venues v
                   WHERE strpos(COALESCE(_name, ''), '/') > 1
                     AND v.slug = split_part(_name, '/', 1)) AS venue) f;
$$;

REVOKE ALL ON FUNCTION public.can_manage_menu_image(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_menu_image(text) TO authenticated, service_role;

/*
 * Reading stays as it is: the bucket is public and its files are served by
 * their public address, which no policy here touches (anonymous listing stays
 * off, 20260620160000). The SELECT policy lets a manager's own session see
 * the files it may change, which the storage API needs to replace (upsert)
 * or remove one.
 *
 * The migration role on Lovable Cloud has made storage policies before
 * (20260504201352). Should a project ever refuse it, the rest of this file
 * still applies and the warning says what to run by hand; the read-only
 * check in the report shows which policies are in place.
 */
DO $storage$
BEGIN
  DROP POLICY IF EXISTS "Admins can upload menu images" ON storage.objects;
  CREATE POLICY "Admins can upload menu images" ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'menu-images' AND public.can_manage_menu_image(name));

  DROP POLICY IF EXISTS "Admins can update menu images" ON storage.objects;
  CREATE POLICY "Admins can update menu images" ON storage.objects FOR UPDATE TO authenticated
    USING (bucket_id = 'menu-images' AND public.can_manage_menu_image(name))
    WITH CHECK (bucket_id = 'menu-images' AND public.can_manage_menu_image(name));

  DROP POLICY IF EXISTS "Admins can delete menu images" ON storage.objects;
  CREATE POLICY "Admins can delete menu images" ON storage.objects FOR DELETE TO authenticated
    USING (bucket_id = 'menu-images' AND public.can_manage_menu_image(name));

  DROP POLICY IF EXISTS "Admins see their restaurant's menu images" ON storage.objects;
  CREATE POLICY "Admins see their restaurant's menu images" ON storage.objects FOR SELECT TO authenticated
    USING (bucket_id = 'menu-images' AND public.can_manage_menu_image(name));
EXCEPTION WHEN insufficient_privilege THEN
  RAISE WARNING 'menu-images policies NOT changed (%): run section 2 of 20261031100000_admin_separation.sql as the storage owner', SQLERRM;
END
$storage$;

-- ---------------------------------------------------------------------
-- 3. Readers follow the restaurant being shown
-- ---------------------------------------------------------------------
-- The same rule as every list since 20261028100000: the restaurant the app is
-- showing (current_venue()), and only for someone who works there. Rows
-- written before the two restaurants carry no restaurant and are La Soul's,
-- as every report already reads them (COALESCE(venue_id, default_venue())).

DROP POLICY IF EXISTS "Staff read analytics" ON public.analytics_events;
CREATE POLICY "Staff read analytics" ON public.analytics_events FOR SELECT TO authenticated
  USING (COALESCE(venue_id, public.default_venue()) = (SELECT public.current_venue())
         AND (SELECT public.can_staff(public.current_venue())));

-- The restaurant's managers read its audit log; the owner reads the one of the
-- restaurant they are looking at, instead of both mixed in one list.
DROP POLICY IF EXISTS "Admins read audit log" ON public.audit_log;
CREATE POLICY "Admins read audit log" ON public.audit_log FOR SELECT TO authenticated
  USING (COALESCE(venue_id, public.default_venue()) = (SELECT public.current_venue())
         AND (SELECT public.can_admin(public.current_venue())));

/*
 * guest_profiles: one row per phone, its visits and spend at both restaurants
 * added together, and no restaurant column to split them by. Splitting means
 * a new key, a per-restaurant rebuild and guest_forget_me learning both, for
 * a table nothing in the app reads (returning_guest_stats() and the reports
 * compute from the sessions themselves). The smaller safe change: it is the
 * owner's, the one person who may see both restaurants' guests at once.
 */
DROP POLICY IF EXISTS "Staff read guest profiles" ON public.guest_profiles;
DROP POLICY IF EXISTS "The owner reads guest profiles" ON public.guest_profiles;
CREATE POLICY "The owner reads guest profiles" ON public.guest_profiles FOR SELECT TO authenticated
  USING (public.is_super_admin());

/**
 * One restaurant's dishes, whatever the menu's own access rules let the
 * caller see (a menu page may show the other restaurant's, 20261031100500).
 * For the access rules of tables that have no restaurant of their own but
 * whose dish does. Dish ids are public: every menu is.
 */
CREATE OR REPLACE FUNCTION public.venue_menu_item_ids(_venue uuid)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.menu_items WHERE venue_id = _venue;
$$;

REVOKE ALL ON FUNCTION public.venue_menu_item_ids(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.venue_menu_item_ids(uuid) TO authenticated, service_role;

-- The suggestion counters have no restaurant of their own; their dish does.
DROP POLICY IF EXISTS "Staff read suggestion stats" ON public.suggestion_stats;
CREATE POLICY "Staff read suggestion stats" ON public.suggestion_stats FOR SELECT TO authenticated
  USING (recommended_item_id IN (SELECT public.venue_menu_item_ids((SELECT public.current_venue())))
         AND (SELECT public.can_staff(public.current_venue())));

DROP POLICY IF EXISTS "Staff read suggestion conversions" ON public.suggestion_conversions;
CREATE POLICY "Staff read suggestion conversions" ON public.suggestion_conversions FOR SELECT TO authenticated
  USING (recommended_item_id IN (SELECT public.venue_menu_item_ids((SELECT public.current_venue())))
         AND (SELECT public.can_staff(public.current_venue())));

DROP POLICY IF EXISTS "Staff read affinity" ON public.menu_item_affinity;
CREATE POLICY "Staff read affinity" ON public.menu_item_affinity FOR SELECT TO authenticated
  USING (item_a IN (SELECT public.venue_menu_item_ids((SELECT public.current_venue())))
         AND (SELECT public.can_staff(public.current_venue())));

-- ---------------------------------------------------------------------
-- 4. Jobs that rewrite both restaurants
-- ---------------------------------------------------------------------
-- Each refuses a restaurant's staff with its own message, and anyone who is
-- not staff at all with the message it always had.

-- Latest: 20260804090500_maintenance.sql.
CREATE OR REPLACE FUNCTION public.prune_analytics_events(_days int DEFAULT 400)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_days int := GREATEST(120, COALESCE(_days, 400));
  v_rows int := 0;
BEGIN
  IF NOT public.is_owner_or_scheduler() THEN
    RAISE EXCEPTION '%', CASE WHEN public.is_trusted_caller()
      THEN 'Only the owner can prune analytics: it removes both restaurants'' history'
      ELSE 'Only staff can prune analytics' END
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  DELETE FROM public.analytics_events
   WHERE occurred_at < now() - make_interval(days => v_days);

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$;

REVOKE ALL ON FUNCTION public.prune_analytics_events(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prune_analytics_events(int) TO authenticated;

-- Latest: 20260804090500_maintenance.sql.
CREATE OR REPLACE FUNCTION public.prune_recommendation_decisions(_days int DEFAULT 400)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_days int := GREATEST(120, COALESCE(_days, 400));
  v_rows int := 0;
BEGIN
  IF NOT public.is_owner_or_scheduler() THEN
    RAISE EXCEPTION '%', CASE WHEN public.is_trusted_caller()
      THEN 'Only the owner can prune decisions: it removes both restaurants'' history'
      ELSE 'Only staff can prune decisions' END
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Never remove a decision that a completed sale points at; the join from
  -- revenue back to the decision is the whole value of the ledger.
  DELETE FROM public.recommendation_decisions d
   WHERE d.created_at < now() - make_interval(days => v_days)
     AND NOT EXISTS (SELECT 1 FROM public.suggestion_conversions sc WHERE sc.decision_id = d.id);

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$;

REVOKE ALL ON FUNCTION public.prune_recommendation_decisions(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prune_recommendation_decisions(int) TO authenticated;

-- Latest: 20260804090700_guest_profiles.sql, gate widened by 20261024130000.
CREATE OR REPLACE FUNCTION public.refresh_guest_profiles()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_rows int := 0;
BEGIN
  IF NOT public.is_owner_or_scheduler() THEN
    RAISE EXCEPTION '%', CASE WHEN public.is_trusted_caller()
      THEN 'Only the owner can refresh guest profiles: they span both restaurants'
      ELSE 'Only staff can refresh guest profiles' END
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  DELETE FROM public.guest_profiles;

  INSERT INTO public.guest_profiles(client_id, first_seen, last_seen, visits, orders, net_spend, computed_at)
  SELECT s.host_client_id,
         min(s.opened_at),
         max(s.opened_at),
         count(DISTINCT s.id)::int,
         COALESCE(sum(so.orders), 0)::int,
         COALESCE(sum(so.net_sales), 0),
         now()
    FROM public.table_sessions s
    JOIN public.session_outcomes so ON so.session_id = s.id
   WHERE s.host_client_id IS NOT NULL
     -- A table that never ordered is not a visit worth counting.
     AND so.orders > 0
   GROUP BY s.host_client_id;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_guest_profiles() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refresh_guest_profiles() TO authenticated;

/*
 * Latest: 20261030130000_suggestions_per_restaurant.sql. Rewrites every
 * restaurant's learned counters: the owner, the scheduler, the service role —
 * or refresh_menu_intelligence() on behalf of a restaurant's staff, which
 * paces them and marks its own call (lasoul.paced_refresh, for the length of
 * that call only; nothing through the API can set it).
 */
CREATE OR REPLACE FUNCTION public.rebuild_reco_learning(_days int DEFAULT 365)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_days int := LEAST(GREATEST(COALESCE(_days, 365), 30), 730);
  v_visits int;
  v_pairs int;
BEGIN
  IF NOT (public.is_owner_or_scheduler()
          OR (COALESCE(current_setting('lasoul.paced_refresh', true), '') = 'on'
              AND public.is_trusted_caller())) THEN
    RAISE EXCEPTION '%', CASE WHEN public.is_trusted_caller()
      THEN 'Only the owner can rebuild what the suggestions learned: it spans both restaurants'
      ELSE 'Only staff can refresh menu intelligence' END
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('lasoul.reco_learning'));

  DROP TABLE IF EXISTS pg_temp._rl_vi;
  CREATE TEMP TABLE _rl_vi ON COMMIT DROP AS
    WITH lines AS (
      SELECT COALESCE(o.table_session_id, o.id) AS visit, ov.venue_id AS venue, o.created_at, oi.menu_item_id AS item_id
        FROM public.completed_orders o
        JOIN public.orders ov ON ov.id = o.id
        JOIN public.order_items oi ON oi.order_id = o.id
       WHERE o.created_at > now() - make_interval(days => v_days)
         AND NOT EXISTS (
               SELECT 1 FROM public.suggestion_conversions sc
                WHERE sc.order_id = o.id AND sc.recommended_item_id = oi.menu_item_id)
    ),
    visits AS (
      SELECT visit, min(created_at) AS started, max(created_at) AS last_at FROM lines GROUP BY visit
    )
    SELECT DISTINCT l.visit, l.venue, v.started, v.last_at, l.item_id,
           mi.subcategory_id::text AS sub,
           public.reco_kind(mi.name, sub.name, mi.meal_role, mi.station) AS kind,
           public.basket_weight(v.started, now(), 45) AS w
      FROM lines l
      JOIN visits v ON v.visit = l.visit
      JOIN public.menu_items mi ON mi.id = l.item_id
      LEFT JOIN public.subcategories sub ON sub.id = mi.subcategory_id;

  DELETE FROM public.reco_learning;

  INSERT INTO public.reco_learning(venue_id, ctx_level, ctx_key, item_id, tables, w, w_at, last_at)
  SELECT k.venue, k.lvl, k.key, k.item_id, count(*)::int, round(sum(k.w), 6), now(), max(k.last_at)
    FROM (
      SELECT visit, venue, w, last_at, 'all'::text AS lvl, '*'::text AS key, NULL::uuid AS item_id FROM _rl_vi
      UNION
      SELECT visit, venue, w, last_at, 'item', item_id::text, NULL::uuid FROM _rl_vi
      UNION
      SELECT visit, venue, w, last_at, 'section', sub, NULL::uuid FROM _rl_vi WHERE sub IS NOT NULL
      UNION
      SELECT visit, venue, w, last_at, 'kind', kind, NULL::uuid FROM _rl_vi
      UNION
      SELECT a.visit, a.venue, a.w, a.last_at, 'item', a.item_id::text, b.item_id
        FROM _rl_vi a JOIN _rl_vi b ON b.visit = a.visit AND b.item_id <> a.item_id
      UNION
      SELECT a.visit, a.venue, a.w, a.last_at, 'section', a.sub, b.item_id
        FROM _rl_vi a JOIN _rl_vi b ON b.visit = a.visit AND b.item_id <> a.item_id
       WHERE a.sub IS NOT NULL AND b.sub IS DISTINCT FROM a.sub
      UNION
      SELECT a.visit, a.venue, a.w, a.last_at, 'kind', a.kind, b.item_id
        FROM _rl_vi a JOIN _rl_vi b ON b.visit = a.visit AND b.item_id <> a.item_id
       WHERE b.kind <> a.kind
    ) k
   GROUP BY k.venue, k.lvl, k.key, k.item_id;

  GET DIAGNOSTICS v_pairs = ROW_COUNT;

  -- The learner's memory of today's visits, consistent with the counters.
  DELETE FROM public.reco_learned_visits;
  INSERT INTO public.reco_learned_visits(visit_id, item_id)
  SELECT DISTINCT visit, item_id FROM _rl_vi WHERE started > now() - interval '24 hours';

  SELECT count(DISTINCT visit) INTO v_visits FROM _rl_vi;

  RETURN jsonb_build_object('visits', v_visits, 'counters', v_pairs);
END;
$$;

REVOKE ALL ON FUNCTION public.rebuild_reco_learning(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rebuild_reco_learning(int) TO authenticated;

/*
 * Latest: 20261026110000_reco_adaptive.sql. Recomputes both restaurants'
 * pairings and learned counters. The owner, the scheduler and the service
 * role run it whenever they ask. A restaurant's admin (Menu intelligence →
 * Recompute) and the staff screens (maybe_refresh_menu_intelligence(), the
 * scheduler where pg_cron is missing) still can, at most once every ten
 * minutes; between those it answers with the last result, marked "paced".
 */
CREATE OR REPLACE FUNCTION public.refresh_menu_intelligence()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pairs int;
  v_session_pairs int;
  v_stats int;
  v_learning jsonb;
  v_result jsonb;
  v_last public.maintenance_runs;
  v_mark text := COALESCE(current_setting('lasoul.paced_refresh', true), '');
BEGIN
  IF NOT public.is_trusted_caller() THEN
    RAISE EXCEPTION 'Only staff can refresh menu intelligence' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT public.is_owner_or_scheduler() THEN
    SELECT * INTO v_last FROM public.maintenance_runs WHERE job = 'menu_intelligence';
    IF v_last.last_run_at > now() - interval '10 minutes' THEN
      RETURN v_last.last_result || jsonb_build_object('paced', true);
    END IF;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('lasoul.menu_intelligence'));

  v_pairs := public.refresh_menu_affinity(365, 2);
  v_session_pairs := public.refresh_session_affinity(365, 2);
  v_stats := public.refresh_suggestion_stats(90);
  PERFORM set_config('lasoul.paced_refresh', 'on', true);
  v_learning := public.rebuild_reco_learning(365);
  PERFORM set_config('lasoul.paced_refresh', v_mark, true);

  v_result := jsonb_build_object(
    'pairs', v_pairs,
    'session_pairs', v_session_pairs,
    'section_pairs', (SELECT count(*) FROM public.subcategory_affinity WHERE eb05 > 1),
    'suggestion_rows', v_stats,
    'learned_visits', v_learning -> 'visits',
    'refreshed_at', now());

  INSERT INTO public.maintenance_runs(job, last_run_at, last_result)
  VALUES ('menu_intelligence', now(), v_result)
  ON CONFLICT (job) DO UPDATE SET last_run_at = now(), last_result = v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_menu_intelligence() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refresh_menu_intelligence() TO authenticated;

/*
 * Latest: 20261028100000_two_restaurants_context.sql. The nightly job: the
 * scheduler's (pg_cron, through run_scheduled_maintenance()) or the service
 * role's. Run by a signed-in person it closed stale orders and switched
 * sampling for their own restaurant only, then marked the night done for
 * both, so the other restaurant missed its night. Nothing in the app calls
 * it; docs/lovable-migration-prompt.md points an outside scheduler at it with
 * the service role key, which still works.
 */
CREATE OR REPLACE FUNCTION public.run_daily_maintenance()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_venue uuid := public.current_venue();
  v record;
  v_last timestamptz;
  v_events int := 0;
  v_stale jsonb;
  v_decisions int := 0;
  v_intel jsonb;
  v_result jsonb;
BEGIN
  IF NOT public.is_trusted_caller() THEN
    RAISE EXCEPTION 'Only staff can run maintenance' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'The nightly maintenance is the scheduler''s: it covers both restaurants'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- A second caller returns immediately rather than queueing behind the first.
  IF NOT pg_try_advisory_lock(hashtext('lasoul.daily_maintenance')) THEN
    RETURN jsonb_build_object('ran', false, 'reason', 'already_running');
  END IF;

  BEGIN
    SELECT last_run_at INTO v_last FROM public.maintenance_runs WHERE job = 'daily';

    IF v_last IS NOT NULL AND v_last > now() - interval '20 hours' THEN
      PERFORM pg_advisory_unlock(hashtext('lasoul.daily_maintenance'));
      RETURN jsonb_build_object('ran', false, 'reason', 'already_ran_today', 'last_run_at', v_last);
    END IF;

    -- Covers every restaurant, each with its own settings.
    v_stale := public.close_stale_orders();
    v_events := public.prune_analytics_events();
    v_decisions := public.prune_recommendation_decisions();
    PERFORM public.refresh_guest_profiles();

    -- Per restaurant: every one.
    FOR v IN
      SELECT id FROM public.venues
       ORDER BY created_at, id
    LOOP
      PERFORM public.use_venue(v.id);
      PERFORM public.maybe_enable_sampling();
    END LOOP;
    PERFORM public.use_venue(v_venue);

    BEGIN
      v_intel := public.refresh_menu_intelligence();
    EXCEPTION WHEN OTHERS THEN
      v_intel := jsonb_build_object('error', SQLERRM);
    END;

    v_result := jsonb_build_object(
      'ran', true,
      'stale_orders_closed', v_stale,
      'analytics_events_pruned', v_events,
      'decisions_pruned', v_decisions,
      'menu_intelligence', v_intel,
      'at', now());

    INSERT INTO public.maintenance_runs(job, last_run_at, last_result)
    VALUES ('daily', now(), v_result)
    ON CONFLICT (job) DO UPDATE SET last_run_at = now(), last_result = v_result;

    PERFORM pg_advisory_unlock(hashtext('lasoul.daily_maintenance'));
    RETURN v_result;
  EXCEPTION WHEN OTHERS THEN
    -- Never strand the lock; the next caller must be able to try again.
    PERFORM pg_advisory_unlock(hashtext('lasoul.daily_maintenance'));
    RAISE;
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.run_daily_maintenance() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.run_daily_maintenance() TO authenticated;

-- ---------------------------------------------------------------------
-- 5. Two small ones
-- ---------------------------------------------------------------------

-- Latest: 20260803002004. Staff of the experiment's restaurant (the owner
-- counts), or a caller with no user (the scheduler, the service role).
CREATE OR REPLACE FUNCTION public.experiment_srm(_experiment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pct numeric;
  v_venue uuid;
  v_n_hold bigint; v_n_treat bigint; v_n bigint;
  v_exp_hold numeric; v_exp_treat numeric;
  v_chi numeric;
BEGIN
  IF NOT public.is_trusted_caller() THEN
    RAISE EXCEPTION 'Only staff can read an experiment' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT holdout_pct, venue_id INTO v_pct, v_venue FROM public.experiments WHERE id = _experiment_id;
  IF v_pct IS NULL THEN RETURN NULL; END IF;

  IF auth.uid() IS NOT NULL AND NOT public.can_staff(v_venue) THEN
    RAISE EXCEPTION 'Only staff can read an experiment' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT count(*) FILTER (WHERE arm = 'holdout'), count(*) FILTER (WHERE arm = 'treatment')
    INTO v_n_hold, v_n_treat
    FROM public.session_experiment_assignment WHERE experiment_id = _experiment_id;

  v_n := v_n_hold + v_n_treat;
  IF v_n < 50 THEN
    RETURN jsonb_build_object('checked', false, 'reason', 'too_few_sessions',
                              'holdout', v_n_hold, 'treatment', v_n_treat);
  END IF;

  v_exp_hold := v_n * v_pct / 100.0;
  v_exp_treat := v_n - v_exp_hold;
  v_chi := power(v_n_hold - v_exp_hold, 2) / NULLIF(v_exp_hold, 0)
         + power(v_n_treat - v_exp_treat, 2) / NULLIF(v_exp_treat, 0);

  RETURN jsonb_build_object(
    'checked', true,
    'holdout', v_n_hold,
    'treatment', v_n_treat,
    'expected_holdout_pct', v_pct,
    'observed_holdout_pct', round(100.0 * v_n_hold / v_n, 1),
    'chi_square', round(v_chi, 2),
    'healthy', v_chi < 10.83
  );
END;
$$;

REVOKE ALL ON FUNCTION public.experiment_srm(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.experiment_srm(uuid) TO authenticated;

/*
 * Latest: 20260429201004. Nothing calls it any more — not the waiter sign-in
 * (supabase/functions/waiter-login reads the waiter with the service role),
 * no access rule, no function — but anyone without signing in could ask which
 * waiter a user id is. Now: signed-in only, about yourself or about the staff
 * of a restaurant you work at.
 */
CREATE OR REPLACE FUNCTION public.get_waiter_id(_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.waiters
   WHERE user_id = _user_id
     AND (_user_id = auth.uid() OR public.can_staff(venue_id))
   ORDER BY (venue_id = public.current_venue()) DESC, created_at, id
   LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.get_waiter_id(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_waiter_id(uuid) TO authenticated, service_role;
