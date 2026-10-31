-- =====================================================================
-- The owner's overview: both restaurants at a glance
-- (docs/two-restaurants.md)
-- =====================================================================
--
-- The owner (an admin of no one restaurant, public.is_super_admin()) looked
-- at one restaurant at a time, through the switch in the admin, and every
-- report answers for the restaurant of the request (current_venue()). To see
-- how the evening is going at both, they switched, waited, switched back.
--
-- owner_overview() answers for every restaurant at once: one element per
-- restaurant, each that restaurant's own numbers. It takes each restaurant in
-- turn with use_venue(), as close_shift() does, and asks the reports the
-- restaurant's own admin already reads — day_reconciliation() for the money,
-- sales_analytics() for the top dish, covers_summary() for the sittings,
-- printer_health() for the printers, orders_needing_attention() for the
-- forgotten orders — so the overview and the restaurant's own pages never
-- disagree. What no report says yet is counted here, on that restaurant's
-- rows only: what is waiting right now, last week's sales by this hour, the
-- guests' ratings.
--
-- `_day` is the trading day for the money (the Sarajevo 05:00-to-05:00 day,
-- public.business_day(); today by default). What is waiting — orders, calls,
-- bills, the printers — is always now.
--
-- Only the owner may call it; a restaurant's admin and its staff are refused,
-- whatever restaurant their app names. Reads only. Safe to run twice.

CREATE OR REPLACE FUNCTION public.owner_overview(_day date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := public.business_day();
  v_day date := COALESCE(_day, public.business_day());
  -- The restaurant this request was about before; put back at the end, so a
  -- caller in the same transaction is not left looking at the last one.
  v_prior text := current_setting('lasoul.venue', true);
  v_today_start timestamptz;
  v_day_start timestamptz;
  v_day_end timestamptz;
  v_week_start timestamptz;
  v_week_end timestamptz;
  v_week_cutoff timestamptz;
  v_venue record;
  v_money jsonb;
  v_last_week jsonb;
  v_sales jsonb;
  v_covers jsonb;
  v_paid bigint;
  v_week_by_now jsonb;
  v_seated jsonb;
  v_kitchen jsonb;
  v_floor jsonb;
  v_rating jsonb;
  v_printers jsonb;
  v_stale bigint;
  v_result jsonb := '[]'::jsonb;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Only the owner can see every restaurant' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT starts_at INTO v_today_start FROM public.business_day_range(v_today);
  SELECT starts_at, ends_at INTO v_day_start, v_day_end FROM public.business_day_range(v_day);
  SELECT starts_at, ends_at INTO v_week_start, v_week_end FROM public.business_day_range(v_day - 7);
  -- The same weekday last week, as far into its trading day as today has
  -- gone: at 14:00 a whole Friday is not what this Friday should be beside.
  -- A day already over is compared whole.
  v_week_cutoff := CASE WHEN v_day = v_today
                        THEN LEAST(v_week_end, v_week_start + (now() - v_today_start))
                        ELSE v_week_end END;

  FOR v_venue IN SELECT id, slug, name, is_live FROM public.venues ORDER BY created_at, id LOOP
    -- From here on every report answers for this restaurant.
    PERFORM public.use_venue(v_venue.id);

    -- The money: the same figures as that restaurant's Dashboard and Daily Report.
    v_money := public.day_reconciliation(v_day);
    v_last_week := public.day_reconciliation(v_day - 7);
    v_sales := public.sales_analytics(v_day, v_day);
    v_covers := public.covers_summary(v_day);

    SELECT count(*) FILTER (WHERE o.payment_status = 'paid')
      INTO v_paid
      FROM public.completed_orders co
      JOIN public.orders o ON o.id = co.id AND o.venue_id = v_venue.id
     WHERE co.created_at >= v_day_start AND co.created_at < v_day_end;

    SELECT jsonb_build_object(
             'gross', COALESCE(round(sum(co.total), 2), 0),
             'orders', count(*))
      INTO v_week_by_now
      FROM public.completed_orders co
      JOIN public.orders o ON o.id = co.id AND o.venue_id = v_venue.id
     WHERE co.created_at >= v_week_start AND co.created_at < v_week_cutoff;

    -- Who is sitting down now. Covers are what staff entered; unknown stays
    -- unknown (null), never zero.
    SELECT jsonb_build_object(
             'tables_now', count(*),
             'covers_now', sum(s.covers),
             'sittings_today', COALESCE((v_covers ->> 'sittings')::int, 0),
             'covers_today', COALESCE((v_covers ->> 'covers')::int, 0))
      INTO v_seated
      FROM public.table_sessions s
     WHERE s.venue_id = v_venue.id AND s.is_active;

    -- What the kitchen has in hand, from today's trading day: an order left
    -- open from an earlier day is a forgotten one (stale_orders), not a wait.
    -- An order held for staff to confirm has not reached the kitchen at all.
    SELECT jsonb_build_object(
             'new', count(*) FILTER (WHERE o.status = 'pending' AND o.released_to_kitchen_at IS NOT NULL),
             'accepted', count(*) FILTER (WHERE o.status = 'confirmed' AND o.released_to_kitchen_at IS NOT NULL),
             'preparing', count(*) FILTER (WHERE o.status = 'preparing' AND o.released_to_kitchen_at IS NOT NULL),
             'ready', count(*) FILTER (WHERE o.status = 'ready' AND o.released_to_kitchen_at IS NOT NULL),
             'held', count(*) FILTER (WHERE o.status = 'pending' AND o.released_to_kitchen_at IS NULL
                                        AND o.held_reason IS NOT NULL),
             'oldest_wait_minutes', round(max(EXTRACT(EPOCH FROM (now() - o.released_to_kitchen_at)) / 60)
                                            FILTER (WHERE o.released_to_kitchen_at IS NOT NULL))::int)
      INTO v_kitchen
      FROM public.orders o
     WHERE o.venue_id = v_venue.id
       AND o.status IN ('pending', 'confirmed', 'preparing', 'ready')
       AND o.created_at >= v_today_start;

    -- Guests waiting for someone: a call nobody has acknowledged, a bill asked
    -- for, at a table still sitting. Freeing a table resolves both; a table
    -- the night closed on its own leaves nobody waiting.
    SELECT jsonb_build_object(
             'calls', (SELECT count(*) FROM public.waiter_calls c
                         JOIN public.table_sessions s ON s.id = c.table_session_id AND s.is_active
                        WHERE c.venue_id = v_venue.id AND c.status = 'pending'),
             'oldest_call_minutes', (SELECT round(max(EXTRACT(EPOCH FROM (now() - c.created_at)) / 60))::int
                                       FROM public.waiter_calls c
                                       JOIN public.table_sessions s ON s.id = c.table_session_id AND s.is_active
                                      WHERE c.venue_id = v_venue.id AND c.status = 'pending'),
             'bills', (SELECT count(*) FROM public.bill_requests b
                         JOIN public.table_sessions s ON s.id = b.table_session_id AND s.is_active
                        WHERE b.venue_id = v_venue.id AND b.status = 'pending'),
             'oldest_bill_minutes', (SELECT round(max(EXTRACT(EPOCH FROM (now() - b.created_at)) / 60))::int
                                       FROM public.bill_requests b
                                       JOIN public.table_sessions s ON s.id = b.table_session_id AND s.is_active
                                      WHERE b.venue_id = v_venue.id AND b.status = 'pending'))
      INTO v_floor;

    -- The guests' own rating of the visit (1–5), given that trading day.
    SELECT jsonb_build_object('average', round(avg(r.rating)::numeric, 1), 'count', count(*))
      INTO v_rating
      FROM public.ratings r
     WHERE r.venue_id = v_venue.id
       AND r.created_at >= v_day_start AND r.created_at < v_day_end;

    -- A printer switched on that has not polled in the last minute is down.
    SELECT jsonb_build_object(
             'total', count(*),
             'enabled', count(*) FILTER (WHERE p.enabled),
             'online', count(*) FILTER (WHERE p.online),
             'down', COALESCE(jsonb_agg(p.name ORDER BY p.name) FILTER (WHERE p.enabled AND NOT p.online), '[]'::jsonb),
             'waiting', COALESCE(sum(p.waiting), 0))
      INTO v_printers
      FROM public.printer_health() p;

    SELECT count(*) INTO v_stale FROM public.orders_needing_attention();

    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'venue_id', v_venue.id,
      'slug', v_venue.slug,
      'name', v_venue.name,
      'is_live', v_venue.is_live,
      'day', v_day,
      'sales', jsonb_build_object(
        'gross', v_money -> 'gross',
        'net', v_money -> 'net',
        'orders', v_money -> 'orders',
        'average_order', v_money -> 'average_order',
        'paid', v_paid,
        'open', v_money -> 'outstanding_orders',
        'cancelled', v_money -> 'cancelled_orders',
        'stuck_payments', v_money -> 'stuck_payments'),
      'last_week', jsonb_build_object(
        'day', v_day - 7,
        'gross', v_last_week -> 'gross',
        'orders', v_last_week -> 'orders',
        'gross_by_now', v_week_by_now -> 'gross',
        'orders_by_now', v_week_by_now -> 'orders'),
      'seated', v_seated,
      'kitchen', v_kitchen,
      'floor', v_floor,
      'rating', v_rating,
      'top_dish', v_sales -> 'top_items' -> 0,
      'printers', v_printers,
      'stale_orders', v_stale
    ));
  END LOOP;

  PERFORM set_config('lasoul.venue', COALESCE(v_prior, ''), true);
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.owner_overview(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_overview(date) TO authenticated;
