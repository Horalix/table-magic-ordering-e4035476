-- =====================================================================
-- Making the uplift number trustworthy
--
-- The engine already measures itself. The measurement had four faults, and
-- every one of them makes the answer confidently wrong rather than visibly
-- missing — which is the worst way for a business number to fail.
--
--   1. THE EXPERIMENT RE-BUCKETED ITSELF. reco_holdout_comparison() called
--      guest_in_reco_holdout(session_id) at READ time against the CURRENT
--      reco_holdout_pct. Moving the dial from 10% to 20% silently reassigned
--      every historical order — orders that demonstrably saw suggestions were
--      counted as the control group. The comparison became fiction with no
--      error, no warning, and no way to notice.
--
--   2. "RELIABLE" WAS NOT A TEST. It was `count >= 100` per side. Restaurant
--      order values have very high variance; 100 orders a side will routinely
--      show a two or three KM "difference" that is pure noise. A manager reads
--      "+2.40 per order", multiplies by a year of orders, and budgets against
--      a number that does not exist.
--
--   3. MIXED DENOMINATORS. suggestion_impact(_days) windowed revenue to _days
--      but summed shown/accepted across ALL of suggestion_stats, which is
--      rebuilt over its own 90-day window. Two different periods, presented
--      side by side as if they described the same thing.
--
--   4. NO PER-COVER VIEW. Party size is the obvious confound under any
--      average-order comparison, and covers now exist.
--
-- The principle throughout: report the uncertainty, and when projecting money
-- forward use the CONSERVATIVE end of it. A dashboard that overstates once
-- never gets believed again.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Assignment is recorded, not recomputed
-- ---------------------------------------------------------------------

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS reco_holdout boolean;

COMMENT ON COLUMN public.orders.reco_holdout IS
  'Whether this order''s session was withheld from suggestions, stamped at '
  'creation. Immutable — the experiment must not re-bucket itself when the '
  'holdout percentage changes. NULL means the order predates the experiment.';

/**
 * Stamp the group at insert.
 *
 * A trigger rather than an edit to guest_place_order: the order-placement
 * function is long, is already rewritten by a later migration, and a third
 * textual fork of it is how the release path drifts.
 */
CREATE OR REPLACE FUNCTION public.stamp_reco_holdout()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.reco_holdout IS NULL THEN
    NEW.reco_holdout := public.guest_in_reco_holdout(NEW.table_session_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stamp_reco_holdout ON public.orders;
CREATE TRIGGER trg_stamp_reco_holdout
  BEFORE INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.stamp_reco_holdout();

/**
 * And it cannot be changed afterwards.
 *
 * Separate from enforce_order_integrity on purpose — that function is already
 * defined across two migrations, and forking its body again to add one check
 * is worse than a second, single-purpose trigger that says exactly what it is.
 */
CREATE OR REPLACE FUNCTION public.freeze_reco_holdout()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.reco_holdout IS DISTINCT FROM OLD.reco_holdout THEN
    RAISE EXCEPTION 'An order''s experiment group cannot be changed after the fact'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_freeze_reco_holdout ON public.orders;
CREATE TRIGGER trg_freeze_reco_holdout
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.freeze_reco_holdout();

-- Existing orders are backfilled to `false` — they were all placed while the
-- holdout was off, so they genuinely were shown suggestions. Leaving them NULL
-- would be more honest still, but they would then be silently dropped from
-- every comparison; `false` is both true and usable.
UPDATE public.orders SET reco_holdout = false WHERE reco_holdout IS NULL;

CREATE INDEX IF NOT EXISTS idx_orders_holdout
  ON public.orders(reco_holdout, created_at DESC);

-- ---------------------------------------------------------------------
-- 2. Statistics
-- ---------------------------------------------------------------------

/**
 * Welch's t-test, normal approximation, as a reusable shape.
 *
 * Welch rather than Student because the two groups have neither equal variance
 * nor equal size — the holdout is by design the smaller one.
 *
 * The 1.96 is a normal approximation to the t distribution. Valid past roughly
 * 30 samples a side, which is well below the point at which anyone should be
 * reading the result anyway; `reliable` enforces that separately.
 */
CREATE OR REPLACE FUNCTION public.welch_interval(
  _mean_a numeric, _var_a numeric, _n_a bigint,
  _mean_b numeric, _var_b numeric, _n_b bigint
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_se numeric;
  v_diff numeric;
BEGIN
  IF _n_a < 2 OR _n_b < 2 THEN
    RETURN jsonb_build_object('difference', NULL, 'ci_low', NULL, 'ci_high', NULL, 'significant', false);
  END IF;

  v_diff := _mean_a - _mean_b;
  v_se := sqrt(COALESCE(_var_a, 0) / _n_a + COALESCE(_var_b, 0) / _n_b);

  IF v_se = 0 THEN
    RETURN jsonb_build_object('difference', round(v_diff, 2), 'ci_low', round(v_diff, 2),
                              'ci_high', round(v_diff, 2), 'significant', v_diff <> 0);
  END IF;

  RETURN jsonb_build_object(
    'difference', round(v_diff, 2),
    'ci_low',  round(v_diff - 1.96 * v_se, 2),
    'ci_high', round(v_diff + 1.96 * v_se, 2),
    'std_error', round(v_se, 3),
    -- The interval excludes zero, so the direction of the effect is real.
    'significant', (v_diff - 1.96 * v_se) > 0 OR (v_diff + 1.96 * v_se) < 0
  );
END;
$$;

-- ---------------------------------------------------------------------
-- 3. The comparison, done properly
-- ---------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.reco_holdout_comparison(int);

/**
 * What the suggestion engine is actually worth.
 *
 * Reads the RECORDED group, so changing the holdout percentage tomorrow
 * affects tomorrow's orders and leaves the history alone.
 *
 * Three numbers a manager can act on, in increasing order of caution:
 *
 *   difference       the observed gap in average order value
 *   ci_low/ci_high   where the true gap plausibly sits
 *   projection       money per month, computed from CI_LOW, never the point
 *                    estimate — an engine that turns out to be worth half what
 *                    the dashboard claimed is an engine nobody trusts again
 *
 * `status` is the headline, and it is allowed to say "we do not know yet".
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
  v_pct int;
  v_treated_n bigint; v_treated_mean numeric; v_treated_var numeric;
  v_held_n bigint;    v_held_mean numeric;    v_held_var numeric;
  v_stats jsonb;
  v_status text;
  v_orders_per_day numeric;
  v_projection numeric;
BEGIN
  IF NOT public.is_staff_member() THEN
    RAISE EXCEPTION 'Only staff can read menu intelligence' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT COALESCE(reco_holdout_pct, 0) INTO v_pct FROM public.restaurant_settings WHERE id = 1;

  SELECT
    count(*) FILTER (WHERE NOT o.reco_holdout),
    avg(co.total) FILTER (WHERE NOT o.reco_holdout),
    var_samp(co.total) FILTER (WHERE NOT o.reco_holdout),
    count(*) FILTER (WHERE o.reco_holdout),
    avg(co.total) FILTER (WHERE o.reco_holdout),
    var_samp(co.total) FILTER (WHERE o.reco_holdout)
  INTO v_treated_n, v_treated_mean, v_treated_var, v_held_n, v_held_mean, v_held_var
  FROM public.completed_orders co
  JOIN public.orders o ON o.id = co.id
  WHERE co.created_at > v_since
    AND o.reco_holdout IS NOT NULL;

  v_stats := public.welch_interval(
    COALESCE(v_treated_mean, 0), COALESCE(v_treated_var, 0), COALESCE(v_treated_n, 0),
    COALESCE(v_held_mean, 0),    COALESCE(v_held_var, 0),    COALESCE(v_held_n, 0));

  -- What the manager is actually told.
  v_status := CASE
    WHEN v_pct = 0 AND COALESCE(v_held_n, 0) = 0 THEN 'not_running'
    WHEN COALESCE(v_held_n, 0) < 30 OR COALESCE(v_treated_n, 0) < 30 THEN 'too_early'
    WHEN NOT (v_stats ->> 'significant')::boolean THEN 'no_measurable_effect'
    WHEN (v_stats ->> 'difference')::numeric > 0 THEN 'positive'
    ELSE 'negative'
  END;

  -- Conservative money projection: the low end of the interval, over the
  -- observed order rate. Only offered once the effect is real.
  v_orders_per_day := CASE WHEN _days > 0
    THEN (COALESCE(v_treated_n, 0) + COALESCE(v_held_n, 0))::numeric / _days ELSE 0 END;
  v_projection := CASE
    WHEN v_status = 'positive'
    THEN round((v_stats ->> 'ci_low')::numeric * v_orders_per_day * 30, 0)
    ELSE NULL END;

  RETURN jsonb_build_object(
    'days', _days,
    'holdout_pct', v_pct,
    'status', v_status,
    'with_suggestions', jsonb_build_object(
      'orders', COALESCE(v_treated_n, 0),
      'avg_order', COALESCE(round(v_treated_mean, 2), 0)),
    'holdout', jsonb_build_object(
      'orders', COALESCE(v_held_n, 0),
      'avg_order', COALESCE(round(v_held_mean, 2), 0)),
    'difference', v_stats -> 'difference',
    'ci_low', v_stats -> 'ci_low',
    'ci_high', v_stats -> 'ci_high',
    'significant', v_stats -> 'significant',
    'conservative_monthly_value', v_projection,
    -- Kept for compatibility with the existing panel, but now it means
    -- "significant", not "we counted to a hundred".
    'reliable', (v_stats ->> 'significant')::boolean
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reco_holdout_comparison(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reco_holdout_comparison(int) TO authenticated;

-- ---------------------------------------------------------------------
-- 4. One window, one denominator
-- ---------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.suggestion_impact(int);

/**
 * Attribution, over exactly the window asked for.
 *
 * Impressions and acceptances are now counted from analytics_events inside
 * `_days`, not summed out of suggestion_stats — which is rebuilt over its own
 * 90-day window and therefore described a different period than the revenue
 * sitting next to it.
 *
 * Everything here remains an UPPER bound on causal impact: some guests would
 * have ordered the coffee anyway. reco_holdout_comparison() is the honest
 * causal number, and the UI leads with it.
 */
CREATE OR REPLACE FUNCTION public.suggestion_impact(_days int DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_since timestamptz := now() - make_interval(days => GREATEST(COALESCE(_days, 30), 1));
  v_total_revenue numeric;
  v_attributed numeric;
  v_orders int;
  v_orders_with int;
  v_shown bigint;
  v_accepted bigint;
  v_covers_orders int;
  v_covers_treated numeric;
  v_covers_held numeric;
BEGIN
  IF NOT public.is_staff_member() THEN
    RAISE EXCEPTION 'Only staff can read menu intelligence' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT COALESCE(sum(total), 0), count(*)
    INTO v_total_revenue, v_orders
    FROM public.completed_orders WHERE created_at > v_since;

  SELECT COALESCE(sum(sc.line_total), 0), count(DISTINCT sc.order_id)
    INTO v_attributed, v_orders_with
    FROM public.suggestion_conversions sc
    JOIN public.completed_orders co ON co.id = sc.order_id
   WHERE sc.created_at > v_since;

  -- Same window as the revenue above. This is the fix.
  SELECT count(*) FILTER (WHERE event = 'suggestion_shown'),
         count(*) FILTER (WHERE event = 'suggestion_accepted')
    INTO v_shown, v_accepted
    FROM public.analytics_events
   WHERE occurred_at > v_since
     AND event IN ('suggestion_shown', 'suggestion_accepted');

  /*
   * Revenue per cover.
   *
   * Party size is the confound sitting under every average-order comparison —
   * a table of six spends more than a table of two whatever the app does. Only
   * sittings where somebody actually counted are included, and the caller is
   * told how many that was so it can say so.
   */
  SELECT count(*),
         avg(co.total / s.covers) FILTER (WHERE NOT o.reco_holdout),
         avg(co.total / s.covers) FILTER (WHERE o.reco_holdout)
    INTO v_covers_orders, v_covers_treated, v_covers_held
    FROM public.completed_orders co
    JOIN public.orders o ON o.id = co.id
    JOIN public.table_sessions s ON s.id = co.table_session_id
   WHERE co.created_at > v_since
     AND s.covers IS NOT NULL AND s.covers > 0
     AND o.reco_holdout IS NOT NULL;

  RETURN jsonb_build_object(
    'days', _days,
    'total_revenue', round(v_total_revenue, 2),
    'attributed_revenue', round(v_attributed, 2),
    'uplift_pct', CASE WHEN v_total_revenue > 0
                       THEN round(100 * v_attributed / v_total_revenue, 2) ELSE 0 END,
    'orders', v_orders,
    'orders_with_suggestion', v_orders_with,
    'attach_rate_pct', CASE WHEN v_orders > 0
                            THEN round(100.0 * v_orders_with / v_orders, 1) ELSE 0 END,
    'avg_order_with_suggestion', COALESCE((
      SELECT round(avg(co.total), 2) FROM public.completed_orders co
       WHERE co.created_at > v_since
         AND EXISTS (SELECT 1 FROM public.suggestion_conversions sc WHERE sc.order_id = co.id)), 0),
    'avg_order_without_suggestion', COALESCE((
      SELECT round(avg(co.total), 2) FROM public.completed_orders co
       WHERE co.created_at > v_since
         AND NOT EXISTS (SELECT 1 FROM public.suggestion_conversions sc WHERE sc.order_id = co.id)), 0),
    'shown', COALESCE(v_shown, 0),
    'accepted', COALESCE(v_accepted, 0),
    'overall_acceptance_pct', CASE WHEN COALESCE(v_shown, 0) > 0
                                   THEN round(100.0 * v_accepted / v_shown, 1) ELSE 0 END,
    'per_cover', jsonb_build_object(
      'orders_counted', COALESCE(v_covers_orders, 0),
      'with_suggestions', COALESCE(round(v_covers_treated, 2), 0),
      'holdout', COALESCE(round(v_covers_held, 2), 0))
  );
END;
$$;

REVOKE ALL ON FUNCTION public.suggestion_impact(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.suggestion_impact(int) TO authenticated;

-- ---------------------------------------------------------------------
-- 5. Which surface earns
-- ---------------------------------------------------------------------

/**
 * Attribution split by where the suggestion appeared.
 *
 * The cart, the product sheet and the after-meal prompt are three different
 * products with three different jobs, and rolling them into one "the engine
 * earned X" hides which one to invest in. An after-meal dessert prompt that
 * converts at 12% is worth building on; a cart add-on at 1% is worth removing,
 * and removing it is a real option that the combined number never surfaces.
 */
CREATE OR REPLACE FUNCTION public.suggestion_impact_by_placement(_days int DEFAULT 30)
RETURNS TABLE(
  placement text,
  shown bigint,
  accepted bigint,
  acceptance_pct numeric,
  attributed_revenue numeric,
  revenue_per_impression numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_since timestamptz := now() - make_interval(days => GREATEST(COALESCE(_days, 30), 1));
BEGIN
  IF NOT public.is_staff_member() THEN
    RAISE EXCEPTION 'Only staff can read menu intelligence' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  WITH events AS (
    SELECT COALESCE(e.props ->> 'placement', 'cart') AS pl,
           e.event
      FROM public.analytics_events e
     WHERE e.occurred_at > v_since
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
     WHERE sc.created_at > v_since
     GROUP BY sc.placement
  )
  SELECT COALESCE(c.pl, m.pl),
         COALESCE(c.n_shown, 0),
         COALESCE(c.n_accepted, 0),
         CASE WHEN COALESCE(c.n_shown, 0) > 0
              THEN round(100.0 * c.n_accepted / c.n_shown, 1) ELSE 0 END,
         COALESCE(round(m.revenue, 2), 0),
         -- The number that decides whether a surface earns its space.
         CASE WHEN COALESCE(c.n_shown, 0) > 0
              THEN round(COALESCE(m.revenue, 0) / c.n_shown, 3) ELSE 0 END
    FROM counted c
    FULL OUTER JOIN money m ON m.pl = c.pl
   ORDER BY 5 DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.suggestion_impact_by_placement(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.suggestion_impact_by_placement(int) TO authenticated;
