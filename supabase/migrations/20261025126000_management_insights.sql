-- =====================================================================
-- What to do next — insight cards with a price tag
--
-- The analytics pages answer "what happened". An owner opening the
-- dashboard wants "what should I do, and is it worth my time". Each row here
-- is one thing to do, in plain words, with:
--
--   est_km_per_week  roughly what doing it is worth, in contribution margin
--                    (price minus ingredient cost) per week — not sales, so a
--                    cheap-to-make dish and an expensive one are compared on
--                    what the restaurant keeps
--   evidence         how many visits / orders / days the claim rests on
--   confidence       'high' when a statistical test backs it, 'medium' when
--                    the estimate leans on an assumption the text names
--
-- Only rows that pass their own test AND are worth at least _min_km (20 KM)
-- a week are returned, ordered by worth. Sources, each with its test:
--
--   puzzle      menu_engineering(): high margin, unpopular beyond doubt (80%
--               Wilson interval wholly under the 70% line). Worth: the extra
--               portions needed to reach the line × its margin above the
--               class average (guests switch to it from a cheaper-to-keep
--               dish, they do not appear from nowhere).
--   dog         menu_engineering(): low margin, unpopular beyond doubt.
--               Worth: its portions × the margin a guest would earn on the
--               class's average dish instead.
--   leak        looked at 20+ times, available, and an order rate whose 80%
--               upper bound is still under the menu's median order rate.
--               Worth: views × the gap to the median × its margin.
--   sold_out    sold out now, sold on 3+ trading days in the window. Worth: a
--               typical selling day's margin × trading days a week. An upper
--               bound: some guests order something else instead.
--   anomaly     daily_anomalies() flagged a complete day in the last week.
--               The figure is that day's distance from a usual one.
--   pairing     a pair that sells together (lift's 80% lower bound >= 1.2,
--               10+ orders together) and is not yet a suggestion. Worth:
--               orders of the first dish that lack the second × the
--               suggestion take-up the ledger has measured (5% until 200
--               sightings exist) × the second dish's margin.
--   retired     a curated suggestion the engine has retired for low take-up
--               (acceptance_retired() under the dish's suggestion_prior(), the
--               ranker's own rule) but that is still switched on, keeping a
--               better one off the screen. Worth: its sightings × the placement's average
--               earnings per sighting minus its own.
--
-- Trend alerts (rising / falling dishes) are tested in the browser
-- (src/lib/trends.ts, Benjamini–Hochberg across every dish) and merged with
-- these rows there, under the same 20 KM floor.
--
-- Read-only. Calls the read models above and the existing ones; changes
-- nothing, and does not touch the recommendation functions.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.management_insights(_days int DEFAULT 28, _min_km numeric DEFAULT 20)
RETURNS TABLE(
  kind text,
  item_id uuid,
  related_item_id uuid,
  headline text,
  why text,
  action text,
  est_km_per_week numeric,
  confidence text,
  evidence int,
  evidence_label text,
  link text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_days int := LEAST(GREATEST(COALESCE(_days, 28), 7), 120);
  v_floor numeric := GREATEST(COALESCE(_min_km, 20), 0);
  v_trading_per_week numeric;
  v_take_up numeric;
  v_seen bigint;
  v_paid bigint;
BEGIN
  IF NOT public.is_staff_member() THEN
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
   WHERE i.seen_at > now() - interval '90 days';
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
      JOIN public.menu_items ma ON ma.id = a.item_a AND ma.is_available
      JOIN public.menu_items mb ON mb.id = a.item_b AND mb.is_available
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
      JOIN public.menu_items mr ON mr.id = st.recommended_item_id
      LEFT JOIN public.menu_items ms ON ms.id = st.source_item_id
      JOIN placement_avg pa ON pa.pa_placement = st.placement
      CROSS JOIN public.restaurant_settings rs
      -- The engine's own rule (20261025100000_reco_learning_v3.sql): enough
      -- sightings, and even the optimistic end of its acceptance, under the
      -- dish's own prior, is below the floor.
      CROSS JOIN LATERAL public.suggestion_prior(st.recommended_item_id, st.placement) pr
     WHERE rs.id = 1
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
$$;

REVOKE ALL ON FUNCTION public.management_insights(int, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.management_insights(int, numeric) TO authenticated;
