-- =====================================================================
-- Menu intelligence — the read model behind Admin → Menu Intelligence.
--
-- Everything here answers a question a restaurant manager actually asks, with
-- a denominator that survives scrutiny:
--
--   "Which dishes do people look at and then not order?"     → the funnel
--   "What genuinely goes with what?"                         → lift, not counts
--   "Is the suggestion engine earning its place?"            → attributed KM
--   "What is it learning, and is it working?"                → engine health
--   "What should come off the menu?"                         → low performers
--   "What is being sold out costing me?"                     → sold-out impact
-- =====================================================================

/**
 * Per-item funnel: viewed → added → ordered, plus what it earned.
 *
 * Views and adds come from analytics_events; orders and money come from
 * completed_orders. The two are reported side by side and never averaged
 * together, because they are measured differently and a blended number would
 * hide which half is weak.
 */
CREATE OR REPLACE FUNCTION public.menu_item_performance(_days int DEFAULT 30)
RETURNS TABLE(
  item_id uuid,
  name text,
  category_name text,
  subcategory_name text,
  price numeric,
  is_available boolean,
  margin_score smallint,
  views bigint,
  adds bigint,
  removes bigint,
  orders bigint,
  units bigint,
  revenue numeric,
  add_rate numeric,
  order_rate numeric,
  abandon_rate numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH since AS (SELECT now() - make_interval(days => GREATEST(COALESCE(_days, 30), 1)) AS ts),
  ev AS (
    SELECT nullif(e.props->>'item_id', '')::uuid AS item_id,
           count(*) FILTER (WHERE e.event = 'item_viewed')      AS views,
           count(*) FILTER (WHERE e.event = 'item_added')       AS adds,
           count(*) FILTER (WHERE e.event = 'cart_item_removed') AS removes
      FROM public.analytics_events e, since
     WHERE e.occurred_at > since.ts
       AND e.event IN ('item_viewed', 'item_added', 'cart_item_removed')
       AND nullif(e.props->>'item_id', '') IS NOT NULL
     GROUP BY 1
  ),
  sold AS (
    SELECT oi.menu_item_id AS item_id,
           count(DISTINCT oi.order_id) AS orders,
           sum(oi.quantity)            AS units,
           sum(oi.quantity * oi.unit_price) AS revenue
      FROM public.order_items oi
      JOIN public.completed_orders co ON co.id = oi.order_id, since
     WHERE co.created_at > since.ts
     GROUP BY 1
  )
  SELECT
    mi.id, mi.name, c.name, s.name, mi.price, mi.is_available, mi.margin_score,
    COALESCE(ev.views, 0), COALESCE(ev.adds, 0), COALESCE(ev.removes, 0),
    COALESCE(sold.orders, 0), COALESCE(sold.units, 0), COALESCE(sold.revenue, 0),
    -- Of the guests who looked, how many added it?
    CASE WHEN COALESCE(ev.views, 0) > 0
         THEN round(100.0 * COALESCE(ev.adds, 0) / ev.views, 1) ELSE NULL END,
    -- Of the guests who looked, how many ended up buying it?
    CASE WHEN COALESCE(ev.views, 0) > 0
         THEN round(100.0 * COALESCE(sold.orders, 0) / ev.views, 1) ELSE NULL END,
    -- Of the guests who added it, how many took it back out?
    CASE WHEN COALESCE(ev.adds, 0) > 0
         THEN round(100.0 * COALESCE(ev.removes, 0) / ev.adds, 1) ELSE NULL END
  FROM public.menu_items mi
  JOIN public.subcategories s ON s.id = mi.subcategory_id
  JOIN public.categories c ON c.id = s.category_id
  LEFT JOIN ev   ON ev.item_id = mi.id
  LEFT JOIN sold ON sold.item_id = mi.id
  ORDER BY COALESCE(sold.revenue, 0) DESC, COALESCE(ev.views, 0) DESC;
$$;

REVOKE ALL ON FUNCTION public.menu_item_performance(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.menu_item_performance(int) TO authenticated;

/**
 * Real pairings, ranked by lift.
 *
 * Lift answers "do these go together?" where a raw co-occurrence count only
 * answers "are both of these popular?". A lift of 2.4 means guests who order A
 * are 2.4x more likely to also order B than the average guest — that is a
 * pairing worth curating.
 */
CREATE OR REPLACE FUNCTION public.menu_pairings(_limit int DEFAULT 30)
RETURNS TABLE(
  item_a uuid,
  name_a text,
  item_b uuid,
  name_b text,
  pair_orders int,
  confidence numeric,
  lift numeric,
  already_curated boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.item_a, ma.name, a.item_b, mb.name,
         a.pair_orders, a.confidence, a.lift,
         EXISTS (
           SELECT 1 FROM public.menu_item_recommendations r
            WHERE r.source_item_id = a.item_a
              AND r.recommended_item_id = a.item_b
              AND r.enabled
         )
    FROM public.menu_item_affinity a
    JOIN public.menu_items ma ON ma.id = a.item_a
    JOIN public.menu_items mb ON mb.id = a.item_b
   WHERE a.lift > 1.0
     -- One direction per pair, so the table is not a mirror of itself.
     AND a.item_a < a.item_b
   ORDER BY a.lift DESC, a.pair_orders DESC
   LIMIT LEAST(GREATEST(COALESCE(_limit, 30), 1), 100);
$$;

REVOKE ALL ON FUNCTION public.menu_pairings(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.menu_pairings(int) TO authenticated;

/**
 * Suggestion performance, per pair and placement, with the money it brought in.
 *
 * `status` is the engine's own verdict on each pair, so the manager can see
 * what it is about to stop showing and why.
 */
CREATE OR REPLACE FUNCTION public.suggestion_performance(_limit int DEFAULT 50)
RETURNS TABLE(
  source_item_id uuid,
  source_name text,
  recommended_item_id uuid,
  recommended_name text,
  placement text,
  shown int,
  accepted int,
  dismissed int,
  acceptance_rate numeric,
  smoothed_rate numeric,
  attributed_revenue numeric,
  revenue_per_impression numeric,
  status text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    st.source_item_id,
    COALESCE(ms.name, 'Any order'),
    st.recommended_item_id,
    mr.name,
    st.placement,
    st.shown,
    st.accepted,
    st.dismissed,
    CASE WHEN st.shown > 0 THEN round(100.0 * st.accepted / st.shown, 1) ELSE NULL END,
    round(100 * public.smoothed_acceptance(st.accepted, st.shown), 1),
    st.attributed_revenue,
    CASE WHEN st.shown > 0 THEN round(st.attributed_revenue / st.shown, 2) ELSE NULL END,
    CASE
      WHEN st.shown < 20 THEN 'learning'
      WHEN st.shown >= (SELECT COALESCE(reco_retire_after_impressions, 60) FROM public.restaurant_settings WHERE id = 1)
       AND public.smoothed_acceptance(st.accepted, st.shown)
           < (SELECT COALESCE(reco_min_acceptance, 0.03) FROM public.restaurant_settings WHERE id = 1)
        THEN 'retired'
      WHEN public.smoothed_acceptance(st.accepted, st.shown) >= 0.15 THEN 'strong'
      WHEN public.smoothed_acceptance(st.accepted, st.shown) >= 0.06 THEN 'working'
      ELSE 'weak'
    END
  FROM public.suggestion_stats st
  JOIN public.menu_items mr ON mr.id = st.recommended_item_id
  LEFT JOIN public.menu_items ms ON ms.id = st.source_item_id
  ORDER BY st.attributed_revenue DESC, st.shown DESC
  LIMIT LEAST(GREATEST(COALESCE(_limit, 50), 1), 200);
$$;

REVOKE ALL ON FUNCTION public.suggestion_performance(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.suggestion_performance(int) TO authenticated;

/**
 * Is the engine earning its place?
 *
 * `attributed_revenue` is money from lines the guest added *from a suggestion*,
 * in orders that actually completed. `uplift_pct` expresses that as a share of
 * total revenue over the same window.
 *
 * Read it as an upper bound, not a causal estimate: some guests would have
 * ordered the coffee anyway. The honest causal number needs a holdout, which
 * is what `reco_holdout_pct` below is for.
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
  v_result jsonb;
  v_total_revenue numeric;
  v_attributed numeric;
  v_orders int;
  v_orders_with int;
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

  SELECT jsonb_build_object(
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
    'shown', COALESCE((SELECT sum(shown) FROM public.suggestion_stats), 0),
    'accepted', COALESCE((SELECT sum(accepted) FROM public.suggestion_stats), 0),
    'overall_acceptance_pct', COALESCE((
      SELECT CASE WHEN sum(shown) > 0 THEN round(100.0 * sum(accepted) / sum(shown), 1) ELSE 0 END
        FROM public.suggestion_stats), 0)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.suggestion_impact(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.suggestion_impact(int) TO authenticated;

/**
 * What the engine currently knows, for the "how this works" panel.
 *
 * A recommendation system nobody can inspect is a recommendation system nobody
 * will trust or correct.
 */
CREATE OR REPLACE FUNCTION public.recommendation_engine_health()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v jsonb;
BEGIN
  IF NOT public.is_staff_member() THEN
    RAISE EXCEPTION 'Only staff can read menu intelligence' USING ERRCODE = 'insufficient_privilege';
  END IF;

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
    'curated_rules', (SELECT count(*) FROM public.menu_item_recommendations WHERE enabled),
    'learned_pairs', (SELECT count(*) FROM public.menu_item_affinity WHERE lift > 1),
    'tracked_pairs', (SELECT count(*) FROM public.suggestion_stats),
    'pairs_still_learning', (SELECT count(*) FROM public.suggestion_stats WHERE shown < 20),
    'pairs_retired', (
      SELECT count(*) FROM public.suggestion_stats st
       WHERE st.shown >= s.reco_retire_after_impressions
         AND public.smoothed_acceptance(st.accepted, st.shown) < s.reco_min_acceptance),
    'affinity_computed_at', (SELECT max(computed_at) FROM public.menu_item_affinity),
    'stats_updated_at', (SELECT max(updated_at) FROM public.suggestion_stats),
    'orders_analysed', (SELECT count(*) FROM public.completed_orders WHERE created_at > now() - interval '90 days')
  ) INTO v
  FROM public.restaurant_settings s WHERE s.id = 1;

  RETURN v;
END;
$$;

REVOKE ALL ON FUNCTION public.recommendation_engine_health() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recommendation_engine_health() TO authenticated;

/**
 * What being sold out costs.
 *
 * Counts the demand signal (views, searches) an unavailable item still
 * attracts, so "we were out of the burger again" becomes a number.
 */
CREATE OR REPLACE FUNCTION public.sold_out_impact(_days int DEFAULT 30)
RETURNS TABLE(
  item_id uuid,
  name text,
  views bigint,
  avg_daily_revenue_when_available numeric,
  estimated_lost_revenue numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH since AS (SELECT now() - make_interval(days => GREATEST(COALESCE(_days, 30), 1)) AS ts),
  hist AS (
    SELECT oi.menu_item_id AS item_id,
           sum(oi.quantity * oi.unit_price) AS revenue,
           GREATEST(count(DISTINCT date_trunc('day', co.created_at)), 1) AS active_days
      FROM public.order_items oi
      JOIN public.completed_orders co ON co.id = oi.order_id, since
     WHERE co.created_at > since.ts
     GROUP BY 1
  ),
  looks AS (
    SELECT nullif(e.props->>'item_id', '')::uuid AS item_id, count(*) AS views
      FROM public.analytics_events e, since
     WHERE e.occurred_at > since.ts AND e.event = 'item_viewed'
     GROUP BY 1
  )
  SELECT mi.id, mi.name,
         COALESCE(looks.views, 0),
         COALESCE(round(hist.revenue / hist.active_days, 2), 0),
         -- One day's typical takings for each currently-unavailable item.
         COALESCE(round(hist.revenue / hist.active_days, 2), 0)
    FROM public.menu_items mi
    LEFT JOIN hist  ON hist.item_id = mi.id
    LEFT JOIN looks ON looks.item_id = mi.id
   WHERE mi.is_available = false
   ORDER BY 4 DESC NULLS LAST, 3 DESC;
$$;

REVOKE ALL ON FUNCTION public.sold_out_impact(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sold_out_impact(int) TO authenticated;

/** Average order value, suggestion group vs holdout group. The causal read. */
CREATE OR REPLACE FUNCTION public.reco_holdout_comparison(_days int DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_since timestamptz := now() - make_interval(days => GREATEST(COALESCE(_days, 30), 1));
  v jsonb;
BEGIN
  IF NOT public.is_staff_member() THEN
    RAISE EXCEPTION 'Only staff can read menu intelligence' USING ERRCODE = 'insufficient_privilege';
  END IF;

  WITH grouped AS (
    SELECT public.guest_in_reco_holdout(co.table_session_id) AS held_out,
           co.total
      FROM public.completed_orders co
     WHERE co.created_at > v_since
  )
  SELECT jsonb_build_object(
    'holdout_pct', (SELECT reco_holdout_pct FROM public.restaurant_settings WHERE id = 1),
    'with_suggestions', jsonb_build_object(
      'orders', count(*) FILTER (WHERE NOT held_out),
      'avg_order', COALESCE(round(avg(total) FILTER (WHERE NOT held_out), 2), 0)),
    'holdout', jsonb_build_object(
      'orders', count(*) FILTER (WHERE held_out),
      'avg_order', COALESCE(round(avg(total) FILTER (WHERE held_out), 2), 0)),
    'difference', COALESCE(round(
      avg(total) FILTER (WHERE NOT held_out) - avg(total) FILTER (WHERE held_out), 2), 0),
    -- Below ~100 orders per side, the difference is noise. Say so rather than
    -- letting someone act on it.
    'reliable', count(*) FILTER (WHERE held_out) >= 100 AND count(*) FILTER (WHERE NOT held_out) >= 100
  ) INTO v
  FROM grouped;

  RETURN v;
END;
$$;

REVOKE ALL ON FUNCTION public.reco_holdout_comparison(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reco_holdout_comparison(int) TO authenticated;
