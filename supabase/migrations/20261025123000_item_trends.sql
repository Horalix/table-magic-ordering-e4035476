-- =====================================================================
-- Is a dish taking off, or dying? — the counts, not the verdict
--
-- With ~150 dishes, eyeballing week-on-week changes finds a "trend" every
-- week, because by chance alone some dish always moves a lot. The test that
-- decides lives in src/lib/trends.ts (exact binomial / continuity-corrected
-- normal, Benjamini–Hochberg across all dishes). This function supplies the
-- four numbers that test needs per dish, on trading days:
--
--   k1  orders containing the dish in the last 14 complete trading days
--   k0  the same in the 56 trading days before those
--   e1  visits (table sessions) on the days IN the recent window on which the
--       dish could be ordered — its exposure
--   e0  the same for the prior window
--
-- Under "nothing changed", the dish's orders per visit are the same in both
-- windows, so given n = k0 + k1 orders, k1 ~ Binomial(n, e1 / (e0 + e1)).
-- Days the dish was sold out are not exposure (analytics_item_days), so a
-- dish back from a week off is not "trending up".
--
-- New function only.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.item_trends(_recent_days int DEFAULT 14, _prior_days int DEFAULT 56)
RETURNS TABLE(
  item_id uuid,
  name text,
  is_available boolean,
  k1 bigint,
  k0 bigint,
  e1 bigint,
  e0 bigint,
  days1 int,
  days0 int,
  units1 bigint,
  price numeric,
  unit_cm numeric,
  cost_estimated boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_recent int := LEAST(GREATEST(COALESCE(_recent_days, 14), 7), 60);
  v_prior int := LEAST(GREATEST(COALESCE(_prior_days, 56), 7), 180);
  v_to date := public.business_day() - 1;
  v_split date;
  v_from date;
  v_start timestamptz;
  v_end timestamptz;
BEGIN
  IF NOT public.is_staff_member() THEN
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
   ORDER BY mi.name, mi.id;
END;
$$;

REVOKE ALL ON FUNCTION public.item_trends(int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.item_trends(int, int) TO authenticated;
