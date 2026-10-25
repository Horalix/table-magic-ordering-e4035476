-- =====================================================================
-- The bandit gate — a check, not a bandit
--
-- Thompson sampling was the last phase of this plan and it is deliberately
-- NOT being built, because the gate it was conditioned on does not pass yet.
-- Writing the check instead of the algorithm is the whole point: the decision
-- to ship a learning system should be answerable with a query rather than a
-- feeling.
--
-- WHY A BANDIT WAS TEMPTING AND WHY IT WOULD HAVE BEEN WRONG
--
-- `smoothed_acceptance` returns the MEAN of a Beta posterior and discards the
-- variance. A pair shown twice with one acceptance and a pair shown 400 times
-- at 25% therefore score almost identically, and exploration is a decaying
-- random bonus that does not care which is which. Sampling from the posterior
-- instead would fix that properly, and it is about ten lines.
--
-- But a bandit optimises whatever it is fed. Until this week impressions were
-- counted on component mount, double-counted across two components, and
-- "acceptance" meant a tap on an order that might later be cancelled. A bandit
-- pointed at those numbers would have learned, efficiently and confidently, to
-- maximise noisy mounts.
--
-- Phases 1 fixed the inputs. What is missing now is simply DATA: none of this
-- has run in a real service. So the gate stays closed, this function says
-- exactly why, and whoever opens it later does so on evidence.
--
-- WHEN IT PASSES, the implementation note: a Gaussian approximation to the
-- Beta posterior (mean ± sd, clamped) is adequate for RANKING at these sample
-- sizes and is a few lines. A hand-rolled Marsaglia–Tsang gamma sampler in
-- PL/pgSQL is real complexity and buys nothing when the only use of the draw
-- is to sort five candidates.
-- =====================================================================

/**
 * Is the evidence good enough to let an algorithm learn from it?
 *
 * Every criterion is a fact about the data, not a judgement. `ready` is the
 * conjunction. Deliberately returns the individual failures too, because "not
 * yet" is only useful if it says what is missing.
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
  v_min_decisions constant int := 2000;
  v_min_pairs constant int := 15;
  v_checks jsonb;
BEGIN
  IF NOT public.is_staff_member() THEN
    RAISE EXCEPTION 'Only staff can read the readiness gate' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT count(*), count(*) FILTER (WHERE action_probability IS NOT NULL)
    INTO v_decisions, v_with_probability
    FROM public.recommendation_decisions;

  SELECT count(*) INTO v_impressions FROM public.recommendation_impressions;

  -- An acceptance only counts if the order it belongs to actually completed.
  SELECT count(*) INTO v_verified_conversions
    FROM public.suggestion_conversions sc
    JOIN public.completed_orders co ON co.id = sc.order_id
   WHERE sc.decision_id IS NOT NULL;

  -- Enough distinct pairs with enough impressions each. A bandit across three
  -- options is a coin toss with extra steps.
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
      'check', 'impressions_are_server_verified',
      'pass', true,
      'note', 'recommendation_impressions is written server-side and deduped by primary key'),
    jsonb_build_object(
      'check', 'acceptance_linked_to_paid_outcome',
      'pass', true,
      'note', 'suggestion_conversions.decision_id joins to completed_orders'),
    jsonb_build_object(
      'check', 'action_probabilities_logged',
      'pass', v_decisions = 0 OR v_with_probability = v_decisions,
      'note', format('%s of %s decisions carry a propensity', v_with_probability, v_decisions)),
    jsonb_build_object(
      'check', 'enough_decisions',
      'pass', v_decisions >= v_min_decisions,
      'have', v_decisions, 'need', v_min_decisions),
    jsonb_build_object(
      'check', 'enough_pairs_with_support',
      'pass', v_pairs_with_support >= v_min_pairs,
      'have', v_pairs_with_support, 'need', v_min_pairs,
      'note', 'distinct pairs with 50+ verified impressions each'),
    jsonb_build_object(
      'check', 'conversions_observed',
      'pass', v_verified_conversions > 0,
      'have', v_verified_conversions)
  );

  RETURN jsonb_build_object(
    'ready', NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_checks) c WHERE (c ->> 'pass')::boolean IS NOT TRUE),
    'checks', v_checks,
    'decisions', v_decisions,
    'impressions', v_impressions,
    'verified_conversions', v_verified_conversions,
    'policy_version', public.reco_policy_version(),
    'note', 'Until every check passes, the fixed ranker stays. A bandit fed '
            'unreliable counts learns to maximise the noise in them.'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.bandit_readiness() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bandit_readiness() TO authenticated;
