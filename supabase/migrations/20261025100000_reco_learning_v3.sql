-- =====================================================================
-- Recommendations, v3: learn from what was paid for, rank by what it earns
--
-- One venue, about 150 dishes and 50–400 orders a day: the engine spends most
-- of its life with too little data, and every number it learns from has to be
-- the honest one. This migration changes five things.
--
--   R1  The learning counts come from the server's own record. `shown` is a
--       decision the guest actually saw (recommendation_impressions), counted
--       once; `accepted` is that decision's dish on an order that became a
--       sale. Browser events are kept only for the time before the ledger
--       existed. They counted a card that was never the decision's choice,
--       and a tap whose order was later cancelled, as a success.
--
--   R2  Pair strength is a shrunk estimate, not raw lift. Each basket is
--       weighted by age (half-life 45 days) instead of falling off a 90-day
--       cliff, and the strength of a pair is the 5th percentile of a Gamma
--       posterior (DuMouchel's EB05): two dishes that were each ordered once,
--       together, no longer look like a perfect match. Where a dish has no
--       history of its own, its SECTION may: "burgers go with fries" is
--       learned at section level and offered as the fries this daypart
--       actually sells.
--
--   R3  A pair with no history starts from what its dish does elsewhere at
--       the same placement, not from one global prior. A pair is retired
--       only when even an optimistic reading of its record (95th percentile)
--       is below the floor.
--
--   R4  Candidates are ranked by expected profit: P(accept) × contribution
--       margin from menu_unit_margins(), relative to the best on the
--       shortlist. margin_score stays as a small manual nudge.
--
--   R5  A suggestion ignored this visit is offered less (−0.15 per sighting).
--       Alcohol is never suggested before reco_alcohol_from (12:00 Sarajevo
--       time by default), to a table with a kids' dish, or to a guest whose
--       diet filter excludes it — curated pairs included.
--
-- Every function this file changes is restated in full: they are ours, and
-- rewriting them by text against a live copy that differs from the
-- repository (it has no SQL comments) would have been the riskier route. The
-- ranker keeps every guardrail it had: availability, cart and repeat rules,
-- same-shelf rule, holdout, retirement, allergens, coursing, kids' dishes,
-- inferred diet, kitchen load and price proportionality. Diet tags and
-- dismissals are applied in the wrapper, which also writes the ledger.
--
-- The ranking policy changes, so its version does too ('v3-profit', or
-- 'v3-profit-thompson' once sampling is on), and a running experiment is
-- closed rather than left to average two rankers into one number.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Settings and columns
-- ---------------------------------------------------------------------

ALTER TABLE public.restaurant_settings
  ADD COLUMN IF NOT EXISTS reco_alcohol_from time NOT NULL DEFAULT '12:00';

COMMENT ON COLUMN public.restaurant_settings.reco_alcohol_from IS
  'Sarajevo time from which an alcoholic drink may be suggested (until the '
  'business day ends at 05:00). Applies to curated pairs too. Ordering is '
  'not affected — this only stops the app volunteering a drink at breakfast.';

-- How much of a pair's `shown` came from the ledger rather than from browser
-- events. bandit_readiness() reads it.
ALTER TABLE public.suggestion_stats
  ADD COLUMN IF NOT EXISTS shown_ledger int NOT NULL DEFAULT 0;

-- What was in the cart when the engine was asked. The first decision of a
-- visit happens before anything has been shown in either arm, so this is a
-- pre-treatment covariate for the holdout comparison.
ALTER TABLE public.recommendation_decisions
  ADD COLUMN IF NOT EXISTS cart_value numeric(10,2);

ALTER TABLE public.menu_item_affinity
  ADD COLUMN IF NOT EXISTS w_pair numeric,
  ADD COLUMN IF NOT EXISTS w_expected numeric,
  ADD COLUMN IF NOT EXISTS eb05 numeric,
  ADD COLUMN IF NOT EXISTS eb_mean numeric;

ALTER TABLE public.session_item_affinity
  ADD COLUMN IF NOT EXISTS w_pair numeric,
  ADD COLUMN IF NOT EXISTS w_expected numeric,
  ADD COLUMN IF NOT EXISTS eb05 numeric,
  ADD COLUMN IF NOT EXISTS eb_mean numeric;

COMMENT ON COLUMN public.menu_item_affinity.eb05 IS
  'Lower 5% bound of the shrunk pair strength (observed/expected, Gamma(1,1) '
  'prior, age-weighted baskets). Above 1 means the pair co-occurs more than '
  'chance even on a pessimistic reading. The ranker uses this, not lift.';

-- ---------------------------------------------------------------------
-- 1. Small, pure building blocks
-- ---------------------------------------------------------------------

/** Weight of a basket from `_at`: halves every `_half_life_days`. */
CREATE OR REPLACE FUNCTION public.basket_weight(
  _at timestamptz,
  _now timestamptz DEFAULT now(),
  _half_life_days numeric DEFAULT 45
)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT power(0.5::numeric,
               GREATEST(EXTRACT(EPOCH FROM (_now - _at)) / 86400.0, 0)::numeric
               / GREATEST(COALESCE(_half_life_days, 45), 1));
$$;

/**
 * EB05: lower 5% point of the posterior for observed/expected.
 *
 * λ ~ Gamma(n + α, E + β) with α = β = 1 (prior mean 1: "no association"
 * until shown otherwise). The quantile uses the Wilson–Hilferty cube-root
 * approximation, accurate to a percent or two at these shapes.
 */
CREATE OR REPLACE FUNCTION public.eb_lower05(
  _n numeric, _e numeric, _alpha numeric DEFAULT 1, _beta numeric DEFAULT 1
)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE WHEN _n IS NULL OR _e IS NULL THEN NULL ELSE
    round(
      ((GREATEST(_n, 0) + _alpha) / (GREATEST(_e, 0) + _beta))
      * power(GREATEST(1 - 1 / (9 * (GREATEST(_n, 0) + _alpha))
                         - 1.645 * sqrt(1 / (9 * (GREATEST(_n, 0) + _alpha))), 0), 3),
      4)
  END;
$$;

/** Posterior mean of observed/expected under the same prior. */
CREATE OR REPLACE FUNCTION public.eb_posterior_mean(
  _n numeric, _e numeric, _alpha numeric DEFAULT 1, _beta numeric DEFAULT 1
)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE WHEN _n IS NULL OR _e IS NULL THEN NULL
    ELSE round((GREATEST(_n, 0) + _alpha) / (GREATEST(_e, 0) + _beta), 4) END;
$$;

/** 0 at EB05 ≤ 1, 1 at EB05 ≥ 3, logarithmic in between. */
CREATE OR REPLACE FUNCTION public.pair_strength(_eb05 numeric)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE WHEN _eb05 IS NULL OR _eb05 <= 1 THEN 0
    ELSE round(LEAST(ln(_eb05) / ln(3::numeric), 1), 4) END;
$$;

/** Posterior mean of a Beta(α0 + accepted, β0 + shown − accepted). */
CREATE OR REPLACE FUNCTION public.smoothed_acceptance(
  _accepted int, _shown int, _alpha0 numeric, _beta0 numeric
)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT round(
    (COALESCE(_accepted, 0) + GREATEST(COALESCE(_alpha0, 1), 0.000001))::numeric
    / (COALESCE(_shown, 0) + GREATEST(COALESCE(_alpha0, 1), 0.000001)
                           + GREATEST(COALESCE(_beta0, 12), 0.000001))::numeric,
    4);
$$;

-- The old two-argument form keeps its Beta(1,12) meaning for every caller
-- that has no prior to give.
CREATE OR REPLACE FUNCTION public.smoothed_acceptance(_accepted int, _shown int)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT public.smoothed_acceptance(_accepted, _shown, 1::numeric, 12::numeric);
$$;

/** A seeded draw from the same posterior (Gaussian approximation). */
CREATE OR REPLACE FUNCTION public.sample_acceptance(
  _accepted int, _shown int, _seed text, _alpha0 numeric, _beta0 numeric
)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_alpha numeric := COALESCE(_accepted, 0) + GREATEST(COALESCE(_alpha0, 1), 0.000001);
  v_beta  numeric := GREATEST(COALESCE(_beta0, 12), 0.000001)
                     + GREATEST(COALESCE(_shown, 0) - COALESCE(_accepted, 0), 0);
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

CREATE OR REPLACE FUNCTION public.sample_acceptance(_accepted int, _shown int, _seed text)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT public.sample_acceptance(_accepted, _shown, _seed, 1::numeric, 12::numeric);
$$;

/** Mean + 1.645 sd of the posterior: an optimistic reading of the record. */
CREATE OR REPLACE FUNCTION public.acceptance_upper95(
  _accepted int, _shown int, _alpha0 numeric, _beta0 numeric
)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  WITH b AS (
    SELECT COALESCE(_accepted, 0) + GREATEST(COALESCE(_alpha0, 1), 0.000001) AS a,
           GREATEST(COALESCE(_beta0, 12), 0.000001)
             + GREATEST(COALESCE(_shown, 0) - COALESCE(_accepted, 0), 0) AS b
  )
  SELECT round(a / (a + b) + 1.645 * sqrt(a * b / ((a + b) * (a + b) * (a + b + 1))), 4) FROM b;
$$;

/**
 * Should this pair stop being offered?
 *
 * Only when even the optimistic end of its record is below the floor. "1 in
 * 60" at a dish that converts at 6% elsewhere is not retired; "0 in 150" is.
 * The caller also requires reco_retire_after_impressions sightings first.
 */
CREATE OR REPLACE FUNCTION public.acceptance_retired(
  _accepted int, _shown int, _alpha0 numeric, _beta0 numeric, _min_acceptance numeric
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT public.acceptance_upper95(_accepted, _shown, _alpha0, _beta0) < COALESCE(_min_acceptance, 0.03);
$$;

-- ---------------------------------------------------------------------
-- 2. R3 — priors that know what a dish does elsewhere
-- ---------------------------------------------------------------------

/**
 * One prior per (dish, placement), plus one per placement with no dish
 * (recommended_item_id NULL) for dishes never suggested there.
 *
 *   m_P  = (Σ accepted + 1) / (Σ shown + 13)                over the placement
 *   m_IP = (accepted_IP + 50·m_P) / (shown_IP + 50)          the dish, shrunk to m_P
 *   prior for any pair offering that dish: Beta(20·m_IP, 20·(1 − m_IP))
 *
 * Until refresh_suggestion_priors() first runs, every pair keeps the old
 * Beta(1, 12).
 */
CREATE TABLE IF NOT EXISTS public.suggestion_priors (
  recommended_item_id uuid REFERENCES public.menu_items(id) ON DELETE CASCADE,
  placement text NOT NULL,
  alpha0 numeric NOT NULL CHECK (alpha0 > 0),
  beta0 numeric NOT NULL CHECK (beta0 > 0),
  item_shown int NOT NULL DEFAULT 0,
  item_accepted int NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Access first, then row level security and the policies below (Supabase no
-- longer grants new tables to the API roles by default).
REVOKE ALL ON public.suggestion_priors FROM PUBLIC, anon;
GRANT SELECT ON public.suggestion_priors TO authenticated;
GRANT ALL ON public.suggestion_priors TO service_role;

CREATE UNIQUE INDEX IF NOT EXISTS suggestion_priors_key
  ON public.suggestion_priors (placement, COALESCE(recommended_item_id, '00000000-0000-0000-0000-000000000000'::uuid));

ALTER TABLE public.suggestion_priors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Staff read suggestion priors" ON public.suggestion_priors;
CREATE POLICY "Staff read suggestion priors" ON public.suggestion_priors
  FOR SELECT TO authenticated USING (public.is_staff_member());

/** The prior for a dish at a placement: its own, the placement's, or Beta(1,12). */
CREATE OR REPLACE FUNCTION public.suggestion_prior(_item_id uuid, _placement text)
RETURNS TABLE(alpha0 numeric, beta0 numeric, item_shown int)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT x.alpha0, x.beta0, x.item_shown
    FROM (
      SELECT sp.alpha0, sp.beta0, sp.item_shown, 0 AS pref
        FROM public.suggestion_priors sp
       WHERE sp.recommended_item_id = _item_id AND sp.placement = _placement
      UNION ALL
      SELECT sp.alpha0, sp.beta0, 0, 1
        FROM public.suggestion_priors sp
       WHERE sp.recommended_item_id IS NULL AND sp.placement = _placement
      UNION ALL
      SELECT 1::numeric, 12::numeric, 0, 2
    ) x
   ORDER BY x.pref
   LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.refresh_suggestion_priors()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows int := 0;
BEGIN
  IF NOT public.is_trusted_caller() THEN
    RAISE EXCEPTION 'Only staff can refresh menu intelligence' USING ERRCODE = 'insufficient_privilege';
  END IF;

  DELETE FROM public.suggestion_priors;

  WITH item AS (
    SELECT st.recommended_item_id, st.placement,
           sum(GREATEST(st.shown, 0))::int AS shown,
           -- Browser-era rows could hold more taps than sightings.
           sum(LEAST(GREATEST(st.accepted, 0), GREATEST(st.shown, 0)))::int AS accepted
      FROM public.suggestion_stats st
     WHERE st.daypart IS NULL AND st.recommended_item_id IS NOT NULL
     GROUP BY 1, 2
  ),
  base AS (
    SELECT placement, (sum(accepted) + 1)::numeric / (sum(shown) + 13) AS m_p
      FROM item GROUP BY placement
  ),
  ins AS (
    INSERT INTO public.suggestion_priors(recommended_item_id, placement, alpha0, beta0, item_shown, item_accepted)
    SELECT NULL::uuid, b.placement, round(20 * b.m_p, 6), round(20 * (1 - b.m_p), 6), 0, 0
      FROM base b
    UNION ALL
    SELECT i.recommended_item_id, i.placement,
           round(20 * ((i.accepted + 50 * b.m_p) / (i.shown + 50)), 6),
           round(20 * (1 - (i.accepted + 50 * b.m_p) / (i.shown + 50)), 6),
           i.shown, i.accepted
      FROM item i JOIN base b ON b.placement = i.placement
    RETURNING 1
  )
  SELECT count(*) INTO v_rows FROM ins;

  RETURN v_rows;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_suggestion_priors() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refresh_suggestion_priors() TO authenticated;
REVOKE ALL ON FUNCTION public.suggestion_prior(uuid, text) FROM PUBLIC, anon, authenticated;

/**
 * Acceptance for one pair, preferring this daypart's row where it exists.
 * Same signature and row preference as before; the prior is now the dish's.
 */
CREATE OR REPLACE FUNCTION public.daypart_acceptance(
  _item_id uuid, _placement text, _source_item_id uuid, _daypart text
)
RETURNS numeric
LANGUAGE sql
STABLE
AS $$
  WITH rows AS (
    SELECT st.daypart, st.accepted, st.shown
      FROM public.suggestion_stats st
     WHERE st.recommended_item_id = _item_id
       AND st.placement = _placement
       AND st.source_item_id IS NOT DISTINCT FROM _source_item_id
       AND (st.daypart = _daypart OR st.daypart IS NULL)
  ),
  pr AS (SELECT * FROM public.suggestion_prior(_item_id, _placement))
  SELECT public.smoothed_acceptance(
           COALESCE((SELECT accepted FROM rows WHERE daypart = _daypart), (SELECT accepted FROM rows WHERE daypart IS NULL), 0),
           COALESCE((SELECT shown FROM rows WHERE daypart = _daypart), (SELECT shown FROM rows WHERE daypart IS NULL), 0),
           pr.alpha0, pr.beta0)
    FROM pr;
$$;

/** The mean while sampling is off, a seeded posterior draw while it is on. */
CREATE OR REPLACE FUNCTION public.acceptance_for_ranking(
  _item_id uuid, _placement text, _source_item_id uuid, _daypart text, _seed text
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
  v_alpha0 numeric;
  v_beta0 numeric;
BEGIN
  SELECT COALESCE(reco_sampling_enabled, false) INTO v_sampling
    FROM public.restaurant_settings WHERE id = 1;

  IF NOT COALESCE(v_sampling, false) THEN
    RETURN public.daypart_acceptance(_item_id, _placement, _source_item_id, _daypart);
  END IF;

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

  SELECT pr.alpha0, pr.beta0 INTO v_alpha0, v_beta0
    FROM public.suggestion_prior(_item_id, _placement) pr;

  RETURN public.sample_acceptance(
    COALESCE(v_accepted, 0), COALESCE(v_shown, 0),
    _seed || ':' || _item_id::text || ':' || COALESCE(_daypart, ''),
    v_alpha0, v_beta0);
END;
$$;

REVOKE ALL ON FUNCTION public.acceptance_for_ranking(uuid, text, uuid, text, text) FROM PUBLIC, anon;

-- ---------------------------------------------------------------------
-- 3. R1 — learn from the ledger
-- ---------------------------------------------------------------------

/**
 * Rebuild suggestion_stats.
 *
 * From the first decision the ledger holds onwards:
 *   shown     a decision with a chosen dish that was seen — an impression row,
 *             or (proof enough) a dismissal or a paid line for it; once per
 *             decision however often the browser reported it
 *   accepted  that decision's dish on a suggestion_conversion whose order is
 *             a completed order — a tap that never became a sale is not one
 *   dismissed browser `suggestion_dismissed` events, joined by decision_id,
 *             for diagnostics only
 * keyed by (source dish, chosen dish, placement, daypart of the decision),
 * plus the all-day row.
 *
 * Before the first ledger row, the browser events are all there is, and they
 * are counted the old way.
 *
 * Revenue is attributed at the all-day level, as before.
 */
CREATE OR REPLACE FUNCTION public.refresh_suggestion_stats(_days int DEFAULT 90)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows int := 0;
  v_since timestamptz := now() - make_interval(days => GREATEST(COALESCE(_days, 90), 1));
  v_ledger_from timestamptz;
BEGIN
  IF NOT public.is_trusted_caller() THEN
    RAISE EXCEPTION 'Only staff can refresh menu intelligence' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT min(d.created_at) INTO v_ledger_from FROM public.recommendation_decisions d;

  DELETE FROM public.suggestion_stats;

  WITH paid AS (
    SELECT DISTINCT sc.decision_id, sc.recommended_item_id
      FROM public.suggestion_conversions sc
      JOIN public.completed_orders co ON co.id = sc.order_id
     WHERE sc.decision_id IS NOT NULL
  ),
  dismissals AS (
    SELECT DISTINCT public.analytics_uuid(e.props->>'decision_id') AS decision_id,
                    public.analytics_uuid(e.props->>'item_id') AS item_id
      FROM public.analytics_events e
     WHERE e.event = 'suggestion_dismissed'
       AND e.occurred_at > v_since
       AND public.analytics_uuid(e.props->>'decision_id') IS NOT NULL
  ),
  ledger AS (
    SELECT d.source_item_id,
           d.chosen_item_id AS recommended_item_id,
           CASE WHEN d.placement IN ('cart', 'after_meal', 'item') THEN d.placement ELSE 'cart' END AS placement,
           public.daypart_of(d.created_at) AS daypart,
           (pd.decision_id IS NOT NULL) AS was_paid,
           (ds.decision_id IS NOT NULL) AS was_dismissed,
           (i.decision_id IS NOT NULL) AS was_seen
      FROM public.recommendation_decisions d
      LEFT JOIN public.recommendation_impressions i ON i.decision_id = d.id
      LEFT JOIN paid pd ON pd.decision_id = d.id AND pd.recommended_item_id = d.chosen_item_id
      LEFT JOIN dismissals ds ON ds.decision_id = d.id AND ds.item_id = d.chosen_item_id
     WHERE d.created_at > v_since
       AND d.chosen_item_id IS NOT NULL
  ),
  browser AS (
    SELECT public.analytics_uuid(e.props->>'source_item_id') AS source_item_id,
           public.analytics_uuid(e.props->>'item_id')        AS recommended_item_id,
           COALESCE(e.props->>'placement', 'cart')           AS placement,
           public.daypart_of(e.occurred_at)                  AS daypart,
           e.event
      FROM public.analytics_events e
     WHERE e.event IN ('suggestion_shown', 'suggestion_accepted', 'suggestion_dismissed')
       AND e.occurred_at > v_since
       -- Superseded by the ledger from its first row on.
       AND (v_ledger_from IS NULL OR e.occurred_at < v_ledger_from)
       AND public.analytics_uuid(e.props->>'item_id') IS NOT NULL
  ),
  unified AS (
    SELECT source_item_id, recommended_item_id, placement, daypart,
           1 AS shown, was_paid::int AS accepted, was_dismissed::int AS dismissed, 1 AS shown_ledger
      FROM ledger
     WHERE was_seen OR was_paid OR was_dismissed
    UNION ALL
    SELECT source_item_id, recommended_item_id, placement, daypart,
           (event = 'suggestion_shown')::int,
           (event = 'suggestion_accepted')::int,
           (event = 'suggestion_dismissed')::int,
           0
      FROM browser
  ),
  -- Per daypart, and again with the daypart rolled up to NULL.
  counted AS (
    SELECT source_item_id, recommended_item_id, placement, daypart,
           sum(shown) AS shown, sum(accepted) AS accepted, sum(dismissed) AS dismissed,
           sum(shown_ledger) AS shown_ledger
      FROM unified
     GROUP BY 1, 2, 3, 4
    UNION ALL
    SELECT source_item_id, recommended_item_id, placement, NULL::text,
           sum(shown), sum(accepted), sum(dismissed), sum(shown_ledger)
      FROM unified
     GROUP BY 1, 2, 3
  ),
  money AS (
    SELECT sc.source_item_id, sc.recommended_item_id, sc.placement,
           sum(sc.line_total)  AS revenue,
           count(DISTINCT sc.order_id) AS orders
      FROM public.suggestion_conversions sc
      JOIN public.completed_orders co ON co.id = sc.order_id
     WHERE sc.created_at > v_since
     GROUP BY 1, 2, 3
  ),
  merged AS (
    SELECT
      COALESCE(c.source_item_id, m.source_item_id)           AS source_item_id,
      COALESCE(c.recommended_item_id, m.recommended_item_id) AS recommended_item_id,
      COALESCE(c.placement, m.placement)                     AS placement,
      c.daypart                                              AS daypart,
      COALESCE(c.shown, 0)::int         AS shown,
      COALESCE(c.accepted, 0)::int      AS accepted,
      COALESCE(c.dismissed, 0)::int     AS dismissed,
      COALESCE(c.shown_ledger, 0)::int  AS shown_ledger,
      CASE WHEN c.daypart IS NULL THEN COALESCE(m.revenue, 0) ELSE 0 END::numeric AS revenue,
      CASE WHEN c.daypart IS NULL THEN COALESCE(m.orders, 0) ELSE 0 END::int      AS orders
    FROM counted c
    FULL OUTER JOIN money m
      ON m.recommended_item_id = c.recommended_item_id
     AND m.placement = c.placement
     AND m.source_item_id IS NOT DISTINCT FROM c.source_item_id
     AND c.daypart IS NULL
  )
  INSERT INTO public.suggestion_stats(
    source_item_id, recommended_item_id, placement, daypart,
    shown, accepted, dismissed, shown_ledger, attributed_revenue, attributed_orders, updated_at)
  SELECT source_item_id, recommended_item_id, placement, daypart,
         shown, accepted, dismissed, shown_ledger, revenue, orders, now()
    FROM merged
   WHERE recommended_item_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.menu_items mi WHERE mi.id = merged.recommended_item_id);

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  PERFORM public.refresh_suggestion_priors();

  RETURN v_rows;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_suggestion_stats(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refresh_suggestion_stats(int) TO authenticated;

/**
 * The gate, with one more check: the counts it would hand a bandit come from
 * the server ledger, not from browser events.
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
  v_stats_shown bigint;
  v_stats_ledger bigint;
  v_sampling boolean;
  v_min_decisions constant int := 2000;
  v_min_pairs constant int := 15;
  v_checks jsonb;
BEGIN
  -- Trusted rather than staff-only: maybe_enable_sampling() calls this from
  -- the nightly job.
  IF NOT public.is_trusted_caller() THEN
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

  SELECT COALESCE(sum(st.shown), 0), COALESCE(sum(st.shown_ledger), 0)
    INTO v_stats_shown, v_stats_ledger
    FROM public.suggestion_stats st
   WHERE st.daypart IS NULL;

  v_checks := jsonb_build_array(
    jsonb_build_object(
      'check', 'impressions_are_server_verified', 'pass', true,
      'note', 'recommendation_impressions is written server-side and deduped by primary key'),
    jsonb_build_object(
      'check', 'acceptance_linked_to_paid_outcome', 'pass', true,
      'note', 'suggestion_conversions.decision_id joins to completed_orders'),
    jsonb_build_object(
      'check', 'stats_learn_from_ledger',
      'pass', v_stats_shown > 0 AND v_stats_ledger >= 0.9 * v_stats_shown,
      'have', v_stats_ledger, 'of', v_stats_shown,
      'note', format('%s of %s counted sightings in suggestion_stats come from the server ledger; '
                     'browser-era rows age out of the 90-day window', v_stats_ledger, v_stats_shown)),
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

-- ---------------------------------------------------------------------
-- 4. R2 — shrunk, age-weighted pair strength, and its section fallback
-- ---------------------------------------------------------------------

/** Section-to-section strength, from the same baskets as dish pairs. */
CREATE TABLE IF NOT EXISTS public.subcategory_affinity (
  sub_a uuid NOT NULL REFERENCES public.subcategories(id) ON DELETE CASCADE,
  sub_b uuid NOT NULL REFERENCES public.subcategories(id) ON DELETE CASCADE,
  pair_orders int NOT NULL,
  a_orders int NOT NULL,
  w_pair numeric NOT NULL,
  w_expected numeric NOT NULL,
  eb05 numeric NOT NULL,
  eb_mean numeric NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (sub_a, sub_b)
);

-- Access first, then row level security and the policies below (Supabase no
-- longer grants new tables to the API roles by default).
REVOKE ALL ON public.subcategory_affinity FROM PUBLIC, anon;
GRANT SELECT ON public.subcategory_affinity TO authenticated;
GRANT ALL ON public.subcategory_affinity TO service_role;

/**
 * A dish's share of its section's orders, per daypart, shrunk to all day:
 *   share = (n_dish,dp + 5·s_dish) / (n_section,dp + 5)
 * The row with daypart NULL is the all-day share s_dish.
 */
CREATE TABLE IF NOT EXISTS public.item_section_share (
  item_id uuid NOT NULL REFERENCES public.menu_items(id) ON DELETE CASCADE,
  subcategory_id uuid NOT NULL REFERENCES public.subcategories(id) ON DELETE CASCADE,
  daypart text,
  share numeric NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now()
);

-- Access first, then row level security and the policies below (Supabase no
-- longer grants new tables to the API roles by default).
REVOKE ALL ON public.item_section_share FROM PUBLIC, anon;
GRANT SELECT ON public.item_section_share TO authenticated;
GRANT ALL ON public.item_section_share TO service_role;

CREATE UNIQUE INDEX IF NOT EXISTS item_section_share_key
  ON public.item_section_share (item_id, COALESCE(daypart, '*'));
CREATE INDEX IF NOT EXISTS item_section_share_section
  ON public.item_section_share (subcategory_id, daypart);

ALTER TABLE public.subcategory_affinity ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.item_section_share ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Staff read section affinity" ON public.subcategory_affinity;
CREATE POLICY "Staff read section affinity" ON public.subcategory_affinity
  FOR SELECT TO authenticated USING (public.is_staff_member());
DROP POLICY IF EXISTS "Staff read section share" ON public.item_section_share;
CREATE POLICY "Staff read section share" ON public.item_section_share
  FOR SELECT TO authenticated USING (public.is_staff_member());

/**
 * Dish pairs within one order (the cart's question), plus the section pairs
 * and section shares the ranker falls back on.
 *
 * Every basket counts with weight 0.5^(age in days / 45). `_days` is now only
 * a horizon past which a basket weighs too little to be worth reading (the
 * nightly job passes 365: weight 0.004). `_min_pair_orders` is a raw count.
 *
 *   N = Σw, n_a, n_b, n_ab weighted; E_ab = n_a·n_b / N
 *   eb05 = 5th percentile of Gamma(n_ab + 1, E_ab + 1)
 *
 * pair_orders, a_orders, confidence and lift keep their old meaning — raw
 * counts over the last 90 days — because management screens quote them as
 * such. Only eb05 and eb_mean (and the w_ columns) use the weighted counts.
 */
CREATE OR REPLACE FUNCTION public.refresh_menu_affinity(_days int DEFAULT 90, _min_pair_orders int DEFAULT 3)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows int := 0;
  v_total_orders int;
  v_recent_orders int;
  v_n numeric;
BEGIN
  IF NOT public.is_trusted_caller() THEN
    RAISE EXCEPTION 'Only staff can refresh menu intelligence' USING ERRCODE = 'insufficient_privilege';
  END IF;

  DROP TABLE IF EXISTS pg_temp._basket, pg_temp._item_counts, pg_temp._sbasket, pg_temp._sub_counts;

  CREATE TEMP TABLE _basket ON COMMIT DROP AS
    SELECT co.id AS order_id,
           oi.menu_item_id AS item_id,
           mi.subcategory_id,
           public.daypart_of(co.created_at) AS daypart,
           public.basket_weight(co.created_at, now(), 45) AS w,
           co.created_at > now() - interval '90 days' AS recent
      FROM public.completed_orders co
      JOIN public.order_items oi ON oi.order_id = co.id
      JOIN public.menu_items mi ON mi.id = oi.menu_item_id
     WHERE co.created_at > now() - make_interval(days => GREATEST(COALESCE(_days, 90), 1))
     GROUP BY co.id, co.created_at, oi.menu_item_id, mi.subcategory_id;

  SELECT count(DISTINCT order_id) INTO v_total_orders FROM _basket;
  IF COALESCE(v_total_orders, 0) < 5 THEN
    -- Not enough history to say anything honest yet.
    RETURN 0;
  END IF;

  SELECT sum(w) INTO v_n FROM (SELECT max(w) AS w FROM _basket GROUP BY order_id) o;
  SELECT count(DISTINCT order_id) INTO v_recent_orders FROM _basket WHERE recent;

  CREATE TEMP TABLE _item_counts ON COMMIT DROP AS
    SELECT item_id, count(*) FILTER (WHERE recent)::int AS orders, sum(w) AS w
      FROM _basket GROUP BY item_id;

  DELETE FROM public.menu_item_affinity;

  INSERT INTO public.menu_item_affinity(
    item_a, item_b, pair_orders, a_orders, confidence, lift,
    w_pair, w_expected, eb05, eb_mean, computed_at)
  SELECT p.item_a,
         p.item_b,
         p.pair_orders,
         ca.orders,
         COALESCE(round(p.pair_orders::numeric / NULLIF(ca.orders, 0), 4), 0),
         COALESCE(round((p.pair_orders::numeric / NULLIF(ca.orders, 0))
                        / NULLIF(cb.orders::numeric / NULLIF(v_recent_orders, 0), 0), 4), 0),
         round(p.w_pair, 4),
         round(ca.w * cb.w / v_n, 4),
         public.eb_lower05(p.w_pair, ca.w * cb.w / v_n),
         public.eb_posterior_mean(p.w_pair, ca.w * cb.w / v_n),
         now()
    FROM (
      SELECT b1.item_id AS item_a, b2.item_id AS item_b,
             count(*) FILTER (WHERE b1.recent)::int AS pair_orders, sum(b1.w) AS w_pair
        FROM _basket b1
        JOIN _basket b2 ON b2.order_id = b1.order_id AND b2.item_id <> b1.item_id
       GROUP BY b1.item_id, b2.item_id
      HAVING count(*) >= GREATEST(COALESCE(_min_pair_orders, 3), 1)
    ) p
    JOIN _item_counts ca ON ca.item_id = p.item_a
    JOIN _item_counts cb ON cb.item_id = p.item_b;

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  -- The same computation one level up: sections, one basket each per order.
  CREATE TEMP TABLE _sbasket ON COMMIT DROP AS
    SELECT order_id, subcategory_id, max(w) AS w
      FROM _basket WHERE subcategory_id IS NOT NULL
     GROUP BY order_id, subcategory_id;

  CREATE TEMP TABLE _sub_counts ON COMMIT DROP AS
    SELECT subcategory_id, count(*)::int AS orders, sum(w) AS w FROM _sbasket GROUP BY subcategory_id;

  DELETE FROM public.subcategory_affinity;

  INSERT INTO public.subcategory_affinity(
    sub_a, sub_b, pair_orders, a_orders, w_pair, w_expected, eb05, eb_mean, computed_at)
  SELECT p.sub_a, p.sub_b, p.pair_orders, ca.orders,
         round(p.w_pair, 4),
         round(ca.w * cb.w / v_n, 4),
         public.eb_lower05(p.w_pair, ca.w * cb.w / v_n),
         public.eb_posterior_mean(p.w_pair, ca.w * cb.w / v_n),
         now()
    FROM (
      SELECT s1.subcategory_id AS sub_a, s2.subcategory_id AS sub_b,
             count(*)::int AS pair_orders, sum(s1.w) AS w_pair
        FROM _sbasket s1
        JOIN _sbasket s2 ON s2.order_id = s1.order_id AND s2.subcategory_id <> s1.subcategory_id
       GROUP BY s1.subcategory_id, s2.subcategory_id
      HAVING count(*) >= GREATEST(COALESCE(_min_pair_orders, 3), 1)
    ) p
    JOIN _sub_counts ca ON ca.subcategory_id = p.sub_a
    JOIN _sub_counts cb ON cb.subcategory_id = p.sub_b;

  -- Which dish of a section to offer, by daypart.
  DELETE FROM public.item_section_share;

  WITH dayparts(dp) AS (VALUES ('morning'), ('lunch'), ('afternoon'), ('evening'), ('late')),
  item_all AS (
    SELECT item_id, subcategory_id, sum(w) AS n FROM _basket
     WHERE subcategory_id IS NOT NULL GROUP BY item_id, subcategory_id
  ),
  item_dp AS (
    SELECT item_id, daypart, sum(w) AS n FROM _basket
     WHERE subcategory_id IS NOT NULL GROUP BY item_id, daypart
  ),
  sub_all AS (SELECT subcategory_id, sum(n) AS n FROM item_all GROUP BY subcategory_id),
  sub_dp AS (
    SELECT subcategory_id, daypart, sum(w) AS n FROM _basket
     WHERE subcategory_id IS NOT NULL GROUP BY subcategory_id, daypart
  ),
  base AS (
    SELECT ia.item_id, ia.subcategory_id, ia.n / NULLIF(sa.n, 0) AS s_all
      FROM item_all ia JOIN sub_all sa ON sa.subcategory_id = ia.subcategory_id
  )
  INSERT INTO public.item_section_share(item_id, subcategory_id, daypart, share, computed_at)
  SELECT b.item_id, b.subcategory_id, NULL, round(COALESCE(b.s_all, 0), 6), now()
    FROM base b
  UNION ALL
  SELECT b.item_id, b.subcategory_id, d.dp,
         round((COALESCE(idp.n, 0) + 5 * COALESCE(b.s_all, 0)) / (COALESCE(sdp.n, 0) + 5), 6),
         now()
    FROM base b
    CROSS JOIN dayparts d
    LEFT JOIN item_dp idp ON idp.item_id = b.item_id AND idp.daypart = d.dp
    LEFT JOIN sub_dp sdp ON sdp.subcategory_id = b.subcategory_id AND sdp.daypart = d.dp;

  RETURN v_rows;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_menu_affinity(int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refresh_menu_affinity(int, int) TO authenticated;

/**
 * Dish pairs across a whole visit (the after-meal question). Same weighting
 * and shrinkage as refresh_menu_affinity, with the visit's first order as its
 * date. pair_sessions, a_sessions, confidence, lift and confidence_low stay
 * raw counts over the last 90 days: they are what social proof may quote.
 */
CREATE OR REPLACE FUNCTION public.refresh_session_affinity(_days int DEFAULT 90, _min_pair_sessions int DEFAULT 3)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows int := 0;
  v_total int;
  v_recent int;
  v_n numeric;
BEGIN
  IF NOT public.is_trusted_caller() THEN
    RAISE EXCEPTION 'Only staff can refresh menu intelligence' USING ERRCODE = 'insufficient_privilege';
  END IF;

  DROP TABLE IF EXISTS pg_temp._vbasket, pg_temp._vcounts;

  -- One basket per VISIT, not per round.
  CREATE TEMP TABLE _vbasket ON COMMIT DROP AS
    WITH lines AS (
      SELECT co.table_session_id AS session_id, oi.menu_item_id AS item_id, co.created_at
        FROM public.completed_orders co
        JOIN public.order_items oi ON oi.order_id = co.id
       WHERE co.created_at > now() - make_interval(days => GREATEST(COALESCE(_days, 90), 1))
         AND co.table_session_id IS NOT NULL
    ),
    visit AS (
      SELECT session_id, public.basket_weight(min(created_at), now(), 45) AS w,
             min(created_at) > now() - interval '90 days' AS recent
        FROM lines GROUP BY session_id
    )
    SELECT DISTINCT l.session_id, l.item_id, v.w, v.recent
      FROM lines l JOIN visit v ON v.session_id = l.session_id;

  SELECT count(DISTINCT session_id) INTO v_total FROM _vbasket;
  IF COALESCE(v_total, 0) < 5 THEN
    RETURN 0;   -- not enough history to say anything honest
  END IF;

  SELECT sum(w) INTO v_n FROM (SELECT max(w) AS w FROM _vbasket GROUP BY session_id) s;
  SELECT count(DISTINCT session_id) INTO v_recent FROM _vbasket WHERE recent;

  CREATE TEMP TABLE _vcounts ON COMMIT DROP AS
    SELECT item_id, count(*) FILTER (WHERE recent)::int AS sessions, sum(w) AS w
      FROM _vbasket GROUP BY item_id;

  DELETE FROM public.session_item_affinity;

  INSERT INTO public.session_item_affinity(
    item_a, item_b, pair_sessions, a_sessions, confidence, lift, confidence_low,
    w_pair, w_expected, eb05, eb_mean, computed_at)
  SELECT p.item_a,
         p.item_b,
         p.pair_sessions,
         ca.sessions,
         COALESCE(round(p.pair_sessions::numeric / NULLIF(ca.sessions, 0), 4), 0),
         COALESCE(round((p.pair_sessions::numeric / NULLIF(ca.sessions, 0))
                        / NULLIF(cb.sessions::numeric / NULLIF(v_recent, 0), 0), 4), 0),
         public.wilson_lower(p.pair_sessions, ca.sessions),
         round(p.w_pair, 4),
         round(ca.w * cb.w / v_n, 4),
         public.eb_lower05(p.w_pair, ca.w * cb.w / v_n),
         public.eb_posterior_mean(p.w_pair, ca.w * cb.w / v_n),
         now()
    FROM (
      SELECT b1.item_id AS item_a, b2.item_id AS item_b,
             count(*) FILTER (WHERE b1.recent)::int AS pair_sessions, sum(b1.w) AS w_pair
        FROM _vbasket b1
        JOIN _vbasket b2 ON b2.session_id = b1.session_id AND b2.item_id <> b1.item_id
       GROUP BY b1.item_id, b2.item_id
      HAVING count(*) >= GREATEST(COALESCE(_min_pair_sessions, 3), 1)
    ) p
    JOIN _vcounts ca ON ca.item_id = p.item_a
    JOIN _vcounts cb ON cb.item_id = p.item_b;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_session_affinity(int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refresh_session_affinity(int, int) TO authenticated;

/**
 * The nightly refresh. Baskets now fade rather than drop off, so the horizon
 * is a year; with shrinkage doing the sceptical work, two co-occurrences are
 * enough to be stored (a pair still needs EB05 > 1 to be used).
 */
CREATE OR REPLACE FUNCTION public.refresh_menu_intelligence()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pairs int;
  v_session_pairs int;
  v_stats int;
BEGIN
  IF NOT public.is_trusted_caller() THEN
    RAISE EXCEPTION 'Only staff can refresh menu intelligence' USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_pairs := public.refresh_menu_affinity(365, 2);
  v_session_pairs := public.refresh_session_affinity(365, 2);
  v_stats := public.refresh_suggestion_stats(90);

  RETURN jsonb_build_object(
    'pairs', v_pairs,
    'session_pairs', v_session_pairs,
    'section_pairs', (SELECT count(*) FROM public.subcategory_affinity WHERE eb05 > 1),
    'suggestion_rows', v_stats,
    'refreshed_at', now());
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_menu_intelligence() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refresh_menu_intelligence() TO authenticated;

/**
 * Popular, by the daypart: what sells now, shrunk to what sells all day.
 *   share = (qty_dp + 5·qty / Σqty) / (Σqty_dp + 5)
 * Same rule as get_popular_items for what counts at all: completed orders,
 * three separate orders minimum.
 */
CREATE OR REPLACE FUNCTION public.popular_items_for_daypart(
  _daypart text, _limit int DEFAULT 12, _days int DEFAULT 45
)
RETURNS TABLE(menu_item_id uuid, qty bigint, share numeric, relative numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH lines AS (
    SELECT oi.menu_item_id, o.id AS order_id, oi.quantity, public.daypart_of(o.created_at) AS dp
      FROM public.completed_orders o
      JOIN public.order_items oi ON oi.order_id = o.id
     WHERE o.created_at > now() - make_interval(days => GREATEST(COALESCE(_days, 45), 1))
  ),
  per_item AS (
    SELECT l.menu_item_id,
           sum(l.quantity)::bigint AS qty,
           count(DISTINCT l.order_id) AS orders,
           COALESCE(sum(l.quantity) FILTER (WHERE l.dp = _daypart), 0)::numeric AS qty_dp
      FROM lines l
     GROUP BY l.menu_item_id
  ),
  totals AS (SELECT sum(qty)::numeric AS q_all, sum(qty_dp) AS q_dp FROM per_item),
  scored AS (
    SELECT pi.menu_item_id, pi.qty,
           (pi.qty_dp + 5 * pi.qty / NULLIF(t.q_all, 0)) / (t.q_dp + 5) AS share
      FROM per_item pi CROSS JOIN totals t
     WHERE pi.orders >= 3
  )
  SELECT s.menu_item_id, s.qty, round(s.share, 6),
         round(s.share / NULLIF(max(s.share) OVER (), 0), 6)
    FROM scored s
   ORDER BY s.share DESC, s.qty DESC, s.menu_item_id
   LIMIT LEAST(GREATEST(COALESCE(_limit, 12), 1), 50);
$$;

REVOKE ALL ON FUNCTION public.popular_items_for_daypart(text, int, int) FROM PUBLIC, anon;

/** Discovered pairings for management, by shrunk strength. Same columns. */
CREATE OR REPLACE FUNCTION public.menu_pairings(_limit int DEFAULT 30)
RETURNS TABLE(item_a uuid, name_a text, item_b uuid, name_b text, pair_orders int,
              confidence numeric, lift numeric, already_curated boolean)
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
   -- Better than chance even on a pessimistic reading, not merely lift > 1.
   WHERE a.eb05 > 1
     -- One direction per pair, so the table is not a mirror of itself.
     AND a.item_a < a.item_b
   ORDER BY a.eb05 DESC, a.pair_orders DESC
   LIMIT LEAST(GREATEST(COALESCE(_limit, 30), 1), 100);
END;
$$;

/** What may honestly be said on the card about a pair. */
CREATE OR REPLACE FUNCTION public.suggestion_evidence(_source_item_id uuid, _recommended_item_id uuid)
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

  -- No claim unless the pair beats chance on a pessimistic reading.
  IF NOT FOUND OR COALESCE(v_row.eb05, 0) <= 1 THEN
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

-- ---------------------------------------------------------------------
-- 5. R5 — coursing, with the alcohol rule first
-- ---------------------------------------------------------------------

/*
 * Signature gains `_no_alcohol`, so the old one is dropped first (two
 * overloads differing by a defaulted argument would make every call
 * ambiguous). Nothing else calls it but the ranker, restated below.
 */
DROP FUNCTION IF EXISTS public.reco_role_fits(public.meal_role, text, text, boolean, uuid[], uuid, timestamptz);

/**
 * Does a candidate of this role belong in this moment?
 *
 * Alcohol first, and for curated pairs too — the owner's "a mojito with a
 * burger" was written for the evening, not for 10:00:
 *   * never before reco_alcohol_from (Sarajevo time; the small hours before
 *     05:00 still belong to the previous evening);
 *   * never to a table with a kids' dish in the cart or already ordered;
 *   * never when the guest's own filter excludes it (`_no_alcohol`: halal or
 *     alcohol-free switched on). Never inferred from the language the menu
 *     is read in.
 *
 * Then, unchanged: a curated pair chooses its moment but never duplicates a
 * course; after the meal, dessert or a hot drink (a cold drink only to a
 * table that has had none); otherwise a drink only without one in the cart,
 * cold with a main except before 11:00, alcohol and unclassified items only
 * on observed evidence, sides and starters only with a main, never a second
 * main, never a dessert.
 */
CREATE OR REPLACE FUNCTION public.reco_role_fits(
  _candidate_role public.meal_role,
  _placement text,
  _rtype text,
  _is_curated boolean,
  _cart uuid[],
  _session_id uuid,
  _at timestamptz DEFAULT now(),
  _no_alcohol boolean DEFAULT false
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_evidence boolean := COALESCE(_rtype IN ('observed', 'frequently_bought_together'), false);
  v_cart_main boolean;
  v_cart_starter boolean;
  v_cart_drink boolean;
  v_cart_dessert boolean;
  v_visit_drink boolean;
  v_morning boolean;
  v_alcohol_from time;
  v_local time := (COALESCE(_at, now()) AT TIME ZONE 'Europe/Sarajevo')::time;
BEGIN
  IF _candidate_role = 'alcohol' THEN
    IF COALESCE(_no_alcohol, false) THEN
      RETURN false;
    END IF;

    SELECT s.reco_alcohol_from INTO v_alcohol_from
      FROM public.restaurant_settings s WHERE s.id = 1;
    IF v_local >= time '05:00' AND v_local < COALESCE(v_alcohol_from, time '12:00') THEN
      RETURN false;
    END IF;

    IF EXISTS (
      SELECT 1
        FROM public.menu_items mi
        JOIN public.subcategories ks ON ks.id = mi.subcategory_id
       WHERE ks.name ~* '(kid|djec|dječ|dijete|child)'
         AND (mi.id = ANY(COALESCE(_cart, '{}'::uuid[]))
              OR EXISTS (
                SELECT 1 FROM public.order_items oi
                  JOIN public.orders o ON o.id = oi.order_id
                 WHERE o.table_session_id = _session_id
                   AND oi.menu_item_id = mi.id
                   AND o.status NOT IN ('cancelled', 'awaiting_payment', 'payment_failed')))
    ) THEN
      RETURN false;
    END IF;
  END IF;

  SELECT COALESCE(bool_or(mi.meal_role = 'main'), false),
         COALESCE(bool_or(mi.meal_role = 'starter'), false),
         -- An unclassified bar item still counts as a drink: the cart should
         -- not be offered a cola because someone forgot to tag the lemonade.
         COALESCE(bool_or(public.role_is_drink(mi.meal_role)
                          OR (mi.meal_role IS NULL AND mi.station = 'bar')), false),
         COALESCE(bool_or(mi.meal_role = 'dessert'), false)
    INTO v_cart_main, v_cart_starter, v_cart_drink, v_cart_dessert
    FROM public.menu_items mi
   WHERE mi.id = ANY(COALESCE(_cart, '{}'::uuid[]));

  IF COALESCE(_is_curated, false) THEN
    -- The owner chose the pairing, so the moment is theirs to decide. A second
    -- serving of the same course is never what they meant. (COALESCE: a
    -- curated dish with no role used to come out NULL here next to a main,
    -- which the ranker reads as "does not fit".)
    RETURN NOT (
         COALESCE(public.role_is_drink(_candidate_role) AND v_cart_drink, false)
      OR COALESCE(_candidate_role = 'main' AND v_cart_main, false)
      OR COALESCE(_candidate_role = 'dessert' AND v_cart_dessert, false)
    );
  END IF;

  IF _placement = 'after_meal' THEN
    IF _candidate_role IN ('dessert', 'hot_drink') THEN
      RETURN true;
    END IF;
    IF _candidate_role = 'cold_drink' THEN
      SELECT EXISTS (
        SELECT 1
          FROM public.order_items oi
          JOIN public.orders o ON o.id = oi.order_id
          JOIN public.menu_items mi ON mi.id = oi.menu_item_id
         WHERE o.table_session_id = _session_id
           AND o.status NOT IN ('cancelled', 'awaiting_payment', 'payment_failed')
           AND (public.role_is_drink(mi.meal_role) OR (mi.meal_role IS NULL AND mi.station = 'bar'))
      ) OR v_cart_drink INTO v_visit_drink;
      RETURN NOT v_visit_drink;
    END IF;
    RETURN false;
  END IF;

  IF _candidate_role IS NULL THEN
    RETURN v_evidence;
  END IF;

  v_morning := EXTRACT(HOUR FROM (COALESCE(_at, now()) AT TIME ZONE 'Europe/Sarajevo')) < 11;

  RETURN CASE _candidate_role
    WHEN 'hot_drink'  THEN NOT v_cart_drink AND (NOT (v_cart_main OR v_cart_starter) OR v_morning)
    WHEN 'cold_drink' THEN NOT v_cart_drink
    WHEN 'alcohol'    THEN NOT v_cart_drink AND v_evidence
    WHEN 'side'       THEN v_cart_main
    WHEN 'starter'    THEN v_cart_main
    WHEN 'main'       THEN NOT (v_cart_main OR v_cart_starter)
    WHEN 'dessert'    THEN false
    ELSE false
  END;
END;
$$;

-- Reads what a table has ordered; reached only through the ranker, which is
-- itself behind the token-checked wrapper.
REVOKE ALL ON FUNCTION public.reco_role_fits(public.meal_role, text, text, boolean, uuid[], uuid, timestamptz, boolean)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------
-- 6. R4 — the ranker
-- ---------------------------------------------------------------------

/**
 * Rank suggestions for a cart, a dish page or the after-meal moment.
 *
 * Candidates: curated pairs (a section rule names the cart dish it matched),
 * observed dish pairs (EB05 > 1), observed section pairs offered as the dish
 * that sells best in this daypart, basket completion (a drink for a cart
 * without one), and daypart-aware popularity.
 *
 * Score:
 *     w_curated  · curated priority
 *   + w_observed · pair strength
 *   + w_value    · P(accept)·margin / best P(accept)·margin on the shortlist
 *   + margin_score nudge (±0.05)
 *   + exploration − kitchen load − inferred diet − price proportionality
 *   − 0.15 per time this visit saw the dish suggested and passed
 *
 * w_value is the old "learned" and "profitability" weights together. The
 * margin in the value term is the dish's own in proportion to how much of its
 * acceptance estimate is evidence rather than prior; the rest is the
 * shortlist's average. With no evidence every candidate has the same P(accept)
 * and "expected profit" would only mean "most expensive", which is exactly
 * what the price rule exists to prevent.
 *
 * Guardrails, which no score can buy past: the master switch; the holdout;
 * availability and serving hours; nothing in the cart; repeat rules; not the
 * cart's own section (unless an upgrade, add-on or after-meal); retirement;
 * explicit allergen filters; coursing and the alcohol rule; kids' dishes only
 * when curated. The guest's diet tags and dismissals are applied by
 * guest_get_recommendations, which also records the decision.
 */
CREATE OR REPLACE FUNCTION public.rank_recommendations(
  _cart_item_ids uuid[] DEFAULT '{}'::uuid[],
  _placement text DEFAULT 'cart',
  _language text DEFAULT 'en',
  _limit int DEFAULT 4,
  _session_id uuid DEFAULT NULL,
  _exclude_allergens text[] DEFAULT '{}'::text[]
)
RETURNS TABLE(id uuid, name text, name_bs text, name_ar text, price numeric, image_url text,
              dietary_tags text[], recommendation_type text, reason text, source_item_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH s AS (
    SELECT
      COALESCE(recommendations_enabled, true) AS enabled,
      COALESCE(reco_weight_curated, 40)::numeric  / 100 AS w_curated,
      COALESCE(reco_weight_observed, 25)::numeric / 100 AS w_observed,
      (COALESCE(reco_weight_learned, 25) + COALESCE(reco_weight_margin, 10))::numeric / 100 AS w_value,
      COALESCE(reco_exploration, 15)::numeric     / 100 AS w_explore,
      COALESCE(reco_min_acceptance, 0.03)               AS min_acceptance,
      COALESCE(reco_retire_after_impressions, 60)       AS retire_after
    FROM public.restaurant_settings WHERE id = 1
  ),
  p AS (
    SELECT
      LEAST(GREATEST(COALESCE(_limit, 4), 1), 8) AS lim,
      COALESCE(_cart_item_ids, '{}'::uuid[])     AS cart,
      CASE WHEN _placement IN ('cart', 'after_meal', 'item') THEN _placement ELSE 'cart' END AS placement,
      CASE WHEN _language IN ('en', 'bs', 'ar') THEN _language ELSE 'en' END AS lang,
      (now() AT TIME ZONE 'Europe/Sarajevo')::time AS now_time,
      public.daypart_of(now()) AS daypart,
      COALESCE(_session_id::text, 'anon') AS seed,
      public.guest_in_reco_holdout(_session_id) AS held_out,
      public.cart_diet(_cart_item_ids) AS diet,
      COALESCE(_exclude_allergens, '{}'::text[]) AS blocked_allergens,
      -- The wrapper adds 'alcohol' when the guest's diet filter excludes it.
      'alcohol' = ANY(COALESCE(_exclude_allergens, '{}'::text[])) AS no_alcohol,
      public.cart_has_drink(_cart_item_ids) AS has_drink,
      sc.ordered_item_ids,
      sc.served_item_ids,
      sc.minutes_since_served,
      -- The average line price includes what is in the cart right now, so the
      -- price check runs from the first round.
      (SELECT round((COALESCE(sc.running_total, 0) + COALESCE(sum(cm.price), 0))
                    / NULLIF(COALESCE(sc.line_count, 0) + count(cm.id), 0), 2)
         FROM public.menu_items cm
        WHERE cm.id = ANY(COALESCE(_cart_item_ids, '{}'::uuid[]))) AS avg_line_price,
      -- Cart plus what the table already ordered: at the after-meal moment
      -- the cart is empty and this is all there is to pair against.
      (COALESCE(_cart_item_ids, '{}'::uuid[]) || COALESCE(sc.ordered_item_ids, '{}'::uuid[])) AS context
    FROM public.session_context(_session_id) sc
  ),
  -- How overloaded the kitchen is right now. Biases AWAY from slow dishes
  -- under load; never hides anything.
  load AS (
    SELECT COALESCE(max(kl.load_factor), 0) AS factor
      FROM public.kitchen_load() kl
     WHERE kl.station = 'kitchen'
  ),
  cart_subcategories AS (
    SELECT DISTINCT mi.subcategory_id
      FROM public.menu_items mi, p
     WHERE mi.id = ANY(p.cart)
  ),
  curated AS (
    SELECT r.recommended_item_id AS item_id,
           -- house pairing source: a section rule names the cart dish it matched
           COALESCE(r.source_item_id,
                    (SELECT ci.id FROM public.menu_items ci
                      WHERE ci.id = ANY(p.cart) AND ci.subcategory_id = r.source_subcategory_id
                      ORDER BY ci.price DESC, ci.id LIMIT 1)) AS source_item_id,
           r.recommendation_type AS rtype,
           max(r.priority)::numeric / 100 AS curated_score
      FROM public.menu_item_recommendations r, p
     WHERE r.enabled
       AND (r.language IS NULL OR r.language = p.lang)
       AND (r.start_time IS NULL OR p.now_time >= r.start_time)
       AND (r.end_time IS NULL OR p.now_time <= r.end_time)
       -- `alternative` is for the substitution path only.
       AND r.recommendation_type <> 'alternative'
       AND (
         (p.placement = 'after_meal' AND r.recommendation_type = 'after_meal')
         OR (p.placement <> 'after_meal' AND r.recommendation_type <> 'after_meal'
             AND (r.source_item_id = ANY(p.context)
                  OR r.source_subcategory_id IN (SELECT cs.subcategory_id FROM cart_subcategories cs)))
       )
     GROUP BY 1, 2, 3
  ),
  -- Visit-grain pairs, for the after-meal moment.
  observed_session AS (
    SELECT sa.item_b AS item_id,
           sa.item_a AS source_item_id,
           'after_meal'::text AS rtype,
           public.pair_strength(sa.eb05) AS observed_score
      FROM public.session_item_affinity sa, p
     WHERE sa.item_a = ANY(p.context)
       AND p.placement = 'after_meal'
       AND sa.eb05 > 1
  ),
  -- Order-grain pairs, for the cart and the dish page.
  observed AS (
    SELECT a.item_b AS item_id,
           a.item_a AS source_item_id,
           'frequently_bought_together'::text AS rtype,
           public.pair_strength(a.eb05) AS observed_score
      FROM public.menu_item_affinity a, p
     WHERE a.item_a = ANY(p.context)
       AND p.placement <> 'after_meal'
       AND a.eb05 > 1
  ),
  -- The sections on the table, each represented by its dearest dish there.
  context_sections AS (
    SELECT DISTINCT ON (mi.subcategory_id) mi.subcategory_id, mi.id AS source_item_id
      FROM public.menu_items mi, p
     WHERE mi.id = ANY(p.context) AND mi.subcategory_id IS NOT NULL
     ORDER BY mi.subcategory_id, mi.price DESC, mi.id
  ),
  /*
   * Section evidence, for dishes with no pair history of their own: a section
   * that goes with one on the table, offered as the dish that section sells
   * in this daypart. 0.6 × section strength × the dish's daypart share.
   */
  observed_family AS (
    SELECT sh.item_id,
           cs.source_item_id,
           'frequently_bought_together'::text AS rtype,
           round(0.6 * public.pair_strength(sf.eb05) * sh.share, 6) AS observed_score
      FROM context_sections cs
      JOIN public.subcategory_affinity sf ON sf.sub_a = cs.subcategory_id AND sf.eb05 > 1
      JOIN public.item_section_share sh ON sh.subcategory_id = sf.sub_b
      CROSS JOIN p
     WHERE p.placement <> 'after_meal'
       AND sh.daypart = p.daypart
       AND sh.share > 0
  ),
  -- Basket completion: a cart with food and no drink is a gap no pair table
  -- can see, because it is about something ABSENT.
  completion AS (
    SELECT mi.id AS item_id,
           NULL::uuid AS source_item_id,
           'add_on'::text AS rtype,
           0.55::numeric AS observed_score
      FROM public.menu_items mi, p
     WHERE p.placement IN ('cart', 'item')
       AND cardinality(p.cart) > 0
       AND NOT p.has_drink
       AND public.role_is_drink(mi.meal_role)
  ),
  fallback AS (
    SELECT pop.menu_item_id AS item_id,
           NULL::uuid AS source_item_id,
           CASE WHEN p.placement = 'after_meal' THEN 'after_meal' ELSE 'popular' END::text AS rtype,
           (0.08 + 0.02 * COALESCE(pop.relative, 1))::numeric AS observed_score
      FROM p
      CROSS JOIN LATERAL public.popular_items_for_daypart(p.daypart, 12, 45) pop
     WHERE NOT EXISTS (SELECT 1 FROM curated c WHERE c.item_id = pop.menu_item_id)
       AND NOT EXISTS (SELECT 1 FROM observed o WHERE o.item_id = pop.menu_item_id)
       AND NOT EXISTS (SELECT 1 FROM observed_family f WHERE f.item_id = pop.menu_item_id)
  ),
  candidates AS (
    SELECT item_id, source_item_id, rtype, curated_score, 0::numeric AS observed_score FROM curated
    UNION ALL
    SELECT item_id, source_item_id, rtype, 0::numeric, observed_score FROM observed
    UNION ALL
    SELECT item_id, source_item_id, rtype, 0::numeric, observed_score FROM observed_session
    UNION ALL
    SELECT item_id, source_item_id, rtype, 0::numeric, observed_score FROM observed_family
    UNION ALL
    SELECT item_id, source_item_id, rtype, 0::numeric, observed_score FROM completion
    UNION ALL
    SELECT item_id, source_item_id, rtype, 0::numeric, observed_score FROM fallback
  ),
  rolled AS (
    SELECT item_id,
           (array_agg(source_item_id ORDER BY curated_score DESC NULLS LAST, observed_score DESC))[1] AS source_item_id,
           (array_agg(rtype ORDER BY curated_score DESC, observed_score DESC))[1] AS rtype,
           max(curated_score)  AS curated_score,
           max(observed_score) AS observed_score
      FROM candidates
     GROUP BY item_id
  ),
  -- Everything that passed the guardrails, with what scoring needs.
  eligible AS (
    SELECT
      mi.id, mi.name, mi.name_bs, mi.name_ar, mi.price, mi.image_url, mi.dietary_tags,
      mi.margin_score,
      r.rtype, r.source_item_id, r.curated_score, r.observed_score,
      COALESCE(st.shown, 0) AS shown,
      public.acceptance_for_ranking(mi.id, p.placement, r.source_item_id, p.daypart, p.seed) AS p_accept,
      -- Never zero for a missing food cost: menu_unit_margins() falls back
      -- to the role's default cost share.
      COALESCE(um.unit_cm, mi.price * (1 - public.default_cost_share(mi.meal_role)), 0) AS unit_cm,
      -- How much of the acceptance estimate is evidence (pair, then dish)
      -- rather than prior: 0 with no history, towards 1 with plenty.
      1 - ((pr.alpha0 + pr.beta0) / (pr.alpha0 + pr.beta0 + COALESCE(st.shown, 0)))
          * (50.0 / (50 + COALESCE(pr.item_shown, 0))) AS evidence,
      -- Sightings this visit that the guest passed on.
      (SELECT count(*)
         FROM public.recommendation_decisions d
         JOIN public.recommendation_impressions i ON i.decision_id = d.id
        WHERE _session_id IS NOT NULL
          AND d.session_id = _session_id
          AND d.chosen_item_id = mi.id
          AND NOT EXISTS (SELECT 1 FROM public.suggestion_conversions sc WHERE sc.decision_id = d.id)
      ) AS passed_over,
      -- Exploration: room for what has not been shown much, stable per visit.
      s.w_explore * (30.0 / (30 + COALESCE(st.shown, 0)))
                  * (('x' || substr(md5(p.seed || mi.id::text), 1, 8))::bit(32)::bigint % 1000)::numeric / 1000
        AS explore,
      -- Kitchen load: only once the kitchen is genuinely behind, only against
      -- slow dishes, never against the bar.
      CASE
        WHEN mi.station = 'bar' THEN 0
        WHEN (SELECT factor FROM load) <= 1 THEN 0
        ELSE LEAST(0.35,
               0.05 * ((SELECT factor FROM load) - 1)
                    * (COALESCE((SELECT e.minutes FROM public.item_prep_estimate(mi.id) e), 8) / 10.0))
      END AS load_penalty,
      -- Inferred diet: a nudge, not a wall; one salad must not hide the meat
      -- from the rest of the table.
      CASE
        WHEN p.diet IS NULL THEN 0
        WHEN p.diet = 'vegan' AND 'vegan' = ANY(mi.dietary_tags) THEN 0
        WHEN p.diet = 'vegetarian'
             AND ('vegetarian' = ANY(mi.dietary_tags) OR 'vegan' = ANY(mi.dietary_tags)) THEN 0
        ELSE 0.30
      END AS diet_penalty,
      -- Price proportionality. Something that goes WITH the meal should cost
      -- clearly less than the table's average line; another main may cost
      -- half as much again. Capped, so it pushes down rather than hides.
      CASE
        WHEN p.avg_line_price IS NULL OR p.avg_line_price <= 0 THEN 0
        WHEN mi.meal_role IS NOT NULL AND mi.meal_role <> 'main' THEN
          CASE
            WHEN mi.price <= p.avg_line_price * 0.75 THEN 0
            ELSE LEAST(0.25, 0.30 * (mi.price / p.avg_line_price - 0.75))
          END
        WHEN mi.price <= p.avg_line_price * 1.5 THEN 0
        ELSE LEAST(0.30, 0.15 * (mi.price / p.avg_line_price - 1.5))
      END AS price_penalty
    FROM rolled r
    JOIN public.menu_items mi ON mi.id = r.item_id
    CROSS JOIN p
    CROSS JOIN s
    CROSS JOIN LATERAL public.suggestion_prior(mi.id, p.placement) pr
    LEFT JOIN public.menu_unit_margins() um ON um.item_id = mi.id
    LEFT JOIN public.suggestion_stats st
           ON st.recommended_item_id = mi.id
          AND st.placement = p.placement
          AND st.source_item_id IS NOT DISTINCT FROM r.source_item_id
          AND st.daypart IS NULL
    WHERE s.enabled
      AND NOT p.held_out
      -- ---- Guardrails. Scoring cannot override any of these. ----
      AND public.menu_item_orderable(mi, p.now_time)
      -- Never re-suggest what is in the cart right now; beyond that, ask the
      -- role (a second coffee is ordinary café behaviour).
      AND NOT (mi.id = ANY(p.cart))
      AND NOT public.repeat_blocked(mi.id, _session_id)
      AND (r.rtype IN ('upgrade_to', 'add_on', 'after_meal')
           OR mi.subcategory_id NOT IN (SELECT cs.subcategory_id FROM cart_subcategories cs))
      -- Retired: shown fairly often, and even an optimistic reading of the
      -- record is below the floor.
      AND NOT (
        COALESCE(st.shown, 0) >= s.retire_after
        AND public.acceptance_retired(COALESCE(st.accepted, 0), COALESCE(st.shown, 0),
                                      pr.alpha0, pr.beta0, s.min_acceptance)
      )
      -- Never suggest around an allergen the guest has filtered out.
      AND NOT (mi.allergens && p.blocked_allergens)
      -- Coursing and the alcohol rule. See reco_role_fits.
      AND public.reco_role_fits(
            mi.meal_role,
            p.placement,
            CASE WHEN EXISTS (SELECT 1 FROM observed ob WHERE ob.item_id = mi.id)
                   OR EXISTS (SELECT 1 FROM observed_session obs WHERE obs.item_id = mi.id)
                   OR EXISTS (SELECT 1 FROM observed_family obf WHERE obf.item_id = mi.id)
                 THEN 'observed' ELSE r.rtype END,
            r.curated_score > 0,
            p.cart,
            _session_id,
            now(),
            p.no_alcohol)
      -- A kids' meal is for a child the menu cannot see: only when curated.
      AND (r.curated_score > 0 OR NOT EXISTS (
            SELECT 1 FROM public.subcategories ks
             WHERE ks.id = mi.subcategory_id
               AND ks.name ~* '(kid|djec|dječ|dijete|child)'))
  ),
  valued AS (
    SELECT e.*,
           (e.evidence * e.unit_cm + (1 - e.evidence) * avg(e.unit_cm) OVER ()) * e.p_accept AS expected_value
      FROM eligible e
  ),
  scored AS (
    SELECT v.*,
      ( s.w_curated  * v.curated_score
      + s.w_observed * v.observed_score
      + s.w_value    * COALESCE(v.expected_value / NULLIF(max(v.expected_value) OVER (), 0), 0)
      + (0.10 * COALESCE(v.margin_score, 0)::numeric / 100 - 0.05)
      + v.explore
      - v.load_penalty
      - v.diet_penalty
      - v.price_penalty
      - 0.15 * v.passed_over
      ) AS score
    FROM valued v
    CROSS JOIN s
  )
  SELECT id, name, name_bs, name_ar, price, image_url, dietary_tags,
         rtype AS recommendation_type,
         rtype AS reason,
         source_item_id
    FROM scored
   ORDER BY score DESC, price ASC, id
   LIMIT (SELECT lim FROM p);
$$;

REVOKE ALL ON FUNCTION public.rank_recommendations(uuid[], text, text, int, uuid, text[]) FROM PUBLIC, anon;

-- ---------------------------------------------------------------------
-- 7. The wrapper: the guest's filters, the ledger, the cart's value
-- ---------------------------------------------------------------------

/*
 * Same signature and behaviour as before, with two additions:
 *   * a halal or alcohol-free diet filter is passed to the ranker as an
 *     `alcohol` allergen, so the alcohol rule applies inside the ranking
 *     (and to curated pairs) rather than only as a tag filter afterwards;
 *   * the decision records the value of what the engine was asked about,
 *     the pre-treatment covariate for the holdout comparison.
 */
CREATE OR REPLACE FUNCTION public.guest_get_recommendations(
  _session_id uuid,
  _session_token text,
  _cart_item_ids uuid[] DEFAULT '{}',
  _placement text DEFAULT 'cart',
  _language text DEFAULT 'en',
  _limit int DEFAULT 4,
  _exclude_allergens text[] DEFAULT '{}',
  _require_tags text[] DEFAULT '{}',
  _exclude_item_ids uuid[] DEFAULT '{}'
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
#variable_conflict use_column
DECLARE
  v_decision_id uuid;
  v_top record;
  v_candidates jsonb;
  v_arm text;
  v_experiment uuid;
  v_limit int := LEAST(GREATEST(COALESCE(_limit, 4), 1), 8);
  v_allergens text[] := COALESCE(_exclude_allergens, '{}'::text[]);
  v_cart_value numeric;
BEGIN
  PERFORM public.assert_guest_session(_session_id, _session_token);

  IF COALESCE(_require_tags, '{}'::text[]) && ARRAY['halal', 'alcohol_free', 'no_alcohol']
     AND NOT ('alcohol' = ANY(v_allergens)) THEN
    v_allergens := v_allergens || 'alcohol'::text;
  END IF;

  -- Twice in one transaction must not fail on the temp table.
  DROP TABLE IF EXISTS pg_temp._ranked;

  CREATE TEMP TABLE _ranked ON COMMIT DROP AS
    SELECT f.*, row_number() OVER (ORDER BY f.ord) AS rnk
      FROM (
        SELECT r.*
          FROM public.rank_recommendations(
                 _cart_item_ids, _placement, _language, 8, _session_id, v_allergens)
               WITH ORDINALITY AS r(id, name, name_bs, name_ar, price, image_url, dietary_tags,
                                    recommendation_type, reason, source_item_id, ord)
         WHERE NOT (r.id = ANY(COALESCE(_exclude_item_ids, '{}'::uuid[])))
           AND COALESCE(_require_tags, '{}'::text[]) <@ COALESCE(r.dietary_tags, '{}'::text[])
         ORDER BY r.ord
         LIMIT v_limit
      ) f;

  SELECT a.arm, a.experiment_id INTO v_arm, v_experiment
    FROM public.session_experiment_assignment a WHERE a.session_id = _session_id;

  SELECT round(sum(mi.price), 2) INTO v_cart_value
    FROM public.menu_items mi
   WHERE mi.id = ANY(COALESCE(_cart_item_ids, '{}'::uuid[]));

  -- The shortlist, not just the winner, in the order it was ranked: needed
  -- to estimate a policy you did not run.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'item_id', r.id, 'type', r.recommendation_type, 'price', r.price, 'rank', r.rnk
         ) ORDER BY r.rnk), '[]'::jsonb)
    INTO v_candidates FROM _ranked r;

  SELECT * INTO v_top FROM _ranked r ORDER BY r.rnk LIMIT 1;

  INSERT INTO public.recommendation_decisions(
    session_id, placement, policy_version, experiment_id, arm,
    candidates, chosen_item_id, source_item_id, recommendation_type, action_probability,
    cart_value)
  VALUES (
    _session_id, _placement, public.reco_policy_version(), v_experiment, v_arm,
    v_candidates, v_top.id, v_top.source_item_id, v_top.recommendation_type,
    -- Deterministic ranker: the top item was certain to be chosen.
    1.0,
    COALESCE(v_cart_value, 0))
  RETURNING recommendation_decisions.id INTO v_decision_id;

  RETURN QUERY
    SELECT v_decision_id, r.id, r.name, r.name_bs, r.name_ar, r.price, r.image_url,
           r.dietary_tags, r.recommendation_type, r.reason, r.source_item_id
      FROM _ranked r
     ORDER BY r.rnk;
END;
$$;

REVOKE ALL ON FUNCTION public.guest_get_recommendations(uuid, text, uuid[], text, text, int, text[], text[], uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guest_get_recommendations(uuid, text, uuid[], text, text, int, text[], text[], uuid[]) TO anon, authenticated;

-- ---------------------------------------------------------------------
-- 8. Reports that read retirement and smoothing
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.suggestion_performance(_limit int DEFAULT 50)
RETURNS TABLE(source_item_id uuid, source_name text, recommended_item_id uuid, recommended_name text,
              placement text, shown int, accepted int, dismissed int, acceptance_rate numeric,
              smoothed_rate numeric, attributed_revenue numeric, revenue_per_impression numeric, status text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_retire_after int;
  v_min numeric;
BEGIN
  IF NOT public.is_staff_member() THEN
    RAISE EXCEPTION 'Only staff can read menu intelligence' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT COALESCE(rs.reco_retire_after_impressions, 60), COALESCE(rs.reco_min_acceptance, 0.03)
    INTO v_retire_after, v_min
    FROM public.restaurant_settings rs WHERE rs.id = 1;

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
    round(100 * public.smoothed_acceptance(st.accepted, st.shown, pr.alpha0, pr.beta0), 1),
    st.attributed_revenue,
    CASE WHEN st.shown > 0 THEN round(st.attributed_revenue / st.shown, 2) END,
    CASE
      WHEN st.shown >= COALESCE(v_retire_after, 60)
       AND public.acceptance_retired(st.accepted, st.shown, pr.alpha0, pr.beta0, v_min)
        THEN 'retired'
      WHEN st.shown < 20 THEN 'learning'
      WHEN public.smoothed_acceptance(st.accepted, st.shown, pr.alpha0, pr.beta0) >= 0.15 THEN 'strong'
      WHEN public.smoothed_acceptance(st.accepted, st.shown, pr.alpha0, pr.beta0) >= 0.06 THEN 'working'
      ELSE 'weak'
    END
  FROM public.suggestion_stats st
  JOIN public.menu_items mr ON mr.id = st.recommended_item_id
  LEFT JOIN public.menu_items ms ON ms.id = st.source_item_id
  CROSS JOIN LATERAL public.suggestion_prior(st.recommended_item_id, st.placement) pr
  WHERE st.daypart IS NULL
  ORDER BY st.attributed_revenue DESC, st.shown DESC
  LIMIT LEAST(GREATEST(COALESCE(_limit, 50), 1), 200);
END;
$$;

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
    'alcohol_from', s.reco_alcohol_from,
    'curated_rules', (SELECT count(*) FROM public.menu_item_recommendations WHERE enabled),
    'learned_pairs', (SELECT count(*) FROM public.menu_item_affinity WHERE eb05 > 1),
    'learned_section_pairs', (SELECT count(*) FROM public.subcategory_affinity WHERE eb05 > 1),
    'tracked_pairs', (SELECT count(*) FROM public.suggestion_stats WHERE daypart IS NULL),
    'pairs_still_learning', (SELECT count(*) FROM public.suggestion_stats
                              WHERE daypart IS NULL AND shown < 20),
    'pairs_retired', (
      SELECT count(*) FROM public.suggestion_stats st
      CROSS JOIN LATERAL public.suggestion_prior(st.recommended_item_id, st.placement) pr
       WHERE st.daypart IS NULL
         AND st.shown >= s.reco_retire_after_impressions
         AND public.acceptance_retired(st.accepted, st.shown, pr.alpha0, pr.beta0, s.reco_min_acceptance)),
    'affinity_computed_at', (SELECT max(computed_at) FROM public.menu_item_affinity),
    'stats_updated_at', (SELECT max(updated_at) FROM public.suggestion_stats),
    'window_days', 90,
    'orders_analysed', (SELECT count(*) FROM public.completed_orders WHERE created_at > now() - interval '90 days')
  ) INTO v
  FROM public.restaurant_settings s WHERE s.id = 1;

  RETURN v;
END;
$$;

-- ---------------------------------------------------------------------
-- 9. A new policy version, and what that means for a running experiment
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.reco_policy_version()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN COALESCE((SELECT reco_sampling_enabled FROM public.restaurant_settings WHERE id = 1), false)
    THEN 'v3-profit-thompson'
    ELSE 'v3-profit'
  END;
$$;

CREATE OR REPLACE FUNCTION public.maybe_enable_sampling()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_enabled boolean;
  v_ready boolean;
  v_version text;
BEGIN
  IF NOT public.is_trusted_caller() THEN
    RAISE EXCEPTION 'Only staff can change the ranking policy' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT COALESCE(reco_sampling_enabled, false) INTO v_enabled
    FROM public.restaurant_settings WHERE id = 1;
  IF v_enabled THEN
    RETURN jsonb_build_object('changed', false, 'reason', 'already_on');
  END IF;

  SELECT (public.bandit_readiness() ->> 'ready')::boolean INTO v_ready;
  IF NOT COALESCE(v_ready, false) THEN
    RETURN jsonb_build_object('changed', false, 'reason', 'gate_not_passed');
  END IF;

  UPDATE public.restaurant_settings SET reco_sampling_enabled = true WHERE id = 1;
  v_version := public.reco_policy_version();

  -- A policy change invalidates the running comparison, so it is closed.
  -- Starting the next one is a deliberate act by a manager.
  UPDATE public.experiments SET ended_at = now(),
         notes = COALESCE(notes, '') || ' [closed automatically: ranking policy changed to ' || v_version || ']'
   WHERE ended_at IS NULL;

  PERFORM public.write_audit('reco.sampling_enabled', 'settings', NULL::uuid, NULL::jsonb,
    jsonb_build_object('policy_version', v_version),
    'bandit_readiness gate passed');

  RETURN jsonb_build_object('changed', true, 'policy_version', v_version);
END;
$$;

REVOKE ALL ON FUNCTION public.maybe_enable_sampling() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.maybe_enable_sampling() TO authenticated;

DO $$
DECLARE
  v_closed int;
BEGIN
  UPDATE public.experiments
     SET ended_at = now(),
         notes = COALESCE(notes, '') || ' [closed automatically: ranking policy changed to v3-profit]'
   WHERE ended_at IS NULL;
  GET DIAGNOSTICS v_closed = ROW_COUNT;
  IF v_closed > 0 THEN
    RAISE NOTICE 'closed % running experiment(s): the ranking policy changed. Start a new one to measure v3.', v_closed;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 10. Relearn now, as the nightly job would
-- ---------------------------------------------------------------------

/*
 * Fills eb05, the section tables, ledger-based stats and priors straight away
 * instead of leaving the ranker without observed pairs until the next night.
 * Runs as the scheduler would; a failure here is reported and does not undo
 * the migration — the nightly job will try again.
 */
DO $$
BEGIN
  PERFORM set_config('lasoul.scheduled_job', 'on', true);
  BEGIN
    RAISE NOTICE 'menu intelligence refreshed: %', public.refresh_menu_intelligence();
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'menu intelligence will refresh tonight instead (%)', SQLERRM;
  END;
  PERFORM set_config('lasoul.scheduled_job', '', true);
END $$;

-- The admin reads the running policy version (Admin → Impact).
REVOKE ALL ON FUNCTION public.reco_policy_version() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reco_policy_version() TO authenticated, service_role;
