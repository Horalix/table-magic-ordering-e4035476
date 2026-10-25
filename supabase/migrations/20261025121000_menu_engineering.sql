-- =====================================================================
-- Menu engineering, done the way the textbook does it — and honestly
--
-- The "Worth protecting" list ranked dishes by revenue × margin_score. A
-- margin score is a 0–100 hint for the suggestion engine, not money, so the
-- product was a number with no unit that rewarded expensive dishes twice.
--
-- This is the Kasavana & Smith (1982) matrix, as worked through by LeBruto,
-- Quain & Ashley (FIU Hospitality Review 13(1), 1995), applied per menu class
-- (meal_role: mains are compared with mains, coffees with coffees):
--
--   POPULARITY   An item is popular when its share of the class's sales is at
--                least 70% of an equal share: share >= 0.7 / N_class. With
--                eight items that is 8.75%.
--   PROFIT       An item is high-CM when its contribution margin per portion
--                (price − ingredient cost, from menu_unit_margins()) is at least
--                the class's sales-weighted average CM.
--
--   Star       popular, high CM    protect: keep the position and the photo
--   Plowhorse  popular, low CM     trim plate cost or nudge the price; pair it
--   Puzzle     unpopular, high CM  rename, re-photograph, move it up
--   Dog        unpopular, low CM   remove, unless it is a deliberate anchor
--
-- Two corrections the textbook does not need, because it assumes a month of a
-- big kitchen's sales and a dish that was on every day:
--
--   1. AVAILABILITY. An item's share is measured only over the trading days it
--      could be ordered (analytics_item_days): its sales over everything its
--      class sold on those same days. A dish sold out for half the month is
--      not "unpopular" for it.
--
--   2. SMALL NUMBERS. The share carries an 80% Wilson interval, with the
--      class's order LINES as the sample size (a round of four coffees is one
--      decision, not four). If the interval straddles the 70% line, the item
--      is 'insufficient' rather than forced into a quadrant on noise.
--
-- Costs come from menu_unit_margins(): a recorded food cost, or an estimate
-- from restaurant_settings.default_cost_pct, flagged `cost_estimated`.
--
-- New function only; nothing existing is changed.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.menu_engineering(_days int DEFAULT 28)
RETURNS TABLE(
  item_id uuid,
  name text,
  menu_class text,
  category_name text,
  is_available boolean,
  units bigint,
  lines bigint,
  revenue numeric,
  available_days int,
  trading_days int,
  availability_basis text,
  class_units bigint,
  class_lines bigint,
  class_items int,
  menu_mix numeric,
  mix_low numeric,
  mix_high numeric,
  popularity_threshold numeric,
  price numeric,
  unit_cost numeric,
  unit_cm numeric,
  class_avg_cm numeric,
  cost_estimated boolean,
  popularity text,
  profitability text,
  quadrant text,
  units_per_week numeric,
  class_units_per_week numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_days int := LEAST(GREATEST(COALESCE(_days, 28), 7), 120);
  -- Complete trading days only: today is still being written.
  v_to date := public.business_day() - 1;
  v_from date := public.business_day() - LEAST(GREATEST(COALESCE(_days, 28), 7), 120);
  v_start timestamptz;
  v_end timestamptz;
  v_trading int;
BEGIN
  IF NOT public.is_staff_member() THEN
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
$$;

REVOKE ALL ON FUNCTION public.menu_engineering(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.menu_engineering(int) TO authenticated;
