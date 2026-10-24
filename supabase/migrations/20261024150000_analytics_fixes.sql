-- =====================================================================
-- Analytics you can act on
--
-- An audit of the analytics screens found that several of them disagreed with
-- the till, with each other, or with themselves. None of the faults was loud:
-- every chart still drew. That is what made them dangerous — a manager looking
-- at a confident bar has no way to know it is in the wrong day, counted six
-- times, or one malformed event away from an error page.
--
-- What this migration changes, grouped by the question each answers:
--
--   INGEST     record_analytics_events drops id properties that are not uuids,
--              clamps occurred_at to [now() - 1h, now() + 1 min], and treats a
--              malformed `at` as "now" instead of failing the whole batch.
--              Existing rows with a malformed item id are deleted, because one
--              of them was enough to make every report that casts to uuid fail.
--
--   SAFETY     Readers use analytics_uuid() instead of a bare ::uuid cast, so a
--              bad row that predates the ingest fix cannot take a screen down.
--
--   ACCESS     menu_item_performance, sold_out_impact, menu_pairings and
--              suggestion_performance now refuse non-staff callers, like every
--              other management read already did.
--
--   COUNTING   suggestion_performance and recommendation_engine_health read
--              only the all-day row of suggestion_stats. Since dayparts were
--              added, each pair has up to six rows (one per daypart plus the
--              all-day roll-up), and both functions listed or counted all of
--              them.
--
--   TIME       sales_analytics buckets by the Sarajevo trading day and the
--              Sarajevo hour, so the day bars sum to the headline figure and
--              the busiest hour is not two hours early. daypart_of stops
--              calling 03:00 "morning".
--
--   MONEY      Net sales (items, after refunds) and tips are reported apart.
--              Revenue per guest is computed per visit, not per order.
--
--   PROJECTION reco_holdout_comparison projects the monthly value from the
--              days the experiment actually ran inside the window, not from the
--              whole window.
--
--   NEW        funnel_summary, staff_performance and looked_at_not_ordered —
--              server-side, staff-only, on trading days.
--
-- Every function is restated in full rather than patched by text replacement.
-- These are read models with no other writers, and a whole definition is far
-- easier to review than a set of search-and-replace pairs.
--
-- Builds on business_day() / business_day_range() from
-- 20260805090000_business_day.sql and never redefines them: the trading-day
-- cutoff lives there, and everything below inherits whatever it says.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Two forgiving parsers
-- ---------------------------------------------------------------------

/**
 * A uuid if the text is one, otherwise NULL — never an error.
 *
 * Analytics properties arrive from an anonymous endpoint, so a value is only
 * as trustworthy as the least careful client that ever sent one. A bare
 * `::uuid` in a report turns one bad row into an error for every manager who
 * opens the page. The canonical hyphenated form is the only one the client
 * ever sends, so it is the only one accepted.
 */
CREATE OR REPLACE FUNCTION public.analytics_uuid(_value text)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN _value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN _value::uuid
  END;
$$;

/**
 * A timestamp if the text parses as one, otherwise NULL.
 *
 * PL/pgSQL rather than SQL because the only reliable way to ask Postgres
 * "would this cast succeed?" is to try it and catch the failure. The length cap
 * keeps an absurd string from reaching the parser at all.
 */
CREATE OR REPLACE FUNCTION public.analytics_timestamptz(_value text)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  IF _value IS NULL OR length(_value) > 64 THEN
    RETURN NULL;
  END IF;
  RETURN _value::timestamptz;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;

/**
 * The first instant of a "last N days" window, in trading days.
 *
 * `_days = 1` means today's trading day so far; `_days = 30` means today and
 * the 29 trading days before it. Using the trading day rather than
 * `now() - interval` keeps a window from starting half-way through a service.
 */
CREATE OR REPLACE FUNCTION public.analytics_window_start(_days int)
RETURNS timestamptz
LANGUAGE sql
STABLE
AS $$
  SELECT r.starts_at
    FROM public.business_day_range(public.business_day() - (GREATEST(COALESCE(_days, 30), 1) - 1)) r;
$$;


-- ---------------------------------------------------------------------
-- 2. Ingest: sanitise ids, clamp time, never drop a batch over one field
-- ---------------------------------------------------------------------

/**
 * Ingest a small batch of product events.
 *
 * Same contract as before — anonymous, allow-listed vocabulary, scalar
 * properties only, at most 25 events a batch and 500 per visit per hour — with
 * three changes, each of which used to let one client spoil the data for
 * everyone:
 *
 *   - `item_id` and `source_item_id` survive only when they are uuids. Every
 *     report joins them to menu_items, and a single "undefined" used to make
 *     those reports raise instead of answer.
 *   - `at` is parsed forgivingly. A malformed timestamp used to abort the
 *     whole INSERT, silently losing the other 24 events in the batch.
 *   - occurred_at is clamped to [now() - 1 hour, now() + 1 minute]. The client
 *     clock is the guest's phone; a phone set to last year would otherwise
 *     write events straight into last year's reports. The client flushes
 *     every few seconds and on page hide, so an hour of slack loses nothing
 *     real, and anything older is stamped at the edge rather than discarded.
 */
CREATE OR REPLACE FUNCTION public.record_analytics_events(_visit_id text, _events jsonb)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_visit text := left(COALESCE(nullif(trim(_visit_id), ''), 'anonymous'), 64);
  v_recent int;
  v_inserted int := 0;
BEGIN
  IF _events IS NULL OR jsonb_typeof(_events) <> 'array' OR jsonb_array_length(_events) = 0 THEN
    RETURN 0;
  END IF;
  IF jsonb_array_length(_events) > 25 THEN
    RETURN 0;
  END IF;

  -- Volume cap per visit per hour: a bored client cannot fill the table.
  SELECT count(*) INTO v_recent
    FROM public.analytics_events
   WHERE visit_id = v_visit AND created_at > now() - interval '1 hour';
  IF v_recent > 500 THEN
    RETURN 0;
  END IF;

  WITH incoming AS (
    SELECT CASE WHEN jsonb_typeof(e) = 'object' THEN e->>'event' END AS event,
           COALESCE(
             (SELECT jsonb_object_agg(k, v)
                FROM jsonb_each(CASE WHEN jsonb_typeof(e->'props') = 'object'
                                     THEN e->'props' ELSE '{}'::jsonb END) AS kv(k, v)
               WHERE jsonb_typeof(v) IN ('string', 'number', 'boolean', 'null')
                 AND length(k) <= 40
                 -- An id that is not an id is worse than no id: drop the key.
                 AND (k NOT IN ('item_id', 'source_item_id')
                      OR (jsonb_typeof(v) = 'string' AND public.analytics_uuid(v #>> '{}') IS NOT NULL))),
             '{}'::jsonb
           ) AS props,
           CASE WHEN jsonb_typeof(e) = 'object' AND jsonb_typeof(e->'at') = 'string'
                THEN public.analytics_timestamptz(e->>'at') END AS claimed_at
      FROM jsonb_array_elements(_events) AS e
  )
  INSERT INTO public.analytics_events(visit_id, event, props, occurred_at)
  SELECT v_visit, i.event, i.props,
         LEAST(GREATEST(COALESCE(i.claimed_at, now()), now() - interval '1 hour'),
               now() + interval '1 minute')
    FROM incoming i
   WHERE i.event IS NOT NULL
     AND public.analytics_event_allowed(i.event);

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$$;

REVOKE ALL ON FUNCTION public.record_analytics_events(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_analytics_events(text, jsonb) TO anon, authenticated;

/*
 * Rows written before the ingest fix. Any one of them was enough to make
 * menu_item_performance, sold_out_impact, app_impact_summary and
 * refresh_suggestion_stats raise "invalid input syntax for type uuid", so they
 * are removed rather than carried forward. An empty string is left alone: every
 * reader already treats it as "no id".
 */
DELETE FROM public.analytics_events
 WHERE (nullif(props->>'item_id', '') IS NOT NULL
        AND public.analytics_uuid(props->>'item_id') IS NULL)
    OR (nullif(props->>'source_item_id', '') IS NOT NULL
        AND public.analytics_uuid(props->>'source_item_id') IS NULL);


-- ---------------------------------------------------------------------
-- 3. Dayparts: three in the morning is not breakfast
-- ---------------------------------------------------------------------

/**
 * The part of the day, in Sarajevo local time.
 *
 * Before, everything from 00:00 to 10:59 was 'morning', so the bar's last
 * hours after midnight were learned as breakfast and a nightcap suggestion
 * was scored against coffee-and-croissant acceptance. 'late' already existed
 * for 23:00 onwards; it now runs on until 05:00, the same point at which the
 * trading day turns over. `suggestion_stats.daypart` is plain text with no
 * CHECK constraint or enum, so no other object needs to learn the value.
 */
CREATE OR REPLACE FUNCTION public.daypart_of(_at timestamptz DEFAULT now())
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN EXTRACT(HOUR FROM (_at AT TIME ZONE 'Europe/Sarajevo')) < 5  THEN 'late'
    WHEN EXTRACT(HOUR FROM (_at AT TIME ZONE 'Europe/Sarajevo')) < 11 THEN 'morning'
    WHEN EXTRACT(HOUR FROM (_at AT TIME ZONE 'Europe/Sarajevo')) < 16 THEN 'lunch'
    WHEN EXTRACT(HOUR FROM (_at AT TIME ZONE 'Europe/Sarajevo')) < 18 THEN 'afternoon'
    WHEN EXTRACT(HOUR FROM (_at AT TIME ZONE 'Europe/Sarajevo')) < 23 THEN 'evening'
    ELSE 'late'
  END;
$$;


-- ---------------------------------------------------------------------
-- 4. Menu intelligence read model
-- ---------------------------------------------------------------------

/*
 * The return type gains `created_at`, so the "not selling at all" list can
 * leave out a dish that has only been on the menu for two days. A changed
 * return type needs DROP rather than CREATE OR REPLACE.
 */
DROP FUNCTION IF EXISTS public.menu_item_performance(int);

/**
 * Per-item funnel: viewed → added → ordered, plus what it earned.
 *
 * Views and adds come from analytics_events; orders and money come from
 * completed_orders. The two are reported side by side and never averaged
 * together, because they are measured differently and a blended number would
 * hide which half is weak.
 *
 * The window is the last `_days` trading days, including today's.
 */
CREATE FUNCTION public.menu_item_performance(_days int DEFAULT 30)
RETURNS TABLE(
  item_id uuid,
  name text,
  category_name text,
  subcategory_name text,
  price numeric,
  is_available boolean,
  margin_score smallint,
  created_at timestamptz,
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
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_since timestamptz := public.analytics_window_start(_days);
BEGIN
  IF NOT public.is_staff_member() THEN
    RAISE EXCEPTION 'Only staff can read menu intelligence' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  WITH ev AS (
    SELECT public.analytics_uuid(e.props->>'item_id') AS ev_item,
           count(*) FILTER (WHERE e.event = 'item_viewed')       AS n_views,
           count(*) FILTER (WHERE e.event = 'item_added')        AS n_adds,
           count(*) FILTER (WHERE e.event = 'cart_item_removed') AS n_removes
      FROM public.analytics_events e
     WHERE e.occurred_at >= v_since
       AND e.event IN ('item_viewed', 'item_added', 'cart_item_removed')
       AND public.analytics_uuid(e.props->>'item_id') IS NOT NULL
     GROUP BY 1
  ),
  sold AS (
    SELECT oi.menu_item_id                  AS sold_item,
           count(DISTINCT oi.order_id)      AS n_orders,
           sum(oi.quantity)::bigint         AS n_units,
           sum(oi.quantity * oi.unit_price) AS n_revenue
      FROM public.order_items oi
      JOIN public.completed_orders co ON co.id = oi.order_id
     WHERE co.created_at >= v_since
     GROUP BY 1
  )
  SELECT
    mi.id, mi.name, c.name, s.name, mi.price, mi.is_available, mi.margin_score, mi.created_at,
    COALESCE(ev.n_views, 0), COALESCE(ev.n_adds, 0), COALESCE(ev.n_removes, 0),
    COALESCE(sold.n_orders, 0), COALESCE(sold.n_units, 0), COALESCE(sold.n_revenue, 0)::numeric,
    -- Of the guests who looked, how many added it?
    CASE WHEN COALESCE(ev.n_views, 0) > 0
         THEN round(100.0 * COALESCE(ev.n_adds, 0) / ev.n_views, 1) END,
    -- Of the guests who looked, how many ended up buying it?
    CASE WHEN COALESCE(ev.n_views, 0) > 0
         THEN round(100.0 * COALESCE(sold.n_orders, 0) / ev.n_views, 1) END,
    -- Of the guests who added it, how many took it back out?
    CASE WHEN COALESCE(ev.n_adds, 0) > 0
         THEN round(100.0 * COALESCE(ev.n_removes, 0) / ev.n_adds, 1) END
  FROM public.menu_items mi
  JOIN public.subcategories s ON s.id = mi.subcategory_id
  JOIN public.categories c ON c.id = s.category_id
  LEFT JOIN ev   ON ev.ev_item = mi.id
  LEFT JOIN sold ON sold.sold_item = mi.id
  ORDER BY COALESCE(sold.n_revenue, 0) DESC, COALESCE(ev.n_views, 0) DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.menu_item_performance(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.menu_item_performance(int) TO authenticated;

/**
 * "Looked at, not ordered" — the ONE definition.
 *
 * Menu Intelligence and the impact page used to disagree about which dishes
 * these were (one used an add rate below 3%, the other an order rate below
 * 10%), and both included dishes that were sold out — of course nobody
 * ordered them. The rule, mirrored in findLeaks() in
 * src/lib/menu-intelligence.ts:
 *
 *   - currently available,
 *   - at least 20 views in the window, so the rate means something,
 *   - fewer than 10% of those views turned into an order.
 */
CREATE OR REPLACE FUNCTION public.looked_at_not_ordered(_days int DEFAULT 30, _limit int DEFAULT 8)
RETURNS TABLE(
  item_id uuid,
  name text,
  views bigint,
  adds bigint,
  orders bigint,
  order_rate numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
  IF NOT public.is_staff_member() THEN
    RAISE EXCEPTION 'Only staff can read menu intelligence' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  SELECT p.item_id, p.name, p.views, p.adds, p.orders, p.order_rate
    FROM public.menu_item_performance(_days) p
   WHERE p.is_available
     AND p.views >= 20
     AND COALESCE(p.order_rate, 0) < 10
   ORDER BY p.views DESC, p.name
   LIMIT LEAST(GREATEST(COALESCE(_limit, 8), 1), 50);
END;
$$;

REVOKE ALL ON FUNCTION public.looked_at_not_ordered(int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.looked_at_not_ordered(int, int) TO authenticated;

/**
 * Real pairings, ranked by lift. Unchanged apart from the staff check: the
 * pairings are the restaurant's own sales pattern and were readable by any
 * signed-in account.
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
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
  IF NOT public.is_staff_member() THEN
    RAISE EXCEPTION 'Only staff can read menu intelligence' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
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
END;
$$;

REVOKE ALL ON FUNCTION public.menu_pairings(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.menu_pairings(int) TO authenticated;

/**
 * Suggestion performance, per pair and placement, with the money it brought in.
 *
 * Reads only the all-day row (`daypart IS NULL`). suggestion_stats keeps one
 * row per daypart as well, for the ranker; listing those here showed every
 * pair up to six times with the same name and different numbers, and gave
 * React duplicate keys.
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
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
  IF NOT public.is_staff_member() THEN
    RAISE EXCEPTION 'Only staff can read menu intelligence' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  SELECT
    st.source_item_id,
    COALESCE(ms.name, 'Any order'),
    st.recommended_item_id,
    mr.name,
    st.placement,
    st.shown,
    st.accepted,
    st.dismissed,
    CASE WHEN st.shown > 0 THEN round(100.0 * st.accepted / st.shown, 1) END,
    round(100 * public.smoothed_acceptance(st.accepted, st.shown), 1),
    st.attributed_revenue,
    CASE WHEN st.shown > 0 THEN round(st.attributed_revenue / st.shown, 2) END,
    CASE
      WHEN st.shown < 20 THEN 'learning'
      WHEN st.shown >= (SELECT COALESCE(rs.reco_retire_after_impressions, 60) FROM public.restaurant_settings rs WHERE rs.id = 1)
       AND public.smoothed_acceptance(st.accepted, st.shown)
           < (SELECT COALESCE(rs.reco_min_acceptance, 0.03) FROM public.restaurant_settings rs WHERE rs.id = 1)
        THEN 'retired'
      WHEN public.smoothed_acceptance(st.accepted, st.shown) >= 0.15 THEN 'strong'
      WHEN public.smoothed_acceptance(st.accepted, st.shown) >= 0.06 THEN 'working'
      ELSE 'weak'
    END
  FROM public.suggestion_stats st
  JOIN public.menu_items mr ON mr.id = st.recommended_item_id
  LEFT JOIN public.menu_items ms ON ms.id = st.source_item_id
  WHERE st.daypart IS NULL
  ORDER BY st.attributed_revenue DESC, st.shown DESC
  LIMIT LEAST(GREATEST(COALESCE(_limit, 50), 1), 200);
END;
$$;

REVOKE ALL ON FUNCTION public.suggestion_performance(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.suggestion_performance(int) TO authenticated;

/**
 * What the engine currently knows, for the "how this works" panel.
 *
 * Counts pairs from the all-day rows only — see suggestion_performance — and
 * says which window the stats cover, so the page does not have to hard-code
 * "90 days" and quietly go stale if the refresh window changes.
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
    'tracked_pairs', (SELECT count(*) FROM public.suggestion_stats WHERE daypart IS NULL),
    'pairs_still_learning', (SELECT count(*) FROM public.suggestion_stats
                              WHERE daypart IS NULL AND shown < 20),
    'pairs_retired', (
      SELECT count(*) FROM public.suggestion_stats st
       WHERE st.daypart IS NULL
         AND st.shown >= s.reco_retire_after_impressions
         AND public.smoothed_acceptance(st.accepted, st.shown) < s.reco_min_acceptance),
    'affinity_computed_at', (SELECT max(computed_at) FROM public.menu_item_affinity),
    'stats_updated_at', (SELECT max(updated_at) FROM public.suggestion_stats),
    'window_days', 90,
    'orders_analysed', (SELECT count(*) FROM public.completed_orders WHERE created_at > now() - interval '90 days')
  ) INTO v
  FROM public.restaurant_settings s WHERE s.id = 1;

  RETURN v;
END;
$$;

REVOKE ALL ON FUNCTION public.recommendation_engine_health() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recommendation_engine_health() TO authenticated;

/*
 * New columns (revenue, last_sold_day, selling_days) make the per-day figure
 * checkable by hand, which is the point. Return type changes, so DROP.
 */
DROP FUNCTION IF EXISTS public.sold_out_impact(int);

/**
 * What being sold out costs.
 *
 * For each currently unavailable dish: how much interest it still attracts,
 * and what it takes on a typical day while it IS selling.
 *
 * The denominator used to be "UTC days on which this dish sold at least once",
 * which inflated the figure — a dish that sold on 3 of 20 open days was
 * credited with its whole revenue spread over three. It is now the number of
 * trading days (Sarajevo days on which the restaurant took any order) from the
 * start of the window, or the day the dish was added if later, up to the last
 * trading day it sold. After that day it has probably been off, so those days
 * are not counted against it.
 *
 * `estimated_lost_revenue` keeps its name for compatibility but means exactly
 * that per-day figure: roughly what each further trading day without the dish
 * forgoes, BEFORE allowing for guests who order something else instead. It is
 * an upper bound per day, not a total, and the page labels it that way.
 */
CREATE FUNCTION public.sold_out_impact(_days int DEFAULT 30)
RETURNS TABLE(
  item_id uuid,
  name text,
  views bigint,
  revenue numeric,
  last_sold_day date,
  selling_days int,
  avg_daily_revenue_when_available numeric,
  estimated_lost_revenue numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_since timestamptz := public.analytics_window_start(_days);
BEGIN
  IF NOT public.is_staff_member() THEN
    RAISE EXCEPTION 'Only staff can read menu intelligence' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  WITH trading AS (
    SELECT DISTINCT public.business_day(co.created_at) AS day
      FROM public.completed_orders co
     WHERE co.created_at >= v_since
  ),
  hist AS (
    SELECT oi.menu_item_id                               AS hist_item,
           sum(oi.quantity * oi.unit_price)              AS hist_revenue,
           max(public.business_day(co.created_at))       AS hist_last_day
      FROM public.order_items oi
      JOIN public.completed_orders co ON co.id = oi.order_id
     WHERE co.created_at >= v_since
     GROUP BY 1
  ),
  looks AS (
    SELECT public.analytics_uuid(e.props->>'item_id') AS look_item, count(*) AS n_views
      FROM public.analytics_events e
     WHERE e.occurred_at >= v_since AND e.event = 'item_viewed'
       AND public.analytics_uuid(e.props->>'item_id') IS NOT NULL
     GROUP BY 1
  ),
  candidates AS (
    SELECT mi.id AS r_item, mi.name AS r_name,
           COALESCE(looks.n_views, 0) AS r_views,
           COALESCE(hist.hist_revenue, 0)::numeric AS r_revenue,
           hist.hist_last_day AS r_last_day,
           (SELECT count(*)::int FROM trading t
             WHERE t.day >= public.business_day(GREATEST(v_since, mi.created_at))
               AND t.day <= hist.hist_last_day) AS r_days
      FROM public.menu_items mi
      LEFT JOIN hist  ON hist.hist_item = mi.id
      LEFT JOIN looks ON looks.look_item = mi.id
     WHERE mi.is_available = false
  )
  SELECT r_item, r_name, r_views, round(r_revenue, 2), r_last_day, COALESCE(r_days, 0),
         COALESCE(round(r_revenue / NULLIF(r_days, 0), 2), 0),
         COALESCE(round(r_revenue / NULLIF(r_days, 0), 2), 0)
    FROM candidates
   ORDER BY 7 DESC, 3 DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.sold_out_impact(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sold_out_impact(int) TO authenticated;

/**
 * Is the engine earning its place? — the honest version.
 *
 * Changes from the previous definition:
 *
 *   - Money is NET SALES: items, minus refunds, without tips. `total_revenue`
 *     keeps its name and now means that; tips are reported beside it.
 *   - Acceptance is counted twice and labelled: `shown`/`accepted` are client
 *     taps from analytics_events (fires on mount, a tap is not a purchase);
 *     `seen`/`paid` come from the decision ledger — a server-recorded sighting,
 *     and a suggested line that reached a completed order. The page leads with
 *     the second and shows the first as taps.
 *   - Revenue per guest is per VISIT: a party's whole net spend over its head
 *     count. Dividing each order by the full party, as before, counted a
 *     four-top's three rounds as three quarter-sized guests.
 *     `per_cover.orders_counted` is kept as an alias of `sessions_counted` for
 *     older clients.
 *   - "Order with a suggestion" vs "without" remain — they are an upper bound
 *     (guests who take a suggestion were already the bigger spenders), and the
 *     page says so.
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
  v_net numeric;
  v_tips numeric;
  v_attributed numeric;
  v_orders int;
  v_orders_with int;
  v_shown bigint;
  v_accepted bigint;
  v_seen bigint;
  v_paid bigint;
  v_cover_sessions int;
  v_cover_treated numeric;
  v_cover_held numeric;
BEGIN
  IF NOT public.is_staff_member() THEN
    RAISE EXCEPTION 'Only staff can read menu intelligence' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT COALESCE(sum(total - COALESCE(tip_amount, 0) - COALESCE(refunded_amount, 0)), 0),
         COALESCE(sum(tip_amount), 0),
         count(*)
    INTO v_net, v_tips, v_orders
    FROM public.completed_orders WHERE created_at > v_since;

  SELECT COALESCE(sum(sc.line_total), 0), count(DISTINCT sc.order_id)
    INTO v_attributed, v_orders_with
    FROM public.suggestion_conversions sc
    JOIN public.completed_orders co ON co.id = sc.order_id
   WHERE sc.created_at > v_since;

  -- Client taps. Kept because they are the only history before the ledger.
  SELECT count(*) FILTER (WHERE event = 'suggestion_shown'),
         count(*) FILTER (WHERE event = 'suggestion_accepted')
    INTO v_shown, v_accepted
    FROM public.analytics_events
   WHERE occurred_at > v_since
     AND event IN ('suggestion_shown', 'suggestion_accepted');

  -- Server-verified: a sighting recorded once per decision, and a paid line.
  SELECT count(*),
         count(*) FILTER (WHERE EXISTS (
           SELECT 1 FROM public.suggestion_conversions sc
             JOIN public.completed_orders co ON co.id = sc.order_id
            WHERE sc.decision_id = i.decision_id))
    INTO v_seen, v_paid
    FROM public.recommendation_impressions i
   WHERE i.seen_at > v_since;

  WITH visits AS (
    SELECT co.table_session_id,
           bool_or(o.reco_holdout) AS held,
           sum(co.total - COALESCE(co.tip_amount, 0) - COALESCE(co.refunded_amount, 0)) AS net,
           max(s.covers) AS covers
      FROM public.completed_orders co
      JOIN public.orders o ON o.id = co.id
      JOIN public.table_sessions s ON s.id = co.table_session_id
     WHERE co.created_at > v_since
       AND s.covers IS NOT NULL AND s.covers > 0
       AND o.reco_holdout IS NOT NULL
     GROUP BY co.table_session_id
  )
  SELECT count(*),
         avg(net / covers) FILTER (WHERE NOT held),
         avg(net / covers) FILTER (WHERE held)
    INTO v_cover_sessions, v_cover_treated, v_cover_held
    FROM visits;

  RETURN jsonb_build_object(
    'days', _days,
    'measure', 'net_sales_excl_tips_and_refunds',
    'total_revenue', round(v_net, 2),
    'net_sales', round(v_net, 2),
    'tips', round(v_tips, 2),
    'attributed_revenue', round(v_attributed, 2),
    'uplift_pct', CASE WHEN v_net > 0 THEN round(100 * v_attributed / v_net, 2) ELSE 0 END,
    'orders', v_orders,
    'orders_with_suggestion', v_orders_with,
    'attach_rate_pct', CASE WHEN v_orders > 0
                            THEN round(100.0 * v_orders_with / v_orders, 1) ELSE 0 END,
    'avg_order_with_suggestion', COALESCE((
      SELECT round(avg(co.total - COALESCE(co.tip_amount, 0) - COALESCE(co.refunded_amount, 0)), 2)
        FROM public.completed_orders co
       WHERE co.created_at > v_since
         AND EXISTS (SELECT 1 FROM public.suggestion_conversions sc WHERE sc.order_id = co.id)), 0),
    'avg_order_without_suggestion', COALESCE((
      SELECT round(avg(co.total - COALESCE(co.tip_amount, 0) - COALESCE(co.refunded_amount, 0)), 2)
        FROM public.completed_orders co
       WHERE co.created_at > v_since
         AND NOT EXISTS (SELECT 1 FROM public.suggestion_conversions sc WHERE sc.order_id = co.id)), 0),
    'shown', COALESCE(v_shown, 0),
    'accepted', COALESCE(v_accepted, 0),
    'overall_acceptance_pct', CASE WHEN COALESCE(v_shown, 0) > 0
                                   THEN round(100.0 * v_accepted / v_shown, 1) ELSE 0 END,
    'seen', COALESCE(v_seen, 0),
    'paid', COALESCE(v_paid, 0),
    'paid_acceptance_pct', CASE WHEN COALESCE(v_seen, 0) > 0
                                THEN round(100.0 * v_paid / v_seen, 1) END,
    'per_cover', jsonb_build_object(
      'sessions_counted', COALESCE(v_cover_sessions, 0),
      'orders_counted', COALESCE(v_cover_sessions, 0),
      'with_suggestions', COALESCE(round(v_cover_treated, 2), 0),
      'holdout', COALESCE(round(v_cover_held, 2), 0))
  );
END;
$$;

REVOKE ALL ON FUNCTION public.suggestion_impact(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.suggestion_impact(int) TO authenticated;


-- ---------------------------------------------------------------------
-- 5. The holdout projection uses the days the experiment actually ran
-- ---------------------------------------------------------------------

/**
 * What the suggestion engine is worth, per VISIT.
 *
 * Identical to 20260803002004 except for the monthly projection. It used to
 * divide the sessions counted by `_days`, the length of the window — but the
 * sessions counted are only those inside the running experiment. An
 * experiment started six days into a 30-day window had its six days of
 * sessions spread over thirty, understating the rate, and so the money, by
 * five times. The rate now divides by the overlap between the window and the
 * experiment, floored at one day so an hour of data cannot be extrapolated
 * into an absurd daily rate.
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
    'reliable', (v_stats ->> 'significant')::boolean
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reco_holdout_comparison(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reco_holdout_comparison(int) TO authenticated;


-- ---------------------------------------------------------------------
-- 6. Sales analytics on the trading day and the local hour
-- ---------------------------------------------------------------------

/**
 * Sales analytics, aggregated server-side.
 *
 * Restated in full. Since 20260805090000 the range bounds were already the
 * Sarajevo trading day, but the buckets inside it were not:
 *
 *   - `by_day` grouped on date_trunc('day', created_at), which is the UTC
 *     date. A sale at 00:30 local counted in the right range but in the
 *     previous day's BAR, so the bars did not sum to the headline and every
 *     late night looked like a weak night plus a strange early morning.
 *     It now groups on business_day(created_at) — the same function the range
 *     comes from, so the two cannot drift apart.
 *   - `by_hour` extracted the hour in UTC, so the 21:00 rush drew at 19:00.
 *
 * And the money is split the way the rest of the app splits it: `net_sales`
 * (items, minus refunds) is the headline; `tips` and `refunded` sit beside it;
 * `revenue` stays as the gross amount taken (items + tips), which is what the
 * Daily Report calls gross, so the two pages can still be reconciled.
 * `average_order` is now net per order.
 */
CREATE OR REPLACE FUNCTION public.sales_analytics(
  _from date DEFAULT (public.business_day() - 6),
  _to date DEFAULT public.business_day()
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from timestamptz;
  v_to timestamptz;
  v_result jsonb;
BEGIN
  IF NOT public.is_staff_member() THEN
    RAISE EXCEPTION 'Only staff can read analytics' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Guard against an inverted or absurd range rather than scanning everything.
  IF _to < _from THEN
    RAISE EXCEPTION 'End date is before start date';
  END IF;
  IF (_to - _from) > 400 THEN
    RAISE EXCEPTION 'Range is limited to 400 days';
  END IF;

  SELECT starts_at INTO v_from FROM public.business_day_range(_from);
  SELECT ends_at INTO v_to FROM public.business_day_range(_to);

  WITH sales AS (
    SELECT co.id, co.total, co.tip_amount, co.refunded_amount, co.created_at, co.table_session_id,
           co.total - COALESCE(co.tip_amount, 0) - COALESCE(co.refunded_amount, 0) AS net,
           public.business_day(co.created_at) AS trading_day,
           extract(hour FROM (co.created_at AT TIME ZONE 'Europe/Sarajevo'))::int AS local_hour
      FROM public.completed_orders co
     WHERE co.created_at >= v_from AND co.created_at < v_to
  ),
  lines AS (
    SELECT oi.menu_item_id, oi.quantity, oi.unit_price, s.id AS order_id
      FROM public.order_items oi
      JOIN sales s ON s.id = oi.order_id
  )
  SELECT jsonb_build_object(
    'from', _from,
    'to', _to,
    'today', public.business_day(),
    'measure', 'net_sales_excl_tips_and_refunds',

    'totals', (
      SELECT jsonb_build_object(
        'net_sales', COALESCE(round(sum(net), 2), 0),
        'revenue', COALESCE(round(sum(total), 2), 0),
        'tips', COALESCE(round(sum(tip_amount), 2), 0),
        'refunded', COALESCE(round(sum(refunded_amount), 2), 0),
        'orders', count(*),
        'average_order', COALESCE(round(avg(net), 2), 0),
        'items_per_order', COALESCE(
          round((SELECT sum(quantity)::numeric FROM lines) / NULLIF(count(*), 0), 2), 0)
      ) FROM sales
    ),

    -- Every trading day in the range is present even when it took nothing — a
    -- missing bar reads as missing data, a zero bar reads as a quiet Tuesday.
    'by_day', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
                         'day', d.day,
                         'net_sales', COALESCE(r.net_sales, 0),
                         'revenue', COALESCE(r.revenue, 0),
                         'tips', COALESCE(r.tips, 0),
                         'orders', COALESCE(r.orders, 0))
                       ORDER BY d.day)
        FROM (SELECT g::date AS day
                FROM generate_series(_from::timestamp, _to::timestamp, interval '1 day') g) d
        LEFT JOIN (
          SELECT trading_day AS day,
                 round(sum(net), 2) AS net_sales,
                 round(sum(total), 2) AS revenue,
                 round(sum(tip_amount), 2) AS tips,
                 count(*) AS orders
            FROM sales GROUP BY 1
        ) r ON r.day = d.day
    ), '[]'::jsonb),

    -- Wall-clock hour in Sarajevo.
    'by_hour', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
                         'hour', h,
                         'orders', COALESCE(o.orders, 0),
                         'net_sales', COALESCE(o.net_sales, 0),
                         'revenue', COALESCE(o.revenue, 0))
                       ORDER BY h)
        FROM generate_series(0, 23) h
        LEFT JOIN (
          SELECT local_hour AS hour,
                 count(*) AS orders,
                 round(sum(net), 2) AS net_sales,
                 round(sum(total), 2) AS revenue
            FROM sales GROUP BY 1
        ) o ON o.hour = h
    ), '[]'::jsonb),

    'by_category', COALESCE((
      SELECT jsonb_agg(x ORDER BY (x->>'revenue')::numeric DESC) FROM (
        SELECT jsonb_build_object(
                 'name', COALESCE(c.name, 'Other'),
                 'revenue', round(sum(l.quantity * l.unit_price), 2),
                 'units', sum(l.quantity)
               ) AS x
          FROM lines l
          LEFT JOIN public.menu_items mi ON mi.id = l.menu_item_id
          LEFT JOIN public.subcategories sc ON sc.id = mi.subcategory_id
          LEFT JOIN public.categories c ON c.id = sc.category_id
         GROUP BY c.name
      ) t
    ), '[]'::jsonb),

    'top_items', COALESCE((
      SELECT jsonb_agg(x ORDER BY (x->>'units')::int DESC) FROM (
        SELECT jsonb_build_object(
                 'item_id', l.menu_item_id,
                 'name', COALESCE(mi.name, 'Unknown'),
                 'units', sum(l.quantity)::int,
                 'revenue', round(sum(l.quantity * l.unit_price), 2)
               ) AS x
          FROM lines l
          LEFT JOIN public.menu_items mi ON mi.id = l.menu_item_id
         GROUP BY l.menu_item_id, mi.name
         ORDER BY sum(l.quantity) DESC
         LIMIT 12
      ) t
    ), '[]'::jsonb),

    -- Turnover is sittings per table, and the average length of a sitting —
    -- a bare session count was labelled "turnover" and told you nothing about
    -- how long a table was held.
    'table_turnover', COALESCE((
      SELECT jsonb_agg(x ORDER BY (x->>'table_number')::int) FROM (
        SELECT jsonb_build_object(
                 'table_number', t.table_number,
                 'sittings', count(*)::int,
                 'avg_minutes', round(avg(
                   EXTRACT(EPOCH FROM (COALESCE(ts.closed_at, now()) - ts.opened_at)) / 60
                 ))
               ) AS x
          FROM public.table_sessions ts
          JOIN public.tables t ON t.id = ts.table_id
         WHERE ts.opened_at >= v_from AND ts.opened_at < v_to
         GROUP BY t.table_number
      ) t
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.sales_analytics(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sales_analytics(date, date) TO authenticated;


-- ---------------------------------------------------------------------
-- 7. The ordering funnel
-- ---------------------------------------------------------------------

/**
 * How many visits reached each step, on trading days.
 *
 * Counts DISTINCT visit_id per step rather than events, so a guest who opens
 * the menu five times is one visit at the first step, and so every step has
 * the same unit and the drop-off between two steps is a real proportion.
 *
 * The steps are counted independently, not as a strict sequence: a guest who
 * arrives on a shared category link never fires menu_viewed but still belongs
 * at category_viewed. `visits` is every visit that recorded anything, the
 * honest top of the funnel when entry points vary.
 *
 * The guest app fires these events; this function only reads them. If a step
 * reads zero while the step after it does not, the client is not firing it —
 * the page says so rather than reporting a 100% drop.
 */
CREATE OR REPLACE FUNCTION public.funnel_summary(
  _from date DEFAULT (public.business_day() - 6),
  _to date DEFAULT public.business_day()
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from timestamptz;
  v_to timestamptz;
  v_steps jsonb;
  v_visits bigint;
BEGIN
  IF NOT public.is_staff_member() THEN
    RAISE EXCEPTION 'Only staff can read analytics' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _to < _from THEN
    RAISE EXCEPTION 'End date is before start date';
  END IF;
  IF (_to - _from) > 400 THEN
    RAISE EXCEPTION 'Range is limited to 400 days';
  END IF;

  SELECT starts_at INTO v_from FROM public.business_day_range(_from);
  SELECT ends_at INTO v_to FROM public.business_day_range(_to);

  SELECT count(DISTINCT e.visit_id) INTO v_visits
    FROM public.analytics_events e
   WHERE e.occurred_at >= v_from AND e.occurred_at < v_to;

  WITH steps(step, ord) AS (
    VALUES ('menu_viewed', 1), ('category_viewed', 2), ('item_viewed', 3), ('item_added', 4),
           ('cart_viewed', 5), ('checkout_opened', 6), ('order_placed', 7)
  ),
  counted AS (
    SELECT e.event, count(DISTINCT e.visit_id) AS n
      FROM public.analytics_events e
     WHERE e.occurred_at >= v_from AND e.occurred_at < v_to
       AND e.event IN ('menu_viewed', 'category_viewed', 'item_viewed', 'item_added',
                       'cart_viewed', 'checkout_opened', 'order_placed')
     GROUP BY e.event
  )
  SELECT jsonb_agg(jsonb_build_object('step', s.step, 'visits', COALESCE(c.n, 0)) ORDER BY s.ord)
    INTO v_steps
    FROM steps s
    LEFT JOIN counted c ON c.event = s.step;

  RETURN jsonb_build_object(
    'from', _from,
    'to', _to,
    'visits', COALESCE(v_visits, 0),
    'steps', v_steps
  );
END;
$$;

REVOKE ALL ON FUNCTION public.funnel_summary(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.funnel_summary(date, date) TO authenticated;


-- ---------------------------------------------------------------------
-- 8. Staff performance, server-side
-- ---------------------------------------------------------------------

/**
 * Per-waiter figures for a range of trading days.
 *
 * The page used to fetch orders, ratings and sessions to the browser and add
 * them up there, which had three faults:
 *
 *   - it counted awaiting_payment and payment_failed orders as revenue — a
 *     card checkout the guest abandoned was credited to the waiter;
 *   - three unbounded queries hit PostgREST's 1000-row cap on a busy month,
 *     and the totals silently became totals of an arbitrary slice;
 *   - the default dates were UTC days, so "today" started at 02:00.
 *
 * Here a sale is a completed_orders row, money is net sales with tips beside
 * it, and the range is the trading day. Timings start from the moment the
 * order reached the kitchen (released_to_kitchen_at), because a card order
 * waiting for payment is not waiting for the waiter.
 */
CREATE OR REPLACE FUNCTION public.staff_performance(
  _from date DEFAULT (public.business_day() - 6),
  _to date DEFAULT public.business_day()
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from timestamptz;
  v_to timestamptz;
  v_waiters jsonb;
  v_unassigned jsonb;
  v_low jsonb;
BEGIN
  IF NOT public.is_staff_member() THEN
    RAISE EXCEPTION 'Only staff can read staff performance' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _to < _from THEN
    RAISE EXCEPTION 'End date is before start date';
  END IF;
  IF (_to - _from) > 400 THEN
    RAISE EXCEPTION 'Range is limited to 400 days';
  END IF;

  SELECT starts_at INTO v_from FROM public.business_day_range(_from);
  SELECT ends_at INTO v_to FROM public.business_day_range(_to);

  WITH sales AS (
    SELECT co.assigned_waiter_id AS waiter_id,
           co.total - COALESCE(co.tip_amount, 0) - COALESCE(co.refunded_amount, 0) AS net,
           COALESCE(co.tip_amount, 0) AS tip,
           EXTRACT(EPOCH FROM (co.confirmed_at - COALESCE(co.released_to_kitchen_at, co.created_at))) / 60.0 AS confirm_min,
           EXTRACT(EPOCH FROM (co.served_at - COALESCE(co.released_to_kitchen_at, co.created_at))) / 60.0 AS served_min
      FROM public.completed_orders co
     WHERE co.created_at >= v_from AND co.created_at < v_to
  ),
  by_sales AS (
    SELECT waiter_id,
           count(*) AS orders,
           round(sum(net), 2) AS net_sales,
           round(sum(tip), 2) AS tips,
           round(avg(confirm_min) FILTER (WHERE confirm_min >= 0)::numeric, 1) AS avg_confirm_minutes,
           round(avg(served_min) FILTER (WHERE served_min >= 0)::numeric, 1) AS avg_served_minutes
      FROM sales
     WHERE waiter_id IS NOT NULL
     GROUP BY waiter_id
  ),
  by_sessions AS (
    SELECT ts.assigned_waiter_id AS waiter_id,
           count(*) AS tables,
           round(avg(EXTRACT(EPOCH FROM (ts.closed_at - ts.opened_at)) / 60.0)
                 FILTER (WHERE ts.closed_at IS NOT NULL)::numeric, 1) AS avg_turn_minutes
      FROM public.table_sessions ts
     WHERE ts.opened_at >= v_from AND ts.opened_at < v_to
       AND ts.assigned_waiter_id IS NOT NULL
     GROUP BY ts.assigned_waiter_id
  ),
  by_ratings AS (
    SELECT r.waiter_id, count(*) AS ratings, round(avg(r.rating)::numeric, 2) AS avg_rating
      FROM public.server_ratings r
     WHERE r.created_at >= v_from AND r.created_at < v_to
       AND r.waiter_id IS NOT NULL
     GROUP BY r.waiter_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'waiter_id', w.id,
           'name', w.display_name,
           'is_active', w.is_active,
           'orders', COALESCE(s.orders, 0),
           'net_sales', COALESCE(s.net_sales, 0),
           'tips', COALESCE(s.tips, 0),
           'tables', COALESCE(t.tables, 0),
           'ratings', COALESCE(r.ratings, 0),
           'avg_rating', r.avg_rating,
           'avg_confirm_minutes', s.avg_confirm_minutes,
           'avg_served_minutes', s.avg_served_minutes,
           'avg_turn_minutes', t.avg_turn_minutes
         ) ORDER BY COALESCE(s.net_sales, 0) DESC, w.display_name), '[]'::jsonb)
    INTO v_waiters
    FROM public.waiters w
    LEFT JOIN by_sales s    ON s.waiter_id = w.id
    LEFT JOIN by_sessions t ON t.waiter_id = w.id
    LEFT JOIN by_ratings r  ON r.waiter_id = w.id
   -- A former waiter still appears for a range in which they worked.
   WHERE w.is_active OR s.waiter_id IS NOT NULL OR t.waiter_id IS NOT NULL OR r.waiter_id IS NOT NULL;

  -- Sales nobody was assigned to, so the per-waiter figures visibly do not
  -- have to add up to the day's total.
  SELECT jsonb_build_object(
           'orders', count(*),
           'net_sales', COALESCE(round(sum(co.total - COALESCE(co.tip_amount, 0) - COALESCE(co.refunded_amount, 0)), 2), 0))
    INTO v_unassigned
    FROM public.completed_orders co
   WHERE co.created_at >= v_from AND co.created_at < v_to
     AND co.assigned_waiter_id IS NULL;

  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'created_at' DESC), '[]'::jsonb)
    INTO v_low
    FROM (
      SELECT jsonb_build_object(
               'waiter_id', r.waiter_id,
               'waiter_name', w.display_name,
               'rating', r.rating,
               'comment', r.comment,
               'created_at', r.created_at) AS x
        FROM public.server_ratings r
        LEFT JOIN public.waiters w ON w.id = r.waiter_id
       WHERE r.created_at >= v_from AND r.created_at < v_to
         AND r.rating <= 2
       ORDER BY r.created_at DESC
       LIMIT 10
    ) t;

  RETURN jsonb_build_object(
    'from', _from,
    'to', _to,
    'today', public.business_day(),
    'waiters', v_waiters,
    'unassigned', v_unassigned,
    'low_ratings', v_low
  );
END;
$$;

REVOKE ALL ON FUNCTION public.staff_performance(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_performance(date, date) TO authenticated;
