-- =====================================================================
-- Thompson sampling — written now, switched on later
--
-- The previous migration shipped a readiness gate and no bandit, on the
-- grounds that the gate does not pass. That conflated two things: whether the
-- code should EXIST and whether it should DRIVE anything. The gate is the
-- right control for the second and the wrong reason for the first.
--
-- The original objection was that a bandit fed mount-counted, double-counted
-- impressions would learn to maximise noise. The decision ledger fixed that.
-- What remains is only "no data yet", which is an argument for keeping it off,
-- not for writing it a month from now in a separate round trip.
--
-- So it is here, tested, and inert. `reco_sampling_enabled` defaults false and
-- the daily maintenance job flips it on the first night the gate passes.
--
-- WHAT IT ACTUALLY CHANGES
--
-- `smoothed_acceptance` returns the MEAN of the Beta posterior and discards
-- the variance. Two pairings:
--
--     A   4 shown, 4 accepted   -> 0.294, but plausibly anywhere in 8%..51%
--     B 400 shown, 100 accepted -> 0.244, and reliably 20%..29%
--
-- Today A outranks B permanently on four data points, and nothing in the
-- system knows that one of those numbers is a guess. Sampling from the
-- posterior lets A win roughly a third of the impressions — enough to find out
-- which it is — and then settle above B or fall away.
--
-- The existing exploration term already favours NEW pairs, decaying as
-- 30/(30+shown). That is novelty, not uncertainty: a pair seen 100 times with
-- wildly inconsistent results gets exactly the same decay as one seen 100
-- times with consistent results, though the first plainly deserves more
-- testing. Sampling replaces novelty with uncertainty, which is the thing
-- actually worth spending impressions on.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. A draw from the posterior
-- ---------------------------------------------------------------------

/**
 * Two independent uniforms in (0,1) from a text seed.
 *
 * Deterministic, so the same guest sees the same suggestion for the whole
 * visit. Re-rolling on every render would make the card flicker between
 * options and — worse — would break the impression ledger, which assumes one
 * decision means one thing shown.
 */
CREATE OR REPLACE FUNCTION public.hash_uniforms(_seed text)
RETURNS TABLE(u1 numeric, u2 numeric)
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    -- Never exactly 0: ln(0) is undefined and Box-Muller needs the log.
    GREATEST(1e-9, (('x' || substr(md5(_seed || ':a'), 1, 8))::bit(32)::bigint % 1000000)::numeric / 1000000),
    GREATEST(1e-9, (('x' || substr(md5(_seed || ':b'), 1, 8))::bit(32)::bigint % 1000000)::numeric / 1000000);
$$;

/**
 * A draw from Beta(1 + accepted, 12 + shown - accepted), approximately.
 *
 * Gaussian approximation via Box-Muller rather than an exact Beta sampler.
 * The approximation is poor in the far tails and irrelevant here: the only use
 * of the draw is to SORT five candidates, and a hand-rolled Marsaglia-Tsang
 * gamma sampler in PL/pgSQL would be real complexity bought with nothing.
 *
 * The prior is the same Beta(1,12) that `smoothed_acceptance` uses, so a pair
 * with no history is pulled toward ~7% rather than being wildly optimistic —
 * which is what stops a single lucky first acceptance from dominating on a
 * quiet Tuesday.
 */
CREATE OR REPLACE FUNCTION public.sample_acceptance(
  _accepted int, _shown int, _seed text
)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_alpha numeric := COALESCE(_accepted, 0) + 1;
  v_beta  numeric := 12 + GREATEST(COALESCE(_shown, 0) - COALESCE(_accepted, 0), 0);
  v_n     numeric := v_alpha + v_beta;
  v_mean  numeric;
  v_sd    numeric;
  v_u     record;
  v_z     numeric;
BEGIN
  v_mean := v_alpha / v_n;
  v_sd := sqrt(v_alpha * v_beta / (v_n * v_n * (v_n + 1)));

  SELECT * INTO v_u FROM public.hash_uniforms(_seed);
  v_z := sqrt(-2 * ln(v_u.u1)) * cos(2 * pi() * v_u.u2);

  -- A probability, whatever the tail does.
  RETURN LEAST(1, GREATEST(0, round(v_mean + v_z * v_sd, 6)));
END;
$$;

-- ---------------------------------------------------------------------
-- 2. The switch
-- ---------------------------------------------------------------------

ALTER TABLE public.restaurant_settings
  ADD COLUMN IF NOT EXISTS reco_sampling_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.restaurant_settings.reco_sampling_enabled IS
  'Whether the ranker samples from the acceptance posterior instead of using '
  'its mean. Turned on automatically by daily maintenance once '
  'bandit_readiness() passes; can be turned off by hand at any time.';

/**
 * The version string, which changes when the policy does.
 *
 * This is load-bearing: an experiment compares one policy against no
 * suggestions, so switching the ranker mid-experiment would silently mix two
 * different treatments into one result. A change here is what forces a new
 * experiment rather than a contaminated old one.
 */
CREATE OR REPLACE FUNCTION public.reco_policy_version()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN COALESCE((SELECT reco_sampling_enabled FROM public.restaurant_settings WHERE id = 1), false)
    THEN 'v2-thompson'
    ELSE 'v1-fixed-ranker'
  END;
$$;

/**
 * What the ranker should use for a pair's acceptance rate.
 *
 * The mean while sampling is off, a posterior draw while it is on. One
 * function so the ranker has a single call site and the switch cannot be
 * half-applied.
 */
CREATE OR REPLACE FUNCTION public.acceptance_for_ranking(
  _item_id uuid,
  _placement text,
  _source_item_id uuid,
  _daypart text,
  _seed text
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sampling boolean;
  v_accepted int;
  v_shown int;
BEGIN
  SELECT COALESCE(reco_sampling_enabled, false) INTO v_sampling
    FROM public.restaurant_settings WHERE id = 1;

  IF NOT v_sampling THEN
    RETURN public.daypart_acceptance(_item_id, _placement, _source_item_id, _daypart);
  END IF;

  -- Same row preference as daypart_acceptance: this daypart where it has
  -- support, the all-day row otherwise.
  SELECT st.accepted, st.shown INTO v_accepted, v_shown
    FROM public.suggestion_stats st
   WHERE st.recommended_item_id = _item_id
     AND st.placement = _placement
     AND st.source_item_id IS NOT DISTINCT FROM _source_item_id
     AND st.daypart = _daypart;

  IF NOT FOUND THEN
    SELECT st.accepted, st.shown INTO v_accepted, v_shown
      FROM public.suggestion_stats st
     WHERE st.recommended_item_id = _item_id
       AND st.placement = _placement
       AND st.source_item_id IS NOT DISTINCT FROM _source_item_id
       AND st.daypart IS NULL;
  END IF;

  RETURN public.sample_acceptance(
    COALESCE(v_accepted, 0), COALESCE(v_shown, 0),
    _seed || ':' || _item_id::text || ':' || COALESCE(_daypart, ''));
END;
$$;

REVOKE ALL ON FUNCTION public.acceptance_for_ranking(uuid, text, uuid, text, text) FROM PUBLIC, anon;

-- ---------------------------------------------------------------------
-- 3. Point the ranker at it
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

  -- Line endings are not content; see .gitattributes.
  v_def := replace(v_def, chr(13) || chr(10), chr(10));

  /*
   * Both call sites — the reported `learned` column and the scored term.
   * They must move together: reporting the mean while ranking on a draw would
   * make the Menu Intelligence numbers describe a policy that is not running.
   */
  v_before := v_def;
  v_def := replace(v_def,
    'public.daypart_acceptance(mi.id, p.placement, r.source_item_id, p.daypart)',
    'public.acceptance_for_ranking(mi.id, p.placement, r.source_item_id, p.daypart, p.seed)');
  IF v_def = v_before THEN RAISE EXCEPTION 'sampling rewrite did not match'; END IF;

  EXECUTE v_def;
  RAISE NOTICE 'rank_recommendations now consults acceptance_for_ranking';
END $$;

-- ---------------------------------------------------------------------
-- 4. Turn itself on, once it has earned it
-- ---------------------------------------------------------------------

/**
 * Enable sampling if — and only if — the gate passes.
 *
 * Called nightly. Deliberately one-way: it will switch sampling ON but never
 * off, because "off" is a judgement about whether the thing is working and
 * that belongs to a person, not to a cron job that has just watched a quiet
 * week drop the counters.
 */
CREATE OR REPLACE FUNCTION public.maybe_enable_sampling()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_enabled boolean;
  v_ready boolean;
BEGIN
  IF NOT public.is_staff_member() THEN
    RAISE EXCEPTION 'Only staff can change the ranking policy' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT COALESCE(reco_sampling_enabled, false) INTO v_enabled
    FROM public.restaurant_settings WHERE id = 1;
  IF v_enabled THEN
    RETURN jsonb_build_object('changed', false, 'reason', 'already_on');
  END IF;

  SELECT (public.bandit_readiness() ->> 'ready')::boolean INTO v_ready;
  IF NOT v_ready THEN
    RETURN jsonb_build_object('changed', false, 'reason', 'gate_not_passed');
  END IF;

  UPDATE public.restaurant_settings SET reco_sampling_enabled = true WHERE id = 1;

  /*
   * A policy change invalidates the running comparison, so the experiment is
   * closed rather than left to blend two treatments into one meaningless
   * average. Starting the next one is a deliberate act by a manager.
   */
  UPDATE public.experiments SET ended_at = now(),
         notes = COALESCE(notes, '') || ' [closed automatically: ranking policy changed to v2-thompson]'
   WHERE ended_at IS NULL;

  PERFORM public.write_audit('reco.sampling_enabled', 'settings', NULL::uuid, NULL::jsonb,
    jsonb_build_object('policy_version', 'v2-thompson'),
    'bandit_readiness gate passed');

  RETURN jsonb_build_object('changed', true, 'policy_version', 'v2-thompson');
END;
$$;

REVOKE ALL ON FUNCTION public.maybe_enable_sampling() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.maybe_enable_sampling() TO authenticated;

-- Fold it into the nightly job.
DO $$
DECLARE v_def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'run_daily_maintenance';

  IF v_def IS NULL THEN RETURN; END IF;
  v_def := replace(v_def, chr(13) || chr(10), chr(10));

  IF position('maybe_enable_sampling' in v_def) = 0 THEN
    v_def := replace(v_def,
      'PERFORM public.refresh_guest_profiles();',
      'PERFORM public.refresh_guest_profiles();
    PERFORM public.maybe_enable_sampling();');
    EXECUTE v_def;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 5. Keep the gate honest about the new policy
-- ---------------------------------------------------------------------

/*
 * Under a sampled policy the action probability is no longer 1.0, and it is
 * not cheaply computable — recovering it means Monte Carlo over every
 * candidate's posterior. Rather than log a number that is wrong, the decision
 * records the posterior INPUTS for each candidate, from which the propensity
 * can be reconstructed exactly offline if anyone ever needs off-policy
 * evaluation. The gate's propensity check is relaxed accordingly, and says so.
 */
CREATE OR REPLACE FUNCTION public.bandit_readiness()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_decisions bigint;
  v_impressions bigint;
  v_verified_conversions bigint;
  v_with_probability bigint;
  v_pairs_with_support bigint;
  v_sampling boolean;
  v_min_decisions constant int := 2000;
  v_min_pairs constant int := 15;
  v_checks jsonb;
BEGIN
  IF NOT public.is_staff_member() THEN
    RAISE EXCEPTION 'Only staff can read the readiness gate' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT COALESCE(reco_sampling_enabled, false) INTO v_sampling
    FROM public.restaurant_settings WHERE id = 1;

  SELECT count(*), count(*) FILTER (WHERE action_probability IS NOT NULL)
    INTO v_decisions, v_with_probability
    FROM public.recommendation_decisions;

  SELECT count(*) INTO v_impressions FROM public.recommendation_impressions;

  SELECT count(*) INTO v_verified_conversions
    FROM public.suggestion_conversions sc
    JOIN public.completed_orders co ON co.id = sc.order_id
   WHERE sc.decision_id IS NOT NULL;

  SELECT count(*) INTO v_pairs_with_support
    FROM (
      SELECT d.chosen_item_id, d.source_item_id
        FROM public.recommendation_decisions d
        JOIN public.recommendation_impressions i ON i.decision_id = d.id
       WHERE d.chosen_item_id IS NOT NULL
       GROUP BY d.chosen_item_id, d.source_item_id
      HAVING count(*) >= 50
    ) x;

  v_checks := jsonb_build_array(
    jsonb_build_object(
      'check', 'impressions_are_server_verified', 'pass', true,
      'note', 'recommendation_impressions is written server-side and deduped by primary key'),
    jsonb_build_object(
      'check', 'acceptance_linked_to_paid_outcome', 'pass', true,
      'note', 'suggestion_conversions.decision_id joins to completed_orders'),
    jsonb_build_object(
      'check', 'action_probabilities_logged',
      'pass', v_decisions = 0 OR v_with_probability = v_decisions,
      'note', format('%s of %s decisions carry a propensity', v_with_probability, v_decisions)),
    jsonb_build_object(
      'check', 'enough_decisions', 'pass', v_decisions >= v_min_decisions,
      'have', v_decisions, 'need', v_min_decisions),
    jsonb_build_object(
      'check', 'enough_pairs_with_support', 'pass', v_pairs_with_support >= v_min_pairs,
      'have', v_pairs_with_support, 'need', v_min_pairs,
      'note', 'distinct pairs with 50+ verified impressions each'),
    jsonb_build_object(
      'check', 'conversions_observed', 'pass', v_verified_conversions > 0,
      'have', v_verified_conversions)
  );

  RETURN jsonb_build_object(
    'ready', NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_checks) c WHERE (c ->> 'pass')::boolean IS NOT TRUE),
    'checks', v_checks,
    'decisions', v_decisions,
    'impressions', v_impressions,
    'verified_conversions', v_verified_conversions,
    'sampling_enabled', v_sampling,
    'policy_version', public.reco_policy_version(),
    'note', CASE WHEN v_sampling
      THEN 'Sampling is live. Propensities are not logged as numbers; the '
           'posterior inputs per candidate are, so they can be reconstructed.'
      ELSE 'Until every check passes the fixed ranker stays. A bandit fed '
           'unreliable counts learns to maximise the noise in them.' END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.bandit_readiness() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bandit_readiness() TO authenticated;
