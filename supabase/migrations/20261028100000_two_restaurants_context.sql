-- =====================================================================
-- Two restaurants — every function works inside one restaurant
-- (docs/two-restaurants.md, phase 2)
-- =====================================================================
--
-- The foundation (20261028090000) gave every row a restaurant and made the
-- access rules and writes respect it. This file does the same for the
-- functions, without changing what any of them is called with:
--
--   * public.current_venue() — the restaurant this request is about:
--       1. what the request already proved (a guest's table session or QR
--          code, the order or session a staff action is about), set with
--          public.use_venue();
--       2. otherwise the restaurant the app is showing — it sends an
--          "x-venue" header (a slug or an id) with every request; for
--          someone signed in, only a restaurant they work at counts;
--       3. otherwise the one restaurant a waiter or restaurant admin works
--          at; otherwise La Soul.
--     It says which restaurant was asked for, never who may see it: every
--     function still checks can_staff / can_admin on that restaurant.
--   * Settings are read for that restaurant (venue_id = current_venue())
--     instead of the single row id = 1.
--   * Lists and reports keep to that restaurant's rows.
--   * Experiments (the suggestion hold-out) run per restaurant.

-- ---------------------------------------------------------------------
-- 1. The restaurant this request is about
-- ---------------------------------------------------------------------

/** From here on in this transaction, the restaurant is this one. */
CREATE OR REPLACE FUNCTION public.use_venue(_venue uuid)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF _venue IS NOT NULL THEN
    PERFORM set_config('lasoul.venue', _venue::text, true);
  END IF;
  RETURN _venue;
END;
$$;

CREATE OR REPLACE FUNCTION public.current_venue()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_set text := nullif(current_setting('lasoul.venue', true), '');
  v_asked text;
  v_id uuid;
BEGIN
  -- 1. What this request already proved.
  IF v_set IS NOT NULL THEN
    RETURN v_set::uuid;
  END IF;

  -- 2. The restaurant the app is showing: any restaurant for a guest, only
  --    one they work at for someone signed in. A waiter whose phone still
  --    asks for the other restaurant (the owner used it last) gets their own.
  BEGIN
    v_asked := nullif(current_setting('request.headers', true), '')::json ->> 'x-venue';
  EXCEPTION WHEN others THEN
    v_asked := NULL;
  END;
  IF v_asked IS NOT NULL THEN
    SELECT id INTO v_id FROM public.venues WHERE slug = v_asked OR id::text = v_asked;
    IF FOUND AND (auth.uid() IS NULL OR public.can_staff(v_id)) THEN
      RETURN v_id;
    END IF;
  END IF;

  -- 3. The restaurant a waiter or restaurant admin works at.
  SELECT venue_id INTO v_id FROM public.user_roles
   WHERE user_id = auth.uid() AND venue_id IS NOT NULL
   ORDER BY role, venue_id
   LIMIT 1;

  RETURN COALESCE(v_id, public.default_venue());
END;
$$;

REVOKE ALL ON FUNCTION public.use_venue(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.use_venue(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.current_venue() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_venue() TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2. Experiments per restaurant
-- ---------------------------------------------------------------------

ALTER TABLE public.experiments
  ADD COLUMN IF NOT EXISTS venue_id uuid NOT NULL DEFAULT 'a5000000-0000-4000-8000-000000000001' REFERENCES public.venues(id);

-- One running experiment per restaurant, not one overall.
DO $exp$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT i.relname::text AS idx
      FROM pg_index ix
      JOIN pg_class c ON c.oid = ix.indrelid
      JOIN pg_class i ON i.oid = ix.indexrelid
     WHERE c.oid = 'public.experiments'::regclass
       AND ix.indisunique AND NOT ix.indisprimary
       AND pg_get_indexdef(ix.indexrelid) !~ 'venue_id'
  LOOP
    EXECUTE format('DROP INDEX public.%I', r.idx);
  END LOOP;
END
$exp$;

CREATE UNIQUE INDEX IF NOT EXISTS experiments_one_running_per_venue
  ON public.experiments(venue_id) WHERE ended_at IS NULL;

-- ---------------------------------------------------------------------
-- 2a. New rows belong to the restaurant of the request
-- ---------------------------------------------------------------------
-- The foundation defaulted every new row to La Soul until the app named a
-- restaurant. The request now says which (current_venue()), so a table, a
-- dish or a printer added in Vera Italia's admin is Vera Italia's without the
-- app naming it; with no restaurant named it is still La Soul. Rows that
-- belong to something else keep inheriting from it regardless.
DO $defaults$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'categories', 'sections', 'tables', 'waiters', 'printers', 'shift_closes', 'experiments',
    'subcategories', 'menu_items', 'menu_combo_slots', 'menu_combo_options', 'menu_item_availability_log',
    'section_assignments', 'table_sessions', 'orders', 'order_items', 'waiter_calls', 'bill_requests',
    'session_join_requests', 'ratings', 'server_ratings', 'payment_transactions', 'order_refunds',
    'order_ticket_events'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN venue_id SET DEFAULT public.current_venue()', t);
  END LOOP;
END
$defaults$;
ALTER TABLE public.analytics_events ALTER COLUMN venue_id SET DEFAULT public.current_venue();

-- ---------------------------------------------------------------------
-- 2b. Access rules follow the restaurant being looked at
-- ---------------------------------------------------------------------
-- A waiter or a restaurant's admin only ever sees their own restaurant (the
-- foundation's rules). The super admin may see both, and with those rules saw
-- both at once: every list in the app would have needed a filter, and one
-- missed filter would mix the two. Now every rule also keeps to
-- current_venue(), the restaurant the app is showing, so a list is always one
-- restaurant's. Public menus follow the menu being shown; with no restaurant
-- named that is La Soul, so today's website and pages read what they always
-- read. The checks run once per query (the sub-selects), not once per row.
DO $lens$
DECLARE
  lens constant text := 'venue_id = (SELECT public.current_venue())';
  staff constant text := lens || ' AND (SELECT public.can_staff(public.current_venue()))';
  admin constant text := lens || ' AND (SELECT public.can_admin(public.current_venue()))';
  p record;
  rule text;
BEGIN
  FOR p IN
    SELECT * FROM (VALUES
      -- table, policy, command, roles, who
      ('categories', 'Anyone can view categories', 'SELECT', 'public', 'anyone'),
      ('categories', 'Admins can delete categories', 'DELETE', 'authenticated', 'admin'),
      ('categories', 'Admins can insert categories', 'INSERT', 'authenticated', 'admin'),
      ('categories', 'Admins can update categories', 'UPDATE', 'authenticated', 'admin'),
      ('subcategories', 'Anyone can view subcategories', 'SELECT', 'public', 'anyone'),
      ('subcategories', 'Admins can delete subcategories', 'DELETE', 'authenticated', 'admin'),
      ('subcategories', 'Admins can insert subcategories', 'INSERT', 'authenticated', 'admin'),
      ('subcategories', 'Admins can update subcategories', 'UPDATE', 'authenticated', 'admin'),
      ('menu_items', 'Anyone can view available menu items', 'SELECT', 'public', 'anyone'),
      ('menu_items', 'Admins can delete menu items', 'DELETE', 'authenticated', 'admin'),
      ('menu_items', 'Admins can insert menu items', 'INSERT', 'authenticated', 'admin'),
      ('menu_items', 'Admins can update menu items', 'UPDATE', 'authenticated', 'admin'),
      ('menu_combo_slots', 'Anyone can view combo slots', 'SELECT', 'anon, authenticated', 'anyone'),
      ('menu_combo_slots', 'Admins manage combo slots', 'ALL', 'authenticated', 'admin'),
      ('menu_combo_options', 'Anyone can view combo options', 'SELECT', 'anon, authenticated', 'anyone'),
      ('menu_combo_options', 'Admins manage combo options', 'ALL', 'authenticated', 'admin'),
      ('menu_item_availability_log', 'Staff read availability history', 'SELECT', 'authenticated', 'staff'),
      ('sections', 'Anyone can view sections', 'SELECT', 'public', 'anyone'),
      ('sections', 'Admins manage sections', 'ALL', 'authenticated', 'admin'),
      ('tables', 'Staff can manage tables', 'ALL', 'authenticated', 'staff'),
      ('section_assignments', 'Admins can manage section assignments', 'ALL', 'authenticated', 'admin'),
      ('section_assignments', 'Staff can view section assignments', 'SELECT', 'authenticated', 'staff'),
      ('waiters', 'Admins can manage waiters', 'ALL', 'authenticated', 'admin'),
      ('waiters', 'Staff can view waiters', 'SELECT', 'authenticated', 'staff'),
      ('printers', 'Admins manage printers', 'ALL', 'authenticated', 'admin'),
      ('restaurant_settings', 'Admins manage settings', 'ALL', 'authenticated', 'admin'),
      ('restaurant_settings', 'Staff can view settings', 'SELECT', 'authenticated', 'staff'),
      ('shift_closes', 'Staff read shift closes', 'SELECT', 'authenticated', 'staff'),
      ('table_sessions', 'Staff can manage table sessions', 'ALL', 'authenticated', 'staff'),
      ('orders', 'Staff can manage orders', 'ALL', 'authenticated', 'staff'),
      ('order_items', 'Staff can manage order items', 'ALL', 'authenticated', 'staff'),
      ('waiter_calls', 'Staff can manage waiter calls', 'ALL', 'authenticated', 'staff'),
      ('bill_requests', 'Staff can manage bill requests', 'ALL', 'authenticated', 'staff'),
      ('session_join_requests', 'Staff can manage join requests', 'ALL', 'authenticated', 'staff'),
      ('order_ticket_events', 'Staff can manage ticket events', 'ALL', 'authenticated', 'staff'),
      ('ratings', 'Staff can view ratings', 'SELECT', 'authenticated', 'staff'),
      ('server_ratings', 'Staff can view server ratings', 'SELECT', 'authenticated', 'staff'),
      ('payment_transactions', 'Admins can manage payment transactions', 'ALL', 'authenticated', 'admin'),
      ('order_refunds', 'Admins manage refunds', 'SELECT', 'authenticated', 'admin'),
      ('experiments', 'Staff read experiments', 'SELECT', 'authenticated', 'staff')
    ) AS t(tbl, name, cmd, roles, who)
  LOOP
    rule := CASE p.who WHEN 'anyone' THEN lens WHEN 'staff' THEN staff ELSE admin END;
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p.name, p.tbl);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR %s TO %s', p.name, p.tbl, p.cmd, p.roles)
      || CASE WHEN p.cmd = 'INSERT' THEN '' ELSE format(' USING (%s)', rule) END
      || CASE WHEN p.cmd IN ('INSERT', 'UPDATE', 'ALL') THEN format(' WITH CHECK (%s)', rule) ELSE '' END;
  END LOOP;
END
$lens$;

-- ---------------------------------------------------------------------
-- 3. Functions
-- ---------------------------------------------------------------------

-- A. Guests and ordering: the table session or QR code sets the restaurant; settings, order numbers, holds, menus, combos and popular dishes are that restaurant's.

CREATE OR REPLACE FUNCTION public.after_meal_moment(_session_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE((
    SELECT sc.has_served_main
       AND sc.minutes_since_served >= COALESCE(
             (SELECT rs.after_meal_prompt_minutes FROM public.restaurant_settings rs
                JOIN public.table_sessions ts ON ts.venue_id = rs.venue_id
               WHERE ts.id = _session_id), 8)
      FROM public.session_context(_session_id) sc
  ), false)
  AND NOT EXISTS (
    SELECT 1
      FROM public.order_items oi
      JOIN public.orders o ON o.id = oi.order_id
      JOIN public.menu_items mi ON mi.id = oi.menu_item_id
     WHERE o.table_session_id = _session_id
       AND o.status NOT IN ('cancelled', 'awaiting_payment', 'payment_failed')
       AND mi.meal_role IN ('dessert', 'hot_drink')
       AND o.created_at > (
         SELECT max(mo.created_at)
           FROM public.orders mo
           JOIN public.order_items moi ON moi.order_id = mo.id
           JOIN public.menu_items mmi ON mmi.id = moi.menu_item_id
          WHERE mo.table_session_id = _session_id
            AND mo.status NOT IN ('cancelled', 'awaiting_payment', 'payment_failed')
            AND mmi.meal_role = 'main')
  );
$function$;

CREATE OR REPLACE FUNCTION public.assert_guest_session(_session_id uuid, _session_token text)
 RETURNS table_sessions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_session public.table_sessions;
BEGIN
  SELECT *
    INTO v_session
    FROM public.table_sessions
   WHERE id = _session_id
     AND token = _session_token
     AND is_active = true
     AND blocked_at IS NULL;

  IF FOUND THEN
    -- Everything this guest does from here happens at this table's restaurant,
    -- and its idle timeout is that restaurant's.
    PERFORM public.use_venue(v_session.venue_id);
    IF COALESCE(v_session.last_heartbeat_at, v_session.opened_at)
         > now() - make_interval(mins => public.session_idle_timeout()) THEN
      RETURN v_session;
    END IF;
  END IF;

  RAISE EXCEPTION 'Invalid or expired table session';
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_popular_items(_limit integer DEFAULT 8, _days integer DEFAULT 30)
 RETURNS TABLE(menu_item_id uuid, qty bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT oi.menu_item_id, sum(oi.quantity)::bigint AS qty
    FROM public.completed_orders o
    JOIN public.order_items oi ON oi.order_id = o.id
   WHERE o.created_at > now() - make_interval(days => GREATEST(COALESCE(_days, 30), 1))
     AND oi.venue_id = public.current_venue()
   GROUP BY oi.menu_item_id
  HAVING count(DISTINCT o.id) >= 3
   ORDER BY qty DESC, oi.menu_item_id
   LIMIT LEAST(GREATEST(COALESCE(_limit, 8), 1), 50);
$function$;

CREATE OR REPLACE FUNCTION public.guest_get_combos()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(jsonb_agg(c.combo ORDER BY c.combo_item_id), '[]'::jsonb)
    FROM (
      SELECT s.combo_item_id,
             jsonb_build_object(
               'combo_item_id', s.combo_item_id,
               'slots', jsonb_agg(jsonb_build_object(
                 'id', s.id,
                 'label', s.label,
                 'label_bs', s.label_bs,
                 'label_ar', s.label_ar,
                 'sort_order', s.sort_order,
                 'options', (
                   SELECT COALESCE(jsonb_agg(jsonb_build_object(
                            'item_id', mi.id,
                            'surcharge', o.surcharge,
                            'name', mi.name,
                            'name_bs', mi.name_bs,
                            'name_ar', mi.name_ar,
                            'price', mi.price,
                            'image_url', mi.image_url,
                            'is_available', mi.is_available,
                            'available_from', mi.available_from,
                            'available_to', mi.available_to,
                            'sale_kind', mi.sale_kind,
                            'sale_value', mi.sale_value,
                            'sale_starts_at', mi.sale_starts_at,
                            'sale_ends_at', mi.sale_ends_at,
                            'station', mi.station
                          ) ORDER BY o.sort_order, mi.name), '[]'::jsonb)
                     FROM public.menu_combo_options o
                     JOIN public.menu_items mi ON mi.id = o.item_id
                    WHERE o.slot_id = s.id
                 )
               ) ORDER BY s.sort_order, s.id)
             ) AS combo
        FROM public.menu_combo_slots s
       WHERE s.venue_id = public.current_venue()
       GROUP BY s.combo_item_id
    ) c;
$function$;

CREATE OR REPLACE FUNCTION public.guest_get_service_status()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'ordering_enabled', COALESCE(s.ordering_enabled, true),
    'online_card_enabled', COALESCE(s.online_card_enabled, false),
    'pay_at_table_enabled', COALESCE(s.pay_at_table_enabled, true),
    'paused_message', s.ordering_paused_message,
    'last_order_time', s.last_order_time,
    'kitchen_delay_minutes', COALESCE(s.kitchen_delay_minutes, 0),
    'recommendations_enabled', COALESCE(s.recommendations_enabled, true)
  )
  FROM public.restaurant_settings s
  WHERE s.venue_id = public.current_venue();
$function$;

CREATE OR REPLACE FUNCTION public.guest_get_substitutes(_item_id uuid, _limit integer DEFAULT 3)
 RETURNS TABLE(id uuid, name text, name_bs text, name_ar text, price numeric, image_url text, dietary_tags text[], match_reason text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH src AS (
    SELECT * FROM public.menu_items WHERE id = _item_id
  ),
  curated AS (
    SELECT r.recommended_item_id AS item_id, 1 AS rank, 'chosen by us'::text AS why
      FROM public.menu_item_recommendations r
     WHERE r.enabled
       AND r.recommendation_type = 'alternative'
       AND r.source_item_id = _item_id
  ),
  near_match AS (
    SELECT mi.id AS item_id, 2 AS rank, 'similar dish'::text AS why
      FROM public.menu_items mi, src
     WHERE mi.subcategory_id = src.subcategory_id
       AND mi.id <> src.id
       -- Within 40% on price. A guest looking at a 9 KM side does not want a
       -- 30 KM main offered as "similar".
       AND mi.price BETWEEN src.price * 0.6 AND src.price * 1.4
  ),
  merged AS (
    SELECT item_id, min(rank) AS rank, (array_agg(why ORDER BY rank))[1] AS why
      FROM (SELECT * FROM curated UNION ALL SELECT * FROM near_match) u
     GROUP BY item_id
  )
  SELECT mi.id, mi.name, mi.name_bs, mi.name_ar, mi.price, mi.image_url, mi.dietary_tags, m.why
    FROM merged m
    JOIN public.menu_items mi ON mi.id = m.item_id
   WHERE public.menu_item_orderable(mi, (now() AT TIME ZONE 'Europe/Sarajevo')::time)
     AND mi.venue_id = (SELECT s2.venue_id FROM src s2)
   ORDER BY m.rank, mi.margin_score DESC, mi.price
   LIMIT LEAST(GREATEST(COALESCE(_limit, 3), 1), 6);
$function$;

CREATE OR REPLACE FUNCTION public.guest_inspect_table(_table_number integer, _qr_token text, _client_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_table public.tables;
  v_session public.table_sessions;
  v_join public.session_join_requests;
  v_timeout int;
BEGIN
  v_table := public.resolve_table_for_token(_table_number, _qr_token);
  IF v_table.id IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;
  v_timeout := public.session_idle_timeout();

  SELECT *
    INTO v_session
    FROM public.table_sessions
   WHERE table_id = v_table.id
     AND is_active = true
     AND COALESCE(last_heartbeat_at, opened_at) > now() - make_interval(mins => v_timeout)
   ORDER BY opened_at DESC
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'empty');
  END IF;

  IF v_session.host_client_id = _client_id THEN
    RETURN jsonb_build_object(
      'status', 'returning', 'role', 'host',
      'session_id', v_session.id, 'session_token', v_session.token,
      'guest_name', v_session.guest_name
    );
  END IF;

  SELECT *
    INTO v_join
    FROM public.session_join_requests
   WHERE table_session_id = v_session.id
     AND client_id = _client_id
     AND status = 'approved'
   ORDER BY resolved_at DESC NULLS LAST, created_at DESC
   LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'status', 'returning', 'role', 'joiner',
      'session_id', v_session.id, 'session_token', v_session.token,
      'guest_name', v_join.guest_name
    );
  END IF;

  RETURN jsonb_build_object('status', 'join_required', 'session_id', v_session.id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.guest_order_eta(_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_order public.orders;
  v_base numeric;
  v_known int := 0;
  v_total int := 0;
  v_observed int := 0;
  v_backlog numeric := 0;
  v_capacity numeric;
  v_delay int;
  v_queue numeric;
  v_low int;
  v_high int;
  v_confidence text;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = _order_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  -- Nothing to wait for.
  IF v_order.status IN ('served', 'cancelled', 'awaiting_payment', 'payment_failed')
     OR v_order.released_to_kitchen_at IS NULL THEN
    RETURN jsonb_build_object('confidence', 'none', 'reason', 'not_in_kitchen');
  END IF;

  SELECT COALESCE(max(e.minutes), 0),
         count(*) FILTER (WHERE e.minutes IS NOT NULL),
         count(*),
         count(*) FILTER (WHERE e.source = 'observed')
    INTO v_base, v_known, v_total, v_observed
    FROM public.order_items oi
    CROSS JOIN LATERAL public.item_prep_estimate(oi.menu_item_id) e
   WHERE oi.order_id = _order_id
     AND oi.status IN ('pending', 'preparing');

  IF v_total = 0 THEN
    RETURN jsonb_build_object('confidence', 'none', 'reason', 'nothing_outstanding');
  END IF;

  -- The whole order is only as fast as its slowest dish, but if we know
  -- nothing about any dish on it we say so rather than inventing a figure.
  IF v_known = 0 THEN
    RETURN jsonb_build_object('confidence', 'none', 'reason', 'no_prep_data');
  END IF;

  SELECT COALESCE(kitchen_capacity_minutes, 25)::numeric, COALESCE(kitchen_delay_minutes, 0)
    INTO v_capacity, v_delay
    FROM public.restaurant_settings WHERE venue_id = v_order.venue_id;

  -- Work ahead of this order, excluding its own lines.
  SELECT COALESCE(sum(oi.quantity * COALESCE(e.minutes, 8)), 0)
    INTO v_backlog
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    CROSS JOIN LATERAL public.item_prep_estimate(oi.menu_item_id) e
   WHERE oi.status IN ('pending', 'preparing')
     AND o.released_to_kitchen_at IS NOT NULL
     AND o.released_to_kitchen_at < v_order.released_to_kitchen_at
     AND o.status IN ('pending', 'confirmed', 'preparing')
     AND o.venue_id = v_order.venue_id;

  v_queue := v_backlog / GREATEST(v_capacity, 1);

  -- The manager's manual "we are slammed" dial still applies on top; it exists
  -- for the things no model sees, like one cook off sick.
  v_low := GREATEST(1, ceil(v_base + v_queue + v_delay))::int;
  v_high := GREATEST(v_low + 2, ceil((v_base * 1.35) + v_queue + v_delay))::int;

  v_confidence := CASE
    WHEN v_known < v_total THEN 'low'      -- some dish on the order is unknown
    WHEN v_observed = v_total THEN 'high'  -- every dish has real history
    ELSE 'medium'                          -- menu settings only
  END;

  RETURN jsonb_build_object(
    'confidence', v_confidence,
    'low_minutes', v_low,
    'high_minutes', v_high,
    'backlog_minutes', round(v_backlog, 1),
    'based_on', CASE WHEN v_observed = v_total THEN 'our own kitchen'
                     WHEN v_observed > 0 THEN 'part history, part menu'
                     ELSE 'menu settings' END,
    -- Enough to render "ready around 20:35" without a second round trip.
    'ready_from', now() + make_interval(mins => v_low),
    'ready_to', now() + make_interval(mins => v_high)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.guest_place_order(_session_id uuid, _session_token text, _guest_name text, _payment_method text, _items jsonb, _tip numeric DEFAULT 0, _client_order_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_session public.table_sessions;
  v_order public.orders;
  v_item_count int;
  v_order_count int;
  v_items_total numeric(10,2);
  v_tip numeric(10,2);
  v_method text;
  v_is_card boolean;
  v_status public.order_status;
  v_ticket_id uuid;
  v_unavailable text;
  v_unavailable_ids text;
  v_qty int;
  v_hold text;
BEGIN
  v_session := public.assert_guest_session(_session_id, _session_token);

  IF _client_order_id IS NOT NULL THEN
    SELECT * INTO v_order
      FROM public.orders o
     WHERE o.table_session_id = v_session.id AND o.client_order_id = _client_order_id;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'order_id', v_order.id,
        'order_code', v_order.order_code,
        'status', v_order.status,
        'total', v_order.total,
        'tip_amount', v_order.tip_amount,
        'payment_method', v_order.payment_method,
        'payment_status', v_order.payment_status,
        'awaiting_payment', v_order.status = 'awaiting_payment',
        'ticket_id', NULL,
        'replayed', true,
        'held', v_order.held_reason IS NOT NULL AND v_order.released_to_kitchen_at IS NULL
      );
    END IF;
  END IF;

  IF NOT COALESCE((SELECT ordering_enabled FROM public.restaurant_settings WHERE venue_id = v_session.venue_id), true) THEN
    RAISE EXCEPTION 'Ordering is paused' USING ERRCODE = 'feature_not_supported';
  END IF;

  v_method := CASE
    WHEN _payment_method IN ('card', 'card_online') THEN 'card_online'
    WHEN _payment_method = 'pos_terminal' THEN 'pos_terminal'
    ELSE 'cash'
  END;
  v_is_card := v_method = 'card_online';

  IF v_is_card AND NOT public.online_card_payments_enabled() THEN
    RAISE EXCEPTION 'Online card payment is currently unavailable' USING ERRCODE = 'feature_not_supported';
  END IF;

  IF jsonb_typeof(_items) <> 'array' THEN
    RAISE EXCEPTION 'Order items must be an array';
  END IF;

  SELECT jsonb_array_length(_items) INTO v_item_count;
  IF v_item_count < 1 OR v_item_count > 20 THEN
    RAISE EXCEPTION 'Invalid order size';
  END IF;

  SELECT COALESCE(sum(LEAST(GREATEST(COALESCE((item->>'quantity')::int, 1), 1), 10)), 0)::int
    INTO v_qty
    FROM jsonb_array_elements(_items) AS item;
  IF v_qty > 60 THEN
    RAISE EXCEPTION 'Invalid order size';
  END IF;

  UPDATE public.table_sessions SET last_heartbeat_at = now() WHERE id = v_session.id;

  SELECT count(*) INTO v_order_count
    FROM public.orders
   WHERE table_session_id = v_session.id;
  IF v_order_count >= 30 THEN
    RAISE EXCEPTION 'Maximum orders reached for this session';
  END IF;

  WITH requested AS (
    SELECT DISTINCT (item->>'menu_item_id')::uuid AS menu_item_id
      FROM jsonb_array_elements(_items) AS item
  )
  SELECT string_agg(COALESCE(mi.name, 'Unknown item'), ', '),
         jsonb_agg(r.menu_item_id)::text
    INTO v_unavailable, v_unavailable_ids
    FROM requested r
    LEFT JOIN public.menu_items mi ON mi.id = r.menu_item_id
   WHERE mi.id IS NULL OR mi.venue_id <> v_session.venue_id OR NOT public.menu_item_orderable(mi);

  IF v_unavailable IS NOT NULL THEN
    RAISE EXCEPTION 'Unavailable: %', v_unavailable
      USING ERRCODE = 'no_data_found', DETAIL = v_unavailable_ids;
  END IF;

  WITH requested AS (
    SELECT
      (item->>'menu_item_id')::uuid AS menu_item_id,
      LEAST(GREATEST(COALESCE((item->>'quantity')::int, 1), 1), 10) AS quantity
    FROM jsonb_array_elements(_items) AS item
  )
  SELECT round(sum(pl.unit_price * pl.quantity)::numeric, 2)
    INTO v_items_total
    FROM public.price_order_lines(_items) pl;

  IF v_items_total IS NULL OR v_items_total <= 0 THEN
    RAISE EXCEPTION 'No available menu items found';
  END IF;

  v_tip := round(GREATEST(COALESCE(_tip, 0), 0)::numeric, 2);
  v_tip := LEAST(v_tip, round(v_items_total * 0.40, 2), 200);

  v_status := CASE WHEN v_is_card THEN 'awaiting_payment'::public.order_status
                   ELSE 'pending'::public.order_status END;

  -- Pay-at-table orders print on arrival. The suspicious ones wait for staff
  -- instead (see order_hold_reason). Card orders are already gated on money.
  IF NOT v_is_card THEN
    v_hold := public.order_hold_reason(v_session.id, v_items_total, v_qty);
  END IF;

  INSERT INTO public.orders(
    table_session_id, total, tip_amount, status, guest_name,
    payment_method, payment_status, order_code, released_to_kitchen_at, client_order_id,
    held_reason, held_at
  )
  VALUES (
    v_session.id, v_items_total + v_tip, v_tip, v_status,
    nullif(left(trim(coalesce(_guest_name, '')), 80), ''),
    v_method,
    CASE WHEN v_is_card THEN 'pending' ELSE 'unpaid' END,
    public.next_order_code(v_session.venue_id),
    CASE WHEN v_is_card OR v_hold IS NOT NULL THEN NULL ELSE now() END,
    _client_order_id,
    v_hold,
    CASE WHEN v_hold IS NULL THEN NULL ELSE now() END
  )
  RETURNING * INTO v_order;

  WITH requested AS (
    SELECT
      (item->>'menu_item_id')::uuid AS menu_item_id,
      LEAST(GREATEST(COALESCE((item->>'quantity')::int, 1), 1), 10) AS quantity,
      nullif(left(trim(coalesce(item->>'notes', '')), 500), '') AS notes
    FROM jsonb_array_elements(_items) AS item
  )
  INSERT INTO public.order_items(order_id, menu_item_id, quantity, unit_price, notes, status, regular_unit_price, components)
  SELECT v_order.id, pl.menu_item_id, pl.quantity, pl.unit_price, pl.notes, 'pending', pl.regular_unit_price, pl.components
    FROM public.price_order_lines(_items) pl
   ORDER BY pl.line_no;

  -- Attribution. Priced from menu_items, never from the client.
  INSERT INTO public.suggestion_conversions(
    order_id, source_item_id, recommended_item_id, placement, quantity, line_total, decision_id)
  SELECT
    v_order.id,
    nullif(item->'from_suggestion'->>'source_item_id', '')::uuid,
    (item->>'menu_item_id')::uuid,
    COALESCE(nullif(item->'from_suggestion'->>'placement', ''), 'cart'),
    LEAST(GREATEST(COALESCE((item->>'quantity')::int, 1), 1), 10),
    round(public.menu_item_unit_price(mi) * LEAST(GREATEST(COALESCE((item->>'quantity')::int, 1), 1), 10), 2),
    nullif(item->'from_suggestion'->>'decision_id', '')::uuid
  FROM jsonb_array_elements(_items) AS item
  JOIN public.menu_items mi ON mi.id = (item->>'menu_item_id')::uuid
  WHERE jsonb_typeof(item->'from_suggestion') = 'object';

  IF NOT v_is_card AND v_hold IS NULL THEN
    v_ticket_id := public.enqueue_station_tickets(v_order.id);
  END IF;

  RETURN jsonb_build_object(
    'order_id', v_order.id,
    'order_code', v_order.order_code,
    'status', v_order.status,
    'total', v_order.total,
    'tip_amount', v_order.tip_amount,
    'payment_method', v_order.payment_method,
    'payment_status', v_order.payment_status,
    'awaiting_payment', v_is_card,
    'ticket_id', v_ticket_id,
    'held', v_hold IS NOT NULL,
    'held_reason', v_hold
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.guest_request_join(_table_number integer, _qr_token text, _client_id text, _guest_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_table public.tables;
  v_session public.table_sessions;
  v_request public.session_join_requests;
  v_timeout int;
  v_name text := COALESCE(nullif(left(trim(coalesce(_guest_name, '')), 80), ''), 'Guest');
BEGIN
  v_table := public.resolve_table_for_token(_table_number, _qr_token);
  IF v_table.id IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;
  v_timeout := public.session_idle_timeout();

  SELECT *
    INTO v_session
    FROM public.table_sessions
   WHERE table_id = v_table.id
     AND is_active = true
     AND COALESCE(last_heartbeat_at, opened_at) > now() - make_interval(mins => v_timeout)
   ORDER BY opened_at DESC
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_active');
  END IF;

  SELECT *
    INTO v_request
    FROM public.session_join_requests
   WHERE table_session_id = v_session.id
     AND client_id = _client_id
     AND status IN ('pending', 'approved')
   ORDER BY created_at DESC
   LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'status', v_request.status,
      'request_id', v_request.id,
      'session_id', v_session.id,
      'session_token', CASE WHEN v_request.status = 'approved' THEN v_session.token ELSE NULL END
    );
  END IF;

  INSERT INTO public.session_join_requests(table_session_id, guest_name, client_id, status)
  VALUES (v_session.id, v_name, _client_id, 'pending')
  RETURNING * INTO v_request;

  RETURN jsonb_build_object('status', 'pending', 'request_id', v_request.id, 'session_id', v_session.id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.guest_search_menu(_query text, _limit integer DEFAULT 20)
 RETURNS TABLE(id uuid, name text, name_bs text, name_ar text, description text, description_bs text, description_ar text, price numeric, image_url text, dietary_tags text[], merchandising_tags text[], is_available boolean, subcategory_id uuid, category_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT mi.id, mi.name, mi.name_bs, mi.name_ar,
         mi.description, mi.description_bs, mi.description_ar,
         mi.price, mi.image_url, mi.dietary_tags, mi.merchandising_tags,
         mi.is_available, mi.subcategory_id, c.name
    FROM public.menu_items mi
    JOIN public.subcategories s ON s.id = mi.subcategory_id
    JOIN public.categories c ON c.id = s.category_id
   WHERE length(btrim(COALESCE(_query, ''))) >= 2
     AND mi.venue_id = public.current_venue()
     AND (
       mi.name ILIKE '%' || btrim(_query) || '%'
       OR COALESCE(mi.name_bs, '') ILIKE '%' || btrim(_query) || '%'
       OR COALESCE(mi.name_ar, '') ILIKE '%' || btrim(_query) || '%'
       OR COALESCE(mi.description, '') ILIKE '%' || btrim(_query) || '%'
       OR s.name ILIKE '%' || btrim(_query) || '%'
     )
   ORDER BY mi.is_available DESC,
            (mi.name ILIKE btrim(_query) || '%') DESC,
            mi.sort_order ASC
   LIMIT LEAST(GREATEST(COALESCE(_limit, 20), 1), 50);
$function$;

CREATE OR REPLACE FUNCTION public.guest_start_table_session(_table_number integer, _qr_token text, _client_id text, _guest_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_table public.tables;
  v_session public.table_sessions;
  v_join public.session_join_requests;
  v_timeout int;
  v_name text := nullif(left(trim(coalesce(_guest_name, '')), 80), '');
BEGIN
  v_table := public.resolve_table_for_token(_table_number, _qr_token);
  IF v_table.id IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;
  v_timeout := public.session_idle_timeout();

  -- Two phones scanning the same table in the same second both found no
  -- session and both opened one. Held until commit, so the second caller sees
  -- the first one's session and is offered a join instead.
  PERFORM pg_advisory_xact_lock(hashtext(v_table.id::text));

  IF nullif(_client_id, '') IS NOT NULL AND EXISTS (
    SELECT 1
      FROM public.table_sessions bs
      LEFT JOIN public.session_join_requests jr
        ON jr.table_session_id = bs.id AND jr.status = 'approved' AND jr.client_id = _client_id
     WHERE bs.table_id = v_table.id
       AND bs.blocked_at > now() - interval '12 hours'
       AND (bs.host_client_id = _client_id OR jr.id IS NOT NULL)
  ) THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;

  SELECT *
    INTO v_session
    FROM public.table_sessions
   WHERE table_id = v_table.id
     AND is_active = true
     AND COALESCE(last_heartbeat_at, opened_at) > now() - make_interval(mins => v_timeout)
   ORDER BY opened_at DESC
   LIMIT 1;

  IF NOT FOUND THEN
    -- Close anything stale on this table first, so a forgotten session from
    -- lunch cannot resurface underneath the dinner guests.
    UPDATE public.table_sessions
       SET is_active = false, closed_at = COALESCE(closed_at, now())
     WHERE table_id = v_table.id AND is_active = true;

    INSERT INTO public.table_sessions(table_id, host_client_id, guest_name)
    VALUES (v_table.id, nullif(_client_id, ''), COALESCE(v_name, 'Guest'))
    RETURNING * INTO v_session;

    RETURN jsonb_build_object(
      'status', 'created', 'role', 'host',
      'session_id', v_session.id, 'session_token', v_session.token,
      'guest_name', v_session.guest_name
    );
  END IF;

  IF v_session.host_client_id = _client_id THEN
    IF v_name IS NOT NULL AND v_session.guest_name IS DISTINCT FROM v_name THEN
      UPDATE public.table_sessions SET guest_name = v_name WHERE id = v_session.id
      RETURNING * INTO v_session;
    END IF;

    RETURN jsonb_build_object(
      'status', 'returning', 'role', 'host',
      'session_id', v_session.id, 'session_token', v_session.token,
      'guest_name', COALESCE(v_session.guest_name, v_name)
    );
  END IF;

  SELECT *
    INTO v_join
    FROM public.session_join_requests
   WHERE table_session_id = v_session.id
     AND client_id = _client_id
     AND status = 'approved'
   ORDER BY resolved_at DESC NULLS LAST, created_at DESC
   LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'status', 'returning', 'role', 'joiner',
      'session_id', v_session.id, 'session_token', v_session.token,
      'guest_name', COALESCE(v_join.guest_name, v_name)
    );
  END IF;

  RETURN jsonb_build_object('status', 'join_required', 'session_id', v_session.id);
END;
$function$;

/** The restaurant a QR code belongs to, so the app opens that restaurant's menu after the scan. */
CREATE OR REPLACE FUNCTION public.guest_table_venue(_table_number integer, _qr_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_table public.tables;
BEGIN
  v_table := public.resolve_table_for_token(_table_number, _qr_token);
  RETURN jsonb_build_object(
    'venue', (SELECT v.slug FROM public.venues v WHERE v.id = v_table.venue_id)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.guest_table_venue(integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guest_table_venue(integer, text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.kitchen_load()
 RETURNS TABLE(station text, open_items integer, backlog_minutes numeric, load_factor numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH cap AS (
    SELECT COALESCE(kitchen_capacity_minutes, 25)::numeric AS capacity
      FROM public.restaurant_settings WHERE venue_id = public.current_venue()
  ),
  open_lines AS (
    SELECT oi.station,
           oi.quantity,
           COALESCE(
             (SELECT e.minutes FROM public.item_prep_estimate(oi.menu_item_id) e),
             8
           ) AS minutes
      FROM public.order_items oi
      JOIN public.orders o ON o.id = oi.order_id
     WHERE oi.status IN ('pending', 'preparing')
       AND o.released_to_kitchen_at IS NOT NULL
       AND o.status IN ('pending', 'confirmed', 'preparing')
       AND o.venue_id = public.current_venue()
  )
  SELECT s.station,
         COALESCE(sum(l.quantity), 0)::int,
         COALESCE(sum(l.quantity * l.minutes), 0)::numeric(8,2),
         round(COALESCE(sum(l.quantity * l.minutes), 0) / (SELECT capacity FROM cap), 2)
    FROM (VALUES ('kitchen'), ('bar')) AS s(station)
    LEFT JOIN open_lines l ON l.station = s.station
   GROUP BY s.station;
$function$;

CREATE OR REPLACE FUNCTION public.monri_apply_callback(_event_hash text, _monri_order_number text, _monri_payment_id text, _normalized_status text, _amount_minor integer, _currency text, _raw jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tx public.payment_transactions;
  v_order public.orders;
  v_outcome text;
  v_detail text;
  v_released boolean := false;
  v_currency text := upper(COALESCE(nullif(trim(_currency), ''), ''));
  v_new_payment_status text;
BEGIN
  IF _event_hash IS NULL OR _event_hash = '' THEN
    RAISE EXCEPTION 'event_hash is required';
  END IF;

  -- Replay guard. Reserve the hash first; a duplicate raises unique_violation.
  BEGIN
    INSERT INTO public.payment_callback_events(
      event_hash, monri_order_number, normalized_status, amount_minor, currency, outcome, raw_payload
    )
    VALUES (_event_hash, _monri_order_number, _normalized_status, _amount_minor, v_currency, 'processing', COALESCE(_raw, '{}'::jsonb));
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('outcome', 'duplicate', 'released', false);
  END;

  SELECT * INTO v_tx
    FROM public.payment_transactions
   WHERE monri_order_number = _monri_order_number;

  IF NOT FOUND THEN
    UPDATE public.payment_callback_events
       SET outcome = 'unknown_transaction'
     WHERE event_hash = _event_hash AND provider = 'monri';
    RETURN jsonb_build_object('outcome', 'unknown_transaction', 'released', false);
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = v_tx.order_id;
  PERFORM public.use_venue(v_order.venue_id);

  -- --- Verification: the money must match what we asked for. ---
  IF _normalized_status = 'approved' THEN
    IF _amount_minor IS DISTINCT FROM v_tx.amount_minor THEN
      v_outcome := 'amount_mismatch';
      v_detail := format('expected %s, callback %s', v_tx.amount_minor, COALESCE(_amount_minor::text, 'null'));
    ELSIF v_currency <> v_tx.currency THEN
      v_outcome := 'currency_mismatch';
      v_detail := format('expected %s, callback %s', v_tx.currency, COALESCE(nullif(v_currency, ''), 'null'));
    END IF;

    IF v_outcome IS NOT NULL THEN
      UPDATE public.payment_transactions
         SET status = 'error',
             failure_reason = v_outcome || ': ' || v_detail,
             provider_payload = COALESCE(_raw, '{}'::jsonb),
             updated_at = now()
       WHERE id = v_tx.id;

      UPDATE public.payment_callback_events
         SET outcome = v_outcome, detail = v_detail,
             payment_transaction_id = v_tx.id, order_id = v_tx.order_id
       WHERE event_hash = _event_hash AND provider = 'monri';

      PERFORM public.write_audit('payment.callback_rejected', 'order', v_tx.order_id,
        to_jsonb(v_tx), COALESCE(_raw, '{}'::jsonb), v_outcome || ': ' || v_detail, 'monri');

      -- Explicitly NOT released. The guest sees "confirmation delayed"; staff
      -- see the order in the payment-problem queue.
      RETURN jsonb_build_object('outcome', v_outcome, 'detail', v_detail, 'released', false);
    END IF;
  END IF;

  -- --- Monotonic status: never move backwards. ---
  IF public.payment_status_rank(_normalized_status) <= public.payment_status_rank(v_tx.status)
     AND _normalized_status <> v_tx.status
  THEN
    UPDATE public.payment_callback_events
       SET outcome = 'stale_status',
           detail = format('%s after %s', _normalized_status, v_tx.status),
           payment_transaction_id = v_tx.id, order_id = v_tx.order_id
     WHERE event_hash = _event_hash AND provider = 'monri';
    RETURN jsonb_build_object('outcome', 'stale_status', 'released', false);
  END IF;

  UPDATE public.payment_transactions
     SET status = _normalized_status,
         monri_payment_id = COALESCE(_monri_payment_id, monri_payment_id),
         provider_payload = COALESCE(_raw, provider_payload),
         approved_at = CASE WHEN _normalized_status = 'approved' THEN COALESCE(approved_at, now()) ELSE approved_at END,
         failure_reason = CASE WHEN _normalized_status IN ('declined', 'cancelled', 'error')
                               THEN left(COALESCE(_raw->>'response_message', _raw->>'message', _normalized_status), 500)
                               ELSE failure_reason END,
         updated_at = now()
   WHERE id = v_tx.id;

  v_new_payment_status := CASE _normalized_status
    WHEN 'approved'  THEN 'paid'
    WHEN 'refunded'  THEN 'refunded'
    WHEN 'declined'  THEN 'failed'
    WHEN 'cancelled' THEN 'failed'
    WHEN 'error'     THEN 'failed'
    ELSE 'pending'
  END;

  PERFORM set_config('lasoul.financial_ctx', 'on', true);

  UPDATE public.orders
     SET payment_status = v_new_payment_status,
         paid_at = CASE WHEN _normalized_status = 'approved' THEN COALESCE(paid_at, now()) ELSE paid_at END
   WHERE id = v_tx.order_id;

  IF _normalized_status = 'approved' THEN
    v_released := public.release_order_to_kitchen(v_tx.order_id);
    v_outcome := CASE WHEN v_released THEN 'approved_released' ELSE 'approved_already_released' END;
  ELSIF _normalized_status IN ('declined', 'cancelled', 'error') THEN
    -- Park the order out of the kitchen's way; the guest can retry or switch.
    PERFORM set_config('lasoul.financial_ctx', 'on', true);
    UPDATE public.orders
       SET status = 'payment_failed'
     WHERE id = v_tx.order_id
       AND status = 'awaiting_payment';
    v_outcome := 'payment_failed';
  ELSE
    v_outcome := 'pending';
  END IF;

  UPDATE public.payment_callback_events
     SET outcome = v_outcome,
         payment_transaction_id = v_tx.id,
         order_id = v_tx.order_id
   WHERE event_hash = _event_hash AND provider = 'monri';

  PERFORM public.write_audit('payment.callback_applied', 'order', v_tx.order_id, NULL,
    jsonb_build_object('status', _normalized_status, 'outcome', v_outcome, 'released', v_released),
    NULL, 'monri');

  SELECT * INTO v_order FROM public.orders WHERE id = v_tx.order_id;

  RETURN jsonb_build_object(
    'outcome', v_outcome,
    'released', v_released,
    'order_id', v_tx.order_id,
    'order_code', v_order.order_code,
    'payment_status', v_order.payment_status
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.online_card_payments_enabled()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE((SELECT online_card_enabled FROM public.restaurant_settings WHERE venue_id = public.current_venue()), false);
$function$;

CREATE OR REPLACE FUNCTION public.order_hold_reason(_session_id uuid, _items_total numeric, _item_count integer)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_session public.table_sessions;
  v_cfg public.restaurant_settings;
  v_timeout int;
  v_prior int;
  v_exposure numeric;
  v_burst int;
BEGIN
  SELECT * INTO v_session FROM public.table_sessions WHERE id = _session_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- A member of staff has dealt with this table: it is real.
  IF v_session.staff_seen_at IS NOT NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_cfg FROM public.restaurant_settings WHERE venue_id = v_session.venue_id;
  v_timeout := COALESCE(v_cfg.session_idle_timeout_minutes, 180);

  IF NOT public.in_service_hours((now() AT TIME ZONE 'Europe/Sarajevo')::time,
                                 v_cfg.service_open, v_cfg.service_close) THEN
    RETURN 'outside_hours';
  END IF;

  -- Blocking a session ends it; the same person can scan again and start a
  -- fresh one on the same table. For an hour, that fresh one waits.
  IF EXISTS (
    SELECT 1 FROM public.table_sessions s
     WHERE s.table_id = v_session.table_id
       AND s.id <> v_session.id
       AND s.blocked_at > now() - interval '1 hour'
  ) THEN
    RETURN 'table_recently_blocked';
  END IF;

  IF COALESCE(v_cfg.hold_auto_admitted, false) AND v_session.auto_admitted_at IS NOT NULL THEN
    RETURN 'auto_admitted';
  END IF;

  IF COALESCE(v_cfg.hold_second_session, false) AND EXISTS (
    SELECT 1 FROM public.table_sessions s
     WHERE s.table_id = v_session.table_id
       AND s.id <> v_session.id
       AND s.is_active
       AND s.blocked_at IS NULL
       AND COALESCE(s.last_heartbeat_at, s.opened_at) > now() - make_interval(mins => v_timeout)
  ) THEN
    RETURN 'second_session';
  END IF;

  -- Many tables appearing at once is what a script, or a photo of the QR
  -- passed around a group chat, looks like. The window is anchored on THIS
  -- session's opening rather than on now(), so opening ten sessions and
  -- waiting five minutes before ordering does not get under it, and an old
  -- table is not held because of an unrelated rush.
  IF v_cfg.hold_burst_sessions IS NOT NULL THEN
    SELECT count(*) INTO v_burst
      FROM public.table_sessions s
     WHERE s.staff_seen_at IS NULL
       AND s.venue_id = v_session.venue_id
       AND s.opened_at BETWEEN v_session.opened_at - interval '5 minutes'
                           AND v_session.opened_at + interval '5 minutes';
    IF v_burst > v_cfg.hold_burst_sessions THEN
      RETURN 'venue_burst';
    END IF;
  END IF;

  SELECT count(*) INTO v_prior
    FROM public.orders o
   WHERE o.table_session_id = _session_id AND o.status <> 'cancelled';
  IF v_prior = 0 AND (
       (v_cfg.hold_first_order_km IS NOT NULL AND _items_total > v_cfg.hold_first_order_km)
    OR (v_cfg.hold_first_order_items IS NOT NULL AND _item_count > v_cfg.hold_first_order_items)
  ) THEN
    RETURN 'large_first_order';
  END IF;

  -- Released and held orders the table has not paid for. Card orders still
  -- waiting for money are not exposure; nothing was cooked for them.
  IF v_cfg.hold_unpaid_km IS NOT NULL THEN
    SELECT COALESCE(sum(o.total), 0) INTO v_exposure
      FROM public.orders o
     WHERE o.table_session_id = _session_id
       AND o.status NOT IN ('cancelled', 'awaiting_payment', 'payment_failed')
       AND o.payment_status NOT IN ('paid', 'refunded', 'partially_refunded');
    IF v_exposure + _items_total > v_cfg.hold_unpaid_km THEN
      -- The threshold travels with the reason so the staff card can say
      -- "Over 150 KM unpaid" without a second query.
      RETURN 'unpaid_exposure:' || rtrim(rtrim(v_cfg.hold_unpaid_km::text, '0'), '.');
    END IF;
  END IF;

  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.popular_items_for_daypart(_daypart text, _limit integer DEFAULT 12, _days integer DEFAULT 45)
 RETURNS TABLE(menu_item_id uuid, qty bigint, share numeric, relative numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH lines AS (
    SELECT oi.menu_item_id, o.id AS order_id, oi.quantity, public.daypart_of(o.created_at) AS dp
      FROM public.completed_orders o
      JOIN public.order_items oi ON oi.order_id = o.id
     WHERE o.created_at > now() - make_interval(days => GREATEST(COALESCE(_days, 45), 1))
       AND oi.venue_id = public.current_venue()
  ),
  per_item AS (
    SELECT l.menu_item_id,
           sum(l.quantity)::bigint AS qty,
           count(DISTINCT l.order_id) AS orders,
           COALESCE(sum(l.quantity) FILTER (WHERE l.dp = _daypart), 0)::numeric AS qty_dp
      FROM lines l
     GROUP BY l.menu_item_id
  ),
  totals AS (SELECT sum(qty)::numeric AS q_all, sum(qty_dp) AS q_dp FROM per_item),
  scored AS (
    SELECT pi.menu_item_id, pi.qty,
           (pi.qty_dp + 5 * pi.qty / NULLIF(t.q_all, 0)) / (t.q_dp + 5) AS share
      FROM per_item pi CROSS JOIN totals t
     WHERE pi.orders >= 3
  )
  SELECT s.menu_item_id, s.qty, round(s.share, 6),
         round(s.share / NULLIF(max(s.share) OVER (), 0), 6)
    FROM scored s
   ORDER BY s.share DESC, s.qty DESC, s.menu_item_id
   LIMIT LEAST(GREATEST(COALESCE(_limit, 12), 1), 50);
$function$;

CREATE OR REPLACE FUNCTION public.release_order_to_kitchen(_order_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rows int := 0;
  v_released boolean := false;
BEGIN
  PERFORM set_config('lasoul.financial_ctx', 'on', true);
  PERFORM public.use_venue((SELECT venue_id FROM public.orders WHERE id = _order_id));

  UPDATE public.orders
     SET status = 'pending',
         released_to_kitchen_at = now(),
         order_code = COALESCE(order_code, public.next_order_code(venue_id))
   WHERE id = _order_id
     AND status IN ('awaiting_payment', 'payment_failed')
     AND released_to_kitchen_at IS NULL;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_released := v_rows > 0;

  IF v_released THEN
    PERFORM public.enqueue_station_tickets(_order_id);
    PERFORM public.write_audit('order.released_to_kitchen', 'order', _order_id);
  END IF;

  RETURN v_released;
END;
$function$;

CREATE OR REPLACE FUNCTION public.resolve_table_for_token(_table_number integer, _token text)
 RETURNS public.tables
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_table public.tables;
BEGIN
  IF _token IS NULL OR btrim(_token) = '' THEN
    RETURN NULL;
  END IF;

  -- Per-table sticker.
  SELECT * INTO v_table FROM public.tables
   WHERE table_number = _table_number AND qr_token = _token;

  -- Room code: it names the restaurant; the table number is what the guest told us.
  IF NOT FOUND THEN
    SELECT t.* INTO v_table
      FROM public.restaurant_settings s
      JOIN public.tables t ON t.venue_id = s.venue_id AND t.table_number = _table_number
     WHERE s.venue_qr_token = _token;
  END IF;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Everything the guest does from here happens at this table's restaurant.
  PERFORM public.use_venue(v_table.venue_id);
  RETURN v_table;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rotate_venue_qr_token()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_token text := encode(gen_random_bytes(32), 'hex');
  v_venue uuid := public.current_venue();
BEGIN
  IF NOT public.can_admin(v_venue) THEN
    RAISE EXCEPTION 'Only a manager can rotate the venue QR' USING ERRCODE = 'insufficient_privilege';
  END IF;

  PERFORM set_config('lasoul.qr_ctx', 'on', true);

  UPDATE public.restaurant_settings
     SET venue_qr_token = v_token, venue_qr_rotated_at = now()
   WHERE venue_id = v_venue;

  PERFORM public.write_audit('qr.venue_rotated', 'restaurant_settings', NULL, NULL, NULL,
                             'Venue QR rotated — reprint required');
  RETURN v_token;
END;
$function$;

CREATE OR REPLACE FUNCTION public.session_idle_timeout()
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE((SELECT session_idle_timeout_minutes FROM public.restaurant_settings WHERE venue_id = public.current_venue()), 180);
$function$;

CREATE OR REPLACE FUNCTION public.touch_session(_id uuid, _token text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_timeout int;
  v_venue uuid;
BEGIN
  SELECT venue_id INTO v_venue FROM public.table_sessions WHERE id = _id AND token = _token;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  PERFORM public.use_venue(v_venue);
  v_timeout := public.session_idle_timeout();

  UPDATE public.table_sessions
     SET last_heartbeat_at = now()
   WHERE id = _id
     AND token = _token
     AND is_active = true
     AND COALESCE(last_heartbeat_at, opened_at) > now() - make_interval(mins => v_timeout);

  RETURN FOUND;
END;
$function$;

CREATE OR REPLACE FUNCTION public.write_audit(_action text, _entity_type text, _entity_id uuid, _before jsonb DEFAULT NULL::jsonb, _after jsonb DEFAULT NULL::jsonb, _reason text DEFAULT NULL::text, _actor_label text DEFAULT NULL::text, _correlation_id text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.audit_log(
    venue_id, actor_user_id, actor_label, action, entity_type, entity_id,
    before_state, after_state, reason, correlation_id
  )
  VALUES (
    public.current_venue(), auth.uid(), nullif(left(trim(coalesce(_actor_label, '')), 120), ''),
    _action, _entity_type, _entity_id, _before, _after,
    nullif(left(trim(coalesce(_reason, '')), 500), ''), _correlation_id
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

-- B. Kitchen, printing and the floor: boards, print queues, printers, reconciliation and the scheduled clean-up, each per restaurant.

CREATE OR REPLACE FUNCTION public.close_stale_orders(_hours integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_venue uuid := public.current_venue();
  v record;
  v_hours int;
  v_venue_hours int;
  v_cutoff timestamptz;
  v_abandoned int := 0;
  v_never_served int := 0;
  v_venue_abandoned int;
  v_venue_never_served int;
  v_ids uuid[];
BEGIN
  IF NOT public.is_trusted_caller() THEN
    RAISE EXCEPTION 'Only staff can close stale orders' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF auth.uid() IS NOT NULL AND NOT public.can_staff(v_venue) THEN
    RAISE EXCEPTION 'Only staff can close stale orders' USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_hours := COALESCE(_hours,
    (SELECT stale_order_hours FROM public.restaurant_settings WHERE venue_id = v_venue), 6);

  -- A floor, so a bad settings write cannot cancel the current service.
  IF v_hours < 2 THEN
    RAISE EXCEPTION 'Refusing to close orders younger than 2 hours (asked for %)', v_hours;
  END IF;

  PERFORM set_config('lasoul.financial_ctx', 'on', true);

  -- A signed-in caller closes their own restaurant's orders; the scheduler
  -- (no user) every restaurant's, each by its own stale_order_hours.
  FOR v IN
    SELECT id FROM public.venues
     WHERE auth.uid() IS NULL OR id = v_venue
     ORDER BY created_at, id
  LOOP
    PERFORM public.use_venue(v.id);

    v_venue_hours := COALESCE(_hours,
      (SELECT stale_order_hours FROM public.restaurant_settings WHERE venue_id = v.id), 6);
    IF v_venue_hours < 2 THEN
      RAISE EXCEPTION 'Refusing to close orders younger than 2 hours (asked for %)', v_venue_hours;
    END IF;

    v_cutoff := now() - make_interval(hours => v_venue_hours);

    /*
     * 1. Card orders that never got paid for. These never reached the kitchen —
     *    `release_order_to_kitchen` is gated on payment — so nothing was cooked
     *    and nothing is owed.
     */
    WITH doomed AS (
      SELECT id FROM public.orders
       WHERE venue_id = v.id
         AND status IN ('awaiting_payment', 'payment_failed')
         AND payment_status <> 'paid'
         AND created_at < v_cutoff
       FOR UPDATE
    ), done AS (
      UPDATE public.orders o
         SET status = 'cancelled',
             cancelled_at = now(),
             cancel_reason = format('Auto-closed: payment never completed (open %s h)', v_venue_hours)
        FROM doomed d WHERE o.id = d.id
      RETURNING o.id
    )
    SELECT count(*)::int, array_agg(id) INTO v_venue_abandoned, v_ids FROM done;

    /*
     * 2. Unpaid orders that sat in the kitchen flow and were never served.
     *    Unpaid means no money moved, so closing them costs nothing and stops
     *    them being reported as outstanding forever.
     */
    WITH doomed AS (
      SELECT id FROM public.orders
       WHERE venue_id = v.id
         AND status IN ('pending', 'confirmed', 'preparing', 'ready')
         AND payment_status <> 'paid'
         AND created_at < v_cutoff
       FOR UPDATE
    ), done AS (
      UPDATE public.orders o
         SET status = 'cancelled',
             cancelled_at = now(),
             cancel_reason = format('Auto-closed: never served, unpaid (open %s h)', v_venue_hours)
        FROM doomed d WHERE o.id = d.id
      RETURNING o.id
    )
    SELECT count(*)::int INTO v_venue_never_served FROM done;

    -- Any queued kitchen ticket for a cancelled order stops being printable.
    UPDATE public.order_ticket_events te
       SET status = 'cancelled', updated_at = now()
      FROM public.orders o
     WHERE te.order_id = o.id
       AND o.venue_id = v.id
       AND o.status = 'cancelled'
       AND te.status IN ('queued', 'exported');

    IF v_venue_abandoned + v_venue_never_served > 0 THEN
      PERFORM public.write_audit('order.auto_closed', 'order', NULL, NULL,
        jsonb_build_object('abandoned_payment', v_venue_abandoned,
                           'never_served', v_venue_never_served,
                           'older_than_hours', v_venue_hours),
        format('Nightly cleanup closed %s unpaid orders open longer than %s hours',
               v_venue_abandoned + v_venue_never_served, v_venue_hours));
    END IF;

    v_abandoned := v_abandoned + v_venue_abandoned;
    v_never_served := v_never_served + v_venue_never_served;
  END LOOP;

  PERFORM public.use_venue(v_venue);

  RETURN jsonb_build_object(
    'abandoned_payment', v_abandoned,
    'never_served', v_never_served,
    'total', v_abandoned + v_never_served,
    'older_than_hours', v_hours);
END;
$function$;

CREATE OR REPLACE FUNCTION public.close_stale_sessions()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_venue uuid := public.current_venue();
  v record;
  v_rows int := 0;
  v_count int := 0;
  v_timeout int;
BEGIN
  -- A signed-in caller closes their own restaurant's sessions; the scheduler
  -- (no user) every restaurant's, each by its own idle timeout.
  FOR v IN
    SELECT id FROM public.venues
     WHERE auth.uid() IS NULL OR id = v_venue
     ORDER BY created_at, id
  LOOP
    PERFORM public.use_venue(v.id);
    v_timeout := public.session_idle_timeout();

    UPDATE public.table_sessions
       SET is_active = false, closed_at = now()
     WHERE venue_id = v.id
       AND is_active = true
       AND COALESCE(last_heartbeat_at, opened_at) <= now() - make_interval(mins => v_timeout);

    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_rows := v_rows + v_count;
  END LOOP;

  PERFORM public.use_venue(v_venue);
  RETURN v_rows;
END;
$function$;

CREATE OR REPLACE FUNCTION public.cloud_print_candidates(_types text[])
 RETURNS SETOF order_ticket_events
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT t.*
    FROM public.order_ticket_events t
    JOIN public.orders o ON o.id = t.order_id
   WHERE t.status = 'queued'
     AND t.venue_id = public.current_venue()
     AND t.ticket_type = ANY(_types)
     AND t.updated_at > now() - interval '60 minutes'
     AND o.status IN ('pending', 'confirmed', 'preparing')
   ORDER BY t.updated_at ASC, t.created_at ASC;
$function$;

CREATE OR REPLACE FUNCTION public.cloud_print_claim(_token text, _ticket_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_printer public.printers;
  v_device text;
  v_ticket public.order_ticket_events;
BEGIN
  SELECT * INTO v_printer FROM public.printers WHERE poll_token = _token AND enabled;
  IF v_printer.id IS NULL THEN
    RETURN NULL;
  END IF;
  -- A printer prints only its own restaurant's tickets.
  PERFORM public.use_venue(v_printer.venue_id);
  v_device := left('cloud:' || v_printer.name, 80);

  UPDATE public.order_ticket_events t
     SET status = 'claimed',
         claimed_by_device = v_device,
         claimed_at = now(),
         attempts = t.attempts + 1,
         last_error = NULL,
         updated_at = now()
   WHERE t.id = (
           SELECT c.id
             FROM public.cloud_print_candidates(public.printer_ticket_types(v_printer.station)) c
            WHERE c.venue_id = v_printer.venue_id
              AND (_ticket_id IS NULL OR c.id = _ticket_id)
            LIMIT 1
         )
     AND t.status = 'queued'
  RETURNING t.* INTO v_ticket;

  -- The printer asking again for the job it already has (a retried GET after
  -- a dropped connection) gets the same job back, not the next one — which
  -- would leave the first claimed by nobody who will ever print it.
  IF v_ticket.id IS NULL AND _ticket_id IS NOT NULL THEN
    SELECT * INTO v_ticket
      FROM public.order_ticket_events
     WHERE id = _ticket_id AND status = 'claimed' AND claimed_by_device = v_device
       AND venue_id = v_printer.venue_id;
  END IF;

  IF v_ticket.id IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'ticket_id', v_ticket.id,
    'order_id', v_ticket.order_id,
    'ticket_type', v_ticket.ticket_type,
    'original_printed_at', v_ticket.original_printed_at,
    'attempts', v_ticket.attempts,
    'paper_width', v_printer.paper_width,
    'plain_text', v_printer.plain_text
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.cloud_print_report(_token text, _ticket_id uuid, _ok boolean, _error text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_printer public.printers;
  v_device text;
  v_id uuid;
BEGIN
  SELECT * INTO v_printer FROM public.printers WHERE poll_token = _token;
  IF v_printer.id IS NULL THEN
    RETURN NULL;
  END IF;
  PERFORM public.use_venue(v_printer.venue_id);
  v_device := left('cloud:' || v_printer.name, 80);

  -- Device names are only unique within a restaurant.
  SELECT id INTO v_id
    FROM public.order_ticket_events
   WHERE claimed_by_device = v_device
     AND venue_id = v_printer.venue_id
     AND status = 'claimed'
     AND (_ticket_id IS NULL OR id = _ticket_id)
   ORDER BY claimed_at ASC
   LIMIT 1;

  IF v_id IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE public.order_ticket_events
     SET status = CASE WHEN _ok THEN 'printed' ELSE 'failed' END,
         printed_at = CASE WHEN _ok THEN now() ELSE NULL END,
         print_verified = CASE WHEN _ok THEN true ELSE NULL END,
         last_error = CASE WHEN _ok THEN NULL ELSE left(coalesce(nullif(btrim(_error), ''), 'The printer reported a problem'), 300) END,
         updated_at = now()
   WHERE id = v_id;

  UPDATE public.printers
     SET last_error = CASE WHEN _ok THEN NULL ELSE left(coalesce(_error, 'print failed'), 300) END,
         updated_at = now()
   WHERE id = v_printer.id;

  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.cloud_printer_checkin(_token text, _protocol text DEFAULT NULL::text, _mac text DEFAULT NULL::text, _status text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_printer public.printers;
  v_device text;
  v_next uuid;
BEGIN
  IF _token IS NULL OR length(_token) < 32 THEN
    RETURN NULL;
  END IF;

  UPDATE public.printers
     SET last_seen_at = now(),
         protocol = COALESCE(CASE WHEN _protocol IN ('star_cloudprnt', 'epson_sdp') THEN _protocol END, protocol),
         device_mac = COALESCE(nullif(left(btrim(coalesce(_mac, '')), 40), ''), device_mac),
         last_status = COALESCE(nullif(left(btrim(coalesce(_status, '')), 120), ''), last_status)
   WHERE poll_token = _token AND enabled
  RETURNING * INTO v_printer;

  IF v_printer.id IS NULL THEN
    RETURN NULL;
  END IF;

  PERFORM public.use_venue(v_printer.venue_id);
  v_device := left('cloud:' || v_printer.name, 80);

  -- Device names are only unique within a restaurant.
  UPDATE public.order_ticket_events
     SET status = 'failed',
         last_error = 'The printer fetched this ticket but never confirmed it printed',
         updated_at = now()
   WHERE status = 'claimed'
     AND venue_id = v_printer.venue_id
     AND claimed_by_device = v_device
     AND claimed_at < now() - interval '90 seconds';

  SELECT c.id INTO v_next
    FROM public.cloud_print_candidates(public.printer_ticket_types(v_printer.station)) c
   WHERE c.venue_id = v_printer.venue_id
   LIMIT 1;

  RETURN jsonb_build_object(
    'id', v_printer.id,
    'name', v_printer.name,
    'station', v_printer.station,
    'paper_width', v_printer.paper_width,
    'plain_text', v_printer.plain_text,
    'device', v_device,
    'next_ticket_id', v_next,
    'test_pending', v_printer.test_requested_at IS NOT NULL
      AND (v_printer.last_test_printed_at IS NULL OR v_printer.last_test_printed_at < v_printer.test_requested_at)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.covers_summary(_day date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_venue uuid := public.current_venue();
  v_day date := COALESCE(_day, public.business_day());
  v_result jsonb;
BEGIN
  IF NOT public.can_staff(v_venue) THEN
    RAISE EXCEPTION 'Only staff can read covers' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT jsonb_build_object(
           'day', v_day,
           'sittings', count(*),
           'counted', count(*) FILTER (WHERE s.covers IS NOT NULL),
           'covers', COALESCE(sum(s.covers), 0),
           'coverage', CASE WHEN count(*) = 0 THEN 0
                            ELSE round(count(*) FILTER (WHERE s.covers IS NOT NULL)::numeric
                                       / count(*)::numeric, 3) END
         )
    INTO v_result
    FROM public.table_sessions s
   WHERE s.venue_id = v_venue
     AND public.business_day(s.opened_at) = v_day;

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.day_reconciliation(_day date DEFAULT business_day())
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_venue uuid := public.current_venue();
  v_result jsonb;
  v_from timestamptz;
  v_to timestamptz;
BEGIN
  IF NOT public.can_staff(v_venue) THEN
    RAISE EXCEPTION 'Only staff can read reconciliation' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT starts_at, ends_at INTO v_from, v_to FROM public.business_day_range(_day);

  SELECT jsonb_build_object(
    'day', _day,
    'orders', count(*),
    'gross', COALESCE(sum(total), 0),
    'tips', COALESCE(sum(tip_amount), 0),
    'refunded', COALESCE(sum(refunded_amount), 0),
    'net', COALESCE(sum(total) - sum(refunded_amount), 0),
    'paid_online', COALESCE(sum(total) FILTER (WHERE payment_method = 'card_online' AND payment_status = 'paid'), 0),
    'paid_cash', COALESCE(sum(total) FILTER (WHERE payment_method = 'cash' AND payment_status = 'paid'), 0),
    'paid_pos_terminal', COALESCE(sum(total) FILTER (WHERE payment_method = 'pos_terminal' AND payment_status = 'paid'), 0),
    'outstanding', COALESCE(sum(total) FILTER (WHERE payment_status IN ('unpaid', 'pending')), 0),
    'outstanding_orders', count(*) FILTER (WHERE payment_status IN ('unpaid', 'pending')),
    'unfiscalized', COALESCE(sum(total) FILTER (WHERE fiscalization_status <> 'fiscalized'), 0),
    'unfiscalized_orders', count(*) FILTER (WHERE fiscalization_status <> 'fiscalized'),
    'average_order', COALESCE(round(avg(total), 2), 0)
  )
  INTO v_result
  FROM public.completed_orders co
  WHERE co.created_at >= v_from AND co.created_at < v_to
    AND EXISTS (SELECT 1 FROM public.orders vo WHERE vo.id = co.id AND vo.venue_id = v_venue);

  -- Money that started but never landed: the queue staff must clear.
  SELECT v_result || jsonb_build_object(
    'stuck_payments', COALESCE(count(*), 0),
    'stuck_amount', COALESCE(round(sum(o.total), 2), 0),
    'cancelled_orders', (SELECT count(*) FROM public.orders c
                          WHERE c.venue_id = v_venue
                            AND c.status = 'cancelled'
                            AND c.created_at >= v_from AND c.created_at < v_to),
    -- A callback naming no order we know has no restaurant; La Soul, which
    -- received every callback before there were two, keeps counting those.
    'callback_problems', (SELECT count(*) FROM public.payment_callback_events e
                           WHERE (e.venue_id = v_venue
                                  OR (e.venue_id IS NULL AND v_venue = public.default_venue()))
                             AND e.outcome IN ('amount_mismatch', 'currency_mismatch', 'unknown_transaction')
                             AND e.created_at >= v_from AND e.created_at < v_to)
  )
  INTO v_result
  FROM public.orders o
  WHERE o.venue_id = v_venue
    AND o.status IN ('awaiting_payment', 'payment_failed')
    AND o.created_at >= v_from AND o.created_at < v_to;

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.kds_all_day(_station text DEFAULT NULL::text)
 RETURNS TABLE(menu_item_id uuid, name text, station text, qty_pending integer, qty_preparing integer, qty_ready integer, oldest_at timestamp with time zone, pending_ids uuid[], open_ids uuid[])
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_venue uuid := public.current_venue();
BEGIN
  IF NOT public.can_staff(v_venue) THEN
    RAISE EXCEPTION 'Only staff can read the kitchen view' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  WITH open_lines AS (
    SELECT oi.id AS line_id, oi.menu_item_id AS line_item_id, oi.station AS line_station,
           oi.status AS line_status, oi.quantity AS line_qty, oi.components AS line_components,
           o.created_at AS order_at
      FROM public.order_items oi
      JOIN public.orders o ON o.id = oi.order_id
     WHERE o.venue_id = v_venue
       AND o.status IN ('pending', 'confirmed', 'preparing', 'ready')
       AND o.released_to_kitchen_at IS NOT NULL
       AND oi.status <> 'served'
  ),
  work AS (
    -- A line at its own station: counted, and what the buttons act on.
    SELECT l.line_item_id AS w_item_id,
           COALESCE(mi.name, 'Unknown') AS w_name,
           l.line_station AS w_station,
           l.line_status AS w_status,
           l.line_qty AS w_qty,
           l.order_at AS w_at,
           l.line_id AS w_line_id
      FROM open_lines l
      LEFT JOIN public.menu_items mi ON mi.id = l.line_item_id
     WHERE _station IS NULL OR l.line_station = _station

    UNION ALL

    -- A combo part made at another station than its line: counted, never bumped.
    SELECT pmi.id,
           COALESCE(pmi.name, nullif(part.value->>'name', ''), 'Unknown'),
           part.value->>'station',
           l.line_status,
           l.line_qty,
           l.order_at,
           NULL::uuid
      FROM open_lines l
      CROSS JOIN LATERAL jsonb_array_elements(
             CASE WHEN jsonb_typeof(l.line_components) = 'array' THEN l.line_components ELSE '[]'::jsonb END
           ) AS part(value)
      LEFT JOIN public.menu_items pmi ON pmi.id::text = part.value->>'item_id'
     WHERE part.value->>'station' IS NOT NULL
       AND part.value->>'station' IS DISTINCT FROM l.line_station
       AND (_station IS NULL OR part.value->>'station' = _station)
  )
  SELECT w.w_item_id,
         w.w_name,
         w.w_station,
         COALESCE(sum(w.w_qty) FILTER (WHERE w.w_status = 'pending'), 0)::int,
         COALESCE(sum(w.w_qty) FILTER (WHERE w.w_status = 'preparing'), 0)::int,
         COALESCE(sum(w.w_qty) FILTER (WHERE w.w_status = 'ready'), 0)::int,
         min(w.w_at),
         COALESCE(array_agg(w.w_line_id ORDER BY w.w_at)
                    FILTER (WHERE w.w_status = 'pending' AND w.w_line_id IS NOT NULL), '{}'),
         COALESCE(array_agg(w.w_line_id ORDER BY w.w_at)
                    FILTER (WHERE w.w_status IN ('pending', 'preparing') AND w.w_line_id IS NOT NULL), '{}')
    FROM work w
   GROUP BY w.w_item_id, w.w_name, w.w_station
   ORDER BY min(w.w_at);
END;
$function$;

CREATE OR REPLACE FUNCTION public.orders_needing_attention(_hours integer DEFAULT NULL::integer)
 RETURNS TABLE(id uuid, order_code text, table_number integer, status order_status, payment_status text, total numeric, hours_open numeric, problem text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  /*
   * The RETURNS TABLE names (id, status, total, …) are OUT parameters, and
   * PL/pgSQL resolves a bare identifier to the variable before the column.
   * Every reference below is qualified, but the ORDER BY and the join
   * conditions still trip it, so say plainly which one wins.
   */
  #variable_conflict use_column
DECLARE
  v_venue uuid := public.current_venue();
  v_hours int;
BEGIN
  IF NOT public.can_staff(v_venue) THEN
    RAISE EXCEPTION 'Only staff can read this' USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_hours := COALESCE(_hours,
    (SELECT stale_order_hours FROM public.restaurant_settings WHERE venue_id = v_venue), 6);

  RETURN QUERY
  SELECT o.id,
         o.order_code,
         t.table_number,
         o.status,
         o.payment_status,
         o.total,
         round(EXTRACT(EPOCH FROM (now() - o.created_at)) / 3600.0, 1),
         CASE
           WHEN o.payment_status = 'paid' THEN
             'Paid but never marked served — confirm the food went out, then close it'
           ELSE
             'Open and unpaid — the nightly cleanup will close this'
         END
    FROM public.orders o
    LEFT JOIN public.table_sessions s ON s.id = o.table_session_id
    LEFT JOIN public.tables t ON t.id = s.table_id
   WHERE o.venue_id = v_venue
     AND o.status NOT IN ('served', 'cancelled')
     AND o.created_at < now() - make_interval(hours => v_hours)
   ORDER BY o.payment_status = 'paid' DESC, o.created_at;
END;
$function$;

CREATE OR REPLACE FUNCTION public.prep_history(_day date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_venue uuid := public.current_venue();
  v_today date := public.business_day();
  v_day date := COALESCE(_day, public.business_day() + 1);
  v_from date;
  v_to date;
  v_start timestamptz;
  v_end timestamptz;
  v_recent timestamptz;
  v_items jsonb;
BEGIN
  IF NOT public.can_staff(v_venue) THEN
    RAISE EXCEPTION 'Only staff can read analytics' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_day > v_today + 7 OR v_day < v_today - 400 THEN
    RAISE EXCEPTION 'Forecast day out of range';
  END IF;

  v_from := v_day - 70;
  -- Only complete trading days are history.
  v_to := LEAST(v_day - 7, v_today - 1);
  SELECT starts_at INTO v_start FROM public.business_day_range(LEAST(v_from, v_today - 28));
  SELECT ends_at INTO v_end FROM public.business_day_range(GREATEST(v_to, v_today - 1));
  SELECT starts_at INTO v_recent FROM public.business_day_range(v_today - 28);

  WITH weeks AS (
    SELECT k, v_day - 7 * k AS d FROM generate_series(1, 10) k
  ),
  parts(dp, ord) AS (
    VALUES ('morning', 1), ('lunch', 2), ('afternoon', 3), ('evening', 4), ('late', 5)
  ),
  avail AS (
    SELECT a.item_id AS a_item, a.day AS a_day FROM public.analytics_item_days(v_from, v_to) a
  ),
  sold AS (
    SELECT oi.menu_item_id AS s_item,
           public.business_day(co.created_at) AS s_day,
           public.daypart_of(co.created_at) AS s_part,
           sum(oi.quantity)::numeric AS s_units
      FROM public.order_items oi
      JOIN public.completed_orders co ON co.id = oi.order_id
     WHERE co.created_at >= v_start AND co.created_at < v_end
       AND oi.venue_id = v_venue
     GROUP BY 1, 2, 3
  ),
  items AS (
    SELECT mi.id, mi.name, mi.is_available, mi.subcategory_id, s.name AS subcategory,
           m.unit_cm, m.unit_cost, m.cost_estimated
      FROM public.menu_items mi
      JOIN public.menu_unit_margins() m ON m.item_id = mi.id
      LEFT JOIN public.subcategories s ON s.id = mi.subcategory_id
     WHERE mi.venue_id = v_venue
       AND EXISTS (SELECT 1 FROM sold WHERE sold.s_item = mi.id)
  ),
  cells AS (
    SELECT i.id, p.dp, p.ord, w.k,
           CASE WHEN a.a_item IS NOT NULL THEN COALESCE(s.s_units, 0) END AS v
      FROM items i
      CROSS JOIN parts p
      CROSS JOIN weeks w
      LEFT JOIN avail a ON a.a_item = i.id AND a.a_day = w.d AND w.d <= v_to
      LEFT JOIN sold s ON s.s_item = i.id AND s.s_day = w.d AND s.s_part = p.dp
  ),
  series AS (
    SELECT id, jsonb_object_agg(dp, arr ORDER BY ord) AS s
      FROM (SELECT id, dp, ord, jsonb_agg(v ORDER BY k) AS arr FROM cells GROUP BY id, dp, ord) x
     GROUP BY id
  ),
  last28 AS (
    SELECT i.id, jsonb_object_agg(p.dp, COALESCE(t.units, 0) ORDER BY p.ord) AS l
      FROM items i
      CROSS JOIN parts p
      LEFT JOIN (
        SELECT s_item, s_part, sum(s_units) AS units
          FROM sold
         WHERE s_day >= v_today - 28 AND s_day <= v_today - 1
         GROUP BY 1, 2
      ) t ON t.s_item = i.id AND t.s_part = p.dp
     GROUP BY i.id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'item_id', i.id,
           'name', i.name,
           'is_available', i.is_available,
           'subcategory_id', i.subcategory_id,
           'subcategory', i.subcategory,
           'unit_cm', i.unit_cm,
           'unit_cost', i.unit_cost,
           'cost_estimated', i.cost_estimated,
           'series', sr.s,
           'last28', l.l)
         ORDER BY i.name, i.id), '[]'::jsonb)
    INTO v_items
    FROM items i
    JOIN series sr ON sr.id = i.id
    JOIN last28 l ON l.id = i.id;

  RETURN jsonb_build_object(
    'day', v_day,
    'weekday', to_char(v_day, 'FMDay'),
    'weeks', (SELECT jsonb_agg(d ORDER BY k) FROM (SELECT k, v_day - 7 * k AS d FROM generate_series(1, 10) k) w),
    'items', v_items);
END;
$function$;

CREATE OR REPLACE FUNCTION public.printer_health()
 RETURNS TABLE(id uuid, name text, station text, protocol text, enabled boolean, online boolean, last_seen_at timestamp with time zone, last_status text, last_error text, waiting integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_venue uuid := public.current_venue();
BEGIN
  IF NOT public.can_staff(v_venue) THEN
    RAISE EXCEPTION 'Only staff can see printer health' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  SELECT p.id, p.name, p.station, p.protocol, p.enabled,
         COALESCE(p.enabled AND p.last_seen_at > now() - interval '60 seconds', false) AS online,
         p.last_seen_at, p.last_status, p.last_error,
         (SELECT count(*)::int
            FROM public.cloud_print_candidates(public.printer_ticket_types(p.station)) c
           WHERE c.venue_id = p.venue_id) AS waiting
    FROM public.printers p
   WHERE p.venue_id = v_venue
   ORDER BY p.created_at;
END;
$function$;

CREATE OR REPLACE FUNCTION public.requeue_stale_ticket_prints(_older_than_seconds integer DEFAULT 90)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_venue uuid := public.current_venue();
  v_rows int := 0;
  v_cutoff int := GREATEST(30, LEAST(600, COALESCE(_older_than_seconds, 90)));
BEGIN
  IF NOT public.can_staff(v_venue) THEN
    RAISE EXCEPTION 'Only staff can sweep the print queue' USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE public.order_ticket_events
     SET status = 'failed',
         last_error = 'The device that claimed this ticket never reported back',
         claimed_by_device = NULL,
         claimed_at = NULL,
         updated_at = now()
   WHERE status = 'claimed'
     AND venue_id = v_venue
     AND claimed_at < now() - make_interval(secs => v_cutoff);

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$function$;

CREATE OR REPLACE FUNCTION public.run_daily_maintenance()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  IF auth.uid() IS NOT NULL AND NOT public.can_staff(v_venue) THEN
    RAISE EXCEPTION 'Only staff can run maintenance' USING ERRCODE = 'insufficient_privilege';
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

    -- Covers every restaurant for the scheduler, each with its own settings.
    v_stale := public.close_stale_orders();
    v_events := public.prune_analytics_events();
    v_decisions := public.prune_recommendation_decisions();
    PERFORM public.refresh_guest_profiles();

    -- Per restaurant: a signed-in caller's own, every one for the scheduler.
    FOR v IN
      SELECT id FROM public.venues
       WHERE auth.uid() IS NULL OR id = v_venue
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
$function$;

CREATE OR REPLACE FUNCTION public.staff_bump_order_item(_item_id uuid, _status order_item_status)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_item public.order_items;
  v_order public.orders;
  v_venue uuid;
  v_window int;
  v_backwards boolean;
  v_left_at timestamptz;
BEGIN
  IF NOT public.is_staff_member() THEN
    RAISE EXCEPTION 'Only staff can bump items' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_item FROM public.order_items WHERE id = _item_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order line not found'; END IF;

  v_venue := v_item.venue_id;
  IF NOT public.can_staff(v_venue) THEN
    RAISE EXCEPTION 'Only staff can bump items' USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM public.use_venue(v_venue);

  v_window := COALESCE((SELECT kitchen_undo_seconds FROM public.restaurant_settings WHERE venue_id = v_venue), 90);

  IF v_item.status = _status THEN
    RETURN jsonb_build_object('item_id', _item_id, 'item_status', _status, 'changed', false);
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = v_item.order_id;
  IF v_order.status IN ('awaiting_payment', 'payment_failed') THEN
    RAISE EXCEPTION 'This order has not been paid for yet — it is not in the kitchen';
  END IF;
  IF v_order.status = 'cancelled' THEN
    RAISE EXCEPTION 'This order was cancelled';
  END IF;

  v_backwards := public.order_item_status_rank(_status) < public.order_item_status_rank(v_item.status);

  IF v_backwards THEN
    -- Undo is time-boxed against the stamp of the state being left, so a
    -- mis-tap is recoverable and a half-hour-old mistake is not quietly rewritten.
    v_left_at := CASE v_item.status
      WHEN 'preparing' THEN v_item.started_at
      WHEN 'ready' THEN v_item.ready_at
      WHEN 'served' THEN v_item.served_at
      ELSE NULL END;

    IF v_left_at IS NULL OR v_left_at < now() - make_interval(secs => v_window) THEN
      RAISE EXCEPTION 'The undo window for this line has passed'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  PERFORM set_config('lasoul.item_ctx', 'on', true);

  UPDATE public.order_items
     SET status = _status,
         bumped_by = auth.uid(),
         started_at = CASE WHEN _status = 'preparing' THEN COALESCE(started_at, now())
                           WHEN v_backwards AND _status = 'pending' THEN NULL ELSE started_at END,
         ready_at   = CASE WHEN _status = 'ready' THEN COALESCE(ready_at, now())
                           WHEN v_backwards AND _status IN ('pending', 'preparing') THEN NULL ELSE ready_at END,
         served_at  = CASE WHEN _status = 'served' THEN COALESCE(served_at, now())
                           WHEN v_backwards THEN NULL ELSE served_at END
   WHERE id = _item_id;

  PERFORM public.write_audit(
    CASE WHEN v_backwards THEN 'order_item.reverted' ELSE 'order_item.bumped' END,
    'order_item', _item_id,
    jsonb_build_object('status', v_item.status),
    jsonb_build_object('status', _status));

  SELECT * INTO v_order FROM public.orders WHERE id = v_item.order_id;

  RETURN jsonb_build_object(
    'item_id', _item_id,
    'item_status', _status,
    'changed', true,
    'order_id', v_order.id,
    'order_status', v_order.status,
    'undo_seconds', v_window
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.staff_revert_order_status(_order_id uuid, _to order_status, _reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_order public.orders;
  v_venue uuid;
  v_window int;
  v_left_at timestamptz;
  v_is_admin boolean;
BEGIN
  IF NOT public.is_staff_member() THEN
    RAISE EXCEPTION 'Only staff can undo' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = _order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;

  v_venue := v_order.venue_id;
  IF NOT public.can_staff(v_venue) THEN
    RAISE EXCEPTION 'Only staff can undo' USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM public.use_venue(v_venue);

  v_window := COALESCE((SELECT kitchen_undo_seconds FROM public.restaurant_settings WHERE venue_id = v_venue), 90);
  -- A manager of this order's restaurant.
  v_is_admin := public.can_admin(v_venue);

  IF NOT public.order_revert_allowed(v_order.status, _to) THEN
    RAISE EXCEPTION 'Cannot undo % back to %', v_order.status, _to
      USING ERRCODE = 'check_violation';
  END IF;

  v_left_at := CASE v_order.status
    WHEN 'confirmed' THEN v_order.confirmed_at
    WHEN 'preparing' THEN v_order.preparing_at
    WHEN 'ready' THEN v_order.ready_at
    WHEN 'served' THEN v_order.served_at
    ELSE NULL END;

  IF v_left_at IS NULL OR v_left_at < now() - make_interval(secs => v_window) THEN
    RAISE EXCEPTION 'The undo window has passed — ask a manager'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Money already moved: a manager decision, not a line-cook one.
  IF v_order.status = 'served' AND v_order.payment_status = 'paid' AND NOT v_is_admin THEN
    RAISE EXCEPTION 'A manager must undo a served order that has been paid for'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  PERFORM set_config('lasoul.revert_ctx', 'on', true);

  UPDATE public.orders
     SET status = _to,
         -- Clear only the stamp of the state being left. The earlier stamps
         -- stand: the order genuinely was in prep for that whole time.
         served_at    = CASE WHEN public.order_status_rank(_to) < 50 THEN NULL ELSE served_at END,
         ready_at     = CASE WHEN public.order_status_rank(_to) < 40 THEN NULL ELSE ready_at END,
         preparing_at = CASE WHEN public.order_status_rank(_to) < 30 THEN NULL ELSE preparing_at END,
         confirmed_at = CASE WHEN public.order_status_rank(_to) < 20 THEN NULL ELSE confirmed_at END
   WHERE id = _order_id;

  PERFORM set_config('lasoul.item_ctx', 'on', true);
  UPDATE public.order_items
     SET status = CASE
           WHEN _to = 'ready' THEN 'ready'
           WHEN _to IN ('preparing', 'confirmed') THEN 'preparing'
           ELSE 'pending' END::public.order_item_status,
         served_at = CASE WHEN public.order_status_rank(_to) < 50 THEN NULL ELSE served_at END,
         ready_at  = CASE WHEN public.order_status_rank(_to) < 40 THEN NULL ELSE ready_at END
   WHERE order_id = _order_id
     AND public.order_item_status_rank(status) > CASE
           WHEN _to = 'ready' THEN 30 WHEN _to IN ('preparing', 'confirmed') THEN 20 ELSE 10 END;

  PERFORM public.write_audit('order.status_reverted', 'order', _order_id,
    jsonb_build_object('status', v_order.status, 'age_seconds', round(EXTRACT(EPOCH FROM (now() - v_left_at)))),
    jsonb_build_object('status', _to), _reason);

  RETURN jsonb_build_object('status', _to, 'reverted_from', v_order.status);
END;
$function$;

CREATE OR REPLACE FUNCTION public.station_timings(_days integer DEFAULT 28)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_venue uuid := public.current_venue();
  v_days int := LEAST(GREATEST(COALESCE(_days, 28), 7), 90);
  v_today date := public.business_day();
  v_start timestamptz;
  v_now_part text := public.daypart_of(now());
  v_baseline jsonb;
  v_now jsonb;
BEGIN
  IF NOT public.can_staff(v_venue) THEN
    RAISE EXCEPTION 'Only staff can read service times' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT starts_at INTO v_start FROM public.business_day_range(v_today - v_days);

  WITH tickets AS (
    SELECT o.id AS t_order,
           oi.station AS t_station,
           COALESCE(o.released_to_kitchen_at, o.created_at) AS t_sent,
           max(oi.ready_at) AS t_ready
      FROM public.completed_orders o
      JOIN public.order_items oi ON oi.order_id = o.id
     WHERE o.created_at >= v_start
       AND oi.venue_id = v_venue
     GROUP BY o.id, oi.station, COALESCE(o.released_to_kitchen_at, o.created_at)
    -- A ticket is done when every one of its lines is.
    HAVING count(*) = count(oi.ready_at)
  ),
  t AS (
    SELECT t_station AS station,
           public.business_day(t_sent) AS day,
           public.daypart_of(t_sent) AS part,
           t_ready AS ready,
           EXTRACT(EPOCH FROM (t_ready - t_sent)) / 60.0 AS minutes
      FROM tickets
     WHERE t_ready >= t_sent
  ),
  base AS (
    SELECT station, part, count(*)::int AS n,
           percentile_disc(0.5) WITHIN GROUP (ORDER BY minutes) AS p50,
           percentile_disc(0.9) WITHIN GROUP (ORDER BY minutes) AS p90
      FROM t WHERE day < v_today
     GROUP BY GROUPING SETS ((station, part), (station))
  ),
  recent AS (
    SELECT station, count(*)::int AS n,
           percentile_disc(0.5) WITHIN GROUP (ORDER BY minutes) AS p50,
           percentile_disc(0.9) WITHIN GROUP (ORDER BY minutes) AS p90
      FROM t WHERE ready >= now() - interval '2 hours'
     GROUP BY station
  ),
  compared AS (
    SELECT r.station, r.n, r.p50, r.p90,
           -- The same daypart's baseline when it has enough tickets, else the
           -- station's whole-day baseline.
           CASE WHEN bp.n >= 20 THEN bp.p90 ELSE ba.p90 END AS b_p90,
           CASE WHEN bp.n >= 20 THEN bp.n ELSE ba.n END AS b_n,
           CASE WHEN bp.n >= 20 THEN v_now_part ELSE 'all' END AS b_part
      FROM recent r
      LEFT JOIN base bp ON bp.station = r.station AND bp.part = v_now_part
      LEFT JOIN base ba ON ba.station = r.station AND ba.part IS NULL
  )
  SELECT
    (SELECT COALESCE(jsonb_agg(jsonb_build_object(
              'station', b.station, 'daypart', COALESCE(b.part, 'all'), 'tickets', b.n,
              'p50', round(b.p50::numeric, 1), 'p90', round(b.p90::numeric, 1))
            ORDER BY b.station, b.part NULLS FIRST), '[]'::jsonb) FROM base b),
    (SELECT COALESCE(jsonb_agg(jsonb_build_object(
              'station', c.station, 'daypart', v_now_part, 'tickets', c.n,
              'p50', round(c.p50::numeric, 1), 'p90', round(c.p90::numeric, 1),
              'baseline_p90', round(c.b_p90::numeric, 1), 'baseline_tickets', COALESCE(c.b_n, 0),
              'baseline_daypart', c.b_part,
              'ratio', CASE WHEN c.b_p90 > 0 THEN round((c.p90 / c.b_p90)::numeric, 2) END,
              'status', CASE
                          WHEN COALESCE(c.b_n, 0) < 20 THEN 'learning'
                          WHEN c.n < 10 THEN 'too_few_tickets'
                          WHEN c.p90 > 1.3 * c.b_p90 THEN 'slow'
                          ELSE 'normal' END,
              'alert', COALESCE(c.b_n, 0) >= 20 AND c.n >= 10 AND c.p90 > 1.3 * c.b_p90)
            ORDER BY c.station), '[]'::jsonb) FROM compared c)
    INTO v_baseline, v_now;

  RETURN jsonb_build_object(
    'window_days', v_days,
    'daypart_now', v_now_part,
    'baseline', v_baseline,
    'now', v_now);
END;
$function$;

-- C. Reports: sales, staff and menu numbers for the restaurant being looked at, and only for an admin of it.

CREATE OR REPLACE FUNCTION public.analytics_item_days(_from date, _to date)
 RETURNS TABLE(item_id uuid, day date, visits integer, basis text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  v_venue uuid := public.current_venue();
  v_from timestamptz;
  v_to timestamptz;
BEGIN
  IF NOT public.can_staff(v_venue) THEN
    RAISE EXCEPTION 'Only staff can read analytics' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _from IS NULL OR _to IS NULL OR _to < _from THEN
    RETURN;
  END IF;

  SELECT starts_at INTO v_from FROM public.business_day_range(_from);
  SELECT ends_at INTO v_to FROM public.business_day_range(_to);

  RETURN QUERY
  WITH td AS (
    -- analytics_trading_days keeps to current_venue(), the same restaurant as v_venue.
    SELECT t.day AS t_day, t.visits AS t_visits, r.starts_at AS t_start, r.ends_at AS t_end
      FROM public.analytics_trading_days(_from, _to) t
      CROSS JOIN LATERAL public.business_day_range(t.day) r
  ),
  sold AS (
    SELECT DISTINCT oi.menu_item_id AS s_item, public.business_day(co.created_at) AS s_day
      FROM public.order_items oi
      JOIN public.completed_orders co ON co.id = oi.order_id
      JOIN public.orders o ON o.id = co.id AND o.venue_id = v_venue
     WHERE co.created_at >= v_from AND co.created_at < v_to
  ),
  last_sold AS (
    SELECT s_item AS ls_item, max(s_day) AS ls_day FROM sold GROUP BY 1
  ),
  logged AS (
    SELECT DISTINCT l.menu_item_id AS lg_item FROM public.menu_item_availability_log l
     WHERE l.venue_id = v_venue
  ),
  grid AS (
    SELECT mi.id AS g_item, mi.is_available AS g_now, td.*,
           (lg.lg_item IS NOT NULL) AS g_logged,
           ls.ls_day AS g_last_sold,
           EXISTS (SELECT 1 FROM sold s WHERE s.s_item = mi.id AND s.s_day = td.t_day) AS g_sold
      FROM public.menu_items mi
      CROSS JOIN td
      LEFT JOIN logged lg ON lg.lg_item = mi.id
      LEFT JOIN last_sold ls ON ls.ls_item = mi.id
     WHERE mi.venue_id = v_venue
       AND td.t_day >= public.business_day(mi.created_at)
  ),
  judged AS (
    SELECT g.*,
           CASE
             WHEN g.g_sold THEN 'sold'
             WHEN g.g_logged AND (
                    -- State at the start of the day: the last change before it,
                    -- or, if every change came later, the opposite of the first.
                    COALESCE(
                      (SELECT l.is_available FROM public.menu_item_availability_log l
                        WHERE l.menu_item_id = g.g_item AND l.changed_at < g.t_start
                        ORDER BY l.changed_at DESC, l.id DESC LIMIT 1),
                      (SELECT NOT l.is_available FROM public.menu_item_availability_log l
                        WHERE l.menu_item_id = g.g_item
                        ORDER BY l.changed_at, l.id LIMIT 1))
                    -- …or switched back on at some point during it.
                    OR EXISTS (SELECT 1 FROM public.menu_item_availability_log l
                                WHERE l.menu_item_id = g.g_item
                                  AND l.changed_at >= g.t_start AND l.changed_at < g.t_end
                                  AND l.is_available))
               THEN 'logged'
             WHEN NOT g.g_logged AND (g.g_now OR g.t_day <= g.g_last_sold) THEN 'assumed'
           END AS g_basis
      FROM grid g
  )
  SELECT j.g_item, j.t_day, j.t_visits, j.g_basis
    FROM judged j
   WHERE j.g_basis IS NOT NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.analytics_trading_days(_from date, _to date)
 RETURNS TABLE(day date, visits integer, orders integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  v_venue uuid := public.current_venue();
  v_from timestamptz;
  v_to timestamptz;
BEGIN
  IF NOT public.can_staff(v_venue) THEN
    RAISE EXCEPTION 'Only staff can read analytics' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _from IS NULL OR _to IS NULL OR _to < _from THEN
    RETURN;
  END IF;

  SELECT starts_at INTO v_from FROM public.business_day_range(_from);
  SELECT ends_at INTO v_to FROM public.business_day_range(_to);

  RETURN QUERY
  SELECT public.business_day(co.created_at),
         count(DISTINCT co.table_session_id)::int,
         count(*)::int
    FROM public.completed_orders co
    JOIN public.orders o ON o.id = co.id AND o.venue_id = v_venue
   WHERE co.created_at >= v_from AND co.created_at < v_to
   GROUP BY 1;
END;
$function$;

CREATE OR REPLACE FUNCTION public.daily_anomalies()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_venue uuid := public.current_venue();
  v_today date := public.business_day();
  v_today_start timestamptz;
  v_start timestamptz;
  v_offset interval;
  v_days jsonb;
  v_pace jsonb;
BEGIN
  IF NOT public.can_staff(v_venue) THEN
    RAISE EXCEPTION 'Only staff can read analytics' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT starts_at INTO v_today_start FROM public.business_day_range(v_today);
  SELECT starts_at INTO v_start FROM public.business_day_range(v_today - 56);
  v_offset := now() - v_today_start;

  -- The last fourteen complete trading days, each against its own weekday.
  WITH daily AS (
    SELECT public.business_day(co.created_at) AS day,
           sum(co.total - COALESCE(co.tip_amount, 0) - COALESCE(co.refunded_amount, 0)) AS net
      FROM public.completed_orders co
      JOIN public.orders o ON o.id = co.id AND o.venue_id = v_venue
     WHERE co.created_at >= v_start AND co.created_at < v_today_start
     GROUP BY 1
  ),
  eval AS (
    SELECT g::date AS d FROM generate_series(v_today - 14, v_today - 1, interval '1 day') g
  ),
  hist AS (
    SELECT e.d, h.net
      FROM eval e
      JOIN daily h ON h.day = ANY (ARRAY[e.d - 7, e.d - 14, e.d - 21, e.d - 28, e.d - 35, e.d - 42])
  ),
  med AS (
    SELECT d, count(*)::int AS n, percentile_cont(0.5) WITHIN GROUP (ORDER BY net) AS med
      FROM hist GROUP BY d
  ),
  mad AS (
    SELECT h.d, percentile_cont(0.5) WITHIN GROUP (ORDER BY abs(h.net - m.med)) AS mad
      FROM hist h JOIN med m ON m.d = h.d GROUP BY h.d
  ),
  scored AS (
    SELECT e.d, COALESCE(dl.net, 0) AS net, dl.day IS NOT NULL AS traded,
           COALESCE(m.n, 0) AS n, m.med,
           GREATEST(1.4826 * COALESCE(md.mad, 0), 0.05 * COALESCE(m.med, 0), 1) AS scale
      FROM eval e
      LEFT JOIN daily dl ON dl.day = e.d
      LEFT JOIN med m ON m.d = e.d
      LEFT JOIN mad md ON md.d = e.d
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'day', s.d,
           'weekday', to_char(s.d, 'FMDay'),
           'net', round(s.net::numeric, 2),
           'traded', s.traded,
           'history', s.n,
           'median', round(s.med::numeric, 2),
           'z', CASE WHEN s.med IS NOT NULL THEN round(((s.net - s.med) / s.scale)::numeric, 2) END,
           'status', CASE
                       WHEN NOT s.traded THEN 'closed'
                       WHEN s.n < 4 THEN 'learning'
                       WHEN abs((s.net - s.med) / s.scale) >= 3 THEN
                         CASE WHEN s.net < s.med THEN 'low' ELSE 'high' END
                       ELSE 'normal' END,
           'alert', s.traded AND s.n >= 4 AND abs((s.net - s.med) / s.scale) >= 3)
         ORDER BY s.d DESC), '[]'::jsonb)
    INTO v_days
    FROM scored s;

  -- Today so far, against the same moment of the same previous weekdays.
  WITH past AS (
    SELECT k, r.starts_at AS s0, r.ends_at AS s1
      FROM generate_series(1, 6) k
      CROSS JOIN LATERAL public.business_day_range(v_today - 7 * k) r
  ),
  past_net AS (
    SELECT p.k,
           sum(co.total - COALESCE(co.tip_amount, 0) - COALESCE(co.refunded_amount, 0)) AS full_net,
           COALESCE(sum(co.total - COALESCE(co.tip_amount, 0) - COALESCE(co.refunded_amount, 0))
                      FILTER (WHERE co.created_at < p.s0 + v_offset), 0) AS part_net
      FROM past p
      JOIN public.completed_orders co ON co.created_at >= p.s0 AND co.created_at < p.s1
      JOIN public.orders o ON o.id = co.id AND o.venue_id = v_venue
     GROUP BY p.k
    HAVING sum(co.total) > 0
  ),
  stats AS (
    SELECT count(*)::int AS n,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY full_net) AS usual_full,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY part_net) AS usual_part,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY part_net / NULLIF(full_net, 0)) AS usual_share
      FROM past_net
  ),
  spread AS (
    SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY abs(p.part_net - s.usual_part)) AS mad
      FROM past_net p CROSS JOIN stats s
  ),
  today AS (
    SELECT COALESCE(sum(co.total - COALESCE(co.tip_amount, 0) - COALESCE(co.refunded_amount, 0)), 0) AS so_far
      FROM public.completed_orders co
      JOIN public.orders o ON o.id = co.id AND o.venue_id = v_venue
     WHERE co.created_at >= v_today_start AND co.created_at < now()
  ),
  scored AS (
    SELECT t.so_far, s.n, s.usual_full, s.usual_part, s.usual_share,
           GREATEST(1.4826 * COALESCE(sp.mad, 0), 0.05 * COALESCE(s.usual_part, 0), 1) AS scale
      FROM today t CROSS JOIN stats s CROSS JOIN spread sp
  )
  SELECT jsonb_build_object(
           'day', v_today,
           'so_far', round(s.so_far::numeric, 2),
           'history', s.n,
           'usual_so_far', round(s.usual_part::numeric, 2),
           'usual_total', round(s.usual_full::numeric, 2),
           'usual_share', round(s.usual_share::numeric, 3),
           'pace', CASE WHEN s.usual_part > 0 THEN round((s.so_far / s.usual_part)::numeric, 2) END,
           'projected', CASE WHEN s.usual_share >= 0.2 THEN round((s.so_far / s.usual_share)::numeric, 0) END,
           'z', CASE WHEN s.usual_part IS NOT NULL THEN round(((s.so_far - s.usual_part) / s.scale)::numeric, 2) END,
           'status', CASE
                       WHEN s.n < 4 THEN 'learning'
                       WHEN COALESCE(s.usual_share, 0) < 0.2 THEN 'too_early'
                       WHEN abs((s.so_far - s.usual_part) / s.scale) >= 3 THEN
                         CASE WHEN s.so_far < s.usual_part THEN 'behind' ELSE 'ahead' END
                       ELSE 'normal' END,
           'alert', s.n >= 4 AND COALESCE(s.usual_share, 0) >= 0.2
                    AND abs((s.so_far - s.usual_part) / s.scale) >= 3)
    INTO v_pace
    FROM scored s;

  RETURN jsonb_build_object('today', v_pace, 'days', v_days);
END;
$function$;

CREATE OR REPLACE FUNCTION public.default_cost_share(_role meal_role)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT LEAST(GREATEST(COALESCE(
           (s.default_cost_pct ->> COALESCE(_role::text, 'other'))::numeric,
           (s.default_cost_pct ->> 'other')::numeric,
           0.30), 0), 0.95)
    FROM (SELECT default_cost_pct FROM public.restaurant_settings WHERE venue_id = public.current_venue()
          UNION ALL SELECT NULL::jsonb LIMIT 1) s;
$function$;

CREATE OR REPLACE FUNCTION public.food_cost_coverage()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'items', count(*),
    'with_cost', count(*) FILTER (WHERE food_cost IS NOT NULL),
    'coverage', CASE WHEN count(*) = 0 THEN 0
                     ELSE round(count(*) FILTER (WHERE food_cost IS NOT NULL)::numeric / count(*), 3) END)
    FROM public.menu_items WHERE is_available AND venue_id = public.current_venue();
$function$;

CREATE OR REPLACE FUNCTION public.item_trends(_recent_days integer DEFAULT 14, _prior_days integer DEFAULT 56)
 RETURNS TABLE(item_id uuid, name text, is_available boolean, k1 bigint, k0 bigint, e1 bigint, e0 bigint, days1 integer, days0 integer, units1 bigint, price numeric, unit_cm numeric, cost_estimated boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  v_venue uuid := public.current_venue();
  v_recent int := LEAST(GREATEST(COALESCE(_recent_days, 14), 7), 60);
  v_prior int := LEAST(GREATEST(COALESCE(_prior_days, 56), 7), 180);
  v_to date := public.business_day() - 1;
  v_split date;
  v_from date;
  v_start timestamptz;
  v_end timestamptz;
BEGIN
  IF NOT public.can_staff(v_venue) THEN
    RAISE EXCEPTION 'Only staff can read menu intelligence' USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_split := v_to - v_recent + 1;           -- first day of the recent window
  v_from := v_split - v_prior;              -- first day of the prior window
  SELECT starts_at INTO v_start FROM public.business_day_range(v_from);
  SELECT ends_at INTO v_end FROM public.business_day_range(v_to);

  RETURN QUERY
  WITH days AS (
    SELECT d.item_id AS d_item, d.day AS d_day, d.visits AS d_visits
      FROM public.analytics_item_days(v_from, v_to) d
  ),
  sold AS (
    SELECT oi.menu_item_id AS s_item,
           public.business_day(co.created_at) AS s_day,
           count(DISTINCT co.id)::bigint AS s_orders,
           sum(oi.quantity)::bigint AS s_units
      FROM public.order_items oi
      JOIN public.completed_orders co ON co.id = oi.order_id
      JOIN public.orders o ON o.id = co.id AND o.venue_id = v_venue
     WHERE co.created_at >= v_start AND co.created_at < v_end
     GROUP BY 1, 2
  ),
  per_item AS (
    SELECT d.d_item AS p_item,
           COALESCE(sum(s.s_orders) FILTER (WHERE d.d_day >= v_split), 0)::bigint AS p_k1,
           COALESCE(sum(s.s_orders) FILTER (WHERE d.d_day <  v_split), 0)::bigint AS p_k0,
           COALESCE(sum(d.d_visits) FILTER (WHERE d.d_day >= v_split), 0)::bigint AS p_e1,
           COALESCE(sum(d.d_visits) FILTER (WHERE d.d_day <  v_split), 0)::bigint AS p_e0,
           (count(*) FILTER (WHERE d.d_day >= v_split))::int AS p_days1,
           (count(*) FILTER (WHERE d.d_day <  v_split))::int AS p_days0,
           COALESCE(sum(s.s_units) FILTER (WHERE d.d_day >= v_split), 0)::bigint AS p_units1
      FROM days d
      LEFT JOIN sold s ON s.s_item = d.d_item AND s.s_day = d.d_day
     GROUP BY d.d_item
  )
  SELECT mi.id, mi.name, mi.is_available,
         p.p_k1, p.p_k0, p.p_e1, p.p_e0, p.p_days1, p.p_days0, p.p_units1,
         m.price, m.unit_cm, m.cost_estimated
    FROM per_item p
    JOIN public.menu_items mi ON mi.id = p.p_item
    JOIN public.menu_unit_margins() m ON m.item_id = mi.id
   WHERE mi.venue_id = v_venue
   ORDER BY mi.name, mi.id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.looked_at_not_ordered(_days integer DEFAULT 30, _limit integer DEFAULT 8)
 RETURNS TABLE(item_id uuid, name text, views bigint, adds bigint, orders bigint, order_rate numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  v_venue uuid := public.current_venue();
BEGIN
  IF NOT public.can_staff(v_venue) THEN
    RAISE EXCEPTION 'Only staff can read menu intelligence' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  SELECT p.item_id, p.name, p.views, p.adds, p.orders, p.order_rate
    FROM public.menu_item_performance(_days) p
   WHERE p.is_available
     AND p.views >= 20
     AND COALESCE(p.order_rate, 0) < 10
   ORDER BY p.views DESC, p.name
   LIMIT LEAST(GREATEST(COALESCE(_limit, 8), 1), 50);
END;
$function$;

CREATE OR REPLACE FUNCTION public.management_insights(_days integer DEFAULT 28, _min_km numeric DEFAULT 20)
 RETURNS TABLE(kind text, item_id uuid, related_item_id uuid, headline text, why text, action text, est_km_per_week numeric, confidence text, evidence integer, evidence_label text, link text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  v_venue uuid := public.current_venue();
  v_days int := LEAST(GREATEST(COALESCE(_days, 28), 7), 120);
  v_floor numeric := GREATEST(COALESCE(_min_km, 20), 0);
  v_trading_per_week numeric;
  v_take_up numeric;
  v_seen bigint;
  v_paid bigint;
BEGIN
  IF NOT public.can_staff(v_venue) THEN
    RAISE EXCEPTION 'Only staff can read menu intelligence' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT count(*)::numeric * 7 / v_days INTO v_trading_per_week
    FROM public.analytics_trading_days(public.business_day() - v_days, public.business_day() - 1);

  -- Measured suggestion take-up: paid of seen over the last 90 days.
  SELECT count(*),
         count(*) FILTER (WHERE EXISTS (
           SELECT 1 FROM public.suggestion_conversions sc
             JOIN public.completed_orders co ON co.id = sc.order_id
            WHERE sc.decision_id = i.decision_id))
    INTO v_seen, v_paid
    FROM public.recommendation_impressions i
    JOIN public.recommendation_decisions d ON d.id = i.decision_id
    LEFT JOIN public.table_sessions ts ON ts.id = d.session_id
    LEFT JOIN public.menu_items dm ON dm.id = d.chosen_item_id
   WHERE i.seen_at > now() - interval '90 days'
     -- A decision without a session belongs to its dish's restaurant, else La Soul.
     AND COALESCE(ts.venue_id, dm.venue_id, public.default_venue()) = v_venue;
  v_take_up := CASE WHEN v_seen >= 200 THEN v_paid::numeric / v_seen ELSE 0.05 END;

  RETURN QUERY
  WITH me AS (
    SELECT * FROM public.menu_engineering(v_days)
  ),
  class_name AS (
    SELECT m.item_id AS cn_item,
           CASE m.menu_class
             WHEN 'main' THEN 'mains' WHEN 'starter' THEN 'starters' WHEN 'side' THEN 'sides'
             WHEN 'dessert' THEN 'desserts' WHEN 'hot_drink' THEN 'hot drinks'
             WHEN 'cold_drink' THEN 'cold drinks' WHEN 'alcohol' THEN 'alcoholic drinks'
             ELSE 'other items' END AS cn_label
      FROM me m
  ),
  puzzles AS (
    SELECT 'puzzle'::text AS k, m.item_id AS i1, NULL::uuid AS i2,
           format('%s earns well but few order it', m.name) AS h,
           format('It keeps %s KM a portion against %s KM for the average of your %s, but only %s%% of %s orders pick it (popular starts at %s%%).%s',
                  round(m.unit_cm, 2), round(m.class_avg_cm, 2), cn.cn_label,
                  round(100 * m.menu_mix, 1), cn.cn_label, round(100 * m.popularity_threshold, 1),
                  CASE WHEN m.cost_estimated THEN ' Margin uses an estimated food cost.' ELSE '' END) AS w,
           format('Rename %s, give it a better photo and move it up its section', m.name) AS a,
           GREATEST(m.popularity_threshold * m.class_units_per_week - m.units_per_week, 0)
             * (m.unit_cm - m.class_avg_cm) AS km,
           'high'::text AS c, m.class_lines::int AS ev, format('%s orders', cn.cn_label) AS evl,
           '/admin/menu-intelligence#engineering'::text AS l
      FROM me m JOIN class_name cn ON cn.cn_item = m.item_id
     WHERE m.quadrant = 'puzzle'
  ),
  dogs AS (
    SELECT 'dog'::text, m.item_id, NULL::uuid,
           format('%s sells little and earns little', m.name),
           format('%s%% of %s orders, and %s KM a portion against a %s KM average.%s',
                  round(100 * m.menu_mix, 1), cn.cn_label, round(m.unit_cm, 2), round(m.class_avg_cm, 2),
                  CASE WHEN m.cost_estimated THEN ' Margin uses an estimated food cost.' ELSE '' END),
           format('Take %s off the menu, unless it is there on purpose as a cheaper anchor', m.name),
           m.units_per_week * GREATEST(m.class_avg_cm - m.unit_cm, 0),
           'high'::text, m.class_lines::int, format('%s orders', cn.cn_label),
           '/admin/menu-intelligence#engineering'::text
      FROM me m JOIN class_name cn ON cn.cn_item = m.item_id
     WHERE m.quadrant = 'dog'
  ),
  perf AS (
    SELECT p.*, mu.unit_cm AS cm
      FROM public.menu_item_performance(v_days) p
      JOIN public.menu_unit_margins() mu ON mu.item_id = p.item_id
  ),
  typical AS (
    SELECT (percentile_cont(0.5) WITHIN GROUP (ORDER BY p.orders::numeric / p.views))::numeric AS rate
      FROM perf p WHERE p.is_available AND p.views >= 20
  ),
  leaks AS (
    SELECT 'leak'::text, p.item_id, NULL::uuid,
           format('%s is looked at but rarely ordered', p.name),
           format('%s looks and %s %s: %s%% against %s%% for a typical dish. Usually the photo, the description or the price.',
                  p.views, p.orders, CASE WHEN p.orders = 1 THEN 'order' ELSE 'orders' END,
                  round(100.0 * p.orders / p.views, 1), round(100 * t.rate, 1)),
           format('Rewrite the description of %s, re-photograph it, or check its price', p.name),
           p.views * 7.0 / v_days * GREATEST(t.rate - p.orders::numeric / p.views, 0) * p.cm,
           'high'::text, p.views::int, 'looks at the dish'::text,
           '/admin/menu-intelligence#leaks'::text
      FROM perf p
      CROSS JOIN typical t
      CROSS JOIN LATERAL public.wilson_interval(p.orders::numeric / p.views, p.views::numeric) w
     WHERE p.is_available AND p.views >= 20 AND t.rate > 0
       AND w.high < t.rate
  ),
  sold_out AS (
    SELECT 'sold_out'::text, s.item_id, NULL::uuid,
           format('%s has been sold out', s.name),
           format('While it was on, it took about %s KM on a typical trading day (%s days of sales). Some guests will have ordered something else, so this is the most it is costing.',
                  round(s.avg_daily_revenue_when_available, 0), s.selling_days),
           format('Bring %s back, or replace it with something similar', s.name),
           s.avg_daily_revenue_when_available * (mu.unit_cm / NULLIF(mu.price, 0)) * v_trading_per_week,
           'medium'::text, s.selling_days, 'trading days of sales'::text,
           '/admin/menu'::text
      FROM public.sold_out_impact(v_days) s
      JOIN public.menu_unit_margins() mu ON mu.item_id = s.item_id
     WHERE s.selling_days >= 3
  ),
  anomalies AS (
    SELECT 'anomaly'::text, NULL::uuid, NULL::uuid,
           format('%s was %s%% %s a usual %s',
                  to_char((d ->> 'day')::date, 'FMDay DD Mon'),
                  abs(round(100 * ((d ->> 'net')::numeric / NULLIF((d ->> 'median')::numeric, 0) - 1))),
                  CASE WHEN (d ->> 'net')::numeric < (d ->> 'median')::numeric THEN 'below' ELSE 'above' END,
                  d ->> 'weekday'),
           format('%s KM against a median of %s KM over the last %s %ss — further out than ordinary weeks go.',
                  round((d ->> 'net')::numeric, 0), round((d ->> 'median')::numeric, 0),
                  d ->> 'history', d ->> 'weekday'),
           CASE WHEN (d ->> 'net')::numeric < (d ->> 'median')::numeric
                THEN 'Find out what was different that day: staffing, weather, an event nearby, a closed section, the QR codes'
                ELSE 'Find out what went right that day, and whether it can be repeated' END,
           abs((d ->> 'net')::numeric - (d ->> 'median')::numeric),
           'high'::text, (d ->> 'history')::int, format('previous %ss', d ->> 'weekday'),
           '/admin/analytics'::text
      FROM jsonb_array_elements(public.daily_anomalies() -> 'days') d
     WHERE (d ->> 'alert')::boolean
       AND (d ->> 'day')::date >= public.business_day() - 7
  ),
  pairs AS (
    SELECT a.item_a, a.item_b, ma.name AS name_a, mb.name AS name_b,
           a.pair_orders, a.a_orders, a.confidence, a.lift, mu.unit_cm AS cm_b,
           public.wilson_lower(a.pair_orders, a.a_orders, 1.2816)
             / NULLIF(a.confidence / NULLIF(a.lift, 0), 0) AS lift_low,
           -- menu_item_affinity is rebuilt over the last 90 days of orders.
           a.a_orders * 7.0 / 90 * (1 - a.confidence) * v_take_up * mu.unit_cm AS km
      FROM public.menu_item_affinity a
      JOIN public.menu_items ma ON ma.id = a.item_a AND ma.is_available AND ma.venue_id = v_venue
      JOIN public.menu_items mb ON mb.id = a.item_b AND mb.is_available AND mb.venue_id = v_venue
      JOIN public.menu_unit_margins() mu ON mu.item_id = a.item_b
     WHERE a.pair_orders >= 10
       AND NOT EXISTS (
         SELECT 1 FROM public.menu_item_recommendations r
          WHERE r.enabled
            AND ((r.source_item_id = a.item_a AND r.recommended_item_id = a.item_b)
              OR (r.source_item_id = a.item_b AND r.recommended_item_id = a.item_a)))
  ),
  best_pairs AS (
    -- One direction per pair: the one worth more.
    SELECT DISTINCT ON (LEAST(p.item_a, p.item_b), GREATEST(p.item_a, p.item_b)) p.*
      FROM pairs p
     WHERE p.lift_low >= 1.2
     ORDER BY LEAST(p.item_a, p.item_b), GREATEST(p.item_a, p.item_b), p.km DESC
  ),
  pairings AS (
    SELECT 'pairing'::text, p.item_a, p.item_b,
           format('Suggest %s with %s', p.name_b, p.name_a),
           format('%s of %s orders with %s also had %s — %s× more often than chance. It is not a suggestion yet.',
                  p.pair_orders, p.a_orders, p.name_a, p.name_b, round(p.lift, 1)),
           format('Add %s as a suggestion for %s', p.name_b, p.name_a),
           p.km,
           'medium'::text, p.a_orders, format('orders with %s', p.name_a),
           '/admin/menu-intelligence#pairings'::text
      FROM best_pairs p
  ),
  placement_avg AS (
    SELECT st.placement AS pa_placement,
           sum(st.attributed_revenue) / NULLIF(sum(st.shown), 0) AS pa_rpi
      FROM public.suggestion_stats st
      JOIN public.menu_items mi ON mi.id = st.recommended_item_id AND mi.venue_id = v_venue
     WHERE st.daypart IS NULL
     GROUP BY 1
  ),
  retired AS (
    SELECT 'retired'::text, st.recommended_item_id, st.source_item_id,
           format('The suggestion %s → %s is not working', COALESCE(ms.name, 'any order'), mr.name),
           format('Shown %s times, taken %s times (%s%%). The engine has stopped trusting it, but your rule keeps it switched on.',
                  st.shown, st.accepted, round(100.0 * st.accepted / NULLIF(st.shown, 0), 1)),
           format('Switch off the rule %s → %s in Service & suggestions', COALESCE(ms.name, 'any order'), mr.name),
           st.shown * 7.0 / 90 * GREATEST(pa.pa_rpi - st.attributed_revenue / NULLIF(st.shown, 0), 0),
           'high'::text, st.shown, 'times shown'::text,
           '/admin/service'::text
      FROM public.suggestion_stats st
      JOIN public.menu_items mr ON mr.id = st.recommended_item_id AND mr.venue_id = v_venue
      LEFT JOIN public.menu_items ms ON ms.id = st.source_item_id
      JOIN placement_avg pa ON pa.pa_placement = st.placement
      CROSS JOIN public.restaurant_settings rs
      -- The engine's own rule (20261025100000_reco_learning_v3.sql): enough
      -- sightings, and even the optimistic end of its acceptance, under the
      -- dish's own prior, is below the floor.
      CROSS JOIN LATERAL public.suggestion_prior(st.recommended_item_id, st.placement) pr
     WHERE rs.venue_id = v_venue
       AND st.daypart IS NULL
       AND st.shown >= rs.reco_retire_after_impressions
       AND public.acceptance_retired(st.accepted, st.shown, pr.alpha0, pr.beta0, rs.reco_min_acceptance)
       AND EXISTS (SELECT 1 FROM public.menu_item_recommendations r
                    WHERE r.enabled
                      AND r.recommended_item_id = st.recommended_item_id
                      AND r.source_item_id IS NOT DISTINCT FROM st.source_item_id)
  ),
  everything AS (
    SELECT * FROM puzzles
    UNION ALL SELECT * FROM dogs
    UNION ALL SELECT * FROM leaks
    UNION ALL SELECT * FROM sold_out
    UNION ALL SELECT * FROM anomalies
    UNION ALL SELECT * FROM pairings
    UNION ALL SELECT * FROM retired
  )
  SELECT e.k, e.i1, e.i2, e.h, e.w, e.a, round(e.km, 0), e.c, e.ev, e.evl, e.l
    FROM everything e
   WHERE e.km IS NOT NULL AND e.km >= v_floor
   ORDER BY round(e.km, 0) DESC, e.k, e.h, e.i1;
END;
$function$;

CREATE OR REPLACE FUNCTION public.menu_engineering(_days integer DEFAULT 28)
 RETURNS TABLE(item_id uuid, name text, menu_class text, category_name text, is_available boolean, units bigint, lines bigint, revenue numeric, available_days integer, trading_days integer, availability_basis text, class_units bigint, class_lines bigint, class_items integer, menu_mix numeric, mix_low numeric, mix_high numeric, popularity_threshold numeric, price numeric, unit_cost numeric, unit_cm numeric, class_avg_cm numeric, cost_estimated boolean, popularity text, profitability text, quadrant text, units_per_week numeric, class_units_per_week numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  v_venue uuid := public.current_venue();
  v_days int := LEAST(GREATEST(COALESCE(_days, 28), 7), 120);
  -- Complete trading days only: today is still being written.
  v_to date := public.business_day() - 1;
  v_from date := public.business_day() - LEAST(GREATEST(COALESCE(_days, 28), 7), 120);
  v_start timestamptz;
  v_end timestamptz;
  v_trading int;
BEGIN
  IF NOT public.can_staff(v_venue) THEN
    RAISE EXCEPTION 'Only staff can read menu intelligence' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT starts_at INTO v_start FROM public.business_day_range(v_from);
  SELECT ends_at INTO v_end FROM public.business_day_range(v_to);
  SELECT count(*)::int INTO v_trading FROM public.analytics_trading_days(v_from, v_to);

  RETURN QUERY
  WITH items AS (
    SELECT mi.id AS i_id, mi.name AS i_name, mi.is_available AS i_avail,
           COALESCE(mi.meal_role::text, 'other') AS i_class,
           c.name AS i_category,
           m.price AS i_price, m.unit_cost AS i_cost, m.unit_cm AS i_cm, m.cost_estimated AS i_est
      FROM public.menu_items mi
      JOIN public.menu_unit_margins() m ON m.item_id = mi.id
      LEFT JOIN public.subcategories s ON s.id = mi.subcategory_id
      LEFT JOIN public.categories c ON c.id = s.category_id
     WHERE mi.venue_id = v_venue
  ),
  days AS (
    SELECT d.item_id AS d_item, d.day AS d_day, d.basis AS d_basis
      FROM public.analytics_item_days(v_from, v_to) d
  ),
  sold AS (
    SELECT oi.menu_item_id AS s_item,
           public.business_day(co.created_at) AS s_day,
           sum(oi.quantity)::bigint AS s_units,
           count(*)::bigint AS s_lines,
           sum(oi.quantity * oi.unit_price) AS s_revenue
      FROM public.order_items oi
      JOIN public.completed_orders co ON co.id = oi.order_id
      JOIN public.orders o ON o.id = co.id AND o.venue_id = v_venue
     WHERE co.created_at >= v_start AND co.created_at < v_end
     GROUP BY 1, 2
  ),
  class_day AS (
    SELECT i.i_class AS cd_class, s.s_day AS cd_day,
           sum(s.s_units)::bigint AS cd_units, sum(s.s_lines)::bigint AS cd_lines
      FROM sold s JOIN items i ON i.i_id = s.s_item
     GROUP BY 1, 2
  ),
  per_item AS (
    SELECT i.*,
           count(d.d_day)::int AS p_days,
           CASE WHEN bool_or(d.d_basis = 'assumed') THEN 'assumed' ELSE 'logged' END AS p_basis,
           COALESCE(sum(s.s_units), 0)::bigint AS p_units,
           COALESCE(sum(s.s_lines), 0)::bigint AS p_lines,
           COALESCE(sum(s.s_revenue), 0)::numeric AS p_revenue,
           COALESCE(sum(cd.cd_units), 0)::bigint AS p_class_units,
           COALESCE(sum(cd.cd_lines), 0)::bigint AS p_class_lines
      FROM items i
      JOIN days d ON d.d_item = i.i_id
      LEFT JOIN sold s ON s.s_item = i.i_id AND s.s_day = d.d_day
      LEFT JOIN class_day cd ON cd.cd_class = i.i_class AND cd.cd_day = d.d_day
     GROUP BY i.i_id, i.i_name, i.i_avail, i.i_class, i.i_category, i.i_price, i.i_cost, i.i_cm, i.i_est
  ),
  per_class AS (
    SELECT p.i_class AS c_class,
           count(*)::int AS c_items,
           CASE WHEN sum(p.p_units) > 0
                THEN sum(p.p_units * p.i_cm) / sum(p.p_units)
                ELSE avg(p.i_cm) END AS c_avg_cm
      FROM per_item p
     WHERE p.p_days > 0
     GROUP BY 1
  ),
  scored AS (
    SELECT p.*, pc.c_items, pc.c_avg_cm,
           0.7 / pc.c_items AS thr,
           CASE WHEN p.p_class_units > 0 THEN p.p_units::numeric / p.p_class_units END AS mix,
           w.low AS w_low, w.high AS w_high
      FROM per_item p
      JOIN per_class pc ON pc.c_class = p.i_class
      CROSS JOIN LATERAL public.wilson_interval(
        CASE WHEN p.p_class_units > 0 THEN p.p_units::numeric / p.p_class_units ELSE 0 END,
        p.p_class_lines::numeric) w
     WHERE p.p_days > 0
  ),
  labelled AS (
    SELECT s.*,
           CASE WHEN s.mix IS NULL OR s.p_class_lines = 0 THEN 'insufficient'
                WHEN s.w_low >= s.thr THEN 'high'
                WHEN s.w_high < s.thr THEN 'low'
                ELSE 'insufficient' END AS pop,
           CASE WHEN s.i_cm >= s.c_avg_cm THEN 'high' ELSE 'low' END AS prof
      FROM scored s
  )
  SELECT l.i_id, l.i_name, l.i_class, l.i_category, l.i_avail,
         l.p_units, l.p_lines, round(l.p_revenue, 2),
         l.p_days, v_trading, l.p_basis,
         l.p_class_units, l.p_class_lines, l.c_items,
         round(l.mix, 4), round(l.w_low, 4), round(l.w_high, 4), round(l.thr, 4),
         l.i_price, l.i_cost, l.i_cm, round(l.c_avg_cm, 2), l.i_est,
         l.pop, l.prof,
         CASE
           WHEN l.pop = 'insufficient' THEN 'insufficient'
           WHEN l.pop = 'high' AND l.prof = 'high' THEN 'star'
           WHEN l.pop = 'high' THEN 'plowhorse'
           WHEN l.prof = 'high' THEN 'puzzle'
           ELSE 'dog'
         END,
         -- Per week of trading, so a quiet month and a busy one compare.
         round(l.p_units::numeric / l.p_days * (v_trading::numeric * 7 / v_days), 2),
         round(l.p_class_units::numeric / l.p_days * (v_trading::numeric * 7 / v_days), 2)
    FROM labelled l
   ORDER BY l.i_class, l.p_units DESC, l.i_name;
END;
$function$;

CREATE OR REPLACE FUNCTION public.menu_item_performance(_days integer DEFAULT 30)
 RETURNS TABLE(item_id uuid, name text, category_name text, subcategory_name text, price numeric, is_available boolean, margin_score smallint, created_at timestamp with time zone, views bigint, adds bigint, removes bigint, orders bigint, units bigint, revenue numeric, add_rate numeric, order_rate numeric, abandon_rate numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  v_venue uuid := public.current_venue();
  v_since timestamptz := public.analytics_window_start(_days);
BEGIN
  IF NOT public.can_staff(v_venue) THEN
    RAISE EXCEPTION 'Only staff can read menu intelligence' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  WITH ev AS (
    SELECT public.analytics_uuid(e.props->>'item_id') AS ev_item,
           count(*) FILTER (WHERE e.event = 'item_viewed')       AS n_views,
           count(*) FILTER (WHERE e.event = 'item_added')        AS n_adds,
           count(*) FILTER (WHERE e.event = 'cart_item_removed') AS n_removes
      FROM public.analytics_events e
     WHERE e.occurred_at >= v_since
       AND COALESCE(e.venue_id, public.default_venue()) = v_venue
       AND e.event IN ('item_viewed', 'item_added', 'cart_item_removed')
       AND public.analytics_uuid(e.props->>'item_id') IS NOT NULL
     GROUP BY 1
  ),
  sold AS (
    SELECT oi.menu_item_id                  AS sold_item,
           count(DISTINCT oi.order_id)      AS n_orders,
           sum(oi.quantity)::bigint         AS n_units,
           sum(oi.quantity * oi.unit_price) AS n_revenue
      FROM public.order_items oi
      JOIN public.completed_orders co ON co.id = oi.order_id
      JOIN public.orders o ON o.id = co.id AND o.venue_id = v_venue
     WHERE co.created_at >= v_since
     GROUP BY 1
  )
  SELECT
    mi.id, mi.name, c.name, s.name, mi.price, mi.is_available, mi.margin_score, mi.created_at,
    COALESCE(ev.n_views, 0), COALESCE(ev.n_adds, 0), COALESCE(ev.n_removes, 0),
    COALESCE(sold.n_orders, 0), COALESCE(sold.n_units, 0), COALESCE(sold.n_revenue, 0)::numeric,
    -- Of the guests who looked, how many added it?
    CASE WHEN COALESCE(ev.n_views, 0) > 0
         THEN round(100.0 * COALESCE(ev.n_adds, 0) / ev.n_views, 1) END,
    -- Of the guests who looked, how many ended up buying it?
    CASE WHEN COALESCE(ev.n_views, 0) > 0
         THEN round(100.0 * COALESCE(sold.n_orders, 0) / ev.n_views, 1) END,
    -- Of the guests who added it, how many took it back out?
    CASE WHEN COALESCE(ev.n_adds, 0) > 0
         THEN round(100.0 * COALESCE(ev.n_removes, 0) / ev.n_adds, 1) END
  FROM public.menu_items mi
  JOIN public.subcategories s ON s.id = mi.subcategory_id
  JOIN public.categories c ON c.id = s.category_id
  LEFT JOIN ev   ON ev.ev_item = mi.id
  LEFT JOIN sold ON sold.sold_item = mi.id
  WHERE mi.venue_id = v_venue
  ORDER BY COALESCE(sold.n_revenue, 0) DESC, COALESCE(ev.n_views, 0) DESC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.menu_unit_margins()
 RETURNS TABLE(item_id uuid, price numeric, unit_cost numeric, unit_cm numeric, cost_estimated boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT m.id,
         m.price,
         round(COALESCE(m.food_cost, m.price * public.default_cost_share(m.meal_role)), 2),
         round(GREATEST(m.price - COALESCE(m.food_cost, m.price * public.default_cost_share(m.meal_role)), 0), 2),
         m.food_cost IS NULL
    FROM public.menu_items m
   WHERE m.venue_id = public.current_venue();
$function$;

CREATE OR REPLACE FUNCTION public.returning_guest_stats(_days integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_venue uuid := public.current_venue();
  v_since timestamptz := now() - make_interval(days => GREATEST(COALESCE(_days, 30), 1));
  v jsonb;
BEGIN
  IF NOT public.can_staff(v_venue) THEN
    RAISE EXCEPTION 'Only staff can read guest stats' USING ERRCODE = 'insufficient_privilege';
  END IF;

  WITH visits AS (
    SELECT s.id,
           s.host_client_id,
           so.net_sales,
           EXISTS (
             SELECT 1 FROM public.table_sessions prior
              WHERE prior.venue_id = v_venue
                AND prior.host_client_id = s.host_client_id
                AND prior.opened_at < s.opened_at
           ) AS is_returning
      FROM public.table_sessions s
      JOIN public.session_outcomes so ON so.session_id = s.id
     WHERE s.venue_id = v_venue
       AND s.opened_at > v_since AND so.orders > 0
  )
  SELECT jsonb_build_object(
    'days', _days,
    'visits', count(*),
    'identified', count(*) FILTER (WHERE host_client_id IS NOT NULL),
    'coverage', CASE WHEN count(*) = 0 THEN 0
                     ELSE round(count(*) FILTER (WHERE host_client_id IS NOT NULL)::numeric
                                / count(*), 3) END,
    'returning', count(*) FILTER (WHERE is_returning),
    'returning_pct', CASE WHEN count(*) FILTER (WHERE host_client_id IS NOT NULL) = 0 THEN NULL
                          ELSE round(100.0 * count(*) FILTER (WHERE is_returning)
                               / count(*) FILTER (WHERE host_client_id IS NOT NULL), 1) END,
    'avg_spend_returning', COALESCE(round(avg(net_sales) FILTER (WHERE is_returning), 2), 0),
    'avg_spend_new', COALESCE(round(avg(net_sales)
                        FILTER (WHERE host_client_id IS NOT NULL AND NOT is_returning), 2), 0)
  ) INTO v
  FROM visits;

  RETURN v;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sales_analytics(_from date DEFAULT (business_day() - 6), _to date DEFAULT business_day())
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_venue uuid := public.current_venue();
  v_from timestamptz;
  v_to timestamptz;
  v_result jsonb;
BEGIN
  IF NOT public.can_staff(v_venue) THEN
    RAISE EXCEPTION 'Only staff can read analytics' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Guard against an inverted or absurd range rather than scanning everything.
  IF _to < _from THEN
    RAISE EXCEPTION 'End date is before start date';
  END IF;
  IF (_to - _from) > 400 THEN
    RAISE EXCEPTION 'Range is limited to 400 days';
  END IF;

  SELECT starts_at INTO v_from FROM public.business_day_range(_from);
  SELECT ends_at INTO v_to FROM public.business_day_range(_to);

  WITH sales AS (
    SELECT co.id, co.total, co.tip_amount, co.refunded_amount, co.created_at, co.table_session_id,
           co.total - COALESCE(co.tip_amount, 0) - COALESCE(co.refunded_amount, 0) AS net,
           public.business_day(co.created_at) AS trading_day,
           extract(hour FROM (co.created_at AT TIME ZONE 'Europe/Sarajevo'))::int AS local_hour
      FROM public.completed_orders co
      JOIN public.orders o ON o.id = co.id AND o.venue_id = v_venue
     WHERE co.created_at >= v_from AND co.created_at < v_to
  ),
  lines AS (
    SELECT oi.menu_item_id, oi.quantity, oi.unit_price, s.id AS order_id
      FROM public.order_items oi
      JOIN sales s ON s.id = oi.order_id
  )
  SELECT jsonb_build_object(
    'from', _from,
    'to', _to,
    'today', public.business_day(),
    'measure', 'net_sales_excl_tips_and_refunds',

    'totals', (
      SELECT jsonb_build_object(
        'net_sales', COALESCE(round(sum(net), 2), 0),
        'revenue', COALESCE(round(sum(total), 2), 0),
        'tips', COALESCE(round(sum(tip_amount), 2), 0),
        'refunded', COALESCE(round(sum(refunded_amount), 2), 0),
        'orders', count(*),
        'average_order', COALESCE(round(avg(net), 2), 0),
        'items_per_order', COALESCE(
          round((SELECT sum(quantity)::numeric FROM lines) / NULLIF(count(*), 0), 2), 0)
      ) FROM sales
    ),

    -- Every trading day in the range is present even when it took nothing — a
    -- missing bar reads as missing data, a zero bar reads as a quiet Tuesday.
    'by_day', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
                         'day', d.day,
                         'net_sales', COALESCE(r.net_sales, 0),
                         'revenue', COALESCE(r.revenue, 0),
                         'tips', COALESCE(r.tips, 0),
                         'orders', COALESCE(r.orders, 0))
                       ORDER BY d.day)
        FROM (SELECT g::date AS day
                FROM generate_series(_from::timestamp, _to::timestamp, interval '1 day') g) d
        LEFT JOIN (
          SELECT trading_day AS day,
                 round(sum(net), 2) AS net_sales,
                 round(sum(total), 2) AS revenue,
                 round(sum(tip_amount), 2) AS tips,
                 count(*) AS orders
            FROM sales GROUP BY 1
        ) r ON r.day = d.day
    ), '[]'::jsonb),

    -- Wall-clock hour in Sarajevo.
    'by_hour', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
                         'hour', h,
                         'orders', COALESCE(o.orders, 0),
                         'net_sales', COALESCE(o.net_sales, 0),
                         'revenue', COALESCE(o.revenue, 0))
                       ORDER BY h)
        FROM generate_series(0, 23) h
        LEFT JOIN (
          SELECT local_hour AS hour,
                 count(*) AS orders,
                 round(sum(net), 2) AS net_sales,
                 round(sum(total), 2) AS revenue
            FROM sales GROUP BY 1
        ) o ON o.hour = h
    ), '[]'::jsonb),

    'by_category', COALESCE((
      SELECT jsonb_agg(x ORDER BY (x->>'revenue')::numeric DESC) FROM (
        SELECT jsonb_build_object(
                 'name', COALESCE(c.name, 'Other'),
                 'revenue', round(sum(l.quantity * l.unit_price), 2),
                 'units', sum(l.quantity)
               ) AS x
          FROM lines l
          LEFT JOIN public.menu_items mi ON mi.id = l.menu_item_id
          LEFT JOIN public.subcategories sc ON sc.id = mi.subcategory_id
          LEFT JOIN public.categories c ON c.id = sc.category_id
         GROUP BY c.name
      ) t
    ), '[]'::jsonb),

    'top_items', COALESCE((
      SELECT jsonb_agg(x ORDER BY (x->>'units')::int DESC) FROM (
        SELECT jsonb_build_object(
                 'item_id', l.menu_item_id,
                 'name', COALESCE(mi.name, 'Unknown'),
                 'units', sum(l.quantity)::int,
                 'revenue', round(sum(l.quantity * l.unit_price), 2)
               ) AS x
          FROM lines l
          LEFT JOIN public.menu_items mi ON mi.id = l.menu_item_id
         GROUP BY l.menu_item_id, mi.name
         ORDER BY sum(l.quantity) DESC
         LIMIT 12
      ) t
    ), '[]'::jsonb),

    -- Turnover is sittings per table, and the average length of a sitting —
    -- a bare session count was labelled "turnover" and told you nothing about
    -- how long a table was held.
    'table_turnover', COALESCE((
      SELECT jsonb_agg(x ORDER BY (x->>'table_number')::int) FROM (
        SELECT jsonb_build_object(
                 'table_number', t.table_number,
                 'sittings', count(*)::int,
                 'avg_minutes', round(avg(
                   EXTRACT(EPOCH FROM (COALESCE(ts.closed_at, now()) - ts.opened_at)) / 60
                 ))
               ) AS x
          FROM public.table_sessions ts
          JOIN public.tables t ON t.id = ts.table_id
         WHERE ts.venue_id = v_venue
           AND ts.opened_at >= v_from AND ts.opened_at < v_to
         GROUP BY t.table_number
      ) t
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sales_components(_from date, _to date)
 RETURNS TABLE(daypart text, net numeric, visits integer, units bigint, covered_visits integer, covers bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  v_venue uuid := public.current_venue();
  v_from timestamptz;
  v_to timestamptz;
BEGIN
  IF NOT public.can_staff(v_venue) THEN
    RAISE EXCEPTION 'Only staff can read analytics' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _from IS NULL OR _to IS NULL OR _to < _from THEN
    RETURN;
  END IF;

  SELECT starts_at INTO v_from FROM public.business_day_range(_from);
  SELECT ends_at INTO v_to FROM public.business_day_range(_to);

  RETURN QUERY
  WITH s AS (
    SELECT co.id AS o_id,
           co.table_session_id AS o_session,
           public.business_day(co.created_at) AS o_day,
           public.daypart_of(co.created_at) AS o_part,
           co.total - COALESCE(co.tip_amount, 0) - COALESCE(co.refunded_amount, 0) AS o_net
      FROM public.completed_orders co
      JOIN public.orders o ON o.id = co.id AND o.venue_id = v_venue
     WHERE co.created_at >= v_from AND co.created_at < v_to
  ),
  q AS (
    SELECT oi.order_id AS q_order, sum(oi.quantity)::bigint AS q_units
      FROM public.order_items oi
      JOIN s ON s.o_id = oi.order_id
     GROUP BY 1
  ),
  x AS (
    SELECT s.*, COALESCE(q.q_units, 0) AS o_units,
           CASE WHEN ts.covers > 0 THEN ts.covers END AS o_covers
      FROM s
      LEFT JOIN q ON q.q_order = s.o_id
      LEFT JOIN public.table_sessions ts ON ts.id = s.o_session
  ),
  visit_all AS (
    SELECT 'all'::text AS v_part, sum(o_net) AS v_net, sum(o_units) AS v_units, max(o_covers) AS v_covers
      FROM x GROUP BY o_session, o_day
  ),
  visit_part AS (
    SELECT o_part AS v_part, sum(o_net) AS v_net, sum(o_units) AS v_units, max(o_covers) AS v_covers
      FROM x GROUP BY o_session, o_day, o_part
  )
  SELECT v.v_part,
         COALESCE(sum(v.v_net), 0),
         count(*)::int,
         COALESCE(sum(v.v_units), 0)::bigint,
         (count(*) FILTER (WHERE v.v_covers IS NOT NULL))::int,
         COALESCE(sum(v.v_covers), 0)::bigint
    FROM (SELECT * FROM visit_all UNION ALL SELECT * FROM visit_part) v
   GROUP BY v.v_part;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sold_out_impact(_days integer DEFAULT 30)
 RETURNS TABLE(item_id uuid, name text, views bigint, revenue numeric, last_sold_day date, selling_days integer, avg_daily_revenue_when_available numeric, estimated_lost_revenue numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  v_venue uuid := public.current_venue();
  v_since timestamptz := public.analytics_window_start(_days);
BEGIN
  IF NOT public.can_staff(v_venue) THEN
    RAISE EXCEPTION 'Only staff can read menu intelligence' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  WITH trading AS (
    SELECT DISTINCT public.business_day(co.created_at) AS day
      FROM public.completed_orders co
      JOIN public.orders o ON o.id = co.id AND o.venue_id = v_venue
     WHERE co.created_at >= v_since
  ),
  hist AS (
    SELECT oi.menu_item_id                               AS hist_item,
           sum(oi.quantity * oi.unit_price)              AS hist_revenue,
           max(public.business_day(co.created_at))       AS hist_last_day
      FROM public.order_items oi
      JOIN public.completed_orders co ON co.id = oi.order_id
      JOIN public.orders o ON o.id = co.id AND o.venue_id = v_venue
     WHERE co.created_at >= v_since
     GROUP BY 1
  ),
  looks AS (
    SELECT public.analytics_uuid(e.props->>'item_id') AS look_item, count(*) AS n_views
      FROM public.analytics_events e
     WHERE e.occurred_at >= v_since AND e.event = 'item_viewed'
       AND COALESCE(e.venue_id, public.default_venue()) = v_venue
       AND public.analytics_uuid(e.props->>'item_id') IS NOT NULL
     GROUP BY 1
  ),
  candidates AS (
    SELECT mi.id AS r_item, mi.name AS r_name,
           COALESCE(looks.n_views, 0) AS r_views,
           COALESCE(hist.hist_revenue, 0)::numeric AS r_revenue,
           hist.hist_last_day AS r_last_day,
           (SELECT count(*)::int FROM trading t
             WHERE t.day >= public.business_day(GREATEST(v_since, mi.created_at))
               AND t.day <= hist.hist_last_day) AS r_days
      FROM public.menu_items mi
      LEFT JOIN hist  ON hist.hist_item = mi.id
      LEFT JOIN looks ON looks.look_item = mi.id
     WHERE mi.venue_id = v_venue AND mi.is_available = false
  )
  SELECT r_item, r_name, r_views, round(r_revenue, 2), r_last_day, COALESCE(r_days, 0),
         COALESCE(round(r_revenue / NULLIF(r_days, 0), 2), 0),
         COALESCE(round(r_revenue / NULLIF(r_days, 0), 2), 0)
    FROM candidates
   ORDER BY 7 DESC, 3 DESC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.staff_performance(_from date DEFAULT (business_day() - 6), _to date DEFAULT business_day())
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_venue uuid := public.current_venue();
  v_from timestamptz;
  v_to timestamptz;
  v_waiters jsonb;
  v_unassigned jsonb;
  v_low jsonb;
BEGIN
  IF NOT public.can_staff(v_venue) THEN
    RAISE EXCEPTION 'Only staff can read staff performance' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _to < _from THEN
    RAISE EXCEPTION 'End date is before start date';
  END IF;
  IF (_to - _from) > 400 THEN
    RAISE EXCEPTION 'Range is limited to 400 days';
  END IF;

  SELECT starts_at INTO v_from FROM public.business_day_range(_from);
  SELECT ends_at INTO v_to FROM public.business_day_range(_to);

  WITH sales AS (
    SELECT co.assigned_waiter_id AS waiter_id,
           co.total - COALESCE(co.tip_amount, 0) - COALESCE(co.refunded_amount, 0) AS net,
           COALESCE(co.tip_amount, 0) AS tip,
           EXTRACT(EPOCH FROM (co.confirmed_at - COALESCE(co.released_to_kitchen_at, co.created_at))) / 60.0 AS confirm_min,
           EXTRACT(EPOCH FROM (co.served_at - COALESCE(co.released_to_kitchen_at, co.created_at))) / 60.0 AS served_min
      FROM public.completed_orders co
      JOIN public.orders o ON o.id = co.id AND o.venue_id = v_venue
     WHERE co.created_at >= v_from AND co.created_at < v_to
  ),
  by_sales AS (
    SELECT waiter_id,
           count(*) AS orders,
           round(sum(net), 2) AS net_sales,
           round(sum(tip), 2) AS tips,
           round(avg(confirm_min) FILTER (WHERE confirm_min >= 0)::numeric, 1) AS avg_confirm_minutes,
           round(avg(served_min) FILTER (WHERE served_min >= 0)::numeric, 1) AS avg_served_minutes
      FROM sales
     WHERE waiter_id IS NOT NULL
     GROUP BY waiter_id
  ),
  by_sessions AS (
    SELECT ts.assigned_waiter_id AS waiter_id,
           count(*) AS tables,
           round(avg(EXTRACT(EPOCH FROM (ts.closed_at - ts.opened_at)) / 60.0)
                 FILTER (WHERE ts.closed_at IS NOT NULL)::numeric, 1) AS avg_turn_minutes
      FROM public.table_sessions ts
     WHERE ts.venue_id = v_venue
       AND ts.opened_at >= v_from AND ts.opened_at < v_to
       AND ts.assigned_waiter_id IS NOT NULL
     GROUP BY ts.assigned_waiter_id
  ),
  by_ratings AS (
    SELECT r.waiter_id, count(*) AS ratings, round(avg(r.rating)::numeric, 2) AS avg_rating
      FROM public.server_ratings r
     WHERE r.venue_id = v_venue
       AND r.created_at >= v_from AND r.created_at < v_to
       AND r.waiter_id IS NOT NULL
     GROUP BY r.waiter_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'waiter_id', w.id,
           'name', w.display_name,
           'is_active', w.is_active,
           'orders', COALESCE(s.orders, 0),
           'net_sales', COALESCE(s.net_sales, 0),
           'tips', COALESCE(s.tips, 0),
           'tables', COALESCE(t.tables, 0),
           'ratings', COALESCE(r.ratings, 0),
           'avg_rating', r.avg_rating,
           'avg_confirm_minutes', s.avg_confirm_minutes,
           'avg_served_minutes', s.avg_served_minutes,
           'avg_turn_minutes', t.avg_turn_minutes
         ) ORDER BY COALESCE(s.net_sales, 0) DESC, w.display_name), '[]'::jsonb)
    INTO v_waiters
    FROM public.waiters w
    LEFT JOIN by_sales s    ON s.waiter_id = w.id
    LEFT JOIN by_sessions t ON t.waiter_id = w.id
    LEFT JOIN by_ratings r  ON r.waiter_id = w.id
   -- A former waiter still appears for a range in which they worked.
   WHERE (w.is_active AND w.venue_id = v_venue)
      OR s.waiter_id IS NOT NULL OR t.waiter_id IS NOT NULL OR r.waiter_id IS NOT NULL;

  -- Sales nobody was assigned to, so the per-waiter figures visibly do not
  -- have to add up to the day's total.
  SELECT jsonb_build_object(
           'orders', count(*),
           'net_sales', COALESCE(round(sum(co.total - COALESCE(co.tip_amount, 0) - COALESCE(co.refunded_amount, 0)), 2), 0))
    INTO v_unassigned
    FROM public.completed_orders co
    JOIN public.orders o ON o.id = co.id AND o.venue_id = v_venue
   WHERE co.created_at >= v_from AND co.created_at < v_to
     AND co.assigned_waiter_id IS NULL;

  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'created_at' DESC), '[]'::jsonb)
    INTO v_low
    FROM (
      SELECT jsonb_build_object(
               'waiter_id', r.waiter_id,
               'waiter_name', w.display_name,
               'rating', r.rating,
               'comment', r.comment,
               'created_at', r.created_at) AS x
        FROM public.server_ratings r
        LEFT JOIN public.waiters w ON w.id = r.waiter_id
       WHERE r.venue_id = v_venue
         AND r.created_at >= v_from AND r.created_at < v_to
         AND r.rating <= 2
       ORDER BY r.created_at DESC
       LIMIT 10
    ) t;

  RETURN jsonb_build_object(
    'from', _from,
    'to', _to,
    'today', public.business_day(),
    'waiters', v_waiters,
    'unassigned', v_unassigned,
    'low_ratings', v_low
  );
END;
$function$;

-- D. Suggestions and experiments: only that restaurant's dishes are ever suggested; its weights, its experiment, its measurements.

CREATE OR REPLACE FUNCTION public.acceptance_for_ranking(_item_id uuid, _placement text, _source_item_id uuid, _daypart text, _seed text)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sampling boolean;
  v_accepted int;
  v_shown int;
  v_alpha0 numeric;
  v_beta0 numeric;
BEGIN
  SELECT COALESCE(reco_sampling_enabled, false) INTO v_sampling
    FROM public.restaurant_settings WHERE venue_id = public.current_venue();

  IF NOT COALESCE(v_sampling, false) THEN
    RETURN public.daypart_acceptance(_item_id, _placement, _source_item_id, _daypart);
  END IF;

  SELECT st.accepted, st.shown INTO v_accepted, v_shown
    FROM public.suggestion_stats st
   WHERE st.recommended_item_id = _item_id
     AND st.placement = _placement
     AND st.source_item_id IS NOT DISTINCT FROM _source_item_id
     AND st.daypart = _daypart;

  IF NOT FOUND THEN
    SELECT st.accepted, st.shown INTO v_accepted, v_shown
      FROM public.suggestion_stats st
     WHERE st.recommended_item_id = _item_id
       AND st.placement = _placement
       AND st.source_item_id IS NOT DISTINCT FROM _source_item_id
       AND st.daypart IS NULL;
  END IF;

  SELECT pr.alpha0, pr.beta0 INTO v_alpha0, v_beta0
    FROM public.suggestion_prior(_item_id, _placement) pr;

  RETURN public.sample_acceptance(
    COALESCE(v_accepted, 0), COALESCE(v_shown, 0),
    _seed || ':' || _item_id::text || ':' || COALESCE(_daypart, ''),
    v_alpha0, v_beta0);
END;
$function$;

CREATE OR REPLACE FUNCTION public.app_impact_summary(_days integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_venue uuid := public.current_venue();
  v_since timestamptz := now() - make_interval(days => GREATEST(COALESCE(_days, 30), 1));
  v_causal jsonb;
  v_attributed jsonb;
  v_funnel jsonb;
  v_sessions int;
  v_net numeric;
BEGIN
  IF NOT public.can_staff(v_venue) THEN
    RAISE EXCEPTION 'Only staff can read the impact summary' USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_causal := public.reco_holdout_comparison(_days);

  SELECT count(*), COALESCE(sum(so.net_sales), 0)
    INTO v_sessions, v_net
    FROM public.session_outcomes so
    JOIN public.table_sessions ts ON ts.id = so.session_id
   WHERE so.opened_at > v_since AND so.orders > 0
     AND ts.venue_id = v_venue;

  -- The upper bound, kept and labelled rather than hidden. It is useful — it
  -- is just not causal, and the difference has to be on the page.
  SELECT jsonb_build_object(
           'revenue', COALESCE(round(sum(sc.line_total), 2), 0),
           'orders', count(DISTINCT sc.order_id))
    INTO v_attributed
    FROM public.suggestion_conversions sc
    JOIN public.completed_orders co ON co.id = sc.order_id
    JOIN public.orders o ON o.id = co.id
   WHERE sc.created_at > v_since
     AND o.venue_id = v_venue;

  /*
   * Money left on the table: dishes people look at and do not order.
   *
   * The single most actionable thing on the page, because the fix is usually a
   * description or a price rather than anything technical.
   */
  SELECT COALESCE(jsonb_agg(x ORDER BY x.views DESC), '[]'::jsonb)
    INTO v_funnel
    FROM (
      SELECT mi.name,
             count(*) FILTER (WHERE e.event = 'item_viewed') AS views,
             count(*) FILTER (WHERE e.event = 'item_added') AS adds
        FROM public.analytics_events e
        JOIN public.menu_items mi ON mi.id = public.analytics_uuid(e.props->>'item_id')
       WHERE e.occurred_at > v_since
         AND mi.venue_id = v_venue
         AND e.event IN ('item_viewed', 'item_added')
       GROUP BY mi.id, mi.name
      HAVING count(*) FILTER (WHERE e.event = 'item_viewed') >= 20
         AND count(*) FILTER (WHERE e.event = 'item_added')
             < count(*) FILTER (WHERE e.event = 'item_viewed') * 0.03
       ORDER BY 2 DESC
       LIMIT 5
    ) x;

  RETURN jsonb_build_object(
    'days', _days,
    'sessions', v_sessions,
    'net_sales', round(v_net, 2),
    -- First, and allowed to say "I do not know yet".
    'causal', v_causal,
    'attributed', v_attributed || jsonb_build_object('is_causal', false),
    'looked_at_not_ordered', v_funnel,
    'food_cost', public.food_cost_coverage()
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.bandit_readiness()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_venue uuid := public.current_venue();
  v_decisions bigint;
  v_impressions bigint;
  v_verified_conversions bigint;
  v_with_probability bigint;
  v_pairs_with_support bigint;
  v_stats_shown bigint;
  v_stats_ledger bigint;
  v_sampling boolean;
  v_min_decisions constant int := 2000;
  v_min_pairs constant int := 15;
  v_checks jsonb;
BEGIN
  -- Trusted rather than staff-only: maybe_enable_sampling() calls this from
  -- the nightly job. Signed-in staff read only a restaurant they work at.
  IF NOT public.is_trusted_caller()
     OR (public.is_staff_member() AND NOT public.can_staff(v_venue)) THEN
    RAISE EXCEPTION 'Only staff can read the readiness gate' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT COALESCE(reco_sampling_enabled, false) INTO v_sampling
    FROM public.restaurant_settings WHERE venue_id = v_venue;

  SELECT count(*), count(*) FILTER (WHERE d.action_probability IS NOT NULL)
    INTO v_decisions, v_with_probability
    FROM public.recommendation_decisions d
    JOIN public.table_sessions ts ON ts.id = d.session_id
   WHERE ts.venue_id = v_venue;

  SELECT count(*) INTO v_impressions
    FROM public.recommendation_impressions i
    JOIN public.recommendation_decisions d ON d.id = i.decision_id
    JOIN public.table_sessions ts ON ts.id = d.session_id
   WHERE ts.venue_id = v_venue;

  SELECT count(*) INTO v_verified_conversions
    FROM public.suggestion_conversions sc
    JOIN public.completed_orders co ON co.id = sc.order_id
    JOIN public.orders o ON o.id = co.id
   WHERE sc.decision_id IS NOT NULL
     AND o.venue_id = v_venue;

  SELECT count(*) INTO v_pairs_with_support
    FROM (
      SELECT d.chosen_item_id, d.source_item_id
        FROM public.recommendation_decisions d
        JOIN public.table_sessions ts ON ts.id = d.session_id
        JOIN public.recommendation_impressions i ON i.decision_id = d.id
       WHERE d.chosen_item_id IS NOT NULL
         AND ts.venue_id = v_venue
       GROUP BY d.chosen_item_id, d.source_item_id
      HAVING count(*) >= 50
    ) x;

  SELECT COALESCE(sum(st.shown), 0), COALESCE(sum(st.shown_ledger), 0)
    INTO v_stats_shown, v_stats_ledger
    FROM public.suggestion_stats st
    JOIN public.menu_items mi ON mi.id = st.recommended_item_id
   WHERE st.daypart IS NULL
     AND mi.venue_id = v_venue;

  v_checks := jsonb_build_array(
    jsonb_build_object(
      'check', 'impressions_are_server_verified', 'pass', true,
      'note', 'recommendation_impressions is written server-side and deduped by primary key'),
    jsonb_build_object(
      'check', 'acceptance_linked_to_paid_outcome', 'pass', true,
      'note', 'suggestion_conversions.decision_id joins to completed_orders'),
    jsonb_build_object(
      'check', 'stats_learn_from_ledger',
      'pass', v_stats_shown > 0 AND v_stats_ledger >= 0.9 * v_stats_shown,
      'have', v_stats_ledger, 'of', v_stats_shown,
      'note', format('%s of %s counted sightings in suggestion_stats come from the server ledger; '
                     'browser-era rows age out of the 90-day window', v_stats_ledger, v_stats_shown)),
    jsonb_build_object(
      'check', 'action_probabilities_logged',
      'pass', v_decisions = 0 OR v_with_probability = v_decisions,
      'note', format('%s of %s decisions carry a propensity', v_with_probability, v_decisions)),
    jsonb_build_object(
      'check', 'enough_decisions', 'pass', v_decisions >= v_min_decisions,
      'have', v_decisions, 'need', v_min_decisions),
    jsonb_build_object(
      'check', 'enough_pairs_with_support', 'pass', v_pairs_with_support >= v_min_pairs,
      'have', v_pairs_with_support, 'need', v_min_pairs,
      'note', 'distinct pairs with 50+ verified impressions each'),
    jsonb_build_object(
      'check', 'conversions_observed', 'pass', v_verified_conversions > 0,
      'have', v_verified_conversions)
  );

  RETURN jsonb_build_object(
    'ready', NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_checks) c WHERE (c ->> 'pass')::boolean IS NOT TRUE),
    'checks', v_checks,
    'decisions', v_decisions,
    'impressions', v_impressions,
    'verified_conversions', v_verified_conversions,
    'sampling_enabled', v_sampling,
    'policy_version', public.reco_policy_version(),
    'note', CASE WHEN v_sampling
      THEN 'Sampling is live. Propensities are not logged as numbers; the '
           'posterior inputs per candidate are, so they can be reconstructed.'
      ELSE 'Until every check passes the fixed ranker stays. A bandit fed '
           'unreliable counts learns to maximise the noise in them.' END
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.decision_performance(_days integer DEFAULT 30)
 RETURNS TABLE(placement text, policy_version text, decisions bigint, with_suggestion bigint, seen bigint, accepted bigint, acceptance_pct numeric, revenue numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_venue uuid := public.current_venue();
  v_since timestamptz := now() - make_interval(days => GREATEST(COALESCE(_days, 30), 1));
BEGIN
  IF NOT public.can_staff(v_venue) THEN
    RAISE EXCEPTION 'Only staff can read menu intelligence' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  SELECT
    d.placement,
    d.policy_version,
    count(*),
    count(*) FILTER (WHERE d.chosen_item_id IS NOT NULL),
    count(i.decision_id),
    count(sc.decision_id),
    CASE WHEN count(i.decision_id) > 0
         THEN round(100.0 * count(sc.decision_id) / count(i.decision_id), 1) ELSE 0 END,
    COALESCE(round(sum(sc.line_total), 2), 0)
  FROM public.recommendation_decisions d
  JOIN public.table_sessions ts ON ts.id = d.session_id
  LEFT JOIN public.recommendation_impressions i ON i.decision_id = d.id
  -- Only conversions on orders that became sales: a cancelled or abandoned
  -- order is not money the suggestion earned.
  LEFT JOIN (SELECT sc0.*
               FROM public.suggestion_conversions sc0
               JOIN public.completed_orders co ON co.id = sc0.order_id) sc ON sc.decision_id = d.id
  WHERE d.created_at > v_since
    AND ts.venue_id = v_venue
  GROUP BY d.placement, d.policy_version
  ORDER BY 8 DESC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.experiment_power(_experiment_id uuid, _mde_pct numeric DEFAULT 5)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_venue uuid;
  v_started timestamptz;
  v_ended timestamptz;
  v_pct numeric;
  v_n bigint; v_mean numeric; v_sd numeric;
  v_delta numeric; v_needed_per_arm numeric;
  v_days numeric; v_rate numeric;
  v_h numeric;
  v_base numeric;
  v_total_current numeric;
  v_total_even numeric;
  c_z2 constant numeric := 7.849;  -- (1.960 + 0.842)²
BEGIN
  SELECT venue_id, started_at, ended_at, holdout_pct INTO v_venue, v_started, v_ended, v_pct
    FROM public.experiments WHERE id = _experiment_id;
  IF v_started IS NULL THEN RETURN NULL; END IF;

  -- A signed-in user reads only the experiments of a restaurant they work at.
  IF auth.uid() IS NOT NULL AND NOT public.can_staff(v_venue) THEN
    RAISE EXCEPTION 'Only staff can read menu intelligence' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT count(*), avg(so.net_sales), stddev_samp(so.net_sales)
    INTO v_n, v_mean, v_sd
    FROM public.session_outcomes so
    JOIN public.session_experiment_assignment a ON a.session_id = so.session_id
    JOIN public.table_sessions ts ON ts.id = so.session_id
   WHERE a.experiment_id = _experiment_id AND so.orders > 0
     AND ts.venue_id = v_venue;

  IF COALESCE(v_n, 0) < 10 OR COALESCE(v_sd, 0) = 0 OR COALESCE(v_mean, 0) = 0 THEN
    RETURN jsonb_build_object('ready', false, 'sessions', COALESCE(v_n, 0));
  END IF;

  v_delta := v_mean * COALESCE(_mde_pct, 5) / 100.0;
  v_needed_per_arm := ceil(15.7 * power(v_sd, 2) / power(v_delta, 2));
  v_base := c_z2 * power(v_sd, 2) / power(v_delta, 2);
  v_h := LEAST(GREATEST(COALESCE(v_pct, 10), 1), 50) / 100.0;
  v_total_current := ceil(v_base * (1 / v_h + 1 / (1 - v_h)));
  v_total_even := ceil(v_base * 4);

  v_days := GREATEST(EXTRACT(EPOCH FROM (LEAST(now(), COALESCE(v_ended, now())) - v_started)) / 86400.0, 0.5);
  v_rate := v_n / v_days;

  RETURN jsonb_build_object(
    'ready', true,
    'mde_pct', COALESCE(_mde_pct, 5),
    'sessions_so_far', v_n,
    'sessions_needed_per_arm', v_needed_per_arm,
    'sessions_per_day', round(v_rate, 1),
    'days_remaining', CASE WHEN v_rate > 0
      THEN GREATEST(0, ceil((v_total_current - v_n) / v_rate)) ELSE NULL END,
    'days_to_answer', jsonb_build_object(
      'holdout_pct', v_pct,
      'sessions_needed', v_total_current,
      'days', CASE WHEN v_rate > 0 THEN ceil(v_total_current / v_rate) END,
      'days_remaining', CASE WHEN v_rate > 0
        THEN GREATEST(0, ceil((v_total_current - v_n) / v_rate)) END),
    'days_to_answer_at_50', jsonb_build_object(
      'holdout_pct', 50,
      'sessions_needed', v_total_even,
      'days', CASE WHEN v_rate > 0 THEN ceil(v_total_even / v_rate) END)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.maybe_enable_sampling()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_enabled boolean;
  v_ready boolean;
  v_version text;
  v_home uuid := public.current_venue();
  v_prev text := current_setting('lasoul.venue', true);
  v record;
  v_result jsonb;
  v_home_result jsonb;
  v_changed jsonb;
BEGIN
  IF NOT public.is_trusted_caller() THEN
    RAISE EXCEPTION 'Only staff can change the ranking policy' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Each restaurant on its own gate and its own settings. The nightly job has
  -- no user and covers every restaurant; a signed-in caller only those they
  -- work at.
  FOR v IN
    SELECT ve.id FROM public.venues ve
     WHERE auth.uid() IS NULL OR public.can_staff(ve.id)
     ORDER BY ve.id
  LOOP
    PERFORM public.use_venue(v.id);

    v_enabled := NULL;
    SELECT COALESCE(reco_sampling_enabled, false) INTO v_enabled
      FROM public.restaurant_settings WHERE venue_id = v.id;

    IF v_enabled THEN
      v_result := jsonb_build_object('changed', false, 'reason', 'already_on');
    ELSE
      SELECT (public.bandit_readiness() ->> 'ready')::boolean INTO v_ready;
      IF NOT COALESCE(v_ready, false) THEN
        v_result := jsonb_build_object('changed', false, 'reason', 'gate_not_passed');
      ELSE
        UPDATE public.restaurant_settings SET reco_sampling_enabled = true WHERE venue_id = v.id;
        v_version := public.reco_policy_version();

        -- A policy change invalidates the running comparison, so it is closed.
        -- Starting the next one is a deliberate act by a manager.
        UPDATE public.experiments SET ended_at = now(),
               notes = COALESCE(notes, '') || ' [closed automatically: ranking policy changed to ' || v_version || ']'
         WHERE ended_at IS NULL AND venue_id = v.id;

        PERFORM public.write_audit('reco.sampling_enabled', 'settings', NULL::uuid, NULL::jsonb,
          jsonb_build_object('policy_version', v_version),
          'bandit_readiness gate passed');

        v_result := jsonb_build_object('changed', true, 'policy_version', v_version);
        v_changed := COALESCE(v_changed, v_result);
      END IF;
    END IF;

    IF v.id = v_home OR v_home_result IS NULL THEN
      v_home_result := v_result;
    END IF;
  END LOOP;

  -- The rest of the caller's transaction is about the restaurant it was about.
  PERFORM set_config('lasoul.venue', COALESCE(v_prev, ''), true);

  -- One answer, as before: a change anywhere, otherwise this restaurant's reason.
  RETURN COALESCE(v_changed, v_home_result,
                  jsonb_build_object('changed', false, 'reason', 'gate_not_passed'));
END;
$function$;

CREATE OR REPLACE FUNCTION public.menu_pairings(_limit integer DEFAULT 30)
 RETURNS TABLE(item_a uuid, name_a text, item_b uuid, name_b text, pair_orders integer, confidence numeric, lift numeric, already_curated boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  v_venue uuid := public.current_venue();
BEGIN
  IF NOT public.can_staff(v_venue) THEN
    RAISE EXCEPTION 'Only staff can read menu intelligence' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  WITH everyone AS (
    SELECT GREATEST(COALESCE(max(public.reco_decayed(r.w, r.w_at, now())), 0), 1) AS w
      FROM public.reco_learning r
     WHERE r.ctx_level = 'all' AND r.ctx_key = '*' AND r.item_id IS NULL
  ),
  dish AS (
    SELECT r.ctx_key AS id, r.tables, public.reco_decayed(r.w, r.w_at, now()) AS w
      FROM public.reco_learning r
     WHERE r.ctx_level = 'item' AND r.item_id IS NULL
  ),
  learned AS (
    SELECT r.ctx_key::uuid AS a, r.item_id AS b, r.tables AS together,
           public.reco_decayed(r.w, r.w_at, now()) AS w_ab,
           da.tables AS a_tables, da.w AS w_a, db.w AS w_b, e.w AS w_all
      FROM public.reco_learning r
      JOIN dish da ON da.id = r.ctx_key
      JOIN dish db ON db.id = r.item_id::text
      CROSS JOIN everyone e
     WHERE r.ctx_level = 'item' AND r.item_id IS NOT NULL
       AND r.ctx_key < r.item_id::text
       AND r.tables >= 3
  ),
  listed AS (
    SELECT l.a, l.b, l.together,
           round(l.together::numeric / NULLIF(l.a_tables, 0), 4) AS conf,
           round((l.w_ab / NULLIF(l.w_a, 0)) / NULLIF(l.w_b / l.w_all, 0), 4) AS lft,
           public.eb_lower05(l.w_ab, l.w_a * l.w_b / l.w_all) AS strength
      FROM learned l
     WHERE public.eb_lower05(l.w_ab, l.w_a * l.w_b / l.w_all) > 1
    UNION ALL
    SELECT a.item_a, a.item_b, a.pair_orders, a.confidence, a.lift, a.eb05
      FROM public.menu_item_affinity a
     WHERE a.eb05 > 1
       AND a.item_a < a.item_b
       AND NOT EXISTS (
             SELECT 1 FROM learned l WHERE l.a = a.item_a AND l.b = a.item_b
               AND public.eb_lower05(l.w_ab, l.w_a * l.w_b / l.w_all) > 1)
  )
  SELECT x.a, ma.name, x.b, mb.name, x.together, x.conf, x.lft,
         EXISTS (
           SELECT 1 FROM public.menu_item_recommendations r
            WHERE r.source_item_id = x.a
              AND r.recommended_item_id = x.b
              AND r.enabled
         )
    FROM listed x
    JOIN public.menu_items ma ON ma.id = x.a
    JOIN public.menu_items mb ON mb.id = x.b
   WHERE ma.venue_id = v_venue
     AND mb.venue_id = v_venue
   ORDER BY x.strength DESC, x.together DESC
   LIMIT LEAST(GREATEST(COALESCE(_limit, 30), 1), 100);
END;
$function$;

CREATE OR REPLACE FUNCTION public.rank_recommendations(_cart_item_ids uuid[] DEFAULT '{}'::uuid[], _placement text DEFAULT 'cart'::text, _language text DEFAULT 'en'::text, _limit integer DEFAULT 4, _session_id uuid DEFAULT NULL::uuid, _exclude_allergens text[] DEFAULT '{}'::text[], _cart_quantities integer[] DEFAULT NULL::integer[])
 RETURNS TABLE(id uuid, name text, name_bs text, name_ar text, price numeric, image_url text, dietary_tags text[], recommendation_type text, reason text, source_item_id uuid, suggested_quantity integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH here AS (
    SELECT public.current_venue() AS venue
  ),
  s AS (
    SELECT
      COALESCE(recommendations_enabled, true) AS enabled,
      COALESCE(reco_weight_curated, 40)::numeric  / 100 AS w_curated,
      COALESCE(reco_weight_observed, 25)::numeric / 100 AS w_observed,
      (COALESCE(reco_weight_learned, 25) + COALESCE(reco_weight_margin, 10))::numeric / 100 AS w_value,
      COALESCE(reco_exploration, 15)::numeric     / 100 AS w_explore,
      COALESCE(reco_min_acceptance, 0.03)               AS min_acceptance,
      COALESCE(reco_retire_after_impressions, 60)       AS retire_after
    FROM public.restaurant_settings WHERE venue_id = (SELECT venue FROM here)
  ),
  -- Only this restaurant's dishes are on the table, whatever the request
  -- says: the cart and what the table ordered, less any other restaurant's.
  own AS (
    SELECT here.venue,
           ARRAY(SELECT c.id
                   FROM unnest(COALESCE(_cart_item_ids, '{}'::uuid[])) WITH ORDINALITY AS c(id, n)
                  WHERE NOT EXISTS (SELECT 1 FROM public.menu_items x
                                     WHERE x.id = c.id AND x.venue_id <> here.venue)
                  ORDER BY c.n) AS cart
      FROM here
  ),
  p AS (
    SELECT
      LEAST(GREATEST(COALESCE(_limit, 4), 1), 8) AS lim,
      own.venue,
      own.cart,
      CASE WHEN _placement IN ('cart', 'after_meal', 'item', 'tab') THEN _placement ELSE 'cart' END AS placement,
      CASE WHEN _language IN ('en', 'bs', 'ar') THEN _language ELSE 'en' END AS lang,
      public.reco_now() AS at,
      (public.reco_now() AT TIME ZONE 'Europe/Sarajevo')::time AS now_time,
      public.daypart_of(public.reco_now()) AS daypart,
      COALESCE(_session_id::text, 'anon') AS seed,
      public.guest_in_reco_holdout(_session_id) AS held_out,
      public.cart_diet(own.cart) AS diet,
      COALESCE(_exclude_allergens, '{}'::text[]) AS blocked_allergens,
      -- The wrapper adds 'alcohol' when the guest's diet filter excludes it.
      'alcohol' = ANY(COALESCE(_exclude_allergens, '{}'::text[])) AS no_alcohol,
      public.cart_has_drink(own.cart) AS has_drink,
      sc.ordered_item_ids,
      sc.served_item_ids,
      sc.minutes_since_served,
      -- The average line price includes what is in the cart right now, so the
      -- price check runs from the first round.
      (SELECT round((COALESCE(sc.running_total, 0) + COALESCE(sum(cm.price), 0))
                    / NULLIF(COALESCE(sc.line_count, 0) + count(cm.id), 0), 2)
         FROM public.menu_items cm
        WHERE cm.id = ANY(own.cart)) AS avg_line_price,
      -- Cart plus what the table already ordered: at the after-meal moment
      -- the cart is empty and this is all there is to pair against.
      (own.cart || ARRAY(SELECT t.id
                           FROM unnest(COALESCE(sc.ordered_item_ids, '{}'::uuid[])) WITH ORDINALITY AS t(id, n)
                          WHERE NOT EXISTS (SELECT 1 FROM public.menu_items x
                                             WHERE x.id = t.id AND x.venue_id <> own.venue)
                          ORDER BY t.n)) AS context,
      -- Portions on the table, this round and earlier ones: who is eating,
      -- and how many of them already have a drink.
      u.food_units,
      u.drink_units,
      CASE WHEN GREATEST(COALESCE(sc.covers, 0), u.main_units) >= 2
           THEN LEAST(GREATEST(GREATEST(COALESCE(sc.covers, 0), u.main_units) - u.drink_units, 1), 6)
           ELSE 1 END AS table_qty
    FROM public.session_context(_session_id) sc
    CROSS JOIN own
    CROSS JOIN LATERAL (
      SELECT COALESCE(sum(l.qty) FILTER (WHERE mi.meal_role = 'main'), 0)::int AS main_units,
             COALESCE(sum(l.qty) FILTER (WHERE mi.meal_role IN ('main', 'starter', 'side')
                                           OR (mi.meal_role IS NULL AND mi.station = 'kitchen')), 0)::int AS food_units,
             COALESCE(sum(l.qty) FILTER (WHERE public.role_is_drink(mi.meal_role)
                                           OR (mi.meal_role IS NULL AND mi.station = 'bar')), 0)::int AS drink_units
        FROM (
          SELECT c.item_id, LEAST(GREATEST(COALESCE(c.qty, 1), 1), 10) AS qty
            FROM unnest(COALESCE(_cart_item_ids, '{}'::uuid[]), COALESCE(_cart_quantities, '{}'::int[]))
                 AS c(item_id, qty)
           WHERE c.item_id IS NOT NULL
          UNION ALL
          SELECT oi.menu_item_id, oi.quantity
            FROM public.order_items oi
            JOIN public.orders o ON o.id = oi.order_id
           WHERE _session_id IS NOT NULL
             AND o.table_session_id = _session_id
             AND o.status NOT IN ('cancelled', 'awaiting_payment', 'payment_failed')
        ) l
        JOIN public.menu_items mi ON mi.id = l.item_id
       WHERE mi.venue_id = own.venue
    ) u
  ),
  -- How overloaded the kitchen is right now. Biases AWAY from slow dishes
  -- under load; never hides anything.
  load AS (
    SELECT COALESCE(max(kl.load_factor), 0) AS factor
      FROM public.kitchen_load() kl
     WHERE kl.station = 'kitchen'
  ),
  -- What kind of thing each dish is (see reco_kind), and the kinds on the table.
  kinds AS (
    SELECT mi.id, public.reco_kind(mi.name, sub.name, mi.meal_role, mi.station) AS kind
      FROM public.menu_items mi
      LEFT JOIN public.subcategories sub ON sub.id = mi.subcategory_id
     WHERE mi.venue_id = (SELECT venue FROM here)
  ),
  context_kinds AS (
    SELECT DISTINCT k.kind FROM kinds k, p WHERE k.id = ANY(p.context)
  ),
  cart_subcategories AS (
    SELECT DISTINCT mi.subcategory_id
      FROM public.menu_items mi, p
     WHERE mi.id = ANY(p.cart)
  ),
  -- What a section rule may match: the cart, or on the running tab (where
  -- the cart is usually empty) what the table has ordered.
  rule_subcategories AS (
    SELECT DISTINCT mi.subcategory_id
      FROM public.menu_items mi, p
     WHERE mi.id = ANY(CASE WHEN p.placement = 'tab' THEN p.context ELSE p.cart END)
  ),
  curated AS (
    SELECT r.recommended_item_id AS item_id,
           -- house pairing source: a section rule names the cart dish it matched
           COALESCE(r.source_item_id,
                    (SELECT ci.id FROM public.menu_items ci
                      WHERE ci.id = ANY(CASE WHEN p.placement = 'tab' THEN p.context ELSE p.cart END)
                        AND ci.subcategory_id = r.source_subcategory_id
                      ORDER BY ci.price DESC, ci.id LIMIT 1)) AS source_item_id,
           r.recommendation_type AS rtype,
           max(r.priority)::numeric / 100 AS curated_score
      FROM public.menu_item_recommendations r, p
     WHERE r.enabled
       AND (r.language IS NULL OR r.language = p.lang)
       AND (r.start_time IS NULL OR p.now_time >= r.start_time)
       AND (r.end_time IS NULL OR p.now_time <= r.end_time)
       -- `alternative` is for the substitution path only.
       AND r.recommendation_type <> 'alternative'
       AND (
         (p.placement = 'after_meal' AND r.recommendation_type = 'after_meal')
         OR (p.placement <> 'after_meal' AND r.recommendation_type <> 'after_meal'
             AND (r.source_item_id = ANY(p.context)
                  OR r.source_subcategory_id IN (SELECT rs.subcategory_id FROM rule_subcategories rs)))
       )
     GROUP BY 1, 2, 3
  ),
  -- Visit-grain pairs, for the after-meal moment.
  observed_session AS (
    SELECT sa.item_b AS item_id,
           sa.item_a AS source_item_id,
           'after_meal'::text AS rtype,
           public.pair_strength(sa.eb05) AS observed_score
      FROM public.session_item_affinity sa, p
     WHERE sa.item_a = ANY(p.context)
       AND p.placement = 'after_meal'
       AND sa.eb05 > 1
  ),
  -- Order-grain pairs, for the cart and the dish page.
  observed AS (
    SELECT a.item_b AS item_id,
           a.item_a AS source_item_id,
           'frequently_bought_together'::text AS rtype,
           public.pair_strength(a.eb05) AS observed_score
      FROM public.menu_item_affinity a, p
     WHERE a.item_a = ANY(p.context)
       AND p.placement <> 'after_meal'
       AND a.eb05 > 1
  ),
  -- The sections on the table, each represented by its dearest dish there.
  context_sections AS (
    SELECT DISTINCT ON (mi.subcategory_id) mi.subcategory_id, mi.id AS source_item_id
      FROM public.menu_items mi, p
     WHERE mi.id = ANY(p.context) AND mi.subcategory_id IS NOT NULL
     ORDER BY mi.subcategory_id, mi.price DESC, mi.id
  ),
  /*
   * Section evidence, for dishes with no pair history of their own: a section
   * that goes with one on the table, offered as the dish that section sells
   * in this daypart. 0.6 × section strength × the dish's daypart share.
   */
  observed_family AS (
    SELECT sh.item_id,
           cs.source_item_id,
           'frequently_bought_together'::text AS rtype,
           round(0.6 * public.pair_strength(sf.eb05) * sh.share, 6) AS observed_score
      FROM context_sections cs
      JOIN public.subcategory_affinity sf ON sf.sub_a = cs.subcategory_id AND sf.eb05 > 1
      JOIN public.item_section_share sh ON sh.subcategory_id = sf.sub_b
      CROSS JOIN p
     WHERE p.placement <> 'after_meal'
       AND sh.daypart = p.daypart
       AND sh.share > 0
  ),
  /*
   * What tables taught it (reco_learned_pairs): dishes that tables with a
   * dish on this table — or, failing a record of its own, with a dish of
   * its section or kind — went on to order, beyond chance and from at least
   * three tables. Proposes and ranks; the gate below still decides.
   */
  learned AS (
    SELECT lp.item_id,
           lp.source_item_id,
           CASE WHEN p.placement = 'after_meal' THEN 'after_meal' ELSE 'frequently_bought_together' END::text AS rtype,
           lp.strength AS learned_score
      FROM p
      CROSS JOIN LATERAL public.reco_learned_pairs(p.context, p.at) lp
     WHERE lp.strength > 0
  ),
  -- Basket completion: a cart with food and no drink is a gap no pair table
  -- can see, because it is about something ABSENT.
  cart_kinds AS (
    SELECT DISTINCT k.kind FROM kinds k, p WHERE k.id = ANY(p.cart)
  ),
  /*
   * The fit graph also proposes, so that on the first night — no history,
   * nothing curated for this section — the right kind of thing is still on
   * the shortlist: a croissant for a fresh juice, a salad for a risotto.
   * It proposes and adds nothing to the score: fitting is the entry ticket,
   * not a merit, so margin and the price rule choose among these.
   */
  grammar AS (
    SELECT k.id AS item_id,
           (SELECT ci.id FROM public.menu_items ci JOIN kinds ck ON ck.id = ci.id
             WHERE ci.id = ANY(p.context) AND ck.kind = f.context_kind
             ORDER BY ci.price DESC, ci.id LIMIT 1) AS source_item_id,
           'goes_with'::text AS rtype,
           0::numeric AS observed_score
      FROM kinds k
      JOIN public.reco_fit f ON f.candidate_kind = k.kind
      CROSS JOIN p
     WHERE (p.placement = 'after_meal' AND f.context_kind = 'after_meal')
        OR (p.placement <> 'after_meal' AND f.context_kind IN (SELECT ck.kind FROM context_kinds ck))
  ),
  completion AS (
    SELECT mi.id AS item_id,
           -- The dish it is for, so the card can say "Goes with your burger".
           (SELECT ci.id FROM public.menu_items ci
             WHERE ci.id = ANY(p.context) AND ci.station = 'kitchen'
               AND ci.meal_role IS DISTINCT FROM 'dessert'
             ORDER BY ci.price DESC, ci.id LIMIT 1) AS source_item_id,
           'add_on'::text AS rtype,
           0.55::numeric AS observed_score
      FROM public.menu_items mi, p
     WHERE ((p.placement IN ('cart', 'item') AND cardinality(p.cart) > 0 AND NOT p.has_drink)
            -- On the running tab: the table ordered food and nothing to drink.
            OR (p.placement = 'tab' AND p.food_units > 0 AND p.drink_units = 0))
       AND mi.venue_id = p.venue
       AND public.role_is_drink(mi.meal_role)
  ),
  fallback AS (
    SELECT pop.menu_item_id AS item_id,
           NULL::uuid AS source_item_id,
           -- Labelled for what it is everywhere, the after-meal moment included.
           'popular'::text AS rtype,
           (0.08 + 0.02 * COALESCE(pop.relative, 1))::numeric AS observed_score
      FROM p
      CROSS JOIN LATERAL public.popular_items_for_daypart(p.daypart, 12, 45) pop
     WHERE NOT EXISTS (SELECT 1 FROM curated c WHERE c.item_id = pop.menu_item_id)
       AND NOT EXISTS (SELECT 1 FROM observed o WHERE o.item_id = pop.menu_item_id)
       AND NOT EXISTS (SELECT 1 FROM observed_family f WHERE f.item_id = pop.menu_item_id)
       AND NOT EXISTS (SELECT 1 FROM learned l WHERE l.item_id = pop.menu_item_id)
  ),
  candidates AS (
    SELECT item_id, source_item_id, rtype, curated_score, 0::numeric AS observed_score,
           0::numeric AS learned_score FROM curated
    UNION ALL
    SELECT item_id, source_item_id, rtype, 0::numeric, observed_score, 0::numeric FROM observed
    UNION ALL
    SELECT item_id, source_item_id, rtype, 0::numeric, observed_score, 0::numeric FROM observed_session
    UNION ALL
    SELECT item_id, source_item_id, rtype, 0::numeric, observed_score, 0::numeric FROM observed_family
    UNION ALL
    SELECT item_id, source_item_id, rtype, 0::numeric, 0::numeric, learned_score FROM learned
    UNION ALL
    SELECT item_id, source_item_id, rtype, 0::numeric, observed_score, 0::numeric FROM grammar
    UNION ALL
    SELECT item_id, source_item_id, rtype, 0::numeric, observed_score, 0::numeric FROM completion
    UNION ALL
    SELECT item_id, source_item_id, rtype, 0::numeric, observed_score, 0::numeric FROM fallback
  ),
  rolled AS (
    SELECT item_id,
           -- Say where it came from, strongest claim first: the owner's pairing
           -- or what tables taught it, whichever is stronger, then evidence,
           -- then completing the order, then the fit graph, then popularity.
           (array_agg(source_item_id ORDER BY GREATEST(curated_score, learned_score) DESC NULLS LAST,
                      CASE rtype WHEN 'frequently_bought_together' THEN 0 WHEN 'after_meal' THEN 0
                                 WHEN 'add_on' THEN 1 WHEN 'goes_with' THEN 2 ELSE 3 END,
                      observed_score DESC))[1] AS source_item_id,
           (array_agg(rtype ORDER BY GREATEST(curated_score, learned_score) DESC,
                      CASE rtype WHEN 'frequently_bought_together' THEN 0 WHEN 'after_meal' THEN 0
                                 WHEN 'add_on' THEN 1 WHEN 'goes_with' THEN 2 ELSE 3 END,
                      observed_score DESC))[1] AS rtype,
           max(curated_score)  AS curated_score,
           max(observed_score) AS observed_score,
           max(learned_score)  AS learned_score
      FROM candidates
     GROUP BY item_id
  ),
  -- Everything that passed the guardrails, with what scoring needs.
  eligible AS (
    SELECT
      mi.id, mi.name, mi.name_bs, mi.name_ar, mi.price, mi.image_url, mi.dietary_tags,
      mi.margin_score,
      r.rtype, r.source_item_id, r.curated_score, r.observed_score, r.learned_score,
      -- Drinks for the table: one for each person still without one, when the
      -- whole order is in view (the cart before sending, or the running tab).
      CASE WHEN p.placement IN ('cart', 'tab') AND public.role_is_drink(mi.meal_role)
           THEN p.table_qty ELSE 1 END AS suggested_quantity,
      k.kind,
      /*
       * How likely a guest is to take something at this price next to this
       * meal, before there is any record to say. Up to a comfortable share of
       * the table's average line (40% for a drink or side, 80% for a dessert
       * or starter, 100% for a main) price does not matter; beyond it the
       * chance falls with the square of the overshoot, so past that point a
       * dearer dish is expected to earn less, not more. It fades as the
       * pair's own record grows.
       */
      CASE WHEN p.avg_line_price IS NULL OR p.avg_line_price <= 0 OR mi.price <= 0 THEN 1
           ELSE LEAST(1, GREATEST(0.01, power(
                  (CASE WHEN mi.meal_role = 'main' THEN 1.0
                        WHEN mi.meal_role IN ('dessert', 'starter') THEN 0.8
                        ELSE 0.4 END) * p.avg_line_price / mi.price, 2)))
      END AS price_fit,
      COALESCE(st.shown, 0) AS shown,
      public.acceptance_for_ranking(mi.id, p.placement, r.source_item_id, p.daypart, p.seed) AS p_accept,
      -- Never zero for a missing food cost: menu_unit_margins() falls back
      -- to the role's default cost share.
      COALESCE(um.unit_cm, mi.price * (1 - public.default_cost_share(mi.meal_role)), 0) AS unit_cm,
      -- How much of the acceptance estimate is evidence (pair, then dish)
      -- rather than prior: 0 with no history, towards 1 with plenty.
      1 - ((pr.alpha0 + pr.beta0) / (pr.alpha0 + pr.beta0 + COALESCE(st.shown, 0)))
          * (50.0 / (50 + COALESCE(pr.item_shown, 0))) AS evidence,
      -- Sightings this visit that the guest passed on.
      (SELECT count(*)
         FROM public.recommendation_decisions d
         JOIN public.recommendation_impressions i ON i.decision_id = d.id
        WHERE _session_id IS NOT NULL
          AND d.session_id = _session_id
          AND d.chosen_item_id = mi.id
          AND NOT EXISTS (SELECT 1 FROM public.suggestion_conversions sc WHERE sc.decision_id = d.id)
      ) AS passed_over,
      -- Exploration: room for what has not been shown much, stable per visit.
      s.w_explore * (30.0 / (30 + COALESCE(st.shown, 0)))
                  * (('x' || substr(md5(p.seed || mi.id::text), 1, 8))::bit(32)::bigint % 1000)::numeric / 1000
        AS explore,
      -- Kitchen load: only once the kitchen is genuinely behind, only against
      -- slow dishes, never against the bar.
      CASE
        WHEN mi.station = 'bar' THEN 0
        WHEN (SELECT factor FROM load) <= 1 THEN 0
        ELSE LEAST(0.35,
               0.05 * ((SELECT factor FROM load) - 1)
                    * (COALESCE((SELECT e.minutes FROM public.item_prep_estimate(mi.id) e), 8) / 10.0))
      END AS load_penalty,
      -- Inferred diet: a nudge, not a wall; one salad must not hide the meat
      -- from the rest of the table.
      CASE
        WHEN p.diet IS NULL THEN 0
        WHEN p.diet = 'vegan' AND 'vegan' = ANY(mi.dietary_tags) THEN 0
        WHEN p.diet = 'vegetarian'
             AND ('vegetarian' = ANY(mi.dietary_tags) OR 'vegan' = ANY(mi.dietary_tags)) THEN 0
        ELSE 0.30
      END AS diet_penalty,
      -- Price proportionality. Something that goes WITH the meal should cost
      -- clearly less than the table's average line; another main may cost
      -- half as much again. Capped, so it pushes down rather than hides.
      CASE
        WHEN p.avg_line_price IS NULL OR p.avg_line_price <= 0 THEN 0
        -- A dessert or a starter is a course of its own, not a side: it may
        -- cost a little more than the average line before this bites.
        WHEN mi.meal_role IN ('dessert', 'starter') THEN
          CASE
            WHEN mi.price <= p.avg_line_price * 1.2 THEN 0
            ELSE LEAST(0.25, 0.30 * (mi.price / p.avg_line_price - 1.2))
          END
        WHEN mi.meal_role IS NOT NULL AND mi.meal_role <> 'main' THEN
          CASE
            WHEN mi.price <= p.avg_line_price * 0.75 THEN 0
            ELSE LEAST(0.25, 0.30 * (mi.price / p.avg_line_price - 0.75))
          END
        WHEN mi.price <= p.avg_line_price * 1.5 THEN 0
        ELSE LEAST(0.30, 0.15 * (mi.price / p.avg_line_price - 1.5))
      END AS price_penalty
    FROM rolled r
    JOIN public.menu_items mi ON mi.id = r.item_id
    JOIN kinds k ON k.id = mi.id
    CROSS JOIN p
    CROSS JOIN s
    CROSS JOIN LATERAL public.suggestion_prior(mi.id, p.placement) pr
    LEFT JOIN public.menu_unit_margins() um ON um.item_id = mi.id
    LEFT JOIN public.suggestion_stats st
           ON st.recommended_item_id = mi.id
          AND st.placement = p.placement
          AND st.source_item_id IS NOT DISTINCT FROM r.source_item_id
          AND st.daypart IS NULL
    WHERE s.enabled
      AND NOT p.held_out
      -- Never another restaurant's dish, whichever source proposed it.
      AND mi.venue_id = p.venue
      -- ---- Relevance first: a candidate is only scored if it belongs. ----
      -- Never volunteered: see reco_vetoed.
      AND NOT public.reco_vetoed(k.kind, mi.meal_role, r.curated_score > 0, p.at, p.placement)
      -- A reason to be here: the owner paired it, or the fit graph says it
      -- goes with something on the table (or after the meal). Popularity,
      -- co-occurrence and margin only ever rank what passed this.
      AND (r.curated_score > 0 OR EXISTS (
            SELECT 1 FROM public.reco_fit f
             WHERE f.candidate_kind = k.kind
               AND CASE WHEN p.placement = 'after_meal'
                        THEN f.context_kind = 'after_meal'
                        ELSE f.context_kind IN (SELECT ck.kind FROM context_kinds ck) END))
      -- Nothing that clashes with what is on the table, curated or not.
      AND NOT EXISTS (
            SELECT 1 FROM public.reco_clash c
             WHERE c.candidate_kind = k.kind
               AND c.context_kind IN (SELECT ck.kind FROM context_kinds ck))
      -- No second of a kind already in this round: we can add, not swap, so
      -- an "upgrade" to truffle fries next to regular fries is a second side.
      AND (p.placement = 'after_meal' OR k.kind NOT IN (SELECT kk.kind FROM cart_kinds kk))
      -- ---- Guardrails. Scoring cannot override any of these. ----
      AND public.menu_item_orderable(mi, p.now_time)
      -- Never re-suggest what is in the cart right now; beyond that, ask the
      -- role (a second coffee is ordinary café behaviour).
      AND NOT (mi.id = ANY(p.cart))
      AND NOT public.repeat_blocked(mi.id, _session_id)
      AND (r.rtype IN ('upgrade_to', 'add_on', 'after_meal')
           OR mi.subcategory_id NOT IN (SELECT cs.subcategory_id FROM cart_subcategories cs))
      -- Retired: shown fairly often, and even an optimistic reading of the
      -- record is below the floor.
      AND NOT (
        COALESCE(st.shown, 0) >= s.retire_after
        AND public.acceptance_retired(COALESCE(st.accepted, 0), COALESCE(st.shown, 0),
                                      pr.alpha0, pr.beta0, s.min_acceptance)
      )
      -- Never suggest around an allergen the guest has filtered out.
      AND NOT (mi.allergens && p.blocked_allergens)
      -- Coursing and the alcohol rule. See reco_role_fits.
      AND public.reco_role_fits(
            mi.meal_role,
            p.placement,
            CASE WHEN EXISTS (SELECT 1 FROM observed ob WHERE ob.item_id = mi.id)
                   OR EXISTS (SELECT 1 FROM observed_session obs WHERE obs.item_id = mi.id)
                   OR EXISTS (SELECT 1 FROM observed_family obf WHERE obf.item_id = mi.id)
                   OR EXISTS (SELECT 1 FROM learned lr WHERE lr.item_id = mi.id)
                 THEN 'observed' ELSE r.rtype END,
            r.curated_score > 0,
            p.cart,
            _session_id,
            p.at,
            p.no_alcohol)
      -- A kids' meal is for a child the menu cannot see: only when curated.
      AND (r.curated_score > 0 OR NOT EXISTS (
            SELECT 1 FROM public.subcategories ks
             WHERE ks.id = mi.subcategory_id
               AND ks.name ~* '(kid|djec|dječ|dijete|child)'))
  ),
  valued AS (
    SELECT e.*,
           e.p_accept * e.unit_cm * (1 - (1 - e.price_fit) * (1 - e.evidence)) AS expected_value
      FROM eligible e
  ),
  scored AS (
    SELECT v.*,
      -- Curated priority and observed strength stand in for "guests will take
      -- this". Once a pair has a record of its own they give way to it, down
      -- to a fifth, and measured expected profit decides. What tables taught
      -- it ranks on the curated scale: the stronger of the two counts.
      ( GREATEST(0.2, 1 - v.evidence) * (s.w_curated * GREATEST(v.curated_score, v.learned_score)
                                         + s.w_observed * v.observed_score)
      -- Expected profit: a light hand while it rests on assumptions, the
      -- full weight once the pair has a record.
      + s.w_value * (0.3 + 0.7 * v.evidence)
                  * COALESCE(v.expected_value / NULLIF(max(v.expected_value) OVER (), 0), 0)
      + (0.10 * COALESCE(v.margin_score, 0)::numeric / 100 - 0.05)
      + v.explore
      - v.load_penalty
      - v.diet_penalty
      - v.price_penalty
      - 0.15 * v.passed_over
      ) AS score
    FROM valued v
    CROSS JOIN s
  )
  SELECT id, name, name_bs, name_ar, price, image_url, dietary_tags,
         rtype AS recommendation_type,
         rtype AS reason,
         source_item_id,
         suggested_quantity
    FROM scored
   ORDER BY score DESC, price ASC, id
   LIMIT (SELECT lim FROM p);
$function$;

CREATE OR REPLACE FUNCTION public.reco_holdout_comparison(_days integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_venue uuid := public.current_venue();
  v_since timestamptz := now() - make_interval(days => GREATEST(COALESCE(_days, 30), 1));
  v_exp public.experiments;
  v_treated_n bigint; v_treated_mean numeric; v_treated_var numeric;
  v_held_n bigint;    v_held_mean numeric;    v_held_var numeric;
  v_stats jsonb; v_srm jsonb; v_power jsonb;
  v_status text;
  v_measured_days numeric;
  v_sessions_per_day numeric;
  v_projection numeric;
  v_guard jsonb;
  -- Adjusted comparison
  v_ta_n bigint; v_ta_y numeric; v_ta_x numeric; v_ta_vy numeric; v_ta_vx numeric; v_ta_c numeric;
  v_hb_n bigint; v_hb_y numeric; v_hb_x numeric; v_hb_vy numeric; v_hb_vx numeric; v_hb_c numeric;
  v_adj jsonb;
  v_adj_status text;
  v_vr numeric;
  -- Attach rates
  v_am_tn bigint; v_am_tx bigint; v_am_hn bigint; v_am_hx bigint;
  v_dr_tn bigint; v_dr_tx bigint; v_dr_hn bigint; v_dr_hx bigint;
BEGIN
  IF NOT public.can_staff(v_venue) THEN
    RAISE EXCEPTION 'Only staff can read menu intelligence' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- The most recent experiment that overlaps the window.
  SELECT * INTO v_exp FROM public.experiments
   WHERE venue_id = v_venue
     AND started_at <= now() AND (ended_at IS NULL OR ended_at > v_since)
   ORDER BY started_at DESC LIMIT 1;

  IF v_exp.id IS NULL THEN
    RETURN jsonb_build_object('status', 'not_running', 'days', _days);
  END IF;

  SELECT
    count(*) FILTER (WHERE a.arm = 'treatment'),
    avg(so.net_sales) FILTER (WHERE a.arm = 'treatment'),
    var_samp(so.net_sales) FILTER (WHERE a.arm = 'treatment'),
    count(*) FILTER (WHERE a.arm = 'holdout'),
    avg(so.net_sales) FILTER (WHERE a.arm = 'holdout'),
    var_samp(so.net_sales) FILTER (WHERE a.arm = 'holdout')
  INTO v_treated_n, v_treated_mean, v_treated_var, v_held_n, v_held_mean, v_held_var
  FROM public.session_outcomes so
  JOIN public.session_experiment_assignment a ON a.session_id = so.session_id
  JOIN public.table_sessions ts ON ts.id = so.session_id
  WHERE a.experiment_id = v_exp.id
    AND ts.venue_id = v_venue
    AND so.opened_at > v_since
    -- A table that never ordered says nothing about suggestions.
    AND so.orders > 0;

  v_stats := public.welch_interval(
    COALESCE(v_treated_mean, 0), COALESCE(v_treated_var, 0), COALESCE(v_treated_n, 0),
    COALESCE(v_held_mean, 0),    COALESCE(v_held_var, 0),    COALESCE(v_held_n, 0));

  /*
   * The adjusted comparison. One predicted spend per visit from what was
   * known before any suggestion could act:
   *   * the visit's cell — daypart and weekday/weekend of its business day —
   *     as a leave-one-out cell mean, shrunk to the overall mean;
   *   * covers and the first decision's cart value, by pooled least squares
   *     within cells (a missing value is the pooled mean, so it carries no
   *     information rather than wrong information).
   * Nothing here uses the arm, so the prediction is the same function in
   * both; θ then rescales it per ancova_interval.
   */
  WITH visits AS (
    SELECT a.arm,
           so.net_sales::numeric AS y,
           so.covers::numeric AS covers,
           public.daypart_of(so.opened_at)
             || CASE WHEN EXTRACT(ISODOW FROM public.business_day(so.opened_at)) >= 6
                     THEN ':weekend' ELSE ':weekday' END AS cell,
           (SELECT d.cart_value FROM public.recommendation_decisions d
             WHERE d.session_id = so.session_id
             ORDER BY d.created_at, d.id LIMIT 1)::numeric AS first_cart
      FROM public.session_outcomes so
      JOIN public.session_experiment_assignment a ON a.session_id = so.session_id
      JOIN public.table_sessions ts ON ts.id = so.session_id
     WHERE a.experiment_id = v_exp.id
       AND ts.venue_id = v_venue
       AND so.opened_at > v_since
       AND so.orders > 0
  ),
  filled AS (
    SELECT v.arm, v.y, v.cell,
           COALESCE(v.covers, avg(v.covers) OVER (), 0) AS c,
           COALESCE(v.first_cart, avg(v.first_cart) OVER (), 0) AS f
      FROM visits v
  ),
  grand AS (SELECT avg(y) AS gy, avg(c) AS gc, avg(f) AS gf FROM filled),
  cells AS (
    SELECT cell, count(*) AS n, sum(y) AS sy, sum(c) AS sc, sum(f) AS sf
      FROM filled GROUP BY cell
  ),
  resid AS (
    SELECT fl.arm, fl.y,
           -- leave-one-out, shrunk with ten visits' worth of the overall mean
           (ce.sy - fl.y + 10 * g.gy) / (ce.n - 1 + 10) AS my,
           fl.y - (ce.sy - fl.y + 10 * g.gy) / (ce.n - 1 + 10) AS ry,
           fl.c - (ce.sc - fl.c + 10 * g.gc) / (ce.n - 1 + 10) AS rc,
           fl.f - (ce.sf - fl.f + 10 * g.gf) / (ce.n - 1 + 10) AS rf
      FROM filled fl
      JOIN cells ce ON ce.cell = fl.cell
      CROSS JOIN grand g
  ),
  moments AS (
    SELECT sum(rf * rf) AS sff, sum(rc * rc) AS scc, sum(rf * rc) AS sfc,
           sum(rf * ry) AS sfy, sum(rc * ry) AS scy
      FROM resid
  ),
  coef AS (
    SELECT CASE
             WHEN sff > 0 AND scc > 0 AND sff * scc - sfc * sfc > 1e-9 * sff * scc
               THEN (scc * sfy - sfc * scy) / (sff * scc - sfc * sfc)
             WHEN sff > 0 THEN sfy / sff
             ELSE 0 END AS bf,
           CASE
             WHEN sff > 0 AND scc > 0 AND sff * scc - sfc * sfc > 1e-9 * sff * scc
               THEN (sff * scy - sfc * sfy) / (sff * scc - sfc * sfc)
             WHEN COALESCE(sff, 0) = 0 AND scc > 0 THEN scy / scc
             ELSE 0 END AS bc
      FROM moments
  ),
  predicted AS (
    SELECT r.arm, r.y, r.my + COALESCE(k.bf, 0) * r.rf + COALESCE(k.bc, 0) * r.rc AS x
      FROM resid r CROSS JOIN coef k
  )
  SELECT
    count(*) FILTER (WHERE arm = 'treatment'),
    avg(y) FILTER (WHERE arm = 'treatment'), avg(x) FILTER (WHERE arm = 'treatment'),
    var_samp(y) FILTER (WHERE arm = 'treatment'), var_samp(x) FILTER (WHERE arm = 'treatment'),
    covar_samp(x, y) FILTER (WHERE arm = 'treatment'),
    count(*) FILTER (WHERE arm = 'holdout'),
    avg(y) FILTER (WHERE arm = 'holdout'), avg(x) FILTER (WHERE arm = 'holdout'),
    var_samp(y) FILTER (WHERE arm = 'holdout'), var_samp(x) FILTER (WHERE arm = 'holdout'),
    covar_samp(x, y) FILTER (WHERE arm = 'holdout')
  INTO v_ta_n, v_ta_y, v_ta_x, v_ta_vy, v_ta_vx, v_ta_c,
       v_hb_n, v_hb_y, v_hb_x, v_hb_vy, v_hb_vx, v_hb_c
  FROM predicted;

  v_adj := public.ancova_interval(
    COALESCE(v_ta_n, 0), COALESCE(v_ta_y, 0), COALESCE(v_ta_x, 0),
    COALESCE(v_ta_vy, 0), COALESCE(v_ta_vx, 0), COALESCE(v_ta_c, 0),
    COALESCE(v_hb_n, 0), COALESCE(v_hb_y, 0), COALESCE(v_hb_x, 0),
    COALESCE(v_hb_vy, 0), COALESCE(v_hb_vx, 0), COALESCE(v_hb_c, 0));

  -- Attach: after the meal (dessert or hot drink once a main was served).
  WITH v AS (
    SELECT a.arm, so.session_id
      FROM public.session_outcomes so
      JOIN public.session_experiment_assignment a ON a.session_id = so.session_id
      JOIN public.table_sessions ts ON ts.id = so.session_id
     WHERE a.experiment_id = v_exp.id AND ts.venue_id = v_venue
       AND so.opened_at > v_since AND so.orders > 0
  ),
  lines AS (
    SELECT co.table_session_id AS session_id, co.id AS order_id, co.created_at,
           oi.served_at, mi.meal_role, mi.station
      FROM public.completed_orders co
      JOIN public.order_items oi ON oi.order_id = co.id
      JOIN public.menu_items mi ON mi.id = oi.menu_item_id
     WHERE co.table_session_id IN (SELECT session_id FROM v)
  ),
  served_main AS (
    SELECT session_id, min(served_at) AS at
      FROM lines WHERE meal_role = 'main' AND served_at IS NOT NULL
     GROUP BY session_id
  ),
  flagged AS (
    SELECT v.arm,
           EXISTS (SELECT 1 FROM lines l
                    WHERE l.session_id = sm.session_id
                      AND l.meal_role IN ('dessert', 'hot_drink')
                      AND l.created_at > sm.at) AS attached
      FROM served_main sm JOIN v ON v.session_id = sm.session_id
  )
  SELECT count(*) FILTER (WHERE arm = 'treatment'),
         count(*) FILTER (WHERE arm = 'treatment' AND attached),
         count(*) FILTER (WHERE arm = 'holdout'),
         count(*) FILTER (WHERE arm = 'holdout' AND attached)
    INTO v_am_tn, v_am_tx, v_am_hn, v_am_hx
    FROM flagged;

  -- Attach: a drink in the first round that had a main.
  WITH v AS (
    SELECT a.arm, so.session_id
      FROM public.session_outcomes so
      JOIN public.session_experiment_assignment a ON a.session_id = so.session_id
      JOIN public.table_sessions ts ON ts.id = so.session_id
     WHERE a.experiment_id = v_exp.id AND ts.venue_id = v_venue
       AND so.opened_at > v_since AND so.orders > 0
  ),
  lines AS (
    SELECT co.table_session_id AS session_id, co.id AS order_id, co.created_at,
           mi.meal_role, mi.station
      FROM public.completed_orders co
      JOIN public.order_items oi ON oi.order_id = co.id
      JOIN public.menu_items mi ON mi.id = oi.menu_item_id
     WHERE co.table_session_id IN (SELECT session_id FROM v)
  ),
  first_main_round AS (
    SELECT DISTINCT ON (session_id) session_id, order_id
      FROM lines WHERE meal_role = 'main'
     ORDER BY session_id, created_at, order_id
  ),
  flagged AS (
    SELECT v.arm,
           EXISTS (SELECT 1 FROM lines l
                    WHERE l.order_id = fm.order_id
                      AND (public.role_is_drink(l.meal_role)
                           OR (l.meal_role IS NULL AND l.station = 'bar'))) AS attached
      FROM first_main_round fm JOIN v ON v.session_id = fm.session_id
  )
  SELECT count(*) FILTER (WHERE arm = 'treatment'),
         count(*) FILTER (WHERE arm = 'treatment' AND attached),
         count(*) FILTER (WHERE arm = 'holdout'),
         count(*) FILTER (WHERE arm = 'holdout' AND attached)
    INTO v_dr_tn, v_dr_tx, v_dr_hn, v_dr_hx
    FROM flagged;

  v_srm := public.experiment_srm(v_exp.id);
  v_power := public.experiment_power(v_exp.id, 5);

  SELECT jsonb_build_object(
    'rating_treatment',  round(avg(so.avg_rating) FILTER (WHERE a.arm = 'treatment'), 2),
    'rating_holdout',    round(avg(so.avg_rating) FILTER (WHERE a.arm = 'holdout'), 2),
    'minutes_treatment', round(avg(so.avg_minutes_to_served) FILTER (WHERE a.arm = 'treatment'), 1),
    'minutes_holdout',   round(avg(so.avg_minutes_to_served) FILTER (WHERE a.arm = 'holdout'), 1))
    INTO v_guard
    FROM public.session_outcomes so
    JOIN public.session_experiment_assignment a ON a.session_id = so.session_id
    JOIN public.table_sessions ts ON ts.id = so.session_id
   WHERE a.experiment_id = v_exp.id AND ts.venue_id = v_venue
     AND so.opened_at > v_since;

  v_status := CASE
    -- Health first. A broken split makes the effect estimate meaningless, so
    -- it is suppressed rather than shown with a warning nobody reads.
    WHEN (v_srm ->> 'checked')::boolean AND NOT (v_srm ->> 'healthy')::boolean THEN 'invalid_srm'
    WHEN COALESCE(v_held_n, 0) < 30 OR COALESCE(v_treated_n, 0) < 30 THEN 'too_early'
    WHEN NOT (v_stats ->> 'significant')::boolean THEN 'no_measurable_effect'
    WHEN (v_stats ->> 'difference')::numeric > 0 THEN 'positive'
    ELSE 'negative'
  END;

  v_adj_status := CASE
    WHEN v_status IN ('invalid_srm', 'too_early') THEN v_status
    WHEN NOT COALESCE((v_adj ->> 'significant')::boolean, false) THEN 'no_measurable_effect'
    WHEN (v_adj ->> 'difference')::numeric > 0 THEN 'positive'
    ELSE 'negative'
  END;

  v_vr := LEAST(GREATEST(COALESCE((v_adj ->> 'variance_reduction_pct')::numeric, 0), 0), 99) / 100;

  -- Days of the window during which this experiment was collecting.
  v_measured_days := GREATEST(
    EXTRACT(EPOCH FROM (LEAST(now(), COALESCE(v_exp.ended_at, now()))
                        - GREATEST(v_since, v_exp.started_at))) / 86400.0,
    1);
  v_sessions_per_day :=
    (COALESCE(v_treated_n, 0) + COALESCE(v_held_n, 0))::numeric / v_measured_days;
  -- Conservative: the low end of the interval, never the point estimate.
  v_projection := CASE WHEN v_status = 'positive'
    THEN round((v_stats ->> 'ci_low')::numeric * v_sessions_per_day * 30, 0) ELSE NULL END;

  RETURN jsonb_build_object(
    'days', _days,
    'measured_days', round(v_measured_days, 1),
    'status', v_status,
    'experiment', jsonb_build_object(
      'id', v_exp.id, 'name', v_exp.name,
      'policy_version', v_exp.policy_version,
      'started_at', v_exp.started_at, 'ended_at', v_exp.ended_at),
    'holdout_pct', v_exp.holdout_pct,
    'unit', 'table_session',
    'measure', 'net_sales_excl_tips_and_refunds',
    'with_suggestions', jsonb_build_object(
      'sessions', COALESCE(v_treated_n, 0),
      'avg_net_sales', COALESCE(round(v_treated_mean, 2), 0)),
    'holdout', jsonb_build_object(
      'sessions', COALESCE(v_held_n, 0),
      'avg_net_sales', COALESCE(round(v_held_mean, 2), 0)),
    'difference', v_stats -> 'difference',
    'ci_low', v_stats -> 'ci_low',
    'ci_high', v_stats -> 'ci_high',
    'significant', v_stats -> 'significant',
    'conservative_monthly_value', v_projection,
    'srm', v_srm,
    'power', v_power,
    'guardrails', v_guard,
    'reliable', (v_stats ->> 'significant')::boolean,
    'adjusted', v_adj || jsonb_build_object(
      'status', v_adj_status,
      'method', 'ANCOVA (CUPED): covers, daypart, weekday/weekend, first cart value',
      'days_to_answer', CASE WHEN v_power ? 'days_to_answer'
        THEN ceil(((v_power -> 'days_to_answer' ->> 'days')::numeric) * (1 - v_vr)) END,
      'days_to_answer_at_50', CASE WHEN v_power ? 'days_to_answer_at_50'
        THEN ceil(((v_power -> 'days_to_answer_at_50' ->> 'days')::numeric) * (1 - v_vr)) END),
    'attach', jsonb_build_object(
      'after_meal', jsonb_build_object(
        'measure', 'visits with a main served that then ordered a dessert or hot drink')
        || public.two_proportion_interval(v_am_tx, v_am_tn, v_am_hx, v_am_hn),
      'drink_with_main', jsonb_build_object(
        'measure', 'visits whose first round with a main also had a drink')
        || public.two_proportion_interval(v_dr_tx, v_dr_tn, v_dr_hx, v_dr_hn))
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.reco_learned_pairs(_context uuid[], _at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(item_id uuid, source_item_id uuid, level text, tables integer, attach numeric, lift numeric, strength numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH prm AS (
    SELECT COALESCE(_at, public.reco_now()) AS at,
           5::numeric    AS m,         -- pseudo-tables of prior at each level
           3             AS support,   -- tables before a pair is believed
           0.12::numeric AS ref        -- strength 1 − exp(−share / ref): 0.81 at one in five
  ),
  ctx AS (
    SELECT DISTINCT mi.id AS a, mi.venue_id AS v, mi.subcategory_id::text AS s,
           public.reco_kind(mi.name, sub.name, mi.meal_role, mi.station) AS k
      FROM public.menu_items mi
      LEFT JOIN public.subcategories sub ON sub.id = mi.subcategory_id
     WHERE mi.id = ANY(COALESCE(_context, '{}'::uuid[]))
  ),
  keyed AS (
    SELECT c.a, 'item'::text AS lvl, c.a::text AS key FROM ctx c
    UNION ALL
    SELECT c.a, 'section', c.s FROM ctx c WHERE c.s IS NOT NULL
    UNION ALL
    SELECT c.a, 'kind', c.k FROM ctx c
  ),
  counted AS (
    SELECT kd.a, kd.lvl, r.item_id AS b, r.tables, public.reco_decayed(r.w, r.w_at, prm.at) AS w
      FROM keyed kd
      JOIN public.reco_learning r ON r.ctx_level = kd.lvl AND r.ctx_key = kd.key
      CROSS JOIN prm
  ),
  -- A pair never crosses restaurants: B is a dish of A's restaurant.
  cand AS (
    SELECT DISTINCT c.a, c.b
      FROM counted c
      JOIN ctx x ON x.a = c.a
      JOIN public.menu_items mb ON mb.id = c.b AND mb.venue_id = x.v
     WHERE c.b IS NOT NULL
  ),
  base AS (
    SELECT r.ctx_key AS b, public.reco_decayed(r.w, r.w_at, prm.at) AS w
      FROM public.reco_learning r CROSS JOIN prm
     WHERE r.ctx_level = 'item' AND r.item_id IS NULL
       AND r.ctx_key IN (SELECT c.b::text FROM cand c)
  ),
  everyone AS (
    SELECT COALESCE(max(public.reco_decayed(r.w, r.w_at, prm.at)), 0) AS w
      FROM public.reco_learning r CROSS JOIN prm
     WHERE r.ctx_level = 'all' AND r.ctx_key = '*' AND r.item_id IS NULL
  ),
  m AS (
    SELECT c.a, c.b,
           COALESCE(pi.w, 0) AS w_ab, COALESCE(pi.tables, 0) AS n_ab, COALESCE(ti.w, 0) AS w_a,
           COALESCE(ps.w, 0) AS w_sb, COALESCE(ps.tables, 0) AS n_sb, COALESCE(ts.w, 0) AS w_s,
           COALESCE(pk.w, 0) AS w_kb, COALESCE(pk.tables, 0) AS n_kb, COALESCE(tk.w, 0) AS w_k,
           COALESCE(bs.w, 0) AS w_b,
           GREATEST(e.w, 1) AS w_all
      FROM cand c
      CROSS JOIN everyone e
      LEFT JOIN counted pi ON pi.a = c.a AND pi.lvl = 'item'    AND pi.b = c.b
      LEFT JOIN counted ps ON ps.a = c.a AND ps.lvl = 'section' AND ps.b = c.b
      LEFT JOIN counted pk ON pk.a = c.a AND pk.lvl = 'kind'    AND pk.b = c.b
      LEFT JOIN counted ti ON ti.a = c.a AND ti.lvl = 'item'    AND ti.b IS NULL
      LEFT JOIN counted ts ON ts.a = c.a AND ts.lvl = 'section' AND ts.b IS NULL
      LEFT JOIN counted tk ON tk.a = c.a AND tk.lvl = 'kind'    AND tk.b IS NULL
      LEFT JOIN base bs ON bs.b = c.b::text
  ),
  shrunk AS (
    SELECT m.*, x.beta, y.th_k, z.th_s, t.th_a,
           (m.n_ab >= prm.support AND public.eb_lower05(m.w_ab, m.w_a * m.w_b / m.w_all) > 1) AS item_ok,
           (m.n_sb >= prm.support AND public.eb_lower05(m.w_sb, m.w_s * m.w_b / m.w_all) > 1) AS section_ok,
           (m.n_kb >= prm.support AND public.eb_lower05(m.w_kb, m.w_k * m.w_b / m.w_all) > 1) AS kind_ok,
           prm.ref
      FROM m
      CROSS JOIN prm
      CROSS JOIN LATERAL (SELECT (m.w_b + 0.5) / (m.w_all + 1) AS beta) x
      CROSS JOIN LATERAL (SELECT (m.w_kb + prm.m * x.beta) / (m.w_k + prm.m) AS th_k) y
      CROSS JOIN LATERAL (SELECT (m.w_sb + prm.m * y.th_k) / (m.w_s + prm.m) AS th_s) z
      CROSS JOIN LATERAL (SELECT (m.w_ab + prm.m * z.th_s) / (m.w_a + prm.m) AS th_a) t
  )
  SELECT s.b, s.a,
         CASE WHEN s.item_ok THEN 'item' WHEN s.section_ok THEN 'section' ELSE 'kind' END,
         CASE WHEN s.item_ok THEN s.n_ab WHEN s.section_ok THEN s.n_sb ELSE s.n_kb END,
         round(s.th_a, 4),
         round(s.th_a / NULLIF(s.beta, 0), 2),
         round(1 - exp(-s.th_a / s.ref), 4)
    FROM shrunk s
   WHERE s.item_ok OR s.section_ok OR s.kind_ok;
$function$;

CREATE OR REPLACE FUNCTION public.reco_policy_version()
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$
  SELECT CASE
    WHEN COALESCE((SELECT reco_sampling_enabled FROM public.restaurant_settings
                    WHERE venue_id = public.current_venue()), false)
    THEN 'v3-profit-thompson'
    ELSE 'v3-profit'
  END;
$function$;

CREATE OR REPLACE FUNCTION public.recommendation_engine_health()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_venue uuid := public.current_venue();
  v jsonb;
  v_learning jsonb;
BEGIN
  IF NOT public.can_staff(v_venue) THEN
    RAISE EXCEPTION 'Only staff can read menu intelligence' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Learned counters are keyed by dish: a pair belongs to its dishes'
  -- restaurant. The visit total ('all') is kept for every restaurant at once.
  SELECT jsonb_build_object(
    'tables', COALESCE((SELECT r.tables FROM public.reco_learning r
                         WHERE r.ctx_level = 'all' AND r.ctx_key = '*' AND r.item_id IS NULL), 0),
    'dish_pairs', (SELECT count(*) FROM public.reco_learning r
                     JOIN public.menu_items mi ON mi.id = r.item_id
                    WHERE r.ctx_level = 'item' AND r.item_id IS NOT NULL AND r.tables >= 3
                      AND r.ctx_key < r.item_id::text
                      AND mi.venue_id = v_venue),
    'family_pairs', (SELECT count(*) FROM public.reco_learning r
                       JOIN public.menu_items mi ON mi.id = r.item_id
                      WHERE r.ctx_level IN ('section', 'kind') AND r.item_id IS NOT NULL AND r.tables >= 3
                        AND mi.venue_id = v_venue),
    'last_learned_at', (SELECT max(r.last_at) FROM public.reco_learning r
                          JOIN public.menu_items mi ON mi.id::text = r.ctx_key
                         WHERE r.ctx_level = 'item'
                           AND mi.venue_id = v_venue),
    'refreshed_at', (SELECT m.last_run_at FROM public.maintenance_runs m WHERE m.job = 'menu_intelligence'),
    'scheduler', CASE WHEN EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
                      THEN 'pg_cron and staff screens' ELSE 'staff screens' END
  ) INTO v_learning;

  SELECT jsonb_build_object(
    'enabled', COALESCE(s.recommendations_enabled, true),
    'weights', jsonb_build_object(
      'curated',  s.reco_weight_curated,
      'observed', s.reco_weight_observed,
      'learned',  s.reco_weight_learned,
      'margin',   s.reco_weight_margin,
      'exploration', s.reco_exploration
    ),
    'retire_below_acceptance_pct', round(100 * s.reco_min_acceptance, 1),
    'retire_after_impressions', s.reco_retire_after_impressions,
    'alcohol_from', s.reco_alcohol_from,
    'curated_rules', (SELECT count(*) FROM public.menu_item_recommendations r
                        JOIN public.menu_items mi ON mi.id = r.recommended_item_id
                       WHERE r.enabled AND mi.venue_id = v_venue),
    'learned_pairs', (SELECT count(*) FROM public.menu_item_affinity a
                        JOIN public.menu_items mi ON mi.id = a.item_a
                       WHERE a.eb05 > 1 AND mi.venue_id = v_venue),
    'learned_section_pairs', (SELECT count(*) FROM public.subcategory_affinity sa
                                JOIN public.subcategories sub ON sub.id = sa.sub_a
                               WHERE sa.eb05 > 1 AND sub.venue_id = v_venue),
    'tracked_pairs', (SELECT count(*) FROM public.suggestion_stats st
                        JOIN public.menu_items mi ON mi.id = st.recommended_item_id
                       WHERE st.daypart IS NULL AND mi.venue_id = v_venue),
    'pairs_still_learning', (SELECT count(*) FROM public.suggestion_stats st
                               JOIN public.menu_items mi ON mi.id = st.recommended_item_id
                              WHERE st.daypart IS NULL AND st.shown < 20 AND mi.venue_id = v_venue),
    'pairs_retired', (
      SELECT count(*) FROM public.suggestion_stats st
        JOIN public.menu_items mi ON mi.id = st.recommended_item_id
      CROSS JOIN LATERAL public.suggestion_prior(st.recommended_item_id, st.placement) pr
       WHERE st.daypart IS NULL
         AND mi.venue_id = v_venue
         AND st.shown >= s.reco_retire_after_impressions
         AND public.acceptance_retired(st.accepted, st.shown, pr.alpha0, pr.beta0, s.reco_min_acceptance)),
    'affinity_computed_at', (SELECT max(a.computed_at) FROM public.menu_item_affinity a
                               JOIN public.menu_items mi ON mi.id = a.item_a
                              WHERE mi.venue_id = v_venue),
    'stats_updated_at', (SELECT max(st.updated_at) FROM public.suggestion_stats st
                           JOIN public.menu_items mi ON mi.id = st.recommended_item_id
                          WHERE mi.venue_id = v_venue),
    'window_days', 90,
    'orders_analysed', (SELECT count(*) FROM public.completed_orders co
                          JOIN public.orders o ON o.id = co.id
                         WHERE co.created_at > now() - interval '90 days'
                           AND o.venue_id = v_venue),
    'learning', v_learning
  ) INTO v
  FROM public.restaurant_settings s WHERE s.venue_id = v_venue;

  RETURN v;
END;
$function$;

CREATE OR REPLACE FUNCTION public.start_experiment(_name text, _policy_version text, _holdout_pct smallint DEFAULT 10)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_venue uuid := public.current_venue();
  v_id uuid;
BEGIN
  IF NOT public.can_admin(v_venue) THEN
    RAISE EXCEPTION 'Only a manager can start an experiment' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Close whatever is running. Two overlapping experiments assigning the same
  -- sessions would interfere and neither would mean anything.
  UPDATE public.experiments SET ended_at = now() WHERE ended_at IS NULL AND venue_id = v_venue;

  INSERT INTO public.experiments(name, policy_version, holdout_pct, venue_id)
  VALUES (_name, _policy_version, GREATEST(1, LEAST(50, _holdout_pct)), v_venue)
  RETURNING id INTO v_id;

  UPDATE public.restaurant_settings SET reco_holdout_pct = GREATEST(1, LEAST(50, _holdout_pct)) WHERE venue_id = v_venue;

  PERFORM public.write_audit('experiment.started', 'experiment', v_id, NULL,
    jsonb_build_object('name', _name, 'policy_version', _policy_version, 'holdout_pct', _holdout_pct));

  RETURN jsonb_build_object('id', v_id, 'name', _name, 'policy_version', _policy_version);
END;
$function$;

CREATE OR REPLACE FUNCTION public.stop_experiment(_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_venue uuid := public.current_venue();
  v_id uuid;
BEGIN
  IF NOT public.can_admin(v_venue) THEN
    RAISE EXCEPTION 'Only a manager can stop an experiment' USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE public.experiments SET ended_at = now(), notes = COALESCE(_notes, notes)
   WHERE ended_at IS NULL AND venue_id = v_venue RETURNING id INTO v_id;

  UPDATE public.restaurant_settings SET reco_holdout_pct = 0 WHERE venue_id = v_venue;
  PERFORM public.write_audit('experiment.stopped', 'experiment', v_id, NULL, NULL, _notes);
  RETURN jsonb_build_object('stopped', v_id IS NOT NULL, 'id', v_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.suggestion_evidence(_source_item_id uuid, _recommended_item_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_venue uuid;
  v_min int;
  v_row public.session_item_affinity;
  v_learned record;
  v_with_source int;
  v_low numeric;
BEGIN
  IF _source_item_id IS NULL OR _recommended_item_id IS NULL THEN
    RETURN jsonb_build_object('kind', 'none');
  END IF;

  SELECT venue_id INTO v_venue FROM public.menu_items WHERE id = _recommended_item_id;

  SELECT COALESCE(social_proof_min_sessions, 20) INTO v_min
    FROM public.restaurant_settings WHERE venue_id = COALESCE(v_venue, public.current_venue());

  SELECT lp.level, lp.tables INTO v_learned
    FROM public.reco_learned_pairs(ARRAY[_source_item_id], NULL) lp
   WHERE lp.item_id = _recommended_item_id AND lp.source_item_id = _source_item_id
   LIMIT 1;

  IF FOUND THEN
    IF v_learned.level <> 'item' THEN
      RETURN jsonb_build_object('kind', 'similar', 'level', v_learned.level, 'tables', v_learned.tables);
    END IF;

    SELECT r.tables INTO v_with_source
      FROM public.reco_learning r
     WHERE r.ctx_level = 'item' AND r.ctx_key = _source_item_id::text AND r.item_id IS NULL;
    v_low := public.wilson_lower(v_learned.tables, COALESCE(v_with_source, 0));

    IF COALESCE(v_with_source, 0) >= v_min AND v_low >= 0.20 THEN
      RETURN jsonb_build_object('kind', 'quantified', 'percent', round(v_low * 100), 'sessions', v_with_source);
    END IF;
    RETURN jsonb_build_object('kind', 'qualitative', 'sessions', v_with_source);
  END IF;

  SELECT * INTO v_row FROM public.session_item_affinity
   WHERE item_a = _source_item_id AND item_b = _recommended_item_id;

  -- No claim unless the pair beats chance on a pessimistic reading.
  IF NOT FOUND OR COALESCE(v_row.eb05, 0) <= 1 THEN
    RETURN jsonb_build_object('kind', 'none');
  END IF;

  IF v_row.a_sessions >= v_min AND v_row.confidence_low >= 0.20 THEN
    RETURN jsonb_build_object(
      'kind', 'quantified',
      -- Deliberately the conservative bound, and deliberately "visits".
      'percent', round(v_row.confidence_low * 100),
      'sessions', v_row.a_sessions);
  END IF;

  RETURN jsonb_build_object('kind', 'qualitative', 'sessions', v_row.a_sessions);
END;
$function$;

CREATE OR REPLACE FUNCTION public.suggestion_impact(_days integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_venue uuid := public.current_venue();
  v_since timestamptz := now() - make_interval(days => GREATEST(COALESCE(_days, 30), 1));
  v_net numeric;
  v_tips numeric;
  v_attributed numeric;
  v_orders int;
  v_orders_with int;
  v_shown bigint;
  v_accepted bigint;
  v_seen bigint;
  v_paid bigint;
  v_cover_sessions int;
  v_cover_treated numeric;
  v_cover_held numeric;
BEGIN
  IF NOT public.can_staff(v_venue) THEN
    RAISE EXCEPTION 'Only staff can read menu intelligence' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT COALESCE(sum(co.total - COALESCE(co.tip_amount, 0) - COALESCE(co.refunded_amount, 0)), 0),
         COALESCE(sum(co.tip_amount), 0),
         count(*)
    INTO v_net, v_tips, v_orders
    FROM public.completed_orders co
    JOIN public.orders o ON o.id = co.id
   WHERE co.created_at > v_since
     AND o.venue_id = v_venue;

  SELECT COALESCE(sum(sc.line_total), 0), count(DISTINCT sc.order_id)
    INTO v_attributed, v_orders_with
    FROM public.suggestion_conversions sc
    JOIN public.completed_orders co ON co.id = sc.order_id
    JOIN public.orders o ON o.id = co.id
   WHERE sc.created_at > v_since
     AND o.venue_id = v_venue;

  -- Client taps. Kept because they are the only history before the ledger.
  -- Events from before there were two restaurants carry none, and are La Soul's.
  SELECT count(*) FILTER (WHERE event = 'suggestion_shown'),
         count(*) FILTER (WHERE event = 'suggestion_accepted')
    INTO v_shown, v_accepted
    FROM public.analytics_events
   WHERE occurred_at > v_since
     AND COALESCE(venue_id, public.default_venue()) = v_venue
     AND event IN ('suggestion_shown', 'suggestion_accepted');

  -- Server-verified: a sighting recorded once per decision, and a paid line.
  SELECT count(*),
         count(*) FILTER (WHERE EXISTS (
           SELECT 1 FROM public.suggestion_conversions sc
             JOIN public.completed_orders co ON co.id = sc.order_id
            WHERE sc.decision_id = i.decision_id))
    INTO v_seen, v_paid
    FROM public.recommendation_impressions i
    JOIN public.recommendation_decisions d ON d.id = i.decision_id
    JOIN public.table_sessions ts ON ts.id = d.session_id
   WHERE i.seen_at > v_since
     AND ts.venue_id = v_venue;

  WITH visits AS (
    SELECT co.table_session_id,
           bool_or(o.reco_holdout) AS held,
           sum(co.total - COALESCE(co.tip_amount, 0) - COALESCE(co.refunded_amount, 0)) AS net,
           max(s.covers) AS covers
      FROM public.completed_orders co
      JOIN public.orders o ON o.id = co.id
      JOIN public.table_sessions s ON s.id = co.table_session_id
     WHERE co.created_at > v_since
       AND o.venue_id = v_venue
       AND s.covers IS NOT NULL AND s.covers > 0
       AND o.reco_holdout IS NOT NULL
     GROUP BY co.table_session_id
  )
  SELECT count(*),
         avg(net / covers) FILTER (WHERE NOT held),
         avg(net / covers) FILTER (WHERE held)
    INTO v_cover_sessions, v_cover_treated, v_cover_held
    FROM visits;

  RETURN jsonb_build_object(
    'days', _days,
    'measure', 'net_sales_excl_tips_and_refunds',
    'total_revenue', round(v_net, 2),
    'net_sales', round(v_net, 2),
    'tips', round(v_tips, 2),
    'attributed_revenue', round(v_attributed, 2),
    'uplift_pct', CASE WHEN v_net > 0 THEN round(100 * v_attributed / v_net, 2) ELSE 0 END,
    'orders', v_orders,
    'orders_with_suggestion', v_orders_with,
    'attach_rate_pct', CASE WHEN v_orders > 0
                            THEN round(100.0 * v_orders_with / v_orders, 1) ELSE 0 END,
    'avg_order_with_suggestion', COALESCE((
      SELECT round(avg(co.total - COALESCE(co.tip_amount, 0) - COALESCE(co.refunded_amount, 0)), 2)
        FROM public.completed_orders co
        JOIN public.orders o ON o.id = co.id
       WHERE co.created_at > v_since
         AND o.venue_id = v_venue
         AND EXISTS (SELECT 1 FROM public.suggestion_conversions sc WHERE sc.order_id = co.id)), 0),
    'avg_order_without_suggestion', COALESCE((
      SELECT round(avg(co.total - COALESCE(co.tip_amount, 0) - COALESCE(co.refunded_amount, 0)), 2)
        FROM public.completed_orders co
        JOIN public.orders o ON o.id = co.id
       WHERE co.created_at > v_since
         AND o.venue_id = v_venue
         AND NOT EXISTS (SELECT 1 FROM public.suggestion_conversions sc WHERE sc.order_id = co.id)), 0),
    'shown', COALESCE(v_shown, 0),
    'accepted', COALESCE(v_accepted, 0),
    'overall_acceptance_pct', CASE WHEN COALESCE(v_shown, 0) > 0
                                   THEN round(100.0 * v_accepted / v_shown, 1) ELSE 0 END,
    'seen', COALESCE(v_seen, 0),
    'paid', COALESCE(v_paid, 0),
    'paid_acceptance_pct', CASE WHEN COALESCE(v_seen, 0) > 0
                                THEN round(100.0 * v_paid / v_seen, 1) END,
    'per_cover', jsonb_build_object(
      'sessions_counted', COALESCE(v_cover_sessions, 0),
      'orders_counted', COALESCE(v_cover_sessions, 0),
      'with_suggestions', COALESCE(round(v_cover_treated, 2), 0),
      'holdout', COALESCE(round(v_cover_held, 2), 0))
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.suggestion_performance(_limit integer DEFAULT 50)
 RETURNS TABLE(source_item_id uuid, source_name text, recommended_item_id uuid, recommended_name text, placement text, shown integer, accepted integer, dismissed integer, acceptance_rate numeric, smoothed_rate numeric, attributed_revenue numeric, revenue_per_impression numeric, status text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  v_venue uuid := public.current_venue();
  v_retire_after int;
  v_min numeric;
BEGIN
  IF NOT public.can_staff(v_venue) THEN
    RAISE EXCEPTION 'Only staff can read menu intelligence' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT COALESCE(rs.reco_retire_after_impressions, 60), COALESCE(rs.reco_min_acceptance, 0.03)
    INTO v_retire_after, v_min
    FROM public.restaurant_settings rs WHERE rs.venue_id = v_venue;

  RETURN QUERY
  SELECT
    st.source_item_id,
    COALESCE(ms.name, 'Any order'),
    st.recommended_item_id,
    mr.name,
    st.placement,
    st.shown,
    st.accepted,
    st.dismissed,
    CASE WHEN st.shown > 0 THEN round(100.0 * st.accepted / st.shown, 1) END,
    round(100 * public.smoothed_acceptance(st.accepted, st.shown, pr.alpha0, pr.beta0), 1),
    st.attributed_revenue,
    CASE WHEN st.shown > 0 THEN round(st.attributed_revenue / st.shown, 2) END,
    CASE
      WHEN st.shown >= COALESCE(v_retire_after, 60)
       AND public.acceptance_retired(st.accepted, st.shown, pr.alpha0, pr.beta0, v_min)
        THEN 'retired'
      WHEN st.shown < 20 THEN 'learning'
      WHEN public.smoothed_acceptance(st.accepted, st.shown, pr.alpha0, pr.beta0) >= 0.15 THEN 'strong'
      WHEN public.smoothed_acceptance(st.accepted, st.shown, pr.alpha0, pr.beta0) >= 0.06 THEN 'working'
      ELSE 'weak'
    END
  FROM public.suggestion_stats st
  JOIN public.menu_items mr ON mr.id = st.recommended_item_id
  LEFT JOIN public.menu_items ms ON ms.id = st.source_item_id
  CROSS JOIN LATERAL public.suggestion_prior(st.recommended_item_id, st.placement) pr
  WHERE st.daypart IS NULL
    AND mr.venue_id = v_venue
  ORDER BY st.attributed_revenue DESC, st.shown DESC
  LIMIT LEAST(GREATEST(COALESCE(_limit, 50), 1), 200);
END;
$function$;

-- E. The rest: the visit and suggestion funnels, taking a table as that restaurant's waiter, and closing the day of the restaurant being looked at.

CREATE OR REPLACE FUNCTION public.close_shift(_day date DEFAULT NULL::date, _counted_cash numeric DEFAULT NULL::numeric, _counted_terminal numeric DEFAULT NULL::numeric, _terminal_batch_reference text DEFAULT NULL::text, _notes text DEFAULT NULL::text, _acknowledge_issues boolean DEFAULT false, _venue uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_venue uuid := COALESCE(_venue, public.current_venue());
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

  -- The reconciliation reads the restaurant of the request: make it this one.
  PERFORM public.use_venue(v_venue);
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
$function$;

CREATE OR REPLACE FUNCTION public.funnel_summary(_from date DEFAULT (business_day() - 6), _to date DEFAULT business_day())
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_from timestamptz;
  v_to timestamptz;
  v_steps jsonb;
  v_visits bigint;
  v_venue uuid := public.current_venue();
BEGIN
  IF NOT public.can_staff(v_venue) THEN
    RAISE EXCEPTION 'Only staff can read analytics' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _to < _from THEN
    RAISE EXCEPTION 'End date is before start date';
  END IF;
  IF (_to - _from) > 400 THEN
    RAISE EXCEPTION 'Range is limited to 400 days';
  END IF;

  SELECT starts_at INTO v_from FROM public.business_day_range(_from);
  SELECT ends_at INTO v_to FROM public.business_day_range(_to);

  SELECT count(DISTINCT e.visit_id) INTO v_visits
    FROM public.analytics_events e
   WHERE e.occurred_at >= v_from AND e.occurred_at < v_to
     AND COALESCE(e.venue_id, public.default_venue()) = v_venue;

  WITH steps(step, ord) AS (
    VALUES ('menu_viewed', 1), ('category_viewed', 2), ('item_viewed', 3), ('item_added', 4),
           ('cart_viewed', 5), ('checkout_opened', 6), ('order_placed', 7)
  ),
  counted AS (
    SELECT e.event, count(DISTINCT e.visit_id) AS n
      FROM public.analytics_events e
     WHERE e.occurred_at >= v_from AND e.occurred_at < v_to
       AND COALESCE(e.venue_id, public.default_venue()) = v_venue
       AND e.event IN ('menu_viewed', 'category_viewed', 'item_viewed', 'item_added',
                       'cart_viewed', 'checkout_opened', 'order_placed')
     GROUP BY e.event
  )
  SELECT jsonb_agg(jsonb_build_object('step', s.step, 'visits', COALESCE(c.n, 0)) ORDER BY s.ord)
    INTO v_steps
    FROM steps s
    LEFT JOIN counted c ON c.event = s.step;

  RETURN jsonb_build_object(
    'from', _from,
    'to', _to,
    'visits', COALESCE(v_visits, 0),
    'steps', v_steps
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.reco_funnel(_days integer DEFAULT 28)
 RETURNS TABLE(placement text, week_start date, decisions bigint, with_suggestion bigint, seen bigint, tapped bigint, paid bigint, paid_km numeric, km_per_1000_seen numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  v_since timestamptz := public.analytics_window_start(LEAST(GREATEST(COALESCE(_days, 28), 1), 180));
  v_venue uuid := public.current_venue();
BEGIN
  IF NOT public.can_staff(v_venue) THEN
    RAISE EXCEPTION 'Only staff can read menu intelligence' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  WITH d AS (
    SELECT rd.id AS d_id, rd.placement AS d_placement, rd.chosen_item_id AS d_chosen, rd.created_at AS d_at
      FROM public.recommendation_decisions rd
     WHERE rd.created_at >= v_since
       -- A decision is its table's restaurant's; one with no table, its dish's.
       AND COALESCE((SELECT s.venue_id FROM public.table_sessions s WHERE s.id = rd.session_id),
                    (SELECT mi.venue_id FROM public.menu_items mi WHERE mi.id = rd.chosen_item_id),
                    public.default_venue()) = v_venue
  ),
  sightings AS (
    SELECT DISTINCT i.decision_id AS s_id
      FROM public.recommendation_impressions i
      JOIN d ON d.d_id = i.decision_id
  ),
  taps AS (
    -- A tap belongs to a decision only when it carries the decision's id AND
    -- is on the dish that decision chose. The guest app sends the id only in
    -- that case (CartSuggestion); requiring the dish as well keeps older
    -- clients, which sent the id with any card, from crediting a decision
    -- with a tap on something it did not pick. Taps on other cards have no
    -- session on them (analytics is per phone visit, not per table), so they
    -- cannot be tied to a decision honestly and are not counted here.
    SELECT DISTINCT d.d_id AS t_id
      FROM public.analytics_events e
      JOIN d ON d.d_id = public.analytics_uuid(e.props->>'decision_id')
     WHERE e.event = 'suggestion_accepted'
       AND e.occurred_at >= v_since - interval '1 day'
       AND (public.analytics_uuid(e.props->>'item_id') IS NULL
            OR public.analytics_uuid(e.props->>'item_id') = d.d_chosen)
  ),
  conv AS (
    SELECT sc.decision_id AS c_id, sum(sc.line_total) AS c_km
      FROM public.suggestion_conversions sc
      JOIN public.completed_orders co ON co.id = sc.order_id
      JOIN d ON d.d_id = sc.decision_id
     GROUP BY sc.decision_id
  ),
  flagged AS (
    SELECT d.*,
           c.c_id IS NOT NULL AS is_paid,
           COALESCE(c.c_km, 0) AS km,
           (t.t_id IS NOT NULL OR c.c_id IS NOT NULL) AS is_tapped,
           (s.s_id IS NOT NULL OR t.t_id IS NOT NULL OR c.c_id IS NOT NULL) AS is_seen
      FROM d
      LEFT JOIN sightings s ON s.s_id = d.d_id
      LEFT JOIN taps t ON t.t_id = d.d_id
      LEFT JOIN conv c ON c.c_id = d.d_id
  )
  SELECT f.d_placement,
         date_trunc('week', public.business_day(f.d_at)::timestamp)::date,
         count(*)::bigint,
         (count(*) FILTER (WHERE f.d_chosen IS NOT NULL OR f.is_seen))::bigint,
         (count(*) FILTER (WHERE f.is_seen))::bigint,
         (count(*) FILTER (WHERE f.is_tapped))::bigint,
         (count(*) FILTER (WHERE f.is_paid))::bigint,
         round(sum(f.km), 2),
         CASE WHEN count(*) FILTER (WHERE f.is_seen) > 0
              THEN round(1000 * sum(f.km) / count(*) FILTER (WHERE f.is_seen), 2) END
    FROM flagged f
   GROUP BY 1, 2
   ORDER BY 2 DESC, 1;
END;
$function$;

CREATE OR REPLACE FUNCTION public.shift_close_for(_day date DEFAULT NULL::date, _venue uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_venue uuid := COALESCE(_venue, public.current_venue());
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
$function$;

CREATE OR REPLACE FUNCTION public.staff_take_table(_session_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_waiter uuid;
  v_session public.table_sessions;
  v_venue uuid;
BEGIN
  IF NOT public.is_staff_member() THEN
    RAISE EXCEPTION 'Only staff can take a table' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT s.venue_id INTO v_venue FROM public.table_sessions s WHERE s.id = _session_id;
  IF v_venue IS NOT NULL AND NOT public.can_staff(v_venue) THEN
    RAISE EXCEPTION 'Only staff can take a table' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Someone who waits in both restaurants takes the table as that restaurant's waiter.
  SELECT w.id INTO v_waiter FROM public.waiters w
   WHERE w.user_id = auth.uid() AND (v_venue IS NULL OR w.venue_id = v_venue)
   LIMIT 1;
  IF v_waiter IS NULL THEN
    RAISE EXCEPTION 'No waiter profile is linked to this account';
  END IF;

  -- Locked, so two waiters tapping the same table at once serialise.
  SELECT * INTO v_session FROM public.table_sessions WHERE id = _session_id FOR UPDATE;
  IF NOT FOUND OR NOT v_session.is_active THEN
    RETURN jsonb_build_object('taken', false, 'reason', 'not_open');
  END IF;

  IF v_session.assigned_waiter_id IS NOT NULL AND v_session.assigned_waiter_id <> v_waiter THEN
    RETURN jsonb_build_object(
      'taken', false, 'reason', 'already_taken',
      'waiter', (SELECT w.display_name FROM public.waiters w WHERE w.id = v_session.assigned_waiter_id));
  END IF;

  UPDATE public.table_sessions
     SET assigned_waiter_id = v_waiter,
         staff_seen_at = COALESCE(staff_seen_at, now())
   WHERE id = _session_id;

  RETURN jsonb_build_object('taken', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.suggestion_impact_by_placement(_days integer DEFAULT 30)
 RETURNS TABLE(placement text, shown bigint, accepted bigint, acceptance_pct numeric, attributed_revenue numeric, revenue_per_impression numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_since timestamptz := now() - make_interval(days => GREATEST(COALESCE(_days, 30), 1));
  v_venue uuid := public.current_venue();
BEGIN
  IF NOT public.can_staff(v_venue) THEN
    RAISE EXCEPTION 'Only staff can read menu intelligence' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  WITH events AS (
    SELECT COALESCE(e.props ->> 'placement', 'cart') AS pl,
           e.event
      FROM public.analytics_events e
     WHERE e.occurred_at > v_since
       AND COALESCE(e.venue_id, public.default_venue()) = v_venue
       AND e.event IN ('suggestion_shown', 'suggestion_accepted')
  ),
  counted AS (
    SELECT pl,
           count(*) FILTER (WHERE event = 'suggestion_shown')    AS n_shown,
           count(*) FILTER (WHERE event = 'suggestion_accepted') AS n_accepted
      FROM events GROUP BY pl
  ),
  money AS (
    SELECT sc.placement AS pl, sum(sc.line_total) AS revenue
      FROM public.suggestion_conversions sc
      JOIN public.completed_orders co ON co.id = sc.order_id
      JOIN public.orders o ON o.id = co.id AND o.venue_id = v_venue
     WHERE sc.created_at > v_since
     GROUP BY sc.placement
  )
  SELECT COALESCE(c.pl, m.pl),
         COALESCE(c.n_shown, 0),
         COALESCE(c.n_accepted, 0),
         CASE WHEN COALESCE(c.n_shown, 0) > 0
              THEN round(100.0 * c.n_accepted / c.n_shown, 1) ELSE 0 END,
         COALESCE(round(m.revenue, 2), 0),
         CASE WHEN COALESCE(c.n_shown, 0) > 0
              THEN round(COALESCE(m.revenue, 0) / c.n_shown, 3) ELSE 0 END
    FROM counted c
    FULL OUTER JOIN money m ON m.pl = c.pl
   ORDER BY 5 DESC;
END;
$function$;
