-- =====================================================================
-- NOTE ON THIS FILENAME
--
-- Applied to the live database under this timestamp by the Lovable Supabase
-- integration, which copied the migration rather than running the original.
-- The filename is kept because it is what `supabase_migrations.schema_migrations`
-- records; renaming it would make a future `supabase db push` try to apply the
-- same schema a second time.
--
-- The body below is the original, restored — Lovable's copy dropped the
-- comments, and several of them document invariants that are not visible from
-- the SQL (statement ordering that prevents trigger recursion, why the all-day
-- ids come back split, why a print claim is not a print). Any GRANT or RLS
-- statement Lovable added is preserved at the end.
-- =====================================================================

-- =====================================================================
-- A recommendation engine that learns.
--
-- Three sources of knowledge, combined into one score:
--
--   1. CURATED   — what management says goes together (menu_item_recommendations).
--   2. OBSERVED  — what guests actually order together, measured as LIFT from
--                  real basket data. Lift > 1 means the pair happens more often
--                  than chance; that is a real pairing, not a popularity echo.
--   3. LEARNED   — how often a suggestion is accepted when shown, per pair and
--                  per placement, with Bayesian smoothing so a 1-for-1 lucky
--                  start cannot outrank a proven pairing.
--
-- Plus two economics inputs the guest never sees: contribution (price x margin)
-- and an exploration bonus so new dishes get a fair hearing instead of being
-- frozen out by whatever was popular the week they launched.
--
-- Every guardrail from the non-learning version still applies and is applied
-- AFTER scoring: never sold out, never already in the cart, never the same
-- shelf unless the manager typed it as an upgrade or add-on, never expose the
-- margin. Learning changes the ORDER of good suggestions. It can never
-- introduce a bad one.
-- =====================================================================

-- =====================================================================
-- 1. Observed pairings — market-basket analysis over real orders
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.menu_item_affinity (
  item_a uuid NOT NULL REFERENCES public.menu_items(id) ON DELETE CASCADE,
  item_b uuid NOT NULL REFERENCES public.menu_items(id) ON DELETE CASCADE,
  /** Orders containing both, in the analysis window. */
  pair_orders int NOT NULL DEFAULT 0,
  /** Orders containing item_a. */
  a_orders int NOT NULL DEFAULT 0,
  /** P(b | a) — of the guests who ordered A, how many also ordered B. */
  confidence numeric(6,4) NOT NULL DEFAULT 0,
  /** confidence / P(b). Above 1 = a genuine pairing, not just B being popular. */
  lift numeric(8,4) NOT NULL DEFAULT 0,
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (item_a, item_b)
);

CREATE INDEX IF NOT EXISTS idx_affinity_a_lift ON public.menu_item_affinity(item_a, lift DESC);

ALTER TABLE public.menu_item_affinity ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff read affinity" ON public.menu_item_affinity;
CREATE POLICY "Staff read affinity"
  ON public.menu_item_affinity FOR SELECT TO authenticated
  USING (public.is_staff_member());

REVOKE ALL ON public.menu_item_affinity FROM anon;
GRANT SELECT ON public.menu_item_affinity TO authenticated;

/**
 * Recompute pairings from completed orders.
 *
 * Only real sales count — `completed_orders` already excludes awaiting_payment,
 * payment_failed and cancelled, so an abandoned card order cannot teach the
 * engine anything.
 *
 * A pair needs `_min_pair_orders` co-occurrences before it is stored, which
 * keeps one unusual Tuesday from becoming a permanent recommendation.
 */
CREATE OR REPLACE FUNCTION public.refresh_menu_affinity(
  _days int DEFAULT 90,
  _min_pair_orders int DEFAULT 3
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows int := 0;
  v_total_orders int;
BEGIN
  IF NOT public.is_staff_member() THEN
    RAISE EXCEPTION 'Only staff can refresh menu intelligence' USING ERRCODE = 'insufficient_privilege';
  END IF;

  CREATE TEMP TABLE _basket ON COMMIT DROP AS
    SELECT DISTINCT co.id AS order_id, oi.menu_item_id AS item_id
      FROM public.completed_orders co
      JOIN public.order_items oi ON oi.order_id = co.id
     WHERE co.created_at > now() - make_interval(days => GREATEST(_days, 1));

  SELECT count(DISTINCT order_id) INTO v_total_orders FROM _basket;
  IF COALESCE(v_total_orders, 0) < 5 THEN
    -- Not enough history to say anything honest yet.
    RETURN 0;
  END IF;

  CREATE TEMP TABLE _item_counts ON COMMIT DROP AS
    SELECT item_id, count(*)::int AS orders FROM _basket GROUP BY item_id;

  DELETE FROM public.menu_item_affinity;

  INSERT INTO public.menu_item_affinity(item_a, item_b, pair_orders, a_orders, confidence, lift, computed_at)
  SELECT p.item_a,
         p.item_b,
         p.pair_orders,
         ca.orders,
         round(p.pair_orders::numeric / ca.orders, 4) AS confidence,
         -- lift = P(b|a) / P(b)
         round((p.pair_orders::numeric / ca.orders) / NULLIF(cb.orders::numeric / v_total_orders, 0), 4) AS lift,
         now()
    FROM (
      SELECT b1.item_id AS item_a, b2.item_id AS item_b, count(*)::int AS pair_orders
        FROM _basket b1
        JOIN _basket b2 ON b2.order_id = b1.order_id AND b2.item_id <> b1.item_id
       GROUP BY b1.item_id, b2.item_id
      HAVING count(*) >= GREATEST(_min_pair_orders, 1)
    ) p
    JOIN _item_counts ca ON ca.item_id = p.item_a
    JOIN _item_counts cb ON cb.item_id = p.item_b;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_menu_affinity(int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refresh_menu_affinity(int, int) TO authenticated;

-- =====================================================================
-- 2. Learned acceptance — what guests actually say yes to
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.suggestion_stats (
  /** NULL source = a general suggestion (after-meal, or an empty cart). */
  source_item_id uuid REFERENCES public.menu_items(id) ON DELETE CASCADE,
  recommended_item_id uuid NOT NULL REFERENCES public.menu_items(id) ON DELETE CASCADE,
  placement text NOT NULL,
  shown int NOT NULL DEFAULT 0,
  accepted int NOT NULL DEFAULT 0,
  dismissed int NOT NULL DEFAULT 0,
  /** KM actually taken, from orders that completed. Not clicks — money. */
  attributed_revenue numeric(12,2) NOT NULL DEFAULT 0,
  attributed_orders int NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_item_id, recommended_item_id, placement)
);

-- A NULL source_item_id would break the primary key's uniqueness guarantee,
-- so general suggestions get their own unique index.
CREATE UNIQUE INDEX IF NOT EXISTS idx_suggestion_stats_general
  ON public.suggestion_stats(recommended_item_id, placement)
  WHERE source_item_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_suggestion_stats_reco
  ON public.suggestion_stats(recommended_item_id, placement);

ALTER TABLE public.suggestion_stats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff read suggestion stats" ON public.suggestion_stats;
CREATE POLICY "Staff read suggestion stats"
  ON public.suggestion_stats FOR SELECT TO authenticated
  USING (public.is_staff_member());

REVOKE ALL ON public.suggestion_stats FROM anon;
GRANT SELECT ON public.suggestion_stats TO authenticated;

/**
 * Precise revenue attribution.
 *
 * Written at order time, from the server, when the guest tells us which lines
 * came from a suggestion. One row per accepted suggestion that made it into a
 * real order — so "this feature earned X" is a sum over completed orders, not
 * an estimate from click counts.
 */
CREATE TABLE IF NOT EXISTS public.suggestion_conversions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  source_item_id uuid REFERENCES public.menu_items(id) ON DELETE SET NULL,
  recommended_item_id uuid NOT NULL REFERENCES public.menu_items(id) ON DELETE CASCADE,
  placement text NOT NULL,
  quantity int NOT NULL DEFAULT 1,
  line_total numeric(10,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_suggestion_conversions_order ON public.suggestion_conversions(order_id);
CREATE INDEX IF NOT EXISTS idx_suggestion_conversions_created ON public.suggestion_conversions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_suggestion_conversions_pair
  ON public.suggestion_conversions(source_item_id, recommended_item_id, placement);

ALTER TABLE public.suggestion_conversions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff read suggestion conversions" ON public.suggestion_conversions;
CREATE POLICY "Staff read suggestion conversions"
  ON public.suggestion_conversions FOR SELECT TO authenticated
  USING (public.is_staff_member());

REVOKE ALL ON public.suggestion_conversions FROM anon;
GRANT SELECT ON public.suggestion_conversions TO authenticated;

/**
 * Rebuild suggestion_stats from the raw record.
 *
 * Impressions, accepts and dismissals come from analytics_events (already
 * collected, no extra request per suggestion). Money comes from
 * suggestion_conversions joined to completed orders, so a suggestion accepted
 * into an order that was later cancelled earns nothing.
 */
CREATE OR REPLACE FUNCTION public.refresh_suggestion_stats(_days int DEFAULT 90)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows int := 0;
  v_since timestamptz := now() - make_interval(days => GREATEST(_days, 1));
BEGIN
  IF NOT public.is_staff_member() THEN
    RAISE EXCEPTION 'Only staff can refresh menu intelligence' USING ERRCODE = 'insufficient_privilege';
  END IF;

  DELETE FROM public.suggestion_stats;

  WITH events AS (
    SELECT
      nullif(e.props->>'source_item_id', '')::uuid AS source_item_id,
      nullif(e.props->>'item_id', '')::uuid        AS recommended_item_id,
      COALESCE(e.props->>'placement', 'cart')      AS placement,
      e.event
    FROM public.analytics_events e
    WHERE e.event IN ('suggestion_shown', 'suggestion_accepted', 'suggestion_dismissed')
      AND e.occurred_at > v_since
      AND nullif(e.props->>'item_id', '') IS NOT NULL
  ),
  counted AS (
    SELECT source_item_id, recommended_item_id, placement,
           count(*) FILTER (WHERE event = 'suggestion_shown')     AS shown,
           count(*) FILTER (WHERE event = 'suggestion_accepted')  AS accepted,
           count(*) FILTER (WHERE event = 'suggestion_dismissed') AS dismissed
      FROM events
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
      COALESCE(c.shown, 0)::int      AS shown,
      COALESCE(c.accepted, 0)::int   AS accepted,
      COALESCE(c.dismissed, 0)::int  AS dismissed,
      COALESCE(m.revenue, 0)::numeric AS revenue,
      COALESCE(m.orders, 0)::int      AS orders
    FROM counted c
    FULL OUTER JOIN money m
      ON m.recommended_item_id = c.recommended_item_id
     AND m.placement = c.placement
     AND m.source_item_id IS NOT DISTINCT FROM c.source_item_id
  )
  INSERT INTO public.suggestion_stats(
    source_item_id, recommended_item_id, placement,
    shown, accepted, dismissed, attributed_revenue, attributed_orders, updated_at)
  SELECT source_item_id, recommended_item_id, placement,
         shown, accepted, dismissed, revenue, orders, now()
    FROM merged
   WHERE recommended_item_id IS NOT NULL
     -- Drop rows whose item has since been deleted from the menu.
     AND EXISTS (SELECT 1 FROM public.menu_items mi WHERE mi.id = merged.recommended_item_id);

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_suggestion_stats(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refresh_suggestion_stats(int) TO authenticated;

/** Refresh both models in one call. */
CREATE OR REPLACE FUNCTION public.refresh_menu_intelligence()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pairs int;
  v_stats int;
BEGIN
  IF NOT public.is_staff_member() THEN
    RAISE EXCEPTION 'Only staff can refresh menu intelligence' USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_pairs := public.refresh_menu_affinity(90, 3);
  v_stats := public.refresh_suggestion_stats(90);

  RETURN jsonb_build_object('pairs', v_pairs, 'suggestion_rows', v_stats, 'refreshed_at', now());
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_menu_intelligence() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refresh_menu_intelligence() TO authenticated;

-- =====================================================================
-- 3. Tuning — every weight is visible and adjustable, nothing is magic
-- =====================================================================

ALTER TABLE public.restaurant_settings
  ADD COLUMN IF NOT EXISTS reco_weight_curated smallint NOT NULL DEFAULT 40 CHECK (reco_weight_curated BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS reco_weight_observed smallint NOT NULL DEFAULT 25 CHECK (reco_weight_observed BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS reco_weight_learned smallint NOT NULL DEFAULT 25 CHECK (reco_weight_learned BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS reco_weight_margin smallint NOT NULL DEFAULT 10 CHECK (reco_weight_margin BETWEEN 0 AND 100),
  /** How much room new items get to prove themselves. 0 = pure exploitation. */
  ADD COLUMN IF NOT EXISTS reco_exploration smallint NOT NULL DEFAULT 15 CHECK (reco_exploration BETWEEN 0 AND 50),
  /** Below this acceptance rate (with enough impressions) a pair is retired. */
  ADD COLUMN IF NOT EXISTS reco_min_acceptance numeric(4,3) NOT NULL DEFAULT 0.030
    CHECK (reco_min_acceptance BETWEEN 0 AND 1),
  ADD COLUMN IF NOT EXISTS reco_retire_after_impressions int NOT NULL DEFAULT 60
    CHECK (reco_retire_after_impressions >= 10);

/**
 * Bayesian-smoothed acceptance rate.
 *
 * A Beta(1, 12) prior — roughly "assume 8% until shown otherwise". This is the
 * whole reason a pair shown 1 time and accepted 1 time does not instantly
 * dominate a pair shown 400 times and accepted 60 times: the prior dilutes
 * small samples and washes out as evidence accumulates.
 */
CREATE OR REPLACE FUNCTION public.smoothed_acceptance(_accepted int, _shown int)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT round((COALESCE(_accepted, 0) + 1)::numeric / (COALESCE(_shown, 0) + 13)::numeric, 4);
$$;

-- =====================================================================
-- 3b. Holdout — the only way to know if any of this actually works
-- =====================================================================

/**
 * Percentage of table sessions that see NO suggestions at all.
 *
 * Without this, "suggestions earned 1,240 KM" is an attribution number, not a
 * causal one — some of those guests would have ordered the coffee anyway. With
 * a holdout, comparing average order value between the two groups gives the
 * real answer.
 *
 * Default 0 (everyone sees suggestions). Set it to 10 for a fortnight when you
 * want a number you can defend. See docs/growth-and-merchandising.md.
 */
ALTER TABLE public.restaurant_settings
  ADD COLUMN IF NOT EXISTS reco_holdout_pct smallint NOT NULL DEFAULT 0
    CHECK (reco_holdout_pct BETWEEN 0 AND 50);

/** Deterministic per-session assignment — one table always gets the same answer. */
CREATE OR REPLACE FUNCTION public.guest_in_reco_holdout(_session_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN COALESCE((SELECT reco_holdout_pct FROM public.restaurant_settings WHERE id = 1), 0) = 0 THEN false
    WHEN _session_id IS NULL THEN false
    ELSE (('x' || substr(md5('holdout:' || _session_id::text), 1, 8))::bit(32)::bigint % 100)
         < COALESCE((SELECT reco_holdout_pct FROM public.restaurant_settings WHERE id = 1), 0)
  END;
$$;

REVOKE ALL ON FUNCTION public.guest_in_reco_holdout(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guest_in_reco_holdout(uuid) TO anon, authenticated;

-- =====================================================================
-- 4. The engine
-- =====================================================================

DROP FUNCTION IF EXISTS public.guest_get_recommendations(uuid[], text, text, int);

/**
 * Context-aware, self-improving suggestions.
 *
 * Score, all normalised to 0..1 before weighting:
 *
 *   curated   priority/100 for an explicit rule, else 0
 *   observed  min(lift, 3)/3 from real baskets
 *   learned   smoothed acceptance for this exact pair and placement
 *   margin    margin_score/100  (internal; never returned)
 *   explore   a bonus that decays as a pair accumulates impressions, so a new
 *             dish is tried instead of being invisible forever
 *
 * `_session_id` makes the choice stable for one table within a visit (without
 * it, a re-render could shuffle the suggestion under the guest's thumb) and is
 * what decides holdout membership when a holdout is running.
 *
 * Guardrails are applied after scoring and cannot be outvoted by it.
 */
CREATE OR REPLACE FUNCTION public.guest_get_recommendations(
  _cart_item_ids uuid[] DEFAULT '{}',
  _placement text DEFAULT 'cart',
  _language text DEFAULT 'en',
  _limit int DEFAULT 4,
  _session_id uuid DEFAULT NULL
)
RETURNS TABLE(
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
      COALESCE(reco_weight_learned, 25)::numeric  / 100 AS w_learned,
      COALESCE(reco_weight_margin, 10)::numeric   / 100 AS w_margin,
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
      LOCALTIME AS now_time,
      -- Deterministic jitter per table+item, so exploration is stable per visit.
      COALESCE(_session_id::text, 'anon') AS seed,
      public.guest_in_reco_holdout(_session_id) AS held_out
  ),
  cart_subcategories AS (
    SELECT DISTINCT mi.subcategory_id
      FROM public.menu_items mi, p
     WHERE mi.id = ANY(p.cart)
  ),
  -- (1) Curated rules.
  curated AS (
    SELECT r.recommended_item_id AS item_id,
           r.source_item_id,
           r.recommendation_type AS rtype,
           max(r.priority)::numeric / 100 AS curated_score
      FROM public.menu_item_recommendations r, p
     WHERE r.enabled
       AND (r.language IS NULL OR r.language = p.lang)
       AND (r.start_time IS NULL OR p.now_time >= r.start_time)
       AND (r.end_time IS NULL OR p.now_time <= r.end_time)
       AND (
         (p.placement = 'after_meal' AND r.recommendation_type = 'after_meal')
         OR (p.placement <> 'after_meal' AND r.recommendation_type <> 'after_meal'
             AND (r.source_item_id = ANY(p.cart)
                  OR r.source_subcategory_id IN (SELECT cs.subcategory_id FROM cart_subcategories cs)))
       )
     GROUP BY 1, 2, 3
  ),
  -- (2) Observed pairings for what is in the cart. Suppressed after the meal,
  --     where basket co-occurrence says nothing useful about "what now?".
  observed AS (
    SELECT a.item_b AS item_id,
           a.item_a AS source_item_id,
           'frequently_bought_together'::text AS rtype,
           LEAST(a.lift, 3)::numeric / 3 AS observed_score
      FROM public.menu_item_affinity a, p
     WHERE a.item_a = ANY(p.cart)
       AND p.placement <> 'after_meal'
       AND a.lift > 1.0
  ),
  -- (3) Popularity fallback, so a brand-new install still says something.
  fallback AS (
    SELECT pop.menu_item_id AS item_id,
           NULL::uuid AS source_item_id,
           CASE WHEN p.placement = 'after_meal' THEN 'after_meal' ELSE 'frequently_bought_together' END::text AS rtype,
           0.10::numeric AS observed_score
      FROM public.get_popular_items(12, 45) pop, p
     WHERE NOT EXISTS (SELECT 1 FROM curated c WHERE c.item_id = pop.menu_item_id)
       AND NOT EXISTS (SELECT 1 FROM observed o WHERE o.item_id = pop.menu_item_id)
  ),
  candidates AS (
    SELECT item_id, source_item_id, rtype, curated_score, 0::numeric AS observed_score FROM curated
    UNION ALL
    SELECT item_id, source_item_id, rtype, 0::numeric, observed_score FROM observed
    UNION ALL
    SELECT item_id, source_item_id, rtype, 0::numeric, observed_score FROM fallback
  ),
  rolled AS (
    SELECT item_id,
           (array_agg(source_item_id ORDER BY curated_score DESC NULLS LAST))[1] AS source_item_id,
           (array_agg(rtype ORDER BY curated_score DESC))[1] AS rtype,
           max(curated_score)  AS curated_score,
           max(observed_score) AS observed_score
      FROM candidates
     GROUP BY item_id
  ),
  scored AS (
    SELECT
      mi.id, mi.name, mi.name_bs, mi.name_ar, mi.price, mi.image_url,
      mi.dietary_tags, mi.subcategory_id, r.rtype, r.source_item_id,
      COALESCE(st.shown, 0) AS shown,
      public.smoothed_acceptance(COALESCE(st.accepted, 0), COALESCE(st.shown, 0)) AS learned,
      (
        s.w_curated  * r.curated_score
      + s.w_observed * r.observed_score
      + s.w_learned  * public.smoothed_acceptance(COALESCE(st.accepted, 0), COALESCE(st.shown, 0))
      + s.w_margin   * (mi.margin_score::numeric / 100)
      -- Exploration: full bonus at zero impressions, ~half at 30, negligible
      -- past a few hundred. Multiplied by a stable per-guest hash so different
      -- tables explore different items rather than all seeing the same one.
      + s.w_explore  * (30.0 / (30 + COALESCE(st.shown, 0)))
                     * (('x' || substr(md5(p.seed || mi.id::text), 1, 8))::bit(32)::bigint % 1000)::numeric / 1000
      ) AS score
    FROM rolled r
    JOIN public.menu_items mi ON mi.id = r.item_id
    CROSS JOIN p
    CROSS JOIN s
    LEFT JOIN public.suggestion_stats st
           ON st.recommended_item_id = mi.id
          AND st.placement = p.placement
          AND st.source_item_id IS NOT DISTINCT FROM r.source_item_id
    WHERE s.enabled
      -- A holdout session sees nothing, so the uplift number can be honest.
      AND NOT p.held_out
      -- ---- Guardrails. Scoring cannot override any of these. ----
      AND public.menu_item_orderable(mi, p.now_time)
      AND NOT (mi.id = ANY(p.cart))
      AND (r.rtype IN ('upgrade_to', 'add_on', 'after_meal')
           OR mi.subcategory_id NOT IN (SELECT cs.subcategory_id FROM cart_subcategories cs))
      -- Retire a pair that has had a fair hearing and been refused.
      AND NOT (
        COALESCE(st.shown, 0) >= s.retire_after
        AND public.smoothed_acceptance(COALESCE(st.accepted, 0), COALESCE(st.shown, 0)) < s.min_acceptance
      )
  )
  SELECT id, name, name_bs, name_ar, price, image_url, dietary_tags,
         rtype AS recommendation_type,
         rtype AS reason,
         source_item_id
    FROM scored
   ORDER BY score DESC, price ASC
   LIMIT (SELECT lim FROM p);
$$;

REVOKE ALL ON FUNCTION public.guest_get_recommendations(uuid[], text, text, int, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guest_get_recommendations(uuid[], text, text, int, uuid) TO anon, authenticated;

-- =====================================================================
-- 5. Attribution at order time
-- =====================================================================

DROP FUNCTION IF EXISTS public.guest_place_order(uuid, text, text, text, jsonb, numeric);

/**
 * guest_place_order v4 — identical to v3, plus suggestion attribution.
 *
 * `_items` may now carry `from_suggestion: { source_item_id, placement }`.
 * The server records the conversion against the line's real, server-computed
 * price, so "suggestions earned X" is measured in money that actually arrived,
 * not in clicks. A client claiming a suggestion it never saw can only ever
 * over-credit a number on an internal dashboard; it cannot affect the total.
 */
CREATE OR REPLACE FUNCTION public.guest_place_order(
  _session_id uuid,
  _session_token text,
  _guest_name text,
  _payment_method text,
  _items jsonb,
  _tip numeric DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session public.table_sessions;
  v_order public.orders;
  v_item_count int;
  v_order_count int;
  v_items_total numeric(10,2);
  v_tip numeric(10,2);
  v_method text;
  v_is_card boolean;
  v_status public.order_status;
  v_ticket_id uuid;
  v_unavailable text;
BEGIN
  v_session := public.assert_guest_session(_session_id, _session_token);

  IF NOT COALESCE((SELECT ordering_enabled FROM public.restaurant_settings WHERE id = 1), true) THEN
    RAISE EXCEPTION 'Ordering is paused' USING ERRCODE = 'feature_not_supported';
  END IF;

  v_method := CASE
    WHEN _payment_method IN ('card', 'card_online') THEN 'card_online'
    WHEN _payment_method = 'pos_terminal' THEN 'pos_terminal'
    ELSE 'cash'
  END;
  v_is_card := v_method = 'card_online';

  IF v_is_card AND NOT public.online_card_payments_enabled() THEN
    RAISE EXCEPTION 'Online card payment is currently unavailable' USING ERRCODE = 'feature_not_supported';
  END IF;

  IF jsonb_typeof(_items) <> 'array' THEN
    RAISE EXCEPTION 'Order items must be an array';
  END IF;

  SELECT jsonb_array_length(_items) INTO v_item_count;
  IF v_item_count < 1 OR v_item_count > 40 THEN
    RAISE EXCEPTION 'Invalid order size';
  END IF;

  UPDATE public.table_sessions SET last_heartbeat_at = now() WHERE id = v_session.id;

  SELECT count(*) INTO v_order_count
    FROM public.orders
   WHERE table_session_id = v_session.id AND status <> 'cancelled';
  IF v_order_count >= 10 THEN
    RAISE EXCEPTION 'Maximum orders reached for this session';
  END IF;

  WITH requested AS (
    SELECT DISTINCT (item->>'menu_item_id')::uuid AS menu_item_id
      FROM jsonb_array_elements(_items) AS item
  )
  SELECT string_agg(COALESCE(mi.name, 'Unknown item'), ', ')
    INTO v_unavailable
    FROM requested r
    LEFT JOIN public.menu_items mi ON mi.id = r.menu_item_id
   WHERE mi.id IS NULL OR mi.is_available = false;

  IF v_unavailable IS NOT NULL THEN
    RAISE EXCEPTION 'Unavailable: %', v_unavailable USING ERRCODE = 'no_data_found';
  END IF;

  WITH requested AS (
    SELECT
      (item->>'menu_item_id')::uuid AS menu_item_id,
      LEAST(GREATEST(COALESCE((item->>'quantity')::int, 1), 1), 10) AS quantity
    FROM jsonb_array_elements(_items) AS item
  )
  SELECT round(sum(mi.price * r.quantity)::numeric, 2)
    INTO v_items_total
    FROM requested r
    JOIN public.menu_items mi ON mi.id = r.menu_item_id AND mi.is_available = true;

  IF v_items_total IS NULL OR v_items_total <= 0 THEN
    RAISE EXCEPTION 'No available menu items found';
  END IF;

  v_tip := round(GREATEST(COALESCE(_tip, 0), 0)::numeric, 2);
  v_tip := LEAST(v_tip, round(v_items_total * 0.40, 2), 200);

  v_status := CASE WHEN v_is_card THEN 'awaiting_payment'::public.order_status
                   ELSE 'pending'::public.order_status END;

  INSERT INTO public.orders(
    table_session_id, total, tip_amount, status, guest_name,
    payment_method, payment_status, order_code, released_to_kitchen_at
  )
  VALUES (
    v_session.id, v_items_total + v_tip, v_tip, v_status,
    nullif(left(trim(coalesce(_guest_name, '')), 80), ''),
    v_method,
    CASE WHEN v_is_card THEN 'pending' ELSE 'unpaid' END,
    public.next_order_code(),
    CASE WHEN v_is_card THEN NULL ELSE now() END
  )
  RETURNING * INTO v_order;

  WITH requested AS (
    SELECT
      (item->>'menu_item_id')::uuid AS menu_item_id,
      LEAST(GREATEST(COALESCE((item->>'quantity')::int, 1), 1), 10) AS quantity,
      nullif(left(trim(coalesce(item->>'notes', '')), 500), '') AS notes
    FROM jsonb_array_elements(_items) AS item
  )
  INSERT INTO public.order_items(order_id, menu_item_id, quantity, unit_price, notes, status)
  SELECT v_order.id, r.menu_item_id, r.quantity, mi.price, r.notes, 'pending'
    FROM requested r
    JOIN public.menu_items mi ON mi.id = r.menu_item_id AND mi.is_available = true;

  -- Attribution. Priced from menu_items, never from the client.
  INSERT INTO public.suggestion_conversions(
    order_id, source_item_id, recommended_item_id, placement, quantity, line_total)
  SELECT
    v_order.id,
    nullif(item->'from_suggestion'->>'source_item_id', '')::uuid,
    (item->>'menu_item_id')::uuid,
    COALESCE(nullif(item->'from_suggestion'->>'placement', ''), 'cart'),
    LEAST(GREATEST(COALESCE((item->>'quantity')::int, 1), 1), 10),
    round(mi.price * LEAST(GREATEST(COALESCE((item->>'quantity')::int, 1), 1), 10), 2)
  FROM jsonb_array_elements(_items) AS item
  JOIN public.menu_items mi ON mi.id = (item->>'menu_item_id')::uuid
  WHERE jsonb_typeof(item->'from_suggestion') = 'object';

  IF NOT v_is_card THEN
    v_ticket_id := public.enqueue_order_ticket(v_order.id, 'kitchen');
  END IF;

  RETURN jsonb_build_object(
    'order_id', v_order.id,
    'order_code', v_order.order_code,
    'status', v_order.status,
    'total', v_order.total,
    'tip_amount', v_order.tip_amount,
    'payment_method', v_order.payment_method,
    'payment_status', v_order.payment_status,
    'awaiting_payment', v_is_card,
    'ticket_id', v_ticket_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.guest_place_order(uuid, text, text, text, jsonb, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guest_place_order(uuid, text, text, text, jsonb, numeric) TO anon, authenticated;

-- ---------------------------------------------------------------------
-- Added by the Lovable integration when this was applied. Kept so the
-- file matches what is actually live.
-- ---------------------------------------------------------------------
grant all on public.menu_item_affinity to service_role;
grant all on public.suggestion_conversions to service_role;
grant all on public.suggestion_stats to service_role;
