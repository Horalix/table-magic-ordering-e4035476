-- =====================================================================
-- Tomorrow's prep: the history the forecast is built from
--
-- The forecast itself (weighted same-weekday mean, a subcategory fallback for
-- slow dishes, a newsvendor prep quantity, and a six-week backtest that hides
-- the card unless it beats "same as last week") lives in
-- src/lib/prep-forecast.ts, where it is unit-tested. This function hands it
-- exactly what it needs and nothing more, as ONE jsonb value — per dish and
-- daypart, a ~150 × 5 × 10 grid that a row-returning RPC would cut off at
-- PostgREST's 1,000-row cap without saying so.
--
-- For the target trading day (default: tomorrow) and each of the ten same
-- weekdays before it, newest first:
--
--   series[daypart][k-1]  portions sold k weeks before the target day, in that
--                         daypart; NULL when the dish could not be ordered that
--                         day (analytics_item_days), so a sold-out Tuesday is
--                         "unknown", never "zero demand"
--   last28[daypart]       portions over the last 28 complete trading days,
--                         for a slow dish's share of its subcategory
--
-- Plus unit margin and unit cost (menu_unit_margins) for the newsvendor ratio.
-- New function only.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.prep_history(_day date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := public.business_day();
  v_day date := COALESCE(_day, public.business_day() + 1);
  v_from date;
  v_to date;
  v_start timestamptz;
  v_end timestamptz;
  v_recent timestamptz;
  v_items jsonb;
BEGIN
  IF NOT public.is_staff_member() THEN
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
     GROUP BY 1, 2, 3
  ),
  items AS (
    SELECT mi.id, mi.name, mi.is_available, mi.subcategory_id, s.name AS subcategory,
           m.unit_cm, m.unit_cost, m.cost_estimated
      FROM public.menu_items mi
      JOIN public.menu_unit_margins() m ON m.item_id = mi.id
      LEFT JOIN public.subcategories s ON s.id = mi.subcategory_id
     WHERE EXISTS (SELECT 1 FROM sold WHERE sold.s_item = mi.id)
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
$$;

REVOKE ALL ON FUNCTION public.prep_history(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prep_history(date) TO authenticated;
