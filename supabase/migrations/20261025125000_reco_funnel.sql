-- =====================================================================
-- One recommendation funnel
--
-- Menu Intelligence showed five suggestion numbers from four sources —
-- client taps, server sightings, attributed revenue, per-placement taps —
-- and no single chain a manager could follow from "the engine was asked" to
-- "money came in". This is that chain, per placement and per trading week:
--
--   decisions        the engine was asked (recommendation_decisions)
--   with_suggestion  it had something to offer
--   seen             the guest's screen showed it (recommendation_impressions)
--   tapped           the guest added the decision's own pick (a
--                    suggestion_accepted event carrying the decision id, on
--                    the chosen dish)
--   paid             it reached an order that became a sale
--                    (suggestion_conversions joined to completed_orders —
--                    a cancelled or abandoned order is not money)
--   paid_km          what those lines took
--   km_per_1000_seen paid_km per thousand sightings: the number that says
--                    whether a placement earns its screen space
--
-- Every stage is a subset of the one before, by construction: a paid
-- suggestion was certainly tapped and seen, even when the phone's event or
-- sighting never arrived (keepalive is good, not perfect), so it is counted
-- at every earlier stage. `paid` therefore equals the ledger's conversions
-- exactly. What the funnel cannot say is how much of `paid_km` would have
-- been ordered anyway; the holdout comparison (reco_holdout_comparison) is
-- the only incremental number and the page shows it beside this, or says
-- "not measured".
--
-- Read-only over existing tables. Changes no recommendation function.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.reco_funnel(_days int DEFAULT 28)
RETURNS TABLE(
  placement text,
  week_start date,
  decisions bigint,
  with_suggestion bigint,
  seen bigint,
  tapped bigint,
  paid bigint,
  paid_km numeric,
  km_per_1000_seen numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_since timestamptz := public.analytics_window_start(LEAST(GREATEST(COALESCE(_days, 28), 1), 180));
BEGIN
  IF NOT public.is_staff_member() THEN
    RAISE EXCEPTION 'Only staff can read menu intelligence' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  WITH d AS (
    SELECT rd.id AS d_id, rd.placement AS d_placement, rd.chosen_item_id AS d_chosen, rd.created_at AS d_at
      FROM public.recommendation_decisions rd
     WHERE rd.created_at >= v_since
  ),
  sightings AS (
    SELECT DISTINCT i.decision_id AS s_id
      FROM public.recommendation_impressions i
      JOIN d ON d.d_id = i.decision_id
  ),
  taps AS (
    -- A tap belongs to a decision only when it carries the decision's id AND
    -- is on the dish that decision chose. The guest app sends the id only in
    -- that case (CartSuggestion); requiring the dish as well keeps older
    -- clients, which sent the id with any card, from crediting a decision
    -- with a tap on something it did not pick. Taps on other cards have no
    -- session on them (analytics is per phone visit, not per table), so they
    -- cannot be tied to a decision honestly and are not counted here.
    SELECT DISTINCT d.d_id AS t_id
      FROM public.analytics_events e
      JOIN d ON d.d_id = public.analytics_uuid(e.props->>'decision_id')
     WHERE e.event = 'suggestion_accepted'
       AND e.occurred_at >= v_since - interval '1 day'
       AND (public.analytics_uuid(e.props->>'item_id') IS NULL
            OR public.analytics_uuid(e.props->>'item_id') = d.d_chosen)
  ),
  conv AS (
    SELECT sc.decision_id AS c_id, sum(sc.line_total) AS c_km
      FROM public.suggestion_conversions sc
      JOIN public.completed_orders co ON co.id = sc.order_id
      JOIN d ON d.d_id = sc.decision_id
     GROUP BY sc.decision_id
  ),
  flagged AS (
    SELECT d.*,
           c.c_id IS NOT NULL AS is_paid,
           COALESCE(c.c_km, 0) AS km,
           (t.t_id IS NOT NULL OR c.c_id IS NOT NULL) AS is_tapped,
           (s.s_id IS NOT NULL OR t.t_id IS NOT NULL OR c.c_id IS NOT NULL) AS is_seen
      FROM d
      LEFT JOIN sightings s ON s.s_id = d.d_id
      LEFT JOIN taps t ON t.t_id = d.d_id
      LEFT JOIN conv c ON c.c_id = d.d_id
  )
  SELECT f.d_placement,
         date_trunc('week', public.business_day(f.d_at)::timestamp)::date,
         count(*)::bigint,
         (count(*) FILTER (WHERE f.d_chosen IS NOT NULL OR f.is_seen))::bigint,
         (count(*) FILTER (WHERE f.is_seen))::bigint,
         (count(*) FILTER (WHERE f.is_tapped))::bigint,
         (count(*) FILTER (WHERE f.is_paid))::bigint,
         round(sum(f.km), 2),
         CASE WHEN count(*) FILTER (WHERE f.is_seen) > 0
              THEN round(1000 * sum(f.km) / count(*) FILTER (WHERE f.is_seen), 2) END
    FROM flagged f
   GROUP BY 1, 2
   ORDER BY 2 DESC, 1;
END;
$$;

REVOKE ALL ON FUNCTION public.reco_funnel(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reco_funnel(int) TO authenticated;
