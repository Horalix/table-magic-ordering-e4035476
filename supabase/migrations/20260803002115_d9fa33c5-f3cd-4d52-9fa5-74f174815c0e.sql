-- =====================================================================
-- A decision ledger
--
-- Everything downstream of this — social proof, a bandit, off-policy
-- evaluation, "which surface earns" — needs to know what the engine actually
-- decided, when, under which policy, and what happened next. Today none of
-- that is recorded. What exists instead is a client-fired `suggestion_shown`
-- event, and it is unreliable in four separate ways:
--
--   * it fires on component MOUNT, not when the suggestion is visible, so a
--     card scrolled past below the fold counts as seen;
--   * a remount re-fires it, so navigating back and forth inflates the count;
--   * the `cart` placement is rendered from two components, so a guest with
--     both mounted is counted twice;
--   * "accepted" means a tap, with no link to whether the order was ever paid
--     for — a cancelled order still counts as a win.
--
-- Anything that learns from those numbers learns to maximise noisy mounts.
-- That is why the bandit is deliberately the LAST phase of this work and not
-- the first: the ranking algorithm is not the weak part, the evidence is.
--
-- This migration makes the server the source of truth: it records every
-- decision it makes, including the decision to suggest NOTHING, which is the
-- denominator that off-policy evaluation needs and that no client event could
-- ever supply.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. What the engine decided
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.recommendation_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid REFERENCES public.table_sessions(id) ON DELETE CASCADE,
  placement text NOT NULL,

  /** Which ranking policy produced this. A change here invalidates comparison. */
  policy_version text NOT NULL,
  experiment_id uuid REFERENCES public.experiments(id) ON DELETE SET NULL,
  arm text,

  /**
   * The ranked shortlist that was considered, not just the winner.
   *
   * Off-policy evaluation needs to know what else was available and how likely
   * each was to be chosen. Without the alternatives you can only ever measure
   * the policy you ran, never estimate one you did not.
   */
  candidates jsonb NOT NULL DEFAULT '[]'::jsonb,

  /** NULL means the engine deliberately suggested nothing. */
  chosen_item_id uuid REFERENCES public.menu_items(id) ON DELETE SET NULL,
  source_item_id uuid REFERENCES public.menu_items(id) ON DELETE SET NULL,
  recommendation_type text,

  /**
   * Probability this action was taken under the logging policy.
   *
   * 1.0 for a deterministic ranker. Recorded now so that when sampling is
   * introduced the history remains analysable — retrofitting propensities is
   * impossible.
   */
  action_probability numeric(6,4) NOT NULL DEFAULT 1.0,

  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_decisions_session ON public.recommendation_decisions(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_decisions_created ON public.recommendation_decisions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_decisions_pair
  ON public.recommendation_decisions(chosen_item_id, placement) WHERE chosen_item_id IS NOT NULL;

ALTER TABLE public.recommendation_decisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff read decisions" ON public.recommendation_decisions;
CREATE POLICY "Staff read decisions" ON public.recommendation_decisions
  FOR SELECT TO authenticated USING (public.is_staff_member());

/**
 * Was this decision actually seen?
 *
 * Separate from the decision itself because computing a suggestion and a guest
 * looking at it are different events, and only the second one is an
 * impression. Written once per decision — a UNIQUE constraint, so a remount
 * cannot inflate the count no matter what the client does.
 */
CREATE TABLE IF NOT EXISTS public.recommendation_impressions (
  decision_id uuid PRIMARY KEY REFERENCES public.recommendation_decisions(id) ON DELETE CASCADE,
  seen_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.recommendation_impressions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff read impressions" ON public.recommendation_impressions;
CREATE POLICY "Staff read impressions" ON public.recommendation_impressions
  FOR SELECT TO authenticated USING (public.is_staff_member());

-- Conversions gain the link back to the decision that caused them.
ALTER TABLE public.suggestion_conversions
  ADD COLUMN IF NOT EXISTS decision_id uuid REFERENCES public.recommendation_decisions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_suggestion_conversions_decision
  ON public.suggestion_conversions(decision_id) WHERE decision_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- 2. Split ranking from recording
-- ---------------------------------------------------------------------

/*
 * The existing function becomes the pure ranker.
 *
 * Renamed rather than copied: it is ~200 lines of carefully-tuned scoring and
 * guardrails, and transcribing it into a new file would be an invitation to
 * lose a clause. It stays STABLE and side-effect free — which is also what
 * makes it directly testable — and loses its anon grant, because guests now
 * reach it only through the wrapper that records what it decided.
 */
ALTER FUNCTION public.guest_get_recommendations(uuid[], text, text, int, uuid, text[])
  RENAME TO rank_recommendations;

REVOKE ALL ON FUNCTION public.rank_recommendations(uuid[], text, text, int, uuid, text[]) FROM PUBLIC, anon;

/** The policy version the ranker currently implements. */
CREATE OR REPLACE FUNCTION public.reco_policy_version()
RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT 'v1-fixed-ranker' $$;

-- ---------------------------------------------------------------------
-- 3. The recording wrapper
-- ---------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.guest_get_recommendations(uuid[], text, text, int, uuid, text[]);

/**
 * Rank, record, return.
 *
 * Returns a `decision_id` alongside the suggestions so that the impression and
 * any resulting order line can be tied back to this exact decision — which is
 * what turns "someone tapped something" into "this decision, under this
 * policy, earned this much".
 *
 * A session token is required. The previous signature took a bare session id
 * from `anon`, which was tolerable while the function only read the menu; it
 * writes now, and in the next phase it will read what the table has eaten.
 * Authorising it here means the client contract changes once instead of twice.
 *
 * Records a row even when there is nothing to suggest. That row is the
 * denominator: without it you can measure the acceptance rate of suggestions
 * that were made, but never how often the engine had nothing useful to say —
 * which is the number that tells you whether it is working.
 */
CREATE OR REPLACE FUNCTION public.guest_get_recommendations(
  _session_id uuid,
  _session_token text,
  _cart_item_ids uuid[] DEFAULT '{}',
  _placement text DEFAULT 'cart',
  _language text DEFAULT 'en',
  _limit int DEFAULT 4,
  _exclude_allergens text[] DEFAULT '{}'
)
RETURNS TABLE(
  decision_id uuid,
  id uuid,
  name text,
  name_bs text,
  name_ar text,
  price numeric,
  image_url text,
  dietary_tags text[],
  recommendation_type text,
  reason text,
  source_item_id uuid
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_decision_id uuid;
  v_top record;
  v_candidates jsonb;
  v_arm text;
  v_experiment uuid;
BEGIN
  PERFORM public.assert_guest_session(_session_id, _session_token);

  CREATE TEMP TABLE _ranked ON COMMIT DROP AS
    SELECT * FROM public.rank_recommendations(
      _cart_item_ids, _placement, _language, _limit, _session_id, _exclude_allergens);

  SELECT a.arm, a.experiment_id INTO v_arm, v_experiment
    FROM public.session_experiment_assignment a WHERE a.session_id = _session_id;

  -- The shortlist, not just the winner: needed to estimate a policy you did
  -- not run.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'item_id', r.id, 'type', r.recommendation_type, 'price', r.price
         ) ORDER BY r.price), '[]'::jsonb)
    INTO v_candidates FROM _ranked r;

  SELECT * INTO v_top FROM _ranked LIMIT 1;

  INSERT INTO public.recommendation_decisions(
    session_id, placement, policy_version, experiment_id, arm,
    candidates, chosen_item_id, source_item_id, recommendation_type, action_probability)
  VALUES (
    _session_id, _placement, public.reco_policy_version(), v_experiment, v_arm,
    v_candidates, v_top.id, v_top.source_item_id, v_top.recommendation_type,
    -- Deterministic ranker: the top item was certain to be chosen.
    1.0)
  RETURNING recommendation_decisions.id INTO v_decision_id;

  RETURN QUERY
    SELECT v_decision_id, r.id, r.name, r.name_bs, r.name_ar, r.price, r.image_url,
           r.dietary_tags, r.recommendation_type, r.reason, r.source_item_id
      FROM _ranked r;
END;
$$;

REVOKE ALL ON FUNCTION public.guest_get_recommendations(uuid, text, uuid[], text, text, int, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guest_get_recommendations(uuid, text, uuid[], text, text, int, text[]) TO anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. An impression is a sighting, not a mount
-- ---------------------------------------------------------------------

/**
 * Record that a decision was actually seen.
 *
 * Idempotent by primary key, so the count is correct no matter how many times
 * a component mounts, how many places render it, or how enthusiastically a
 * client retries. The old client-side event could not make that guarantee from
 * where it stood.
 */
CREATE OR REPLACE FUNCTION public.guest_mark_suggestion_seen(
  _decision_id uuid,
  _session_id uuid,
  _session_token text
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.assert_guest_session(_session_id, _session_token);

  INSERT INTO public.recommendation_impressions(decision_id)
  SELECT _decision_id
    FROM public.recommendation_decisions d
   WHERE d.id = _decision_id
     AND d.session_id = _session_id
  ON CONFLICT (decision_id) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.guest_mark_suggestion_seen(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guest_mark_suggestion_seen(uuid, uuid, text) TO anon, authenticated;

-- ---------------------------------------------------------------------
-- 5. Acceptance means paid for
-- ---------------------------------------------------------------------

/*
 * `guest_place_order` already writes suggestion_conversions with a
 * server-computed line total, so the money was never client-controlled. What
 * it lacked was the decision link. Added by textual rewrite of the live
 * definition for the same reason as the release path: restating a 150-line
 * function here would fork it.
 */
DO $$
DECLARE v_def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'guest_place_order';
  -- Line endings are not content. Git rewrites .sql to CRLF on Windows
  -- checkouts, which would make every search literal below miss silently.
  v_def := replace(v_def, chr(13) || chr(10), chr(10));


  IF v_def IS NULL THEN
    RAISE EXCEPTION 'guest_place_order is missing — migrations are out of order';
  END IF;

  IF position('decision_id' in v_def) = 0 THEN
    v_def := replace(v_def,
      'INSERT INTO public.suggestion_conversions(
    order_id, source_item_id, recommended_item_id, placement, quantity, line_total)',
      'INSERT INTO public.suggestion_conversions(
    order_id, source_item_id, recommended_item_id, placement, quantity, line_total, decision_id)');

    v_def := replace(v_def,
      '    round(mi.price * LEAST(GREATEST(COALESCE((item->>''quantity'')::int, 1), 1), 10), 2)
  FROM jsonb_array_elements(_items) AS item',
      '    round(mi.price * LEAST(GREATEST(COALESCE((item->>''quantity'')::int, 1), 1), 10), 2),
    nullif(item->''from_suggestion''->>''decision_id'', '''')::uuid
  FROM jsonb_array_elements(_items) AS item');

    EXECUTE v_def;
  END IF;
END $$;

/**
 * Suggestion performance, counted honestly.
 *
 * Impressions are server-recorded sightings. An acceptance is a line that
 * reached a COMPLETED order — not a tap, and not a cancelled order. The old
 * numbers could count both.
 */
CREATE OR REPLACE FUNCTION public.decision_performance(_days int DEFAULT 30)
RETURNS TABLE(
  placement text,
  policy_version text,
  decisions bigint,
  with_suggestion bigint,
  seen bigint,
  accepted bigint,
  acceptance_pct numeric,
  revenue numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_since timestamptz := now() - make_interval(days => GREATEST(COALESCE(_days, 30), 1));
BEGIN
  IF NOT public.is_staff_member() THEN
    RAISE EXCEPTION 'Only staff can read menu intelligence' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  SELECT
    d.placement,
    d.policy_version,
    count(*),
    count(*) FILTER (WHERE d.chosen_item_id IS NOT NULL),
    count(i.decision_id),
    count(sc.decision_id),
    CASE WHEN count(i.decision_id) > 0
         THEN round(100.0 * count(sc.decision_id) / count(i.decision_id), 1) ELSE 0 END,
    COALESCE(round(sum(sc.line_total), 2), 0)
  FROM public.recommendation_decisions d
  LEFT JOIN public.recommendation_impressions i ON i.decision_id = d.id
  LEFT JOIN public.suggestion_conversions sc ON sc.decision_id = d.id
  LEFT JOIN public.completed_orders co ON co.id = sc.order_id AND co.id IS NOT NULL
  WHERE d.created_at > v_since
  GROUP BY d.placement, d.policy_version
  ORDER BY 8 DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.decision_performance(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decision_performance(int) TO authenticated;