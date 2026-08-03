-- =====================================================================
-- Closing orders that were never going to arrive
--
-- Live symptom: tickets on the board showing hundreds of hours of wait. The
-- kitchen display already hides anything older than 18 hours, so this was
-- never only a display problem — the rows themselves are still open, still
-- counted as outstanding, and still attached to a session.
--
-- An order left in `pending` or `preparing` overnight is one of four things:
--
--   1. a card order whose payment was abandoned            — no money, no food
--   2. a test order from setting the place up              — no money, no food
--   3. a real order the kitchen forgot to tap through      — food served, paid
--   4. an order that genuinely never got made              — money may be owed
--
-- Cases 1 and 2 are noise and can be closed automatically. Cases 3 and 4 are
-- money, and this function will not touch them.
--
-- THE LINE THIS DRAWS
--
-- Auto-close applies ONLY to orders that are not paid. If a guest has paid and
-- the order was never marked served, cancelling it would move money out of
-- revenue on a guess — `completed_orders` excludes cancelled orders, so a
-- forgotten tap would silently reduce the day's takings, and a refund would
-- appear to be owed for food that was almost certainly eaten. That is exactly
-- the kind of quiet financial rewrite the integrity trigger exists to prevent,
-- and a cron job is the last thing that should be allowed to do it.
--
-- So paid-but-unserved orders are collected by `orders_needing_attention()`
-- and put in front of a person instead.
--
-- Deliberately NOT closed: the table session. A session has its own idle
-- expiry, and a guest still sitting there with one abandoned card attempt
-- should not lose their tab.
-- =====================================================================

ALTER TABLE public.restaurant_settings
  ADD COLUMN IF NOT EXISTS stale_order_hours smallint NOT NULL DEFAULT 6;

COMMENT ON COLUMN public.restaurant_settings.stale_order_hours IS
  'How long an unpaid order may sit unserved before the nightly job closes it. '
  'Must comfortably exceed the longest realistic service; 6 hours is longer '
  'than any single visit and shorter than the gap to the next day.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
     WHERE table_name = 'restaurant_settings' AND column_name = 'stale_order_hours'
  ) THEN
    ALTER TABLE public.restaurant_settings
      ADD CONSTRAINT restaurant_settings_stale_order_hours_sane
      CHECK (stale_order_hours BETWEEN 2 AND 72);
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- Close the ones that cost nothing to close
-- ---------------------------------------------------------------------

/**
 * Cancel unpaid orders that have been open too long.
 *
 * Returns what it did, per reason, so the nightly log says something useful
 * rather than a bare count.
 */
CREATE OR REPLACE FUNCTION public.close_stale_orders(_hours int DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hours int;
  v_cutoff timestamptz;
  v_abandoned int := 0;
  v_never_served int := 0;
  v_ids uuid[];
BEGIN
  IF NOT public.is_staff_member() THEN
    RAISE EXCEPTION 'Only staff can close stale orders' USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_hours := COALESCE(_hours,
    (SELECT stale_order_hours FROM public.restaurant_settings WHERE id = 1), 6);

  -- A floor, so a bad settings write cannot cancel the current service.
  IF v_hours < 2 THEN
    RAISE EXCEPTION 'Refusing to close orders younger than 2 hours (asked for %)', v_hours;
  END IF;

  v_cutoff := now() - make_interval(hours => v_hours);

  PERFORM set_config('lasoul.financial_ctx', 'on', true);

  /*
   * 1. Card orders that never got paid for. These never reached the kitchen —
   *    `release_order_to_kitchen` is gated on payment — so nothing was cooked
   *    and nothing is owed.
   */
  WITH doomed AS (
    SELECT id FROM public.orders
     WHERE status IN ('awaiting_payment', 'payment_failed')
       AND payment_status <> 'paid'
       AND created_at < v_cutoff
     FOR UPDATE
  ), done AS (
    UPDATE public.orders o
       SET status = 'cancelled',
           cancelled_at = now(),
           cancel_reason = format('Auto-closed: payment never completed (open %s h)', v_hours)
      FROM doomed d WHERE o.id = d.id
    RETURNING o.id
  )
  SELECT count(*)::int, array_agg(id) INTO v_abandoned, v_ids FROM done;

  /*
   * 2. Unpaid orders that sat in the kitchen flow and were never served.
   *    Unpaid means no money moved, so closing them costs nothing and stops
   *    them being reported as outstanding forever.
   */
  WITH doomed AS (
    SELECT id FROM public.orders
     WHERE status IN ('pending', 'confirmed', 'preparing', 'ready')
       AND payment_status <> 'paid'
       AND created_at < v_cutoff
     FOR UPDATE
  ), done AS (
    UPDATE public.orders o
       SET status = 'cancelled',
           cancelled_at = now(),
           cancel_reason = format('Auto-closed: never served, unpaid (open %s h)', v_hours)
      FROM doomed d WHERE o.id = d.id
    RETURNING o.id
  )
  SELECT count(*)::int INTO v_never_served FROM done;

  -- Any queued kitchen ticket for a cancelled order stops being printable.
  UPDATE public.order_ticket_events te
     SET status = 'cancelled', updated_at = now()
    FROM public.orders o
   WHERE te.order_id = o.id
     AND o.status = 'cancelled'
     AND te.status IN ('queued', 'exported');

  IF v_abandoned + v_never_served > 0 THEN
    PERFORM public.write_audit('order.auto_closed', 'order', NULL, NULL,
      jsonb_build_object('abandoned_payment', v_abandoned,
                         'never_served', v_never_served,
                         'older_than_hours', v_hours),
      format('Nightly cleanup closed %s unpaid orders open longer than %s hours',
             v_abandoned + v_never_served, v_hours));
  END IF;

  RETURN jsonb_build_object(
    'abandoned_payment', v_abandoned,
    'never_served', v_never_served,
    'total', v_abandoned + v_never_served,
    'older_than_hours', v_hours);
END;
$$;

REVOKE ALL ON FUNCTION public.close_stale_orders(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_stale_orders(int) TO authenticated;

-- ---------------------------------------------------------------------
-- Put the rest in front of a person
-- ---------------------------------------------------------------------

/**
 * Orders that are stale AND involve money, so a human has to decide.
 *
 * Paid but never marked served is the common one and is almost always a
 * forgotten tap rather than missing food — but "almost always" is not a
 * standard a cron job gets to act on.
 */
CREATE OR REPLACE FUNCTION public.orders_needing_attention(_hours int DEFAULT NULL)
RETURNS TABLE(
  id uuid,
  order_code text,
  table_number int,
  status public.order_status,
  payment_status text,
  total numeric,
  hours_open numeric,
  problem text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  /*
   * The RETURNS TABLE names (id, status, total, …) are OUT parameters, and
   * PL/pgSQL resolves a bare identifier to the variable before the column.
   * Every reference below is qualified, but the ORDER BY and the join
   * conditions still trip it, so say plainly which one wins.
   */
  #variable_conflict use_column
DECLARE
  v_hours int;
BEGIN
  IF NOT public.is_staff_member() THEN
    RAISE EXCEPTION 'Only staff can read this' USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_hours := COALESCE(_hours,
    (SELECT stale_order_hours FROM public.restaurant_settings WHERE id = 1), 6);

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
   WHERE o.status NOT IN ('served', 'cancelled')
     AND o.created_at < now() - make_interval(hours => v_hours)
   ORDER BY o.payment_status = 'paid' DESC, o.created_at;
END;
$$;

REVOKE ALL ON FUNCTION public.orders_needing_attention(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.orders_needing_attention(int) TO authenticated;

-- ---------------------------------------------------------------------
-- Run it nightly
-- ---------------------------------------------------------------------

DO $$
DECLARE v_def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'run_daily_maintenance';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'run_daily_maintenance is missing — migrations are out of order';
  END IF;

  -- Line endings are not content; see .gitattributes.
  v_def := replace(v_def, chr(13) || chr(10), chr(10));

  IF position('close_stale_orders' in v_def) = 0 THEN
    v_def := replace(v_def,
      '    v_events := public.prune_analytics_events();',
      '    v_stale := public.close_stale_orders();
    v_events := public.prune_analytics_events();');
    v_def := replace(v_def,
      '  v_events int := 0;',
      '  v_events int := 0;
  v_stale jsonb;');
    v_def := replace(v_def,
      '      ''analytics_events_pruned'', v_events,',
      '      ''stale_orders_closed'', v_stale,
      ''analytics_events_pruned'', v_events,');

    IF position('v_stale' in v_def) = 0 THEN
      RAISE EXCEPTION 'could not fold close_stale_orders into the nightly job';
    END IF;
    EXECUTE v_def;
    RAISE NOTICE 'run_daily_maintenance now closes stale orders';
  END IF;
END $$;
