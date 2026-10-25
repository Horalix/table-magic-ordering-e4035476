-- =====================================================================
-- What one more portion of an item earns, in KM.
--
-- The ranker and the menu-engineering report both need contribution margin
-- per unit (price minus ingredient cost), and both need it to be honest about
-- where the cost came from. `menu_items.food_cost` is optional and mostly
-- empty; reading NULL as zero would call every item pure profit. So:
--
--   * a recorded food_cost is used as is;
--   * otherwise the cost is estimated from a per-role percentage of price,
--     editable in restaurant_settings.default_cost_pct, and flagged as
--     estimated so every screen that shows it can say so.
--
-- The starting percentages are typical café figures, not La Soul's: the
-- owner should replace them (or, better, enter real food costs).
-- =====================================================================

ALTER TABLE public.restaurant_settings
  ADD COLUMN IF NOT EXISTS default_cost_pct jsonb NOT NULL DEFAULT
    '{"starter":0.30,"main":0.32,"side":0.28,"dessert":0.28,"hot_drink":0.15,"cold_drink":0.25,"alcohol":0.25,"other":0.30}'::jsonb;

COMMENT ON COLUMN public.restaurant_settings.default_cost_pct IS
  'Ingredient cost as a share of price, per meal_role, used only for items '
  'with no food_cost recorded. Results built on it are marked estimated.';

/** Cost share for a role, falling back to "other", then to 0.30. */
CREATE OR REPLACE FUNCTION public.default_cost_share(_role public.meal_role)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT LEAST(GREATEST(COALESCE(
           (s.default_cost_pct ->> COALESCE(_role::text, 'other'))::numeric,
           (s.default_cost_pct ->> 'other')::numeric,
           0.30), 0), 0.95)
    FROM (SELECT default_cost_pct FROM public.restaurant_settings WHERE id = 1
          UNION ALL SELECT NULL::jsonb LIMIT 1) s;
$$;

/**
 * Per-item unit economics for every item on the menu.
 *
 * unit_cm         price − unit_cost, never below zero
 * cost_estimated  true when unit_cost came from default_cost_pct
 */
CREATE OR REPLACE FUNCTION public.menu_unit_margins()
RETURNS TABLE (
  item_id uuid,
  price numeric,
  unit_cost numeric,
  unit_cm numeric,
  cost_estimated boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.id,
         m.price,
         round(COALESCE(m.food_cost, m.price * public.default_cost_share(m.meal_role)), 2),
         round(GREATEST(m.price - COALESCE(m.food_cost, m.price * public.default_cost_share(m.meal_role)), 0), 2),
         m.food_cost IS NULL
    FROM public.menu_items m;
$$;

REVOKE ALL ON FUNCTION public.default_cost_share(public.meal_role) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.menu_unit_margins() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.default_cost_share(public.meal_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.menu_unit_margins() TO authenticated;
