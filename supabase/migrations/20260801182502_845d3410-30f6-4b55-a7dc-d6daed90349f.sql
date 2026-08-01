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
-- Suggestions that read the room
--
-- The engine already learns which pairings get accepted. Four things it could
-- not do, each of which makes it wrong in a way a person would notice:
--
--   1. It learned ONE acceptance rate per pair, averaged across the whole day.
--      Coffee is a good suggestion at 09:00 and a poor one at 22:00; a single
--      number is wrong at both ends and slowly converges on being wrong in the
--      middle too.
--   2. It would suggest a steak into a cart containing nothing but vegetarian
--      food. Not merely a poor suggestion — for someone who has told the app
--      what they eat, it reads as not being listened to.
--   3. It would suggest a 25-minute dish while the kitchen was drowning,
--      making the wait worse for the whole room to add one item.
--   4. It had an `alternative` recommendation type and nothing that used it,
--      so an item going unavailable just disappeared instead of offering the
--      nearest thing.
--
-- Every one of these is a FILTER or a penalty on top of the existing score,
-- never a new way to override the guardrails. Availability, "not already in
-- the cart", and the retirement rule all still apply first.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Acceptance, per daypart
-- ---------------------------------------------------------------------

ALTER TABLE public.suggestion_stats
  ADD COLUMN IF NOT EXISTS daypart text;

/*
 * Found while adding dayparts: the table could never hold a general suggestion.
 *
 * Its comment says "NULL source = a general suggestion (after-meal, or an empty
 * cart)" and there is even a partial unique index for that case — but
 * source_item_id was part of the PRIMARY KEY, which makes it NOT NULL. So every
 * source-less row was rejected, the partial index was dead, and
 * refresh_suggestion_stats() would ERROR outright the first time an after-meal
 * suggestion was shown. The after-meal placement could not learn anything at
 * all, and nobody would have seen why.
 *
 * The PK is replaced by an equivalent unique index that treats NULL as a value
 * and also covers the new daypart column.
 */
ALTER TABLE public.suggestion_stats DROP CONSTRAINT IF EXISTS suggestion_stats_pkey;
-- Dropping the PK does NOT drop the NOT NULL it implied — that has to be said
-- explicitly, and forgetting it leaves exactly the bug this is fixing.
ALTER TABLE public.suggestion_stats ALTER COLUMN source_item_id DROP NOT NULL;
DROP INDEX IF EXISTS idx_suggestion_stats_general;

-- The all-day row keeps daypart NULL and remains the fallback, so a pair that
-- has been seen twenty times overall but twice at breakfast still has
-- something to stand on rather than falling back to the prior.
CREATE UNIQUE INDEX IF NOT EXISTS idx_suggestion_stats_unique_daypart
  ON public.suggestion_stats(
    recommended_item_id,
    placement,
    COALESCE(source_item_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(daypart, '')
  );

/**
 * Acceptance for a pair, preferring the current daypart and falling back.
 *
 * Bayesian smoothing is applied to whichever row is used, so a daypart with
 * three impressions is pulled hard toward the prior rather than declaring a
 * 100% acceptance rate off one click.
 */
CREATE OR REPLACE FUNCTION public.daypart_acceptance(
  _item_id uuid,
  _placement text,
  _source_item_id uuid,
  _daypart text
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
  )
  SELECT public.smoothed_acceptance(
           COALESCE((SELECT accepted FROM rows WHERE daypart = _daypart), (SELECT accepted FROM rows WHERE daypart IS NULL), 0),
           COALESCE((SELECT shown FROM rows WHERE daypart = _daypart), (SELECT shown FROM rows WHERE daypart IS NULL), 0)
         );
$$;

-- ---------------------------------------------------------------------
-- 2. What the cart says about the guest
-- ---------------------------------------------------------------------

/**
 * A diet the whole cart already conforms to, or NULL.
 *
 * Two conditions, and the second one matters more than it looks:
 *
 *   - EVERY line must carry the tag. One vegetarian side in a mixed cart says
 *     nothing about the table; a cart that is entirely vegetarian is a
 *     statement.
 *   - At least one line must be FOOD. A cart holding a single black coffee is
 *     technically 100% vegan, and reading that as a declaration would quietly
 *     hide every meat dish from someone who has ordered nothing but a drink.
 *     Diets are declared by what people choose to eat.
 *
 * An empty cart says nothing either, and returns NULL.
 */
CREATE OR REPLACE FUNCTION public.cart_diet(_cart_item_ids uuid[])
RETURNS text
LANGUAGE sql
STABLE
AS $$
  WITH items AS (
    SELECT dietary_tags, station
      FROM public.menu_items
     WHERE id = ANY(COALESCE(_cart_item_ids, '{}'::uuid[]))
  )
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM items WHERE station = 'kitchen') THEN NULL
    -- Vegan first: it is the stricter claim, and a vegan cart is also vegetarian.
    WHEN NOT EXISTS (SELECT 1 FROM items WHERE NOT ('vegan' = ANY(dietary_tags))) THEN 'vegan'
    WHEN NOT EXISTS (SELECT 1 FROM items WHERE NOT ('vegetarian' = ANY(dietary_tags) OR 'vegan' = ANY(dietary_tags))) THEN 'vegetarian'
    ELSE NULL
  END;
$$;

/** Does the cart already contain something from this subcategory kind? */
CREATE OR REPLACE FUNCTION public.cart_has_drink(_cart_item_ids uuid[])
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.menu_items mi
     WHERE mi.id = ANY(COALESCE(_cart_item_ids, '{}'::uuid[]))
       AND mi.station = 'bar'
  );
$$;

-- ---------------------------------------------------------------------
-- 3. The recommendation function, context-aware
-- ---------------------------------------------------------------------

-- Dropped rather than overloaded: two functions differing only by trailing
-- defaults make supabase.rpc() ambiguous at the PostgREST layer.
DROP FUNCTION IF EXISTS public.guest_get_recommendations(uuid[], text, text, int, uuid);

CREATE OR REPLACE FUNCTION public.guest_get_recommendations(
  _cart_item_ids uuid[] DEFAULT '{}',
  _placement text DEFAULT 'cart',
  _language text DEFAULT 'en',
  _limit int DEFAULT 4,
  _session_id uuid DEFAULT NULL,
  /** Allergens the guest has filtered out. Never suggest around a filter. */
  _exclude_allergens text[] DEFAULT '{}'
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
      COALESCE(reco_retire_after_impressions, 60)       AS retire_after,
      COALESCE(kitchen_capacity_minutes, 25)::numeric   AS capacity
    FROM public.restaurant_settings WHERE id = 1
  ),
  p AS (
    SELECT
      LEAST(GREATEST(COALESCE(_limit, 4), 1), 8) AS lim,
      COALESCE(_cart_item_ids, '{}'::uuid[])     AS cart,
      CASE WHEN _placement IN ('cart', 'after_meal', 'item') THEN _placement ELSE 'cart' END AS placement,
      CASE WHEN _language IN ('en', 'bs', 'ar') THEN _language ELSE 'en' END AS lang,
      LOCALTIME AS now_time,
      public.daypart_of(now()) AS daypart,
      COALESCE(_session_id::text, 'anon') AS seed,
      public.guest_in_reco_holdout(_session_id) AS held_out,
      public.cart_diet(_cart_item_ids) AS diet,
      COALESCE(_exclude_allergens, '{}'::text[]) AS blocked_allergens,
      public.cart_has_drink(_cart_item_ids) AS has_drink
  ),
  -- How overloaded the kitchen is right now. Used to bias AWAY from slow
  -- dishes under load, never to hide them from the menu itself.
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
           r.source_item_id,
           r.recommendation_type AS rtype,
           max(r.priority)::numeric / 100 AS curated_score
      FROM public.menu_item_recommendations r, p
     WHERE r.enabled
       AND (r.language IS NULL OR r.language = p.lang)
       AND (r.start_time IS NULL OR p.now_time >= r.start_time)
       AND (r.end_time IS NULL OR p.now_time <= r.end_time)
       -- `alternative` is for the substitution path only; offering a
       -- replacement for something the guest has not lost is confusing.
       AND r.recommendation_type <> 'alternative'
       AND (
         (p.placement = 'after_meal' AND r.recommendation_type = 'after_meal')
         OR (p.placement <> 'after_meal' AND r.recommendation_type <> 'after_meal'
             AND (r.source_item_id = ANY(p.cart)
                  OR r.source_subcategory_id IN (SELECT cs.subcategory_id FROM cart_subcategories cs)))
       )
     GROUP BY 1, 2, 3
  ),
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
  /*
   * Basket completion — a cart-SHAPE rule, distinct from item-to-item pairing.
   *
   * "Two mains and no drink" is a gap the affinity table cannot see: it only
   * knows which items appear together, so it can never notice something
   * ABSENT. This is the cheapest real uplift on the list and it is also the
   * most useful to the guest, who usually did want a drink.
   */
  completion AS (
    SELECT mi.id AS item_id,
           NULL::uuid AS source_item_id,
           'add_on'::text AS rtype,
           0.55::numeric AS observed_score
      FROM public.menu_items mi, p
     WHERE p.placement = 'cart'
       AND cardinality(p.cart) > 0
       AND NOT p.has_drink
       AND mi.station = 'bar'
  ),
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
    SELECT item_id, source_item_id, rtype, 0::numeric, observed_score FROM completion
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
      public.daypart_acceptance(mi.id, p.placement, r.source_item_id, p.daypart) AS learned,
      (
        s.w_curated  * r.curated_score
      + s.w_observed * r.observed_score
      + s.w_learned  * public.daypart_acceptance(mi.id, p.placement, r.source_item_id, p.daypart)
      + s.w_margin   * (mi.margin_score::numeric / 100)
      + s.w_explore  * (30.0 / (30 + COALESCE(st.shown, 0)))
                     * (('x' || substr(md5(p.seed || mi.id::text), 1, 8))::bit(32)::bigint % 1000)::numeric / 1000
      /*
       * Capacity penalty.
       *
       * Only bites once the kitchen is genuinely behind (load factor > 1), and
       * only against dishes that are slow relative to a ten-minute yardstick.
       * Bar items are untouched — pouring a drink does not compete with the
       * pass, and under load a drink is exactly the right thing to suggest.
       */
      - CASE
          WHEN mi.station = 'bar' THEN 0
          WHEN (SELECT factor FROM load) <= 1 THEN 0
          ELSE LEAST(0.35,
                 0.05 * ((SELECT factor FROM load) - 1)
                      * (COALESCE((SELECT e.minutes FROM public.item_prep_estimate(mi.id) e), 8) / 10.0))
        END
      ) AS score
    FROM rolled r
    JOIN public.menu_items mi ON mi.id = r.item_id
    CROSS JOIN p
    CROSS JOIN s
    LEFT JOIN public.suggestion_stats st
           ON st.recommended_item_id = mi.id
          AND st.placement = p.placement
          AND st.source_item_id IS NOT DISTINCT FROM r.source_item_id
          AND st.daypart IS NULL
    WHERE s.enabled
      AND NOT p.held_out
      -- ---- Guardrails. Scoring cannot override any of these. ----
      AND public.menu_item_orderable(mi, p.now_time)
      AND NOT (mi.id = ANY(p.cart))
      AND (r.rtype IN ('upgrade_to', 'add_on', 'after_meal')
           OR mi.subcategory_id NOT IN (SELECT cs.subcategory_id FROM cart_subcategories cs))
      AND NOT (
        COALESCE(st.shown, 0) >= s.retire_after
        AND public.smoothed_acceptance(COALESCE(st.accepted, 0), COALESCE(st.shown, 0)) < s.min_acceptance
      )
      -- Never suggest meat into an all-vegetarian cart. A hard filter, not a
      -- penalty: for a guest who has shown what they eat, being offered a
      -- steak reads as not being listened to.
      AND (p.diet IS NULL
           OR (p.diet = 'vegan' AND 'vegan' = ANY(mi.dietary_tags))
           OR (p.diet = 'vegetarian' AND ('vegetarian' = ANY(mi.dietary_tags) OR 'vegan' = ANY(mi.dietary_tags))))
      -- Never suggest around an allergen the guest has filtered out.
      AND NOT (mi.allergens && p.blocked_allergens)
  )
  SELECT id, name, name_bs, name_ar, price, image_url, dietary_tags,
         rtype AS recommendation_type,
         rtype AS reason,
         source_item_id
    FROM scored
   ORDER BY score DESC, price ASC
   LIMIT (SELECT lim FROM p);
$$;

REVOKE ALL ON FUNCTION public.guest_get_recommendations(uuid[], text, text, int, uuid, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guest_get_recommendations(uuid[], text, text, int, uuid, text[]) TO anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. Something else, when the thing they wanted is gone
-- ---------------------------------------------------------------------

/**
 * The nearest orderable thing to an item that has run out.
 *
 * The `alternative` recommendation type has existed since the merchandising
 * migration with nothing reading it. Order of preference:
 *
 *   1. an explicit `alternative` rule someone curated;
 *   2. a same-subcategory item at a similar price, because that is what
 *      "similar" means to a guest reading a menu;
 *   3. nothing. An unrelated dish offered as a substitute is worse than an
 *      honest "sorry, that is off tonight".
 */
CREATE OR REPLACE FUNCTION public.guest_get_substitutes(
  _item_id uuid,
  _limit int DEFAULT 3
)
RETURNS TABLE(
  id uuid,
  name text,
  name_bs text,
  name_ar text,
  price numeric,
  image_url text,
  dietary_tags text[],
  match_reason text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH src AS (
    SELECT * FROM public.menu_items WHERE id = _item_id
  ),
  curated AS (
    SELECT r.recommended_item_id AS item_id, 1 AS rank, 'chosen by us'::text AS why
      FROM public.menu_item_recommendations r
     WHERE r.enabled
       AND r.recommendation_type = 'alternative'
       AND r.source_item_id = _item_id
  ),
  near_match AS (
    SELECT mi.id AS item_id, 2 AS rank, 'similar dish'::text AS why
      FROM public.menu_items mi, src
     WHERE mi.subcategory_id = src.subcategory_id
       AND mi.id <> src.id
       -- Within 40% on price. A guest looking at a 9 KM side does not want a
       -- 30 KM main offered as "similar".
       AND mi.price BETWEEN src.price * 0.6 AND src.price * 1.4
  ),
  merged AS (
    SELECT item_id, min(rank) AS rank, (array_agg(why ORDER BY rank))[1] AS why
      FROM (SELECT * FROM curated UNION ALL SELECT * FROM near_match) u
     GROUP BY item_id
  )
  SELECT mi.id, mi.name, mi.name_bs, mi.name_ar, mi.price, mi.image_url, mi.dietary_tags, m.why
    FROM merged m
    JOIN public.menu_items mi ON mi.id = m.item_id
   WHERE public.menu_item_orderable(mi, LOCALTIME)
   ORDER BY m.rank, mi.margin_score DESC, mi.price
   LIMIT LEAST(GREATEST(COALESCE(_limit, 3), 1), 6);
$$;

REVOKE ALL ON FUNCTION public.guest_get_substitutes(uuid, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guest_get_substitutes(uuid, int) TO anon, authenticated;

-- ---------------------------------------------------------------------
-- 5. Learning, per daypart
-- ---------------------------------------------------------------------

/**
 * Rebuild suggestion_stats with a daypart breakdown alongside the all-day row.
 *
 * BOTH granularities are kept. Keeping only dayparts would fragment a pair's
 * evidence five ways and leave every bucket too thin to learn from; keeping
 * only the all-day figure is what made coffee look like a mediocre suggestion
 * at every hour instead of a great one at 09:00 and a poor one at 22:00.
 *
 * Same name as before, so refresh_menu_intelligence() picks this up unchanged.
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
      public.daypart_of(e.occurred_at)             AS daypart,
      e.event
    FROM public.analytics_events e
    WHERE e.event IN ('suggestion_shown', 'suggestion_accepted', 'suggestion_dismissed')
      AND e.occurred_at > v_since
      AND nullif(e.props->>'item_id', '') IS NOT NULL
  ),
  -- Per daypart, and again with the daypart rolled up to NULL.
  counted AS (
    SELECT source_item_id, recommended_item_id, placement, daypart,
           count(*) FILTER (WHERE event = 'suggestion_shown')     AS shown,
           count(*) FILTER (WHERE event = 'suggestion_accepted')  AS accepted,
           count(*) FILTER (WHERE event = 'suggestion_dismissed') AS dismissed
      FROM events
     GROUP BY 1, 2, 3, 4
    UNION ALL
    SELECT source_item_id, recommended_item_id, placement, NULL::text,
           count(*) FILTER (WHERE event = 'suggestion_shown'),
           count(*) FILTER (WHERE event = 'suggestion_accepted'),
           count(*) FILTER (WHERE event = 'suggestion_dismissed')
      FROM events
     GROUP BY 1, 2, 3
  ),
  -- Money is attributed only at the all-day level: a conversion is a
  -- conversion, and splitting revenue five ways would make every per-daypart
  -- figure too small to mean anything.
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
      COALESCE(c.shown, 0)::int      AS shown,
      COALESCE(c.accepted, 0)::int   AS accepted,
      COALESCE(c.dismissed, 0)::int  AS dismissed,
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
    shown, accepted, dismissed, attributed_revenue, attributed_orders, updated_at)
  SELECT source_item_id, recommended_item_id, placement, daypart,
         shown, accepted, dismissed, revenue, orders, now()
    FROM merged
   WHERE recommended_item_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.menu_items mi WHERE mi.id = merged.recommended_item_id);

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_suggestion_stats(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refresh_suggestion_stats(int) TO authenticated;
