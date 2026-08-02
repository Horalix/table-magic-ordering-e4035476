-- =====================================================================
-- What goes together across a whole visit
--
-- `menu_item_affinity` builds its baskets from ORDERS:
--
--     SELECT DISTINCT co.id AS order_id, oi.menu_item_id ...
--
-- So it only ever learns pairs that were put in the same round. Steak first
-- and coffee twenty minutes later is invisible to it — and that is precisely
-- the relationship the after-meal prompt needs. The previous migration gave
-- that prompt the session's history to pair against; without this it has
-- nothing to pair it with.
--
-- Both grains are kept, because they answer different questions:
--
--   order-level    "what goes in the same round" — for the cart
--   session-level  "what goes in the same visit" — for after the meal
--
-- Also here: social proof worded to what is actually computed. `confidence` is
-- orders-containing-both over orders-containing-the-source. Calling that
-- "7 in 10 tables add this" is wrong twice — they are orders and not tables,
-- and "add" implies the suggestion caused it. It says "often ordered with"
-- unless there is enough session-grained support to quote a real number, and
-- then it quotes the conservative end of the interval rather than the point
-- estimate.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Pairs at visit grain
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.session_item_affinity (
  item_a uuid NOT NULL REFERENCES public.menu_items(id) ON DELETE CASCADE,
  item_b uuid NOT NULL REFERENCES public.menu_items(id) ON DELETE CASCADE,
  pair_sessions int NOT NULL,
  a_sessions int NOT NULL,
  confidence numeric(6,4) NOT NULL,
  lift numeric(8,4) NOT NULL,
  /**
   * Lower bound of the Wilson interval on the confidence.
   *
   * This is the number that may be shown to a guest. The point estimate off
   * four sessions can read 75%; the lower bound says what the data actually
   * supports, and a claim printed on a menu should be the one that survives
   * being wrong.
   */
  confidence_low numeric(6,4) NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (item_a, item_b)
);

ALTER TABLE public.session_item_affinity ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone reads session affinity" ON public.session_item_affinity;
CREATE POLICY "Anyone reads session affinity"
  ON public.session_item_affinity FOR SELECT TO anon, authenticated USING (true);

/**
 * Wilson score lower bound.
 *
 * The normal approximation collapses at small n — with 4 successes out of 4 it
 * reports a 100% rate with zero width, which is exactly when a suggestion
 * engine most wants to make a claim and least should. Wilson stays sensible
 * down to single digits, which is where a real restaurant's data lives.
 */
CREATE OR REPLACE FUNCTION public.wilson_lower(_successes int, _trials int, _z numeric DEFAULT 1.96)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE WHEN COALESCE(_trials, 0) = 0 THEN 0 ELSE
    GREATEST(0, round((
      (_successes::numeric / _trials)
      + (_z * _z) / (2 * _trials)
      - _z * sqrt(
          ((_successes::numeric / _trials) * (1 - _successes::numeric / _trials)
           + (_z * _z) / (4 * _trials)) / _trials)
    ) / (1 + (_z * _z) / _trials), 4))
  END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_session_affinity(
  _days int DEFAULT 90,
  _min_pair_sessions int DEFAULT 3
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows int := 0;
  v_total int;
BEGIN
  IF NOT public.is_staff_member() THEN
    RAISE EXCEPTION 'Only staff can refresh menu intelligence' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- One basket per VISIT, not per round. This is the whole difference.
  CREATE TEMP TABLE _sbasket ON COMMIT DROP AS
    SELECT DISTINCT co.table_session_id AS session_id, oi.menu_item_id AS item_id
      FROM public.completed_orders co
      JOIN public.order_items oi ON oi.order_id = co.id
     WHERE co.created_at > now() - make_interval(days => GREATEST(_days, 1))
       AND co.table_session_id IS NOT NULL;

  SELECT count(DISTINCT session_id) INTO v_total FROM _sbasket;
  IF COALESCE(v_total, 0) < 5 THEN
    RETURN 0;   -- not enough history to say anything honest
  END IF;

  CREATE TEMP TABLE _scounts ON COMMIT DROP AS
    SELECT item_id, count(*)::int AS sessions FROM _sbasket GROUP BY item_id;

  DELETE FROM public.session_item_affinity;

  INSERT INTO public.session_item_affinity(
    item_a, item_b, pair_sessions, a_sessions, confidence, lift, confidence_low, computed_at)
  SELECT p.item_a,
         p.item_b,
         p.pair_sessions,
         ca.sessions,
         round(p.pair_sessions::numeric / ca.sessions, 4),
         round((p.pair_sessions::numeric / ca.sessions)
               / NULLIF(cb.sessions::numeric / v_total, 0), 4),
         public.wilson_lower(p.pair_sessions, ca.sessions),
         now()
    FROM (
      SELECT b1.item_id AS item_a, b2.item_id AS item_b, count(*)::int AS pair_sessions
        FROM _sbasket b1
        JOIN _sbasket b2 ON b2.session_id = b1.session_id AND b2.item_id <> b1.item_id
       GROUP BY b1.item_id, b2.item_id
      HAVING count(*) >= GREATEST(_min_pair_sessions, 1)
    ) p
    JOIN _scounts ca ON ca.item_id = p.item_a
    JOIN _scounts cb ON cb.item_id = p.item_b;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_session_affinity(int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refresh_session_affinity(int, int) TO authenticated;

-- Fold it into the one-button refresh so nobody has to remember it exists.
DO $$
DECLARE v_def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'refresh_menu_intelligence';

  IF v_def IS NOT NULL AND position('refresh_session_affinity' in v_def) = 0 THEN
    v_def := replace(v_def,
      'v_pairs := public.refresh_menu_affinity();',
      'v_pairs := public.refresh_menu_affinity();
  PERFORM public.refresh_session_affinity();');
    EXECUTE v_def;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 2. The after-meal path uses visit-grain pairs
-- ---------------------------------------------------------------------

DO $$
DECLARE v_def text; v_before text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'rank_recommendations';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'rank_recommendations is missing — migrations are out of order';
  END IF;

  v_before := v_def;
  /*
   * `observed` was suppressed entirely after the meal, because order-grain
   * co-occurrence says nothing about "what now?". With visit-grain pairs it
   * says exactly that, so the after-meal case gets its own source rather than
   * falling through to popularity.
   */
  v_def := replace(v_def,
    '  observed AS (
    SELECT a.item_b AS item_id,',
    '  observed_session AS (
    SELECT sa.item_b AS item_id,
           sa.item_a AS source_item_id,
           ''after_meal''::text AS rtype,
           LEAST(sa.lift, 3)::numeric / 3 AS observed_score
      FROM public.session_item_affinity sa, p
     WHERE sa.item_a = ANY(p.context)
       AND p.placement = ''after_meal''
       AND sa.lift > 1.0
  ),
  observed AS (
    SELECT a.item_b AS item_id,');
  IF v_def = v_before THEN RAISE EXCEPTION 'session affinity CTE did not match'; END IF;

  v_before := v_def;
  v_def := replace(v_def,
    '    SELECT item_id, source_item_id, rtype, 0::numeric, observed_score FROM observed
    UNION ALL',
    '    SELECT item_id, source_item_id, rtype, 0::numeric, observed_score FROM observed
    UNION ALL
    SELECT item_id, source_item_id, rtype, 0::numeric, observed_score FROM observed_session
    UNION ALL');
  IF v_def = v_before THEN RAISE EXCEPTION 'session affinity union did not match'; END IF;

  EXECUTE v_def;
  RAISE NOTICE 'rank_recommendations now uses visit-grain pairs after the meal';
END $$;

-- ---------------------------------------------------------------------
-- 3. Social proof, worded to what was measured
-- ---------------------------------------------------------------------

ALTER TABLE public.restaurant_settings
  ADD COLUMN IF NOT EXISTS social_proof_min_sessions int NOT NULL DEFAULT 20
    CHECK (social_proof_min_sessions BETWEEN 5 AND 500);

COMMENT ON COLUMN public.restaurant_settings.social_proof_min_sessions IS
  'How many visits a pair needs before a percentage may be shown to a guest. '
  'Below this the copy stays qualitative.';

/**
 * What may honestly be said about a pairing.
 *
 * `kind` is the contract:
 *   none        — say nothing
 *   qualitative — "often ordered with X"
 *   quantified  — a real percentage, from visit-grain data, above the support
 *                 threshold, using the LOWER bound of the interval
 *
 * The lower bound rather than the point estimate because this ends up in front
 * of a guest. A claim of "80%" that is really "somewhere between 45% and 95%"
 * is not a statistic, it is a decoration.
 */
CREATE OR REPLACE FUNCTION public.suggestion_evidence(
  _source_item_id uuid,
  _recommended_item_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_min int;
  v_row public.session_item_affinity;
BEGIN
  IF _source_item_id IS NULL OR _recommended_item_id IS NULL THEN
    RETURN jsonb_build_object('kind', 'none');
  END IF;

  SELECT COALESCE(social_proof_min_sessions, 20) INTO v_min
    FROM public.restaurant_settings WHERE id = 1;

  SELECT * INTO v_row FROM public.session_item_affinity
   WHERE item_a = _source_item_id AND item_b = _recommended_item_id;

  IF NOT FOUND OR v_row.lift <= 1.0 THEN
    RETURN jsonb_build_object('kind', 'none');
  END IF;

  IF v_row.a_sessions >= v_min AND v_row.confidence_low >= 0.20 THEN
    RETURN jsonb_build_object(
      'kind', 'quantified',
      -- Deliberately the conservative bound, and deliberately "visits".
      'percent', round(v_row.confidence_low * 100),
      'sessions', v_row.a_sessions);
  END IF;

  RETURN jsonb_build_object('kind', 'qualitative', 'sessions', v_row.a_sessions);
END;
$$;

REVOKE ALL ON FUNCTION public.suggestion_evidence(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.suggestion_evidence(uuid, uuid) TO anon, authenticated;
