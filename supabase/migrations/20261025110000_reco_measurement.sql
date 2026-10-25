-- =====================================================================
-- Measuring suggestions at the volume one café actually has
--
-- Net spend per visit is the right outcome and a hard one to measure: a
-- table of six spends five times what a table of one does, and that spread
-- swamps a 3% effect for months. Three additions to the holdout comparison,
-- none of which change how sessions are assigned or what the holdout
-- percentage is:
--
--   1. Attach rates, which move far more than spend and are far less noisy:
--        * after the meal — of visits with a main served, how many then
--          ordered a dessert or a hot drink;
--        * a drink with the meal — of visits whose first round had a main,
--          how many had a drink in that round.
--      Each with a two-proportion interval (Agresti–Caffo).
--
--   2. Net per visit adjusted for what was known before any suggestion could
--      act (CUPED / ANCOVA): covers, daypart, weekday or weekend, and the
--      value of the cart when the engine was first asked. Those are combined
--      into one predicted spend per visit, and θ = cov/var is pooled across
--      arms. Unbiased like the plain difference, with a much narrower
--      interval when party size is what makes visits differ.
--
--   3. Power that says how many DAYS the answer takes — at the running split
--      and at 50/50 — because "too early" with no horizon invites someone to
--      refresh the page for a month.
--
-- All three are added to reco_holdout_comparison() next to what it already
-- returns; every existing key keeps its meaning (`status` is still the plain
-- comparison). The holdout percentage default is untouched.
-- =====================================================================

/**
 * Difference between two proportions, in percentage points.
 *
 * The interval adds one success and one failure to each arm (Agresti–Caffo),
 * which keeps its coverage honest at the tens of visits a week the
 * after-meal moment sees; the plain Wald interval does not.
 */
CREATE OR REPLACE FUNCTION public.two_proportion_interval(
  _x_a bigint, _n_a bigint, _x_b bigint, _n_b bigint
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_pa numeric; v_pb numeric;
  v_ta numeric; v_tb numeric;
  v_se numeric; v_d numeric;
BEGIN
  IF COALESCE(_n_a, 0) < 1 OR COALESCE(_n_b, 0) < 1 THEN
    RETURN jsonb_build_object(
      'visits_a', COALESCE(_n_a, 0), 'attached_a', COALESCE(_x_a, 0), 'rate_a_pct', NULL,
      'visits_b', COALESCE(_n_b, 0), 'attached_b', COALESCE(_x_b, 0), 'rate_b_pct', NULL,
      'difference_pts', NULL, 'ci_low_pts', NULL, 'ci_high_pts', NULL, 'significant', false);
  END IF;

  v_pa := COALESCE(_x_a, 0)::numeric / _n_a;
  v_pb := COALESCE(_x_b, 0)::numeric / _n_b;
  v_ta := (COALESCE(_x_a, 0) + 1)::numeric / (_n_a + 2);
  v_tb := (COALESCE(_x_b, 0) + 1)::numeric / (_n_b + 2);
  v_se := sqrt(v_ta * (1 - v_ta) / (_n_a + 2) + v_tb * (1 - v_tb) / (_n_b + 2));
  v_d := v_ta - v_tb;

  RETURN jsonb_build_object(
    'visits_a', _n_a, 'attached_a', COALESCE(_x_a, 0), 'rate_a_pct', round(100 * v_pa, 1),
    'visits_b', _n_b, 'attached_b', COALESCE(_x_b, 0), 'rate_b_pct', round(100 * v_pb, 1),
    'difference_pts', round(100 * (v_pa - v_pb), 1),
    'ci_low_pts', round(100 * (v_d - 1.96 * v_se), 1),
    'ci_high_pts', round(100 * (v_d + 1.96 * v_se), 1),
    'significant', (v_d - 1.96 * v_se) > 0 OR (v_d + 1.96 * v_se) < 0);
END;
$$;

/**
 * Covariate-adjusted difference in means (CUPED / ANCOVA), A minus B.
 *
 * Takes per-arm moments of the outcome y and a pre-treatment covariate x:
 *   θ    = pooled within-arm cov(x, y) / pooled within-arm var(x)
 *   diff = (ȳa − ȳb) − θ·(x̄a − x̄b)
 *   var  = var(y) − 2θ·cov(x, y) + θ²·var(x), per arm
 * Same 95% normal interval as welch_interval, so the two read side by side.
 * `variance_reduction_pct` is how much narrower the interval is for it.
 */
CREATE OR REPLACE FUNCTION public.ancova_interval(
  _n_a bigint, _mean_y_a numeric, _mean_x_a numeric, _var_y_a numeric, _var_x_a numeric, _cov_a numeric,
  _n_b bigint, _mean_y_b numeric, _mean_x_b numeric, _var_y_b numeric, _var_x_b numeric, _cov_b numeric
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_den numeric;
  v_theta numeric;
  v_diff numeric;
  v_va numeric;
  v_vb numeric;
  v_se numeric;
  v_plain_se numeric;
BEGIN
  IF COALESCE(_n_a, 0) < 3 OR COALESCE(_n_b, 0) < 3 THEN
    RETURN jsonb_build_object('difference', NULL, 'ci_low', NULL, 'ci_high', NULL,
                              'significant', false, 'theta', NULL, 'variance_reduction_pct', NULL);
  END IF;

  v_den := (_n_a - 1) * COALESCE(_var_x_a, 0) + (_n_b - 1) * COALESCE(_var_x_b, 0);
  v_theta := CASE WHEN v_den > 0
    THEN ((_n_a - 1) * COALESCE(_cov_a, 0) + (_n_b - 1) * COALESCE(_cov_b, 0)) / v_den
    ELSE 0 END;

  v_diff := (_mean_y_a - _mean_y_b) - v_theta * (COALESCE(_mean_x_a, 0) - COALESCE(_mean_x_b, 0));
  v_va := GREATEST(COALESCE(_var_y_a, 0) - 2 * v_theta * COALESCE(_cov_a, 0)
                   + v_theta * v_theta * COALESCE(_var_x_a, 0), 0);
  v_vb := GREATEST(COALESCE(_var_y_b, 0) - 2 * v_theta * COALESCE(_cov_b, 0)
                   + v_theta * v_theta * COALESCE(_var_x_b, 0), 0);
  v_se := sqrt(v_va / _n_a + v_vb / _n_b);
  v_plain_se := sqrt(COALESCE(_var_y_a, 0) / _n_a + COALESCE(_var_y_b, 0) / _n_b);

  IF v_se = 0 THEN
    RETURN jsonb_build_object('difference', round(v_diff, 2), 'ci_low', round(v_diff, 2),
                              'ci_high', round(v_diff, 2), 'std_error', 0,
                              'significant', v_diff <> 0, 'theta', round(v_theta, 4),
                              'variance_reduction_pct', 100);
  END IF;

  RETURN jsonb_build_object(
    'difference', round(v_diff, 2),
    'ci_low',  round(v_diff - 1.96 * v_se, 2),
    'ci_high', round(v_diff + 1.96 * v_se, 2),
    'std_error', round(v_se, 3),
    'significant', (v_diff - 1.96 * v_se) > 0 OR (v_diff + 1.96 * v_se) < 0,
    'theta', round(v_theta, 4),
    'variance_reduction_pct', CASE WHEN v_plain_se > 0
      THEN round(100 * (1 - (v_se * v_se) / (v_plain_se * v_plain_se)), 1) END
  );
END;
$$;

/**
 * Sessions and days needed to detect `_mde_pct` of mean net spend per visit
 * (two-sided 5%, 80% power), at the experiment's own split and at 50/50.
 *
 *   total visits = 7.85 · σ² / δ² · (1/h + 1/(1 − h)),  h = holdout share
 *
 * A 10% holdout needs 2.8 times as many visits as a 50/50 split for the same
 * answer. `sessions_needed_per_arm` keeps its old (50/50) meaning;
 * `days_remaining` now uses the running split.
 */
CREATE OR REPLACE FUNCTION public.experiment_power(_experiment_id uuid, _mde_pct numeric DEFAULT 5)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
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
  SELECT started_at, ended_at, holdout_pct INTO v_started, v_ended, v_pct
    FROM public.experiments WHERE id = _experiment_id;
  IF v_started IS NULL THEN RETURN NULL; END IF;

  SELECT count(*), avg(so.net_sales), stddev_samp(so.net_sales)
    INTO v_n, v_mean, v_sd
    FROM public.session_outcomes so
    JOIN public.session_experiment_assignment a ON a.session_id = so.session_id
   WHERE a.experiment_id = _experiment_id AND so.orders > 0;

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
$$;

REVOKE ALL ON FUNCTION public.experiment_power(uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.experiment_power(uuid, numeric) TO authenticated;

/**
 * Suggestions versus none, per visit, with the additions described at the
 * top of this file. Restated in full; every key it returned before is still
 * there with the same meaning.
 */
CREATE OR REPLACE FUNCTION public.reco_holdout_comparison(_days int DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
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
  IF NOT public.is_staff_member() THEN
    RAISE EXCEPTION 'Only staff can read menu intelligence' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- The most recent experiment that overlaps the window.
  SELECT * INTO v_exp FROM public.experiments
   WHERE started_at <= now() AND (ended_at IS NULL OR ended_at > v_since)
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
  WHERE a.experiment_id = v_exp.id
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
     WHERE a.experiment_id = v_exp.id
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
     WHERE a.experiment_id = v_exp.id AND so.opened_at > v_since AND so.orders > 0
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
     WHERE a.experiment_id = v_exp.id AND so.opened_at > v_since AND so.orders > 0
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
   WHERE a.experiment_id = v_exp.id AND so.opened_at > v_since;

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
$$;

REVOKE ALL ON FUNCTION public.reco_holdout_comparison(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reco_holdout_comparison(int) TO authenticated;
