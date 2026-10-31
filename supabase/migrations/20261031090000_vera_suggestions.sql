-- =====================================================================
-- Vera Italia's suggestions from the first night
-- (docs/two-restaurants.md, "Suggestions")
-- =====================================================================
--
-- Vera Italia opened with no order history, and its guests were suggested
-- nothing — not on the first night, and not after weeks of orders either.
-- Anything that is not the owner's own pairing must pass the fit graph
-- (reco_fit, 20261025160000_reco_profit.sql), and that graph is La Soul's
-- café grammar: a drink with food, fries with a burger, a salad with pasta,
-- coffee and dessert after the meal. Vera Italia serves no drinks, desserts
-- or coffee; its salads are in a section called "Insalate", which read as
-- starters; its grilled chicken extra read as fries. What its own tables
-- taught the engine was gated out the same way.
--
-- Four changes, none of which moves anything of La Soul's:
--
--   1. reco_kind reads Italian section names: Antipasti are starters,
--      Insalate are salads, Extras (Dodaci) are extras, not fries. With it,
--      the existing "a salad with pasta or risotto" fit gives every pizza,
--      pasta, risotto and steak a salad on the first night. La Soul has no
--      section of those names; every one of its dishes keeps its kind.
--   2. rank_recommendations: the owner's own add-on for a dish on the table
--      is no longer pushed down by an inferred diet. Every pasta and risotto
--      at Vera Italia is vegetarian, so one in the cart read as "this table
--      is vegetarian" and buried the grilled chicken that exists to go on
--      them. A guest who switched the vegetarian filter on still never sees
--      it (guest_get_recommendations' _require_tags). Otherwise exactly the
--      ranker of 20261028100000_two_restaurants_context.sql.
--   3. Suggestion rules (menu_item_recommendations) belong to a restaurant,
--      like every other restaurant-owned row: venue_id, taken from the dish
--      suggested; a rule cannot mix two restaurants; staff read, and admins
--      change, only the rules of the restaurant they are looking at and work
--      at — the owner, either. Guests are not affected: the ranker reads the
--      rules as their owner (SECURITY DEFINER), never through these rules.
--   4. Vera Italia's house pairings: pasta and risotto → the grilled chicken,
--      then a salad; a pizza → a salad or a starter to share; the rib-eye
--      platter, which already has fries, a salad and bread → a starter to
--      share. They are written in scripts/vera-italia/menu.json and generated
--      into this file by fixed id: La Soul has sections and dishes with the
--      same names, so nothing here is looked up by name.
--
-- Then the learned counters are recounted, since some are keyed by kind.
-- Safe to run twice. Runs after 20261030130000_suggestions_per_restaurant.sql.

-- ---------------------------------------------------------------------
-- 1. What kind of thing a dish is, Italian sections included
-- ---------------------------------------------------------------------

/**
 * As in 20261025160000_reco_profit.sql, plus three section names:
 * "Antipasti" are appetizers, "Insalate" salads, and "Extras" ("Dodaci") an
 * extra for a dish — offered only where the owner pairs it, never as fries.
 */
CREATE OR REPLACE FUNCTION public.reco_kind(
  _name text, _section text, _role public.meal_role, _station text DEFAULT NULL
)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    -- A combo already comes with its drink and fries.
    WHEN n ~ '\mcombo\M' THEN 'combo'
    WHEN s ~ '(kid|djec|dječ|dijete|child)' THEN 'kids'
    WHEN n ~ '(red bull|blue beast|energy|nescaf|vitamin mix)' THEN 'no_suggest'
    WHEN n ~ '(box set|for two|for 2|to share)' THEN 'sharing'
    WHEN n ~ '\mwater\M' THEN 'water'
    WHEN n ~ 'croissant' AND s <> 'breakfast' THEN 'pastry'
    WHEN n ~ 'affogato' THEN 'dessert'
    WHEN n ~ '(avocado|\mavo\M)' AND (r IN ('cold_drink', 'hot_drink') OR st = 'bar') THEN 'smoothie'
    WHEN s = 'breakfast' THEN 'breakfast'
    WHEN s IN ('burgers', 'sliders', 'sandwiches', 'wraps') THEN 'handheld'
    WHEN s IN ('pasta', 'risotto', 'mains') THEN 'plate'
    WHEN s ~ '^(appetizer|starter|antipast)' THEN 'appetizer'
    WHEN s ~ '(salad|insalat)' THEN 'salad'
    WHEN s ~ 'soup' THEN 'soup'
    -- An extra goes on a dish ("grilled chicken on any pasta"); it is not fries.
    WHEN s IN ('extras', 'dodaci') THEN 'extra'
    WHEN s = 'fries' THEN 'fries'
    WHEN s IN ('iced tea', 'lemonade', 'mojito') THEN 'refresher'
    WHEN s = 'frappe' THEN 'frappe'
    WHEN s = 'fresh juice' THEN 'juice'
    WHEN s ~ 'dessert' THEN 'dessert'
    WHEN s = 'special drinks' THEN CASE WHEN n ~ 'matcha' THEN 'iced_coffee' ELSE 'mocktail' END
    WHEN s = 'iced coffee' OR (n ~ '(\miced\M|cold brew|\mcold\M|frozen)' AND r IN ('cold_drink', 'hot_drink'))
      THEN 'iced_coffee'
    WHEN s IN ('coffee', 'filter coffee', 'hot drinks', 'tea', 'hot')
      THEN CASE WHEN r = 'cold_drink' THEN 'iced_coffee' ELSE 'hot' END
    WHEN s IN ('other', 'soft drinks', 'drinks', 'juices') THEN 'soft'
    WHEN r = 'main' THEN 'plate'
    WHEN r = 'starter' THEN 'appetizer'
    WHEN r = 'side' THEN 'fries'
    WHEN r = 'dessert' THEN 'dessert'
    WHEN r = 'hot_drink' THEN 'hot'
    WHEN r = 'cold_drink' THEN 'soft'
    WHEN st = 'bar' THEN 'soft'
    ELSE 'other_food'
  END
  FROM (SELECT lower(btrim(COALESCE(_name, ''))) AS n,
               lower(btrim(COALESCE(_section, ''))) AS s,
               COALESCE(_role::text, '') AS r,
               COALESCE(_station, '') AS st) x;
$$;

-- ---------------------------------------------------------------------
-- 2. The ranker: the owner's add-on is not a diet statement
-- ---------------------------------------------------------------------

/**
 * Rank suggestions. Exactly 20261028100000_two_restaurants_context.sql's
 * ranker, except that a curated add_on for a dish on the table is exempt from
 * the inferred-diet penalty (see `curated_add_on`).
 */
CREATE OR REPLACE FUNCTION public.rank_recommendations(_cart_item_ids uuid[] DEFAULT '{}'::uuid[], _placement text DEFAULT 'cart'::text, _language text DEFAULT 'en'::text, _limit integer DEFAULT 4, _session_id uuid DEFAULT NULL::uuid, _exclude_allergens text[] DEFAULT '{}'::text[], _cart_quantities integer[] DEFAULT NULL::integer[])
 RETURNS TABLE(id uuid, name text, name_bs text, name_ar text, price numeric, image_url text, dietary_tags text[], recommendation_type text, reason text, source_item_id uuid, suggested_quantity integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH here AS (
    SELECT public.current_venue() AS venue
  ),
  s AS (
    SELECT
      COALESCE(recommendations_enabled, true) AS enabled,
      COALESCE(reco_weight_curated, 40)::numeric  / 100 AS w_curated,
      COALESCE(reco_weight_observed, 25)::numeric / 100 AS w_observed,
      (COALESCE(reco_weight_learned, 25) + COALESCE(reco_weight_margin, 10))::numeric / 100 AS w_value,
      COALESCE(reco_exploration, 15)::numeric     / 100 AS w_explore,
      COALESCE(reco_min_acceptance, 0.03)               AS min_acceptance,
      COALESCE(reco_retire_after_impressions, 60)       AS retire_after
    FROM public.restaurant_settings WHERE venue_id = (SELECT venue FROM here)
  ),
  -- Only this restaurant's dishes are on the table, whatever the request
  -- says: the cart and what the table ordered, less any other restaurant's.
  own AS (
    SELECT here.venue,
           ARRAY(SELECT c.id
                   FROM unnest(COALESCE(_cart_item_ids, '{}'::uuid[])) WITH ORDINALITY AS c(id, n)
                  WHERE NOT EXISTS (SELECT 1 FROM public.menu_items x
                                     WHERE x.id = c.id AND x.venue_id <> here.venue)
                  ORDER BY c.n) AS cart
      FROM here
  ),
  p AS (
    SELECT
      LEAST(GREATEST(COALESCE(_limit, 4), 1), 8) AS lim,
      own.venue,
      own.cart,
      CASE WHEN _placement IN ('cart', 'after_meal', 'item', 'tab') THEN _placement ELSE 'cart' END AS placement,
      CASE WHEN _language IN ('en', 'bs', 'ar') THEN _language ELSE 'en' END AS lang,
      public.reco_now() AS at,
      (public.reco_now() AT TIME ZONE 'Europe/Sarajevo')::time AS now_time,
      public.daypart_of(public.reco_now()) AS daypart,
      COALESCE(_session_id::text, 'anon') AS seed,
      public.guest_in_reco_holdout(_session_id) AS held_out,
      public.cart_diet(own.cart) AS diet,
      COALESCE(_exclude_allergens, '{}'::text[]) AS blocked_allergens,
      -- The wrapper adds 'alcohol' when the guest's diet filter excludes it.
      'alcohol' = ANY(COALESCE(_exclude_allergens, '{}'::text[])) AS no_alcohol,
      public.cart_has_drink(own.cart) AS has_drink,
      sc.ordered_item_ids,
      sc.served_item_ids,
      sc.minutes_since_served,
      -- The average line price includes what is in the cart right now, so the
      -- price check runs from the first round.
      (SELECT round((COALESCE(sc.running_total, 0) + COALESCE(sum(cm.price), 0))
                    / NULLIF(COALESCE(sc.line_count, 0) + count(cm.id), 0), 2)
         FROM public.menu_items cm
        WHERE cm.id = ANY(own.cart)) AS avg_line_price,
      -- Cart plus what the table already ordered: at the after-meal moment
      -- the cart is empty and this is all there is to pair against.
      (own.cart || ARRAY(SELECT t.id
                           FROM unnest(COALESCE(sc.ordered_item_ids, '{}'::uuid[])) WITH ORDINALITY AS t(id, n)
                          WHERE NOT EXISTS (SELECT 1 FROM public.menu_items x
                                             WHERE x.id = t.id AND x.venue_id <> own.venue)
                          ORDER BY t.n)) AS context,
      -- Portions on the table, this round and earlier ones: who is eating,
      -- and how many of them already have a drink.
      u.food_units,
      u.drink_units,
      CASE WHEN GREATEST(COALESCE(sc.covers, 0), u.main_units) >= 2
           THEN LEAST(GREATEST(GREATEST(COALESCE(sc.covers, 0), u.main_units) - u.drink_units, 1), 6)
           ELSE 1 END AS table_qty
    FROM public.session_context(_session_id) sc
    CROSS JOIN own
    CROSS JOIN LATERAL (
      SELECT COALESCE(sum(l.qty) FILTER (WHERE mi.meal_role = 'main'), 0)::int AS main_units,
             COALESCE(sum(l.qty) FILTER (WHERE mi.meal_role IN ('main', 'starter', 'side')
                                           OR (mi.meal_role IS NULL AND mi.station = 'kitchen')), 0)::int AS food_units,
             COALESCE(sum(l.qty) FILTER (WHERE public.role_is_drink(mi.meal_role)
                                           OR (mi.meal_role IS NULL AND mi.station = 'bar')), 0)::int AS drink_units
        FROM (
          SELECT c.item_id, LEAST(GREATEST(COALESCE(c.qty, 1), 1), 10) AS qty
            FROM unnest(COALESCE(_cart_item_ids, '{}'::uuid[]), COALESCE(_cart_quantities, '{}'::int[]))
                 AS c(item_id, qty)
           WHERE c.item_id IS NOT NULL
          UNION ALL
          SELECT oi.menu_item_id, oi.quantity
            FROM public.order_items oi
            JOIN public.orders o ON o.id = oi.order_id
           WHERE _session_id IS NOT NULL
             AND o.table_session_id = _session_id
             AND o.status NOT IN ('cancelled', 'awaiting_payment', 'payment_failed')
        ) l
        JOIN public.menu_items mi ON mi.id = l.item_id
       WHERE mi.venue_id = own.venue
    ) u
  ),
  -- How overloaded the kitchen is right now. Biases AWAY from slow dishes
  -- under load; never hides anything.
  load AS (
    SELECT COALESCE(max(kl.load_factor), 0) AS factor
      FROM public.kitchen_load() kl
     WHERE kl.station = 'kitchen'
  ),
  -- What kind of thing each dish is (see reco_kind), and the kinds on the table.
  kinds AS (
    SELECT mi.id, public.reco_kind(mi.name, sub.name, mi.meal_role, mi.station) AS kind
      FROM public.menu_items mi
      LEFT JOIN public.subcategories sub ON sub.id = mi.subcategory_id
     WHERE mi.venue_id = (SELECT venue FROM here)
  ),
  context_kinds AS (
    SELECT DISTINCT k.kind FROM kinds k, p WHERE k.id = ANY(p.context)
  ),
  cart_subcategories AS (
    SELECT DISTINCT mi.subcategory_id
      FROM public.menu_items mi, p
     WHERE mi.id = ANY(p.cart)
  ),
  -- What a section rule may match: the cart, or on the running tab (where
  -- the cart is usually empty) what the table has ordered.
  rule_subcategories AS (
    SELECT DISTINCT mi.subcategory_id
      FROM public.menu_items mi, p
     WHERE mi.id = ANY(CASE WHEN p.placement = 'tab' THEN p.context ELSE p.cart END)
  ),
  curated AS (
    SELECT r.recommended_item_id AS item_id,
           -- house pairing source: a section rule names the cart dish it matched
           COALESCE(r.source_item_id,
                    (SELECT ci.id FROM public.menu_items ci
                      WHERE ci.id = ANY(CASE WHEN p.placement = 'tab' THEN p.context ELSE p.cart END)
                        AND ci.subcategory_id = r.source_subcategory_id
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
                  OR r.source_subcategory_id IN (SELECT rs.subcategory_id FROM rule_subcategories rs)))
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
  /*
   * What tables taught it (reco_learned_pairs): dishes that tables with a
   * dish on this table — or, failing a record of its own, with a dish of
   * its section or kind — went on to order, beyond chance and from at least
   * three tables. Proposes and ranks; the gate below still decides.
   */
  learned AS (
    SELECT lp.item_id,
           lp.source_item_id,
           CASE WHEN p.placement = 'after_meal' THEN 'after_meal' ELSE 'frequently_bought_together' END::text AS rtype,
           lp.strength AS learned_score
      FROM p
      CROSS JOIN LATERAL public.reco_learned_pairs(p.context, p.at) lp
     WHERE lp.strength > 0
  ),
  -- Basket completion: a cart with food and no drink is a gap no pair table
  -- can see, because it is about something ABSENT.
  cart_kinds AS (
    SELECT DISTINCT k.kind FROM kinds k, p WHERE k.id = ANY(p.cart)
  ),
  /*
   * The fit graph also proposes, so that on the first night — no history,
   * nothing curated for this section — the right kind of thing is still on
   * the shortlist: a croissant for a fresh juice, a salad for a risotto.
   * It proposes and adds nothing to the score: fitting is the entry ticket,
   * not a merit, so margin and the price rule choose among these.
   */
  grammar AS (
    SELECT k.id AS item_id,
           (SELECT ci.id FROM public.menu_items ci JOIN kinds ck ON ck.id = ci.id
             WHERE ci.id = ANY(p.context) AND ck.kind = f.context_kind
             ORDER BY ci.price DESC, ci.id LIMIT 1) AS source_item_id,
           'goes_with'::text AS rtype,
           0::numeric AS observed_score
      FROM kinds k
      JOIN public.reco_fit f ON f.candidate_kind = k.kind
      CROSS JOIN p
     WHERE (p.placement = 'after_meal' AND f.context_kind = 'after_meal')
        OR (p.placement <> 'after_meal' AND f.context_kind IN (SELECT ck.kind FROM context_kinds ck))
  ),
  completion AS (
    SELECT mi.id AS item_id,
           -- The dish it is for, so the card can say "Goes with your burger".
           (SELECT ci.id FROM public.menu_items ci
             WHERE ci.id = ANY(p.context) AND ci.station = 'kitchen'
               AND ci.meal_role IS DISTINCT FROM 'dessert'
             ORDER BY ci.price DESC, ci.id LIMIT 1) AS source_item_id,
           'add_on'::text AS rtype,
           0.55::numeric AS observed_score
      FROM public.menu_items mi, p
     WHERE ((p.placement IN ('cart', 'item') AND cardinality(p.cart) > 0 AND NOT p.has_drink)
            -- On the running tab: the table ordered food and nothing to drink.
            OR (p.placement = 'tab' AND p.food_units > 0 AND p.drink_units = 0))
       AND mi.venue_id = p.venue
       AND public.role_is_drink(mi.meal_role)
  ),
  fallback AS (
    SELECT pop.menu_item_id AS item_id,
           NULL::uuid AS source_item_id,
           -- Labelled for what it is everywhere, the after-meal moment included.
           'popular'::text AS rtype,
           (0.08 + 0.02 * COALESCE(pop.relative, 1))::numeric AS observed_score
      FROM p
      CROSS JOIN LATERAL public.popular_items_for_daypart(p.daypart, 12, 45) pop
     WHERE NOT EXISTS (SELECT 1 FROM curated c WHERE c.item_id = pop.menu_item_id)
       AND NOT EXISTS (SELECT 1 FROM observed o WHERE o.item_id = pop.menu_item_id)
       AND NOT EXISTS (SELECT 1 FROM observed_family f WHERE f.item_id = pop.menu_item_id)
       AND NOT EXISTS (SELECT 1 FROM learned l WHERE l.item_id = pop.menu_item_id)
  ),
  candidates AS (
    SELECT item_id, source_item_id, rtype, curated_score, 0::numeric AS observed_score,
           0::numeric AS learned_score FROM curated
    UNION ALL
    SELECT item_id, source_item_id, rtype, 0::numeric, observed_score, 0::numeric FROM observed
    UNION ALL
    SELECT item_id, source_item_id, rtype, 0::numeric, observed_score, 0::numeric FROM observed_session
    UNION ALL
    SELECT item_id, source_item_id, rtype, 0::numeric, observed_score, 0::numeric FROM observed_family
    UNION ALL
    SELECT item_id, source_item_id, rtype, 0::numeric, 0::numeric, learned_score FROM learned
    UNION ALL
    SELECT item_id, source_item_id, rtype, 0::numeric, observed_score, 0::numeric FROM grammar
    UNION ALL
    SELECT item_id, source_item_id, rtype, 0::numeric, observed_score, 0::numeric FROM completion
    UNION ALL
    SELECT item_id, source_item_id, rtype, 0::numeric, observed_score, 0::numeric FROM fallback
  ),
  rolled AS (
    SELECT item_id,
           -- Say where it came from, strongest claim first: the owner's pairing
           -- or what tables taught it, whichever is stronger, then evidence,
           -- then completing the order, then the fit graph, then popularity.
           (array_agg(source_item_id ORDER BY GREATEST(curated_score, learned_score) DESC NULLS LAST,
                      CASE rtype WHEN 'frequently_bought_together' THEN 0 WHEN 'after_meal' THEN 0
                                 WHEN 'add_on' THEN 1 WHEN 'goes_with' THEN 2 ELSE 3 END,
                      observed_score DESC))[1] AS source_item_id,
           (array_agg(rtype ORDER BY GREATEST(curated_score, learned_score) DESC,
                      CASE rtype WHEN 'frequently_bought_together' THEN 0 WHEN 'after_meal' THEN 0
                                 WHEN 'add_on' THEN 1 WHEN 'goes_with' THEN 2 ELSE 3 END,
                      observed_score DESC))[1] AS rtype,
           max(curated_score)  AS curated_score,
           max(observed_score) AS observed_score,
           max(learned_score)  AS learned_score,
           -- The owner's own add-on for a dish on the table: chicken on the pasta.
           bool_or(rtype = 'add_on' AND curated_score > 0) AS curated_add_on
      FROM candidates
     GROUP BY item_id
  ),
  -- Everything that passed the guardrails, with what scoring needs.
  eligible AS (
    SELECT
      mi.id, mi.name, mi.name_bs, mi.name_ar, mi.price, mi.image_url, mi.dietary_tags,
      mi.margin_score,
      r.rtype, r.source_item_id, r.curated_score, r.observed_score, r.learned_score,
      -- Drinks for the table: one for each person still without one, when the
      -- whole order is in view (the cart before sending, or the running tab).
      CASE WHEN p.placement IN ('cart', 'tab') AND public.role_is_drink(mi.meal_role)
           THEN p.table_qty ELSE 1 END AS suggested_quantity,
      k.kind,
      /*
       * How likely a guest is to take something at this price next to this
       * meal, before there is any record to say. Up to a comfortable share of
       * the table's average line (40% for a drink or side, 80% for a dessert
       * or starter, 100% for a main) price does not matter; beyond it the
       * chance falls with the square of the overshoot, so past that point a
       * dearer dish is expected to earn less, not more. It fades as the
       * pair's own record grows.
       */
      CASE WHEN p.avg_line_price IS NULL OR p.avg_line_price <= 0 OR mi.price <= 0 THEN 1
           ELSE LEAST(1, GREATEST(0.01, power(
                  (CASE WHEN mi.meal_role = 'main' THEN 1.0
                        WHEN mi.meal_role IN ('dessert', 'starter') THEN 0.8
                        ELSE 0.4 END) * p.avg_line_price / mi.price, 2)))
      END AS price_fit,
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
      -- from the rest of the table. Never against the owner's own add-on for
      -- a dish on the table: at Vera Italia every pasta and risotto is
      -- vegetarian, so the inferred diet buried the chicken that exists to go
      -- on them. A guest's own filter (_require_tags) still removes it.
      CASE
        WHEN p.diet IS NULL THEN 0
        WHEN r.curated_add_on THEN 0
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
        -- A dessert or a starter is a course of its own, not a side: it may
        -- cost a little more than the average line before this bites.
        WHEN mi.meal_role IN ('dessert', 'starter') THEN
          CASE
            WHEN mi.price <= p.avg_line_price * 1.2 THEN 0
            ELSE LEAST(0.25, 0.30 * (mi.price / p.avg_line_price - 1.2))
          END
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
    JOIN kinds k ON k.id = mi.id
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
      -- Never another restaurant's dish, whichever source proposed it.
      AND mi.venue_id = p.venue
      -- ---- Relevance first: a candidate is only scored if it belongs. ----
      -- Never volunteered: see reco_vetoed.
      AND NOT public.reco_vetoed(k.kind, mi.meal_role, r.curated_score > 0, p.at, p.placement)
      -- A reason to be here: the owner paired it, or the fit graph says it
      -- goes with something on the table (or after the meal). Popularity,
      -- co-occurrence and margin only ever rank what passed this.
      AND (r.curated_score > 0 OR EXISTS (
            SELECT 1 FROM public.reco_fit f
             WHERE f.candidate_kind = k.kind
               AND CASE WHEN p.placement = 'after_meal'
                        THEN f.context_kind = 'after_meal'
                        ELSE f.context_kind IN (SELECT ck.kind FROM context_kinds ck) END))
      -- Nothing that clashes with what is on the table, curated or not.
      AND NOT EXISTS (
            SELECT 1 FROM public.reco_clash c
             WHERE c.candidate_kind = k.kind
               AND c.context_kind IN (SELECT ck.kind FROM context_kinds ck))
      -- No second of a kind already in this round: we can add, not swap, so
      -- an "upgrade" to truffle fries next to regular fries is a second side.
      AND (p.placement = 'after_meal' OR k.kind NOT IN (SELECT kk.kind FROM cart_kinds kk))
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
                   OR EXISTS (SELECT 1 FROM learned lr WHERE lr.item_id = mi.id)
                 THEN 'observed' ELSE r.rtype END,
            r.curated_score > 0,
            p.cart,
            _session_id,
            p.at,
            p.no_alcohol)
      -- A kids' meal is for a child the menu cannot see: only when curated.
      AND (r.curated_score > 0 OR NOT EXISTS (
            SELECT 1 FROM public.subcategories ks
             WHERE ks.id = mi.subcategory_id
               AND ks.name ~* '(kid|djec|dječ|dijete|child)'))
  ),
  valued AS (
    SELECT e.*,
           e.p_accept * e.unit_cm * (1 - (1 - e.price_fit) * (1 - e.evidence)) AS expected_value
      FROM eligible e
  ),
  scored AS (
    SELECT v.*,
      -- Curated priority and observed strength stand in for "guests will take
      -- this". Once a pair has a record of its own they give way to it, down
      -- to a fifth, and measured expected profit decides. What tables taught
      -- it ranks on the curated scale: the stronger of the two counts.
      ( GREATEST(0.2, 1 - v.evidence) * (s.w_curated * GREATEST(v.curated_score, v.learned_score)
                                         + s.w_observed * v.observed_score)
      -- Expected profit: a light hand while it rests on assumptions, the
      -- full weight once the pair has a record.
      + s.w_value * (0.3 + 0.7 * v.evidence)
                  * COALESCE(v.expected_value / NULLIF(max(v.expected_value) OVER (), 0), 0)
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
         source_item_id,
         suggested_quantity
    FROM scored
   ORDER BY score DESC, price ASC, id
   LIMIT (SELECT lim FROM p);
$function$;

REVOKE ALL ON FUNCTION public.rank_recommendations(uuid[], text, text, int, uuid, text[], int[]) FROM PUBLIC, anon;

-- ---------------------------------------------------------------------
-- 3. Suggestion rules belong to a restaurant
-- ---------------------------------------------------------------------

ALTER TABLE public.menu_item_recommendations
  ADD COLUMN IF NOT EXISTS venue_id uuid REFERENCES public.venues(id) ON DELETE CASCADE;

-- Every rule so far suggests a dish of one restaurant: it is that restaurant's.
UPDATE public.menu_item_recommendations r
   SET venue_id = COALESCE((SELECT mi.venue_id FROM public.menu_items mi WHERE mi.id = r.recommended_item_id),
                           public.default_venue())
 WHERE r.venue_id IS NULL;

ALTER TABLE public.menu_item_recommendations ALTER COLUMN venue_id SET DEFAULT public.current_venue();
ALTER TABLE public.menu_item_recommendations ALTER COLUMN venue_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_reco_venue ON public.menu_item_recommendations(venue_id);

-- A rule is the restaurant of the dish it suggests ...
DROP TRIGGER IF EXISTS aa_inherit_venue ON public.menu_item_recommendations;
CREATE TRIGGER aa_inherit_venue BEFORE INSERT OR UPDATE ON public.menu_item_recommendations
  FOR EACH ROW EXECUTE FUNCTION public.inherit_venue('menu_items', 'recommended_item_id');
-- ... the dish or section it goes with is of the same restaurant ...
DROP TRIGGER IF EXISTS ab_same_venue ON public.menu_item_recommendations;
CREATE TRIGGER ab_same_venue BEFORE INSERT OR UPDATE ON public.menu_item_recommendations
  FOR EACH ROW EXECUTE FUNCTION public.guard_same_venue(
    'source_item_id', 'menu_items', 'source_subcategory_id', 'subcategories');
-- ... and whatever function a change comes through, only someone who works there makes it.
DROP TRIGGER IF EXISTS ac_venue_access ON public.menu_item_recommendations;
CREATE TRIGGER ac_venue_access BEFORE INSERT OR UPDATE OR DELETE ON public.menu_item_recommendations
  FOR EACH ROW EXECUTE FUNCTION public.guard_venue_access();

-- The same lens as every other restaurant-owned table (20261028100000, 2b):
-- one restaurant's rules at a time, the one the app is showing, and only for
-- someone who works there. A restaurant's admin is always shown their own.
DROP POLICY IF EXISTS "Staff read recommendations" ON public.menu_item_recommendations;
CREATE POLICY "Staff read recommendations" ON public.menu_item_recommendations
  FOR SELECT TO authenticated
  USING (venue_id = (SELECT public.current_venue()) AND (SELECT public.can_staff(public.current_venue())));

DROP POLICY IF EXISTS "Admins manage recommendations" ON public.menu_item_recommendations;
CREATE POLICY "Admins manage recommendations" ON public.menu_item_recommendations
  FOR ALL TO authenticated
  USING (venue_id = (SELECT public.current_venue()) AND (SELECT public.can_admin(public.current_venue())))
  WITH CHECK (venue_id = (SELECT public.current_venue()) AND (SELECT public.can_admin(public.current_venue())));

-- ---------------------------------------------------------------------
-- 4. Vera Italia's house pairings
-- ---------------------------------------------------------------------
-- Ordinary rules: the owner can switch any of them off or change it in
-- Admin → Service & suggestions, and learning reorders them as orders come.

-- BEGIN GENERATED by scripts/vera-italia/pairings-sql.mjs from scripts/vera-italia/menu.json
-- 15 pairings. A dish or section deleted in the admin since is skipped,
-- and a rule already there (by id) is left as the owner has it.
INSERT INTO public.menu_item_recommendations
       (id, source_subcategory_id, recommended_item_id, recommendation_type, priority)
SELECT v.id::uuid, v.section::uuid, v.dish::uuid, v.kind, v.priority::smallint
  FROM (VALUES
    ('b7a1e000-0000-4000-8000-000000000001', 'b7a15000-0000-4000-8000-000000000021', 'b7a1d000-0000-4000-8000-000000000014', 'add_on', 95),  -- Pasta → Grilled Chicken: The menu offers grilled chicken on any pasta: the add-on a waiter would mention first.
    ('b7a1e000-0000-4000-8000-000000000002', 'b7a15000-0000-4000-8000-000000000021', 'b7a1d000-0000-4000-8000-000000000004', 'pair_with', 40),  -- Pasta → Grilled Vegetable Salad: A salad beside the pasta, after the chicken: low enough that the chicken still leads while the engine explores.
    ('b7a1e000-0000-4000-8000-000000000003', 'b7a15000-0000-4000-8000-000000000021', 'b7a1d000-0000-4000-8000-000000000003', 'pair_with', 35),  -- Pasta → Insalata Caprese: A salad beside the pasta, after the chicken: low enough that the chicken still leads while the engine explores.
    ('b7a1e000-0000-4000-8000-000000000004', 'b7a15000-0000-4000-8000-000000000022', 'b7a1d000-0000-4000-8000-000000000014', 'add_on', 95),  -- Risotto → Grilled Chicken: The menu offers grilled chicken on any risotto.
    ('b7a1e000-0000-4000-8000-000000000005', 'b7a15000-0000-4000-8000-000000000022', 'b7a1d000-0000-4000-8000-000000000004', 'pair_with', 40),  -- Risotto → Grilled Vegetable Salad: A salad beside the risotto, after the chicken: low enough that the chicken still leads while the engine explores.
    ('b7a1e000-0000-4000-8000-000000000006', 'b7a15000-0000-4000-8000-000000000022', 'b7a1d000-0000-4000-8000-000000000003', 'pair_with', 35),  -- Risotto → Insalata Caprese: A salad beside the risotto, after the chicken: low enough that the chicken still leads while the engine explores.
    ('b7a1e000-0000-4000-8000-000000000007', 'b7a15000-0000-4000-8000-000000000031', 'b7a1d000-0000-4000-8000-000000000004', 'pair_with', 75),  -- Classiche → Grilled Vegetable Salad: The classics already carry tomato and mozzarella: grilled vegetables rather than a caprese.
    ('b7a1e000-0000-4000-8000-000000000008', 'b7a15000-0000-4000-8000-000000000031', 'b7a1d000-0000-4000-8000-000000000001', 'pair_with', 65),  -- Classiche → Bruschetta: A starter to share before the pizza.
    ('b7a1e000-0000-4000-8000-000000000009', 'b7a15000-0000-4000-8000-000000000031', 'b7a1d000-0000-4000-8000-000000000002', 'pair_with', 55),  -- Classiche → Baked Feta Dip: A starter to share before the pizza.
    ('b7a1e000-0000-4000-8000-000000000010', 'b7a15000-0000-4000-8000-000000000032', 'b7a1d000-0000-4000-8000-000000000003', 'pair_with', 75),  -- Speciali → Insalata Caprese: Fresh tomato and mozzarella beside a white-cream pizza.
    ('b7a1e000-0000-4000-8000-000000000011', 'b7a15000-0000-4000-8000-000000000032', 'b7a1d000-0000-4000-8000-000000000004', 'pair_with', 65),  -- Speciali → Grilled Vegetable Salad: A salad beside the pizza.
    ('b7a1e000-0000-4000-8000-000000000012', 'b7a15000-0000-4000-8000-000000000032', 'b7a1d000-0000-4000-8000-000000000001', 'pair_with', 60),  -- Speciali → Bruschetta: A starter to share before the pizza.
    ('b7a1e000-0000-4000-8000-000000000013', 'b7a15000-0000-4000-8000-000000000041', 'b7a1d000-0000-4000-8000-000000000002', 'pair_with', 75),  -- Bistecca → Baked Feta Dip: The platter already has fries, a walnut salad and baguette: a starter to share.
    ('b7a1e000-0000-4000-8000-000000000014', 'b7a15000-0000-4000-8000-000000000041', 'b7a1d000-0000-4000-8000-000000000001', 'pair_with', 70),  -- Bistecca → Bruschetta: A starter to share before the steak.
    ('b7a1e000-0000-4000-8000-000000000015', 'b7a15000-0000-4000-8000-000000000041', 'b7a1d000-0000-4000-8000-000000000003', 'pair_with', 55)   -- Bistecca → Insalata Caprese: A lighter starter before the steak.
  ) AS v(id, section, dish, kind, priority)
 WHERE EXISTS (SELECT 1 FROM public.subcategories s WHERE s.id = v.section::uuid)
   AND EXISTS (SELECT 1 FROM public.menu_items mi WHERE mi.id = v.dish::uuid)
ON CONFLICT (id) DO NOTHING;
-- END GENERATED

-- ---------------------------------------------------------------------
-- 5. Learned counters, recounted
-- ---------------------------------------------------------------------
-- Counters at the 'kind' level are keyed by the kind's name, and Vera
-- Italia's salads and its extra have new ones. The full rebuild is what the
-- scheduled refresh runs every night (refresh_menu_intelligence); it is run
-- here as that job, if this connection may run it, and otherwise left to it.
DO $recount$
BEGIN
  PERFORM set_config('lasoul.scheduled_job', 'on', true);
  IF public.is_trusted_caller() THEN
    PERFORM public.rebuild_reco_learning(365);
  ELSE
    RAISE NOTICE 'learned counters not recounted here: the next scheduled refresh does it';
  END IF;
  PERFORM set_config('lasoul.scheduled_job', '', true);
END
$recount$;
