-- =====================================================================
-- Which days was a dish actually on sale?
--
-- Every fair comparison between dishes needs this. A dish that was sold out
-- for half the month sold half as much, and "half as much" is not "half as
-- popular". The menu-engineering matrix, the trend alerts and the prep
-- forecast all divide by it.
--
-- Until now the database kept only the CURRENT `is_available` flag, so the
-- history has to start somewhere. This migration:
--
--   1. adds menu_item_availability_log, written by a trigger whenever
--      is_available changes (never on any other edit), and
--   2. adds analytics_item_days(_from, _to): one row per (item, trading day)
--      on which the item could be ordered.
--
-- A day counts as an item's when ANY of these holds, in this order:
--
--   * it sold that day — a sale proves it was available;
--   * the log says it was available at the start of the day, or was switched
--     back on during it;
--   * there is no log for the item yet, and either it is available now, or it
--     is sold out now and the day is on or before the last day it sold (the
--     same rule sold_out_impact() already uses).
--
-- The last rule is the limitation, and screens say so: before the log
-- existed, an item that was sold out for a week and then came back is counted
-- as available for that week. The log removes the guess from now on.
--
-- Only trading days count — days on which the restaurant completed at least
-- one sale — so a closed Monday is not a day every dish "failed to sell".
--
-- Nothing existing is rewritten. The trigger is AFTER UPDATE OF is_available,
-- writes one small row, and swallows its own errors: a sold-out toggle must
-- never fail because of analytics.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.menu_item_availability_log (
  id bigserial PRIMARY KEY,
  menu_item_id uuid NOT NULL REFERENCES public.menu_items(id) ON DELETE CASCADE,
  is_available boolean NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  changed_by uuid
);

CREATE INDEX IF NOT EXISTS idx_menu_item_availability_log_item
  ON public.menu_item_availability_log(menu_item_id, changed_at);

COMMENT ON TABLE public.menu_item_availability_log IS
  'One row per change of menu_items.is_available, written by trigger. Read by '
  'analytics_item_days() so a dish is only judged on the days it was on sale.';

ALTER TABLE public.menu_item_availability_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff read availability history" ON public.menu_item_availability_log;
CREATE POLICY "Staff read availability history"
  ON public.menu_item_availability_log
  FOR SELECT TO authenticated
  USING (public.is_staff_member());

REVOKE ALL ON public.menu_item_availability_log FROM PUBLIC, anon;
GRANT SELECT ON public.menu_item_availability_log TO authenticated;

/**
 * Trigger body: record a change of is_available.
 *
 * SECURITY DEFINER so the insert works whoever flips the switch (the table has
 * no insert policy on purpose — nobody writes to it directly). Errors are
 * downgraded to a warning: losing one history row is better than refusing to
 * mark a dish sold out in the middle of service.
 */
CREATE OR REPLACE FUNCTION public.log_menu_item_availability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.is_available IS DISTINCT FROM OLD.is_available THEN
    BEGIN
      INSERT INTO public.menu_item_availability_log(menu_item_id, is_available, changed_by)
      VALUES (NEW.id, NEW.is_available, auth.uid());
    EXCEPTION WHEN others THEN
      RAISE WARNING 'availability history not recorded for %: %', NEW.id, SQLERRM;
    END;
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.log_menu_item_availability() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_log_menu_item_availability ON public.menu_items;
CREATE TRIGGER trg_log_menu_item_availability
  AFTER UPDATE OF is_available ON public.menu_items
  FOR EACH ROW
  EXECUTE FUNCTION public.log_menu_item_availability();


-- ---------------------------------------------------------------------
-- Trading days
-- ---------------------------------------------------------------------

/**
 * Trading days in a range, with how many visits (table sessions) and sales
 * each had. A day with no completed sale is not a trading day and is absent.
 *
 * Visits are counted per day: a session is one visit on the trading day of its
 * order(s). Sessions that span the 05:00 cutoff are vanishingly rare and count
 * once on each side.
 */
CREATE OR REPLACE FUNCTION public.analytics_trading_days(_from date, _to date)
RETURNS TABLE(day date, visits int, orders int)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_from timestamptz;
  v_to timestamptz;
BEGIN
  IF NOT public.is_staff_member() THEN
    RAISE EXCEPTION 'Only staff can read analytics' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _from IS NULL OR _to IS NULL OR _to < _from THEN
    RETURN;
  END IF;

  SELECT starts_at INTO v_from FROM public.business_day_range(_from);
  SELECT ends_at INTO v_to FROM public.business_day_range(_to);

  RETURN QUERY
  SELECT public.business_day(co.created_at),
         count(DISTINCT co.table_session_id)::int,
         count(*)::int
    FROM public.completed_orders co
   WHERE co.created_at >= v_from AND co.created_at < v_to
   GROUP BY 1;
END;
$$;

REVOKE ALL ON FUNCTION public.analytics_trading_days(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.analytics_trading_days(date, date) TO authenticated;


/**
 * Every (item, trading day) on which the item could be ordered, with that
 * day's visit count — the exposure an item's sales are divided by.
 *
 * `basis` says how the day was decided: 'sold' (it sold that day), 'logged'
 * (the availability history says so) or 'assumed' (no history for this item
 * yet; see the header for the rule). Screens use it to say how sure they are.
 */
CREATE OR REPLACE FUNCTION public.analytics_item_days(_from date, _to date)
RETURNS TABLE(item_id uuid, day date, visits int, basis text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_from timestamptz;
  v_to timestamptz;
BEGIN
  IF NOT public.is_staff_member() THEN
    RAISE EXCEPTION 'Only staff can read analytics' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _from IS NULL OR _to IS NULL OR _to < _from THEN
    RETURN;
  END IF;

  SELECT starts_at INTO v_from FROM public.business_day_range(_from);
  SELECT ends_at INTO v_to FROM public.business_day_range(_to);

  RETURN QUERY
  WITH td AS (
    SELECT t.day AS t_day, t.visits AS t_visits, r.starts_at AS t_start, r.ends_at AS t_end
      FROM public.analytics_trading_days(_from, _to) t
      CROSS JOIN LATERAL public.business_day_range(t.day) r
  ),
  sold AS (
    SELECT DISTINCT oi.menu_item_id AS s_item, public.business_day(co.created_at) AS s_day
      FROM public.order_items oi
      JOIN public.completed_orders co ON co.id = oi.order_id
     WHERE co.created_at >= v_from AND co.created_at < v_to
  ),
  last_sold AS (
    SELECT s_item AS ls_item, max(s_day) AS ls_day FROM sold GROUP BY 1
  ),
  logged AS (
    SELECT DISTINCT l.menu_item_id AS lg_item FROM public.menu_item_availability_log l
  ),
  grid AS (
    SELECT mi.id AS g_item, mi.is_available AS g_now, td.*,
           (lg.lg_item IS NOT NULL) AS g_logged,
           ls.ls_day AS g_last_sold,
           EXISTS (SELECT 1 FROM sold s WHERE s.s_item = mi.id AND s.s_day = td.t_day) AS g_sold
      FROM public.menu_items mi
      CROSS JOIN td
      LEFT JOIN logged lg ON lg.lg_item = mi.id
      LEFT JOIN last_sold ls ON ls.ls_item = mi.id
     WHERE td.t_day >= public.business_day(mi.created_at)
  ),
  judged AS (
    SELECT g.*,
           CASE
             WHEN g.g_sold THEN 'sold'
             WHEN g.g_logged AND (
                    -- State at the start of the day: the last change before it,
                    -- or, if every change came later, the opposite of the first.
                    COALESCE(
                      (SELECT l.is_available FROM public.menu_item_availability_log l
                        WHERE l.menu_item_id = g.g_item AND l.changed_at < g.t_start
                        ORDER BY l.changed_at DESC, l.id DESC LIMIT 1),
                      (SELECT NOT l.is_available FROM public.menu_item_availability_log l
                        WHERE l.menu_item_id = g.g_item
                        ORDER BY l.changed_at, l.id LIMIT 1))
                    -- …or switched back on at some point during it.
                    OR EXISTS (SELECT 1 FROM public.menu_item_availability_log l
                                WHERE l.menu_item_id = g.g_item
                                  AND l.changed_at >= g.t_start AND l.changed_at < g.t_end
                                  AND l.is_available))
               THEN 'logged'
             WHEN NOT g.g_logged AND (g.g_now OR g.t_day <= g.g_last_sold) THEN 'assumed'
           END AS g_basis
      FROM grid g
  )
  SELECT j.g_item, j.t_day, j.t_visits, j.g_basis
    FROM judged j
   WHERE j.g_basis IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.analytics_item_days(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.analytics_item_days(date, date) TO authenticated;


-- ---------------------------------------------------------------------
-- Interval arithmetic shared by the reports below
-- ---------------------------------------------------------------------

/**
 * Wilson score interval for a proportion, as {low, high}.
 *
 * Unlike p ± z·se it never leaves [0, 1] and stays sensible at small n and
 * at p = 0, which is exactly where a café's per-dish numbers live. `_n` may be
 * fractional (an effective sample size). Pure arithmetic over its arguments,
 * so it reads no data and needs no staff check.
 */
CREATE OR REPLACE FUNCTION public.wilson_interval(_p numeric, _n numeric, _z numeric DEFAULT 1.2816)
RETURNS TABLE(low numeric, high numeric)
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE WHEN COALESCE(_n, 0) <= 0 THEN 0::numeric ELSE
           GREATEST(0, (_p + _z * _z / (2 * _n)
                        - _z * sqrt(GREATEST(_p * (1 - _p) / _n + _z * _z / (4 * _n * _n), 0)))
                       / (1 + _z * _z / _n)) END,
         CASE WHEN COALESCE(_n, 0) <= 0 THEN 1::numeric ELSE
           LEAST(1, (_p + _z * _z / (2 * _n)
                     + _z * sqrt(GREATEST(_p * (1 - _p) / _n + _z * _z / (4 * _n * _n), 0)))
                    / (1 + _z * _z / _n)) END;
$$;

REVOKE ALL ON FUNCTION public.wilson_interval(numeric, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wilson_interval(numeric, numeric, numeric) TO authenticated;
