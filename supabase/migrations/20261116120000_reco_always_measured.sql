-- =====================================================================
-- Suggestions are always measured, in margin, per restaurant
-- (supabase/tests/reco-always-measured.test.ts)
-- =====================================================================
--
-- Until now nobody could know whether suggestions earn anything: the holdout
-- defaulted to 0 and an experiment existed only if a manager pressed "Start a
-- 10% holdout"; when the nightly job switched the ranking policy it closed the
-- experiment and nothing started the next one; and the read-out was net sales,
-- not what the restaurant keeps.
--
--   1. reco_auto_holdout_pct (per restaurant, default 10; 0 = off). Every 15
--      minutes (pg_cron where it exists; also whenever an admin opens the
--      card that reads it) reco_keep_measuring() makes sure each restaurant
--      with suggestions on has an experiment running: if none is, an
--      "Always-on check" opens under the current policy version with that
--      holdout. An always-on check whose policy version or holdout no longer
--      matches is closed and the next one opened, so each policy is measured
--      on its own and history is never re-bucketed. A manager's own
--      experiment is never touched. Tables are assigned at the door, as
--      before (assign_session_to_experiment), so the change takes effect for
--      tables that open after the check starts.
--   2. A manager's Stop also sets the always-on holdout to 0, so a deliberate
--      stop is not undone a quarter of an hour later.
--   3. reco_profit_check(_days): what the suggestions added per visit in
--      contribution margin (net sales less food cost; the role's default cost
--      share where no food cost is entered, and the share of sales that is
--      estimated is stated), suggestions vs no suggestions, with a 95%
--      interval, and per week from the cautious end. "Too early" until each
--      side has 30 visits over at least 7 days, with how many more tables that
--      takes. Plus drink, dessert and coffee attach per daypart and arm.
--   4. reco_policy_version_for(venue): the policy of a named restaurant, for
--      the scheduler, which has no request restaurant. reco_policy_version()
--      reads it for the request's restaurant, as before.
--
-- Additive: new columns with defaults, new functions, one restated function
-- (stop_experiment, same signature and result). Nothing is deleted or
-- rewritten; existing experiments, assignments and decisions are untouched.
-- The test harness has no pg_cron, so no test or offline demo opens an
-- always-on check unless it calls reco_keep_measuring() itself.
-- Safe to run twice. Runs after 20261114090000_reservation_messages.sql.

-- ---------------------------------------------------------------------
-- 0. Columns
-- ---------------------------------------------------------------------

ALTER TABLE public.restaurant_settings
  ADD COLUMN IF NOT EXISTS reco_auto_holdout_pct smallint NOT NULL DEFAULT 10;

DO $chk$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'restaurant_settings_reco_auto_holdout_pct_check') THEN
    ALTER TABLE public.restaurant_settings
      ADD CONSTRAINT restaurant_settings_reco_auto_holdout_pct_check
      CHECK (reco_auto_holdout_pct BETWEEN 0 AND 50);
  END IF;
END
$chk$;

COMMENT ON COLUMN public.restaurant_settings.reco_auto_holdout_pct IS
  'Share of tables (0-50) kept without suggestions by the always-on check, so what suggestions earn is always measured. 0 = off.';

/** Opened by reco_keep_measuring(), not by a manager. */
ALTER TABLE public.experiments
  ADD COLUMN IF NOT EXISTS auto boolean NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------
-- 1. The policy of a named restaurant
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.reco_policy_version_for(_venue uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN COALESCE((SELECT reco_sampling_enabled FROM public.restaurant_settings
                    WHERE venue_id = _venue), false)
    THEN 'v3-profit-thompson'
    ELSE 'v3-profit'
  END;
$$;

REVOKE ALL ON FUNCTION public.reco_policy_version_for(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reco_policy_version_for(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.reco_policy_version()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT public.reco_policy_version_for(public.current_venue());
$$;

-- ---------------------------------------------------------------------
-- 2. Keep measuring
-- ---------------------------------------------------------------------

/**
 * Make sure every restaurant (the scheduler) or the caller's restaurant (an
 * admin) has its experiment. Idempotent; returns what it did per restaurant.
 */
CREATE OR REPLACE FUNCTION public.reco_keep_measuring()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- The scheduler, the service role or the owner of both restaurants covers
  -- every restaurant; a manager only their own.
  v_scheduler boolean := COALESCE(public.is_owner_or_scheduler(), false);
  v record;
  v_exp public.experiments;
  v_policy text;
  v_action text;
  v_out jsonb := '{}'::jsonb;
BEGIN
  IF NOT v_scheduler AND NOT public.can_admin(public.current_venue()) THEN
    RAISE EXCEPTION 'Only a manager or the scheduler can start measuring' USING ERRCODE = 'insufficient_privilege';
  END IF;

  FOR v IN
    SELECT s.venue_id,
           COALESCE(s.reco_auto_holdout_pct, 0) AS pct,
           COALESCE(s.recommendations_enabled, true) AS enabled
      FROM public.restaurant_settings s
     WHERE s.venue_id IS NOT NULL
       AND (v_scheduler OR s.venue_id = public.current_venue())
     ORDER BY s.venue_id
  LOOP
    v_action := 'unchanged';
    v_policy := public.reco_policy_version_for(v.venue_id);

    SELECT * INTO v_exp FROM public.experiments
     WHERE ended_at IS NULL AND venue_id = v.venue_id LIMIT 1;

    -- An always-on check that no longer describes what runs is closed: a new
    -- policy, a new holdout, or measuring switched off.
    IF v_exp.id IS NOT NULL AND v_exp.auto
       AND (v_exp.policy_version <> v_policy OR v_exp.holdout_pct <> v.pct OR v.pct = 0 OR NOT v.enabled) THEN
      UPDATE public.experiments
         SET ended_at = now(),
             notes = COALESCE(notes || ' ', '') || '[closed: '
                     || CASE WHEN v_exp.policy_version <> v_policy THEN 'policy changed to ' || v_policy
                             WHEN v.pct = 0 OR NOT v.enabled THEN 'measuring switched off'
                             ELSE 'holdout changed to ' || v.pct || '%' END || ']'
       WHERE id = v_exp.id;
      v_exp := NULL;
      v_action := 'closed';
    END IF;

    IF v_exp.id IS NULL AND v.pct > 0 AND v.enabled THEN
      BEGIN
        INSERT INTO public.experiments(name, policy_version, holdout_pct, venue_id, auto, notes)
        VALUES ('Always-on check', v_policy, v.pct, v.venue_id, true,
                'Opened automatically: ' || v.pct || '% of tables see no suggestions, so what they earn is measured.')
        RETURNING * INTO v_exp;
        UPDATE public.restaurant_settings SET reco_holdout_pct = v.pct WHERE venue_id = v.venue_id;
        v_action := CASE WHEN v_action = 'closed' THEN 'restarted' ELSE 'started' END;
      EXCEPTION WHEN unique_violation THEN
        -- Someone else opened one a moment ago: theirs stands.
        v_action := 'unchanged';
      END;
    END IF;

    v_out := v_out || jsonb_build_object(v.venue_id::text, jsonb_build_object(
      'action', v_action, 'holdout_pct', v.pct, 'policy_version', v_policy));
  END LOOP;

  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.reco_keep_measuring() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reco_keep_measuring() TO authenticated, service_role;

/** What pg_cron runs every 15 minutes. */
CREATE OR REPLACE FUNCTION public.run_scheduled_reco_measuring()
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_prev text := COALESCE(current_setting('lasoul.scheduled_job', true), '');
  v_result jsonb;
BEGIN
  PERFORM set_config('lasoul.scheduled_job', 'on', true);
  v_result := public.reco_keep_measuring();
  PERFORM set_config('lasoul.scheduled_job', v_prev, true);
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.run_scheduled_reco_measuring() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_scheduled_reco_measuring() TO service_role;

/** An admin turns the always-on check on (1-50) or off (0) for their restaurant. */
CREATE OR REPLACE FUNCTION public.set_reco_auto_holdout(_pct int)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_venue uuid := public.current_venue();
  v_pct smallint := GREATEST(0, LEAST(50, COALESCE(_pct, 0)))::smallint;
BEGIN
  IF NOT public.can_admin(v_venue) THEN
    RAISE EXCEPTION 'Only a manager can change measuring' USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE public.restaurant_settings SET reco_auto_holdout_pct = v_pct WHERE venue_id = v_venue;
  PERFORM public.write_audit('experiment.auto_holdout', 'settings', NULL::uuid, NULL::jsonb,
    jsonb_build_object('reco_auto_holdout_pct', v_pct));
  RETURN public.reco_keep_measuring() -> v_venue::text;
END;
$$;

REVOKE ALL ON FUNCTION public.set_reco_auto_holdout(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_reco_auto_holdout(int) TO authenticated;

-- ---------------------------------------------------------------------
-- 3. A manager's Stop stays stopped
-- ---------------------------------------------------------------------

-- Latest: 20261028100000_two_restaurants_context.sql. Same, plus the
-- always-on check is switched off.
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

  UPDATE public.restaurant_settings SET reco_holdout_pct = 0, reco_auto_holdout_pct = 0 WHERE venue_id = v_venue;
  PERFORM public.write_audit('experiment.stopped', 'experiment', v_id, NULL, NULL, _notes);
  RETURN jsonb_build_object('stopped', v_id IS NOT NULL, 'id', v_id);
END;
$function$;

-- ---------------------------------------------------------------------
-- 4. What the suggestions added, in margin
-- ---------------------------------------------------------------------

/**
 * The experiment that is running (or the latest that overlaps the window),
 * per visit that ordered, in this restaurant:
 *   margin = net sales (items, less tip and refunds) − food cost of the lines
 *            (menu_items.food_cost, or the role's default cost share of the
 *            line price where none is entered).
 * Treatment minus holdout, a Welch 95% interval, per week from the visits per
 * day the experiment actually ran. Status:
 *   not_running · too_early (fewer than 30 visits a side or under 7 days) ·
 *   positive (the whole interval above 0) · negative (below) ·
 *   no_clear_difference (it includes 0; with an estimate of how many more
 *   tables would tell, at the difference seen so far).
 * Attach rates per daypart and arm, over every visit in the window.
 */
CREATE OR REPLACE FUNCTION public.reco_profit_check(_days int DEFAULT 28)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_venue uuid := public.current_venue();
  v_days int := LEAST(GREATEST(COALESCE(_days, 28), 1), 365);
  v_since timestamptz := now() - make_interval(days => LEAST(GREATEST(COALESCE(_days, 28), 1), 365));
  v_exp public.experiments;
  v_auto smallint;
  v_min constant int := 30;
  t_n bigint; t_m numeric; t_v numeric; t_sales numeric;
  h_n bigint; h_m numeric; h_v numeric; h_sales numeric;
  v_est numeric; v_sold numeric;
  v_diff numeric; v_se numeric; v_low numeric; v_high numeric;
  v_from timestamptz; v_measured_days numeric;
  v_treated_per_week numeric;
  v_status text;
  v_more bigint;
  v_attach jsonb;
BEGIN
  IF NOT public.can_staff(v_venue) THEN
    RAISE EXCEPTION 'Only staff can read what suggestions earned' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT COALESCE(reco_auto_holdout_pct, 0) INTO v_auto
    FROM public.restaurant_settings WHERE venue_id = v_venue;

  -- Attach per daypart and arm, whether or not an experiment runs.
  WITH visits AS (
    SELECT so.session_id, public.daypart_of(so.opened_at) AS daypart,
           COALESCE(a.arm, 'none') AS arm
      FROM public.session_outcomes so
      JOIN public.table_sessions ts ON ts.id = so.session_id
      LEFT JOIN public.session_experiment_assignment a ON a.session_id = so.session_id
     WHERE ts.venue_id = v_venue AND so.opened_at > v_since AND so.orders > 0
  ),
  lines AS (
    SELECT v.session_id, v.daypart, v.arm,
           bool_or(mi.meal_role = 'main') AS has_main,
           bool_or(mi.meal_role IN ('main', 'starter', 'side')
                   OR (mi.meal_role IS NULL AND mi.station = 'kitchen')) AS has_food,
           bool_or(public.role_is_drink(mi.meal_role)
                   OR (mi.meal_role IS NULL AND mi.station = 'bar')) AS has_drink,
           bool_or(mi.meal_role = 'dessert') AS has_dessert,
           bool_or(mi.meal_role = 'hot_drink') AS has_coffee
      FROM visits v
      JOIN public.completed_orders co ON co.table_session_id = v.session_id
      JOIN public.order_items oi ON oi.order_id = co.id
      JOIN public.menu_items mi ON mi.id = oi.menu_item_id
     GROUP BY v.session_id, v.daypart, v.arm
  ),
  cells AS (
    SELECT daypart, arm,
           count(*) AS visits,
           count(*) FILTER (WHERE has_food) AS food_visits,
           count(*) FILTER (WHERE has_food AND has_drink) AS with_drink,
           count(*) FILTER (WHERE has_main) AS main_visits,
           count(*) FILTER (WHERE has_main AND has_dessert) AS with_dessert,
           count(*) FILTER (WHERE has_main AND has_coffee) AS with_coffee
      FROM lines GROUP BY daypart, arm
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'daypart', daypart, 'arm', arm, 'visits', visits,
           'drink_with_food', CASE WHEN food_visits > 0 THEN round(with_drink::numeric / food_visits, 3) END,
           'dessert_after_main', CASE WHEN main_visits > 0 THEN round(with_dessert::numeric / main_visits, 3) END,
           'coffee_after_main', CASE WHEN main_visits > 0 THEN round(with_coffee::numeric / main_visits, 3) END,
           'food_visits', food_visits, 'main_visits', main_visits)
         ORDER BY CASE daypart WHEN 'morning' THEN 1 WHEN 'lunch' THEN 2 WHEN 'afternoon' THEN 3
                               WHEN 'evening' THEN 4 ELSE 5 END, arm), '[]'::jsonb)
    INTO v_attach FROM cells;

  SELECT * INTO v_exp FROM public.experiments
   WHERE venue_id = v_venue
     AND started_at <= now() AND (ended_at IS NULL OR ended_at > v_since)
   ORDER BY (ended_at IS NULL) DESC, started_at DESC LIMIT 1;

  IF v_exp.id IS NULL THEN
    RETURN jsonb_build_object('status', 'not_running', 'days', v_days,
                              'auto_holdout_pct', v_auto, 'attach', v_attach);
  END IF;

  WITH visits AS (
    SELECT a.arm, so.net_sales::numeric AS sales,
           so.net_sales::numeric - COALESCE(c.cost, 0) AS margin,
           COALESCE(c.estimated_sales, 0) AS estimated_sales,
           COALESCE(c.sold, 0) AS sold
      FROM public.session_outcomes so
      JOIN public.session_experiment_assignment a ON a.session_id = so.session_id
      JOIN public.table_sessions ts ON ts.id = so.session_id
      LEFT JOIN LATERAL (
        SELECT sum(oi.quantity * COALESCE(mi.food_cost, oi.unit_price * public.default_cost_share(mi.meal_role))) AS cost,
               sum(oi.quantity * oi.unit_price) FILTER (WHERE mi.food_cost IS NULL) AS estimated_sales,
               sum(oi.quantity * oi.unit_price) AS sold
          FROM public.completed_orders co
          JOIN public.order_items oi ON oi.order_id = co.id
          JOIN public.menu_items mi ON mi.id = oi.menu_item_id
         WHERE co.table_session_id = so.session_id
      ) c ON true
     WHERE a.experiment_id = v_exp.id
       AND ts.venue_id = v_venue
       AND so.opened_at > v_since
       AND so.orders > 0
  )
  SELECT count(*) FILTER (WHERE arm = 'treatment'), avg(margin) FILTER (WHERE arm = 'treatment'),
         var_samp(margin) FILTER (WHERE arm = 'treatment'), avg(sales) FILTER (WHERE arm = 'treatment'),
         count(*) FILTER (WHERE arm = 'holdout'), avg(margin) FILTER (WHERE arm = 'holdout'),
         var_samp(margin) FILTER (WHERE arm = 'holdout'), avg(sales) FILTER (WHERE arm = 'holdout'),
         sum(estimated_sales), sum(sold)
    INTO t_n, t_m, t_v, t_sales, h_n, h_m, h_v, h_sales, v_est, v_sold
    FROM visits;

  v_from := GREATEST(v_exp.started_at, v_since);
  v_measured_days := GREATEST(EXTRACT(EPOCH FROM (COALESCE(v_exp.ended_at, now()) - v_from)) / 86400.0, 1);
  v_treated_per_week := COALESCE(t_n, 0) / v_measured_days * 7;

  IF COALESCE(t_n, 0) >= 2 AND COALESCE(h_n, 0) >= 2 THEN
    v_diff := t_m - h_m;
    v_se := sqrt(COALESCE(t_v, 0) / t_n + COALESCE(h_v, 0) / h_n);
    v_low := v_diff - 1.96 * v_se;
    v_high := v_diff + 1.96 * v_se;
  END IF;

  IF COALESCE(t_n, 0) < v_min OR COALESCE(h_n, 0) < v_min OR v_measured_days < 7 THEN
    v_status := 'too_early';
    -- Tables still to come before the smaller side has its 30, at this split.
    v_more := GREATEST(
      CEIL((v_min - LEAST(COALESCE(h_n, 0), v_min)) / GREATEST(v_exp.holdout_pct / 100.0, 0.01)),
      CEIL((v_min - LEAST(COALESCE(t_n, 0), v_min)) / GREATEST(1 - v_exp.holdout_pct / 100.0, 0.01)))::bigint;
  ELSIF v_low > 0 THEN
    v_status := 'positive';
  ELSIF v_high < 0 THEN
    v_status := 'negative';
  ELSE
    v_status := 'no_clear_difference';
    -- At the difference seen so far, the interval would clear zero after
    -- (1.96·se/|diff|)² times the visits so far.
    IF v_diff IS NOT NULL AND abs(v_diff) > 0.005 AND v_se > 0 THEN
      v_more := GREATEST(CEIL((t_n + h_n) * (power(1.96 * v_se / abs(v_diff), 2) - 1)), 0)::bigint;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'status', v_status,
    'days', v_days,
    'auto_holdout_pct', v_auto,
    'experiment', jsonb_build_object(
      'id', v_exp.id, 'name', v_exp.name, 'auto', v_exp.auto, 'policy_version', v_exp.policy_version,
      'holdout_pct', v_exp.holdout_pct, 'started_at', v_exp.started_at, 'ended_at', v_exp.ended_at,
      'measured_days', round(v_measured_days, 1)),
    'with_suggestions', jsonb_build_object('visits', COALESCE(t_n, 0),
      'margin_per_visit', round(t_m, 2), 'sales_per_visit', round(t_sales, 2)),
    'without', jsonb_build_object('visits', COALESCE(h_n, 0),
      'margin_per_visit', round(h_m, 2), 'sales_per_visit', round(h_sales, 2)),
    'margin_per_visit', jsonb_build_object('difference', round(v_diff, 2),
      'low', round(v_low, 2), 'high', round(v_high, 2)),
    -- Per week, at the number of tables that saw suggestions per week.
    'per_week', jsonb_build_object(
      'treated_visits', round(v_treated_per_week, 1),
      'estimate', round(v_diff * v_treated_per_week, 0),
      'low', round(v_low * v_treated_per_week, 0),
      'high', round(v_high * v_treated_per_week, 0)),
    'tables_needed', v_more,
    'cost_estimated_share', CASE WHEN COALESCE(v_sold, 0) > 0 THEN round(v_est / v_sold, 3) END,
    'attach', v_attach
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reco_profit_check(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reco_profit_check(int) TO authenticated;

-- ---------------------------------------------------------------------
-- 5. The schedule
-- ---------------------------------------------------------------------

-- Only where pg_cron exists (as 20261024130000_suggestion_guardrails.sql):
-- the test harness and the offline demo have none, so neither opens an
-- always-on check by itself. cron.schedule with a job name replaces the job.
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      EXECUTE $q$SELECT cron.schedule('lasoul-reco-measuring', '*/15 * * * *',
                                       'SELECT public.run_scheduled_reco_measuring()')$q$;
      RAISE NOTICE 'always-on suggestion check scheduled with pg_cron every 15 minutes';
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'pg_cron is installed but the job could not be scheduled (%)', SQLERRM;
    END;
  ELSE
    RAISE NOTICE 'pg_cron is not available: run run_scheduled_reco_measuring() from a scheduler, or open the admin card';
  END IF;
END $cron$;
