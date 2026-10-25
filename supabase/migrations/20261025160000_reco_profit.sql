-- =====================================================================
-- Suggestions a good waiter would make, and that earn the most
--
-- The objective is the incremental contribution margin a suggestion adds to a
-- visit, without making the guest's evening worse: one card at a time, always
-- dismissible, never pushy, never silly. Relevance comes first and is a gate,
-- not a weight; profit only orders what passed it. Six changes:
--
--   0. The relevance gate. Every dish has a kind (reco_kind: burger, pasta,
--      breakfast, dessert, pastry, coffee, refresher, soft drink, ...). A
--      candidate that is not a curated pairing is considered only if
--      reco_fit says its kind goes with a kind on the table — a drink with
--      food, fries with a burger, a salad with pasta, coffee or dessert after
--      the meal, a pastry with coffee — and never if reco_vetoed says no (a
--      main course, a kids' dish, a box for sharing, an energy drink, a
--      breakfast dish after noon). Learned co-occurrence and popularity
--      only rank what passed. If nothing passes, the card stays empty.
--      The fit graph is a table the owner can edit.
--
--   1. Drinks for the table. When the whole order is in view — the cart
--      before sending, or the running tab — and the table has more people
--      (covers, or mains ordered) than drinks, a drink suggestion carries a
--      quantity: one for each person still without one, at most six. The
--      card says so plainly and the guest can take just one. The decision
--      records the quantity it offered; the paid line records what was
--      actually ordered.
--
--   2. A new moment: the running tab while the table waits ('tab'). A table
--      that ordered food and nothing to drink is offered a drink there — only
--      a drink, and only while the visit has none.
--
--   3. Profit decides once it is known. Curated priority and observed pair
--      strength are stand-ins for "guests will take this"; as a pair builds
--      its own record they shrink to a fifth of their weight and measured
--      expected profit (acceptance × margin) takes over. At cold start nothing
--      changes: relevance and price proportionality still lead.
--
--   4. House pairings lean towards margin. Each seeded rule the owner has not
--      edited moves by up to ten priority points, by its dish's unit margin
--      against the others in the same rule group (menu_unit_margins: food
--      costs where entered, role defaults otherwise). Two high-margin
--      after-meal rules are added.
--
--   5. Halal by default. Everything served is halal and alcohol-free, so a
--      "halal" filter no longer hides dishes that merely lack the tag, and
--      the alcohol rule is simply "never" (menu_items_no_alcohol already
--      makes such a dish impossible).
--
-- Before any order history exists, a guest is assumed less likely to take
-- an accompaniment the dearer it is next to the meal (price_fit), so
-- margin can already choose between suitable drinks without pushing a
-- 14 KM coffee next to a 15 KM burger; the assumption fades as each pair
-- builds a record. `reco_now()` lets tests fix the clock.
--
-- The ranker and the guest wrapper change their result (a quantity column),
-- so both are dropped and created again; every guardrail is carried over
-- unchanged. Runs after 20261025150000_menu_corrections.sql.
-- =====================================================================

ALTER TABLE public.recommendation_decisions
  ADD COLUMN IF NOT EXISTS suggested_quantity int;

COMMENT ON COLUMN public.recommendation_decisions.suggested_quantity IS
  'How many of the chosen dish the card offered (drinks for the table). The '
  'order line, not this, says how many were bought.';

-- ---------------------------------------------------------------------
-- 0. Relevance is a gate, not a score
-- ---------------------------------------------------------------------

/**
 * The time the ranker reasons about: now(), unless a test or the waiter
 * scenarios fix it with `SET lasoul.reco_now = '<timestamptz>'`. No API role
 * can set that, so on the live database this is now().
 */
CREATE OR REPLACE FUNCTION public.reco_now()
RETURNS timestamptz
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(NULLIF(current_setting('lasoul.reco_now', true), '')::timestamptz, now());
$$;

/**
 * What kind of thing a dish is, for the question "does it go with that?".
 *
 * Read off the section the menu already has, with a few names that say more
 * than their section: a croissant on the dessert list is a pastry, an
 * affogato on the drinks list is a dessert, an avocado juice is a meal in a
 * glass, and an energy drink, instant coffee or a box for sharing is never
 * something to volunteer. Kinds:
 *
 *   food      breakfast, handheld (burgers, sliders), plate (pasta, risotto),
 *             appetizer, salad, soup, fries, kids, combo (comes with a drink
 *             and fries), dessert, pastry, sharing, other_food
 *   drinks    hot (coffee, tea, hot chocolate), iced_coffee, frappe,
 *             refresher (lemonade, iced tea, mojito), juice, smoothie,
 *             mocktail, soft (sodas, bottled juices), water, no_suggest
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
    WHEN s ~ '^(appetizer|starter)' THEN 'appetizer'
    WHEN s ~ 'salad' THEN 'salad'
    WHEN s ~ 'soup' THEN 'soup'
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

/**
 * What goes with what: "with <context kind> you may offer <candidate kind>".
 *
 * A candidate that is not a curated pairing must have a row here for
 * something on the table, whatever its popularity, co-occurrence or margin;
 * if nothing qualifies the card stays empty. `after_meal` is the moment after
 * a main was served. The owner can add or delete rows; this is the list a
 * head waiter at La Soul would sign:
 *
 *   savoury food           → a cold soft drink, lemonade/iced tea/mojito,
 *                            a fruit mocktail, fresh juice, water
 *   burgers, sliders, kids → fries
 *   pasta, risotto         → a salad
 *   breakfast              → coffee or tea, fresh juice, an iced coffee,
 *                            a smoothie, water
 *   a dessert              → coffee or tea, an iced coffee, water
 *   a pastry               → coffee or tea, fresh juice, an iced coffee
 *   coffee, iced coffee    → a pastry, a dessert
 *   a juice or smoothie    → a pastry
 *   after the meal         → a dessert, coffee or tea, an iced coffee
 *
 * Deliberately absent: food for someone who only ordered a drink, a frappé
 * or smoothie with a savoury meal, a soup or starter on its own, any second
 * main, and anything from a kids' menu or for sharing (unless curated).
 */
CREATE TABLE IF NOT EXISTS public.reco_fit (
  context_kind text NOT NULL,
  candidate_kind text NOT NULL,
  note text,
  PRIMARY KEY (context_kind, candidate_kind)
);

-- Access first, then row level security and the policies below (Supabase no
-- longer grants new tables to the API roles by default).
REVOKE ALL ON public.reco_fit FROM PUBLIC, anon;
GRANT SELECT ON public.reco_fit TO authenticated;
GRANT ALL ON public.reco_fit TO service_role;

ALTER TABLE public.reco_fit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Staff read reco fit" ON public.reco_fit;
CREATE POLICY "Staff read reco fit" ON public.reco_fit
  FOR SELECT TO authenticated USING (public.is_staff_member());

INSERT INTO public.reco_fit(context_kind, candidate_kind, note)
SELECT c, d, 'a drink with savoury food'
  FROM unnest(ARRAY['handheld', 'plate', 'appetizer', 'salad', 'soup', 'fries', 'kids', 'other_food']) c
 CROSS JOIN unnest(ARRAY['refresher', 'soft', 'mocktail', 'water', 'juice']) d
UNION ALL
SELECT c, d, n FROM (VALUES
  ('handheld', 'fries', 'fries with a burger or slider'),
  ('kids', 'fries', 'fries with a kids'' dish'),
  ('plate', 'salad', 'a salad with pasta or risotto'),
  ('breakfast', 'hot', 'coffee or tea with breakfast'),
  ('breakfast', 'juice', 'fresh juice with breakfast'),
  ('breakfast', 'iced_coffee', 'an iced coffee with breakfast'),
  ('breakfast', 'smoothie', 'a smoothie with breakfast'),
  ('breakfast', 'water', 'water with breakfast'),
  ('dessert', 'hot', 'coffee or tea with dessert'),
  ('dessert', 'iced_coffee', 'an iced coffee with dessert'),
  ('dessert', 'water', 'water with dessert'),
  ('pastry', 'hot', 'coffee or tea with a pastry'),
  ('pastry', 'juice', 'fresh juice with a pastry'),
  ('pastry', 'iced_coffee', 'an iced coffee with a pastry'),
  ('hot', 'pastry', 'a pastry with coffee'),
  ('hot', 'dessert', 'something sweet with coffee'),
  ('iced_coffee', 'pastry', 'a pastry with an iced coffee'),
  ('iced_coffee', 'dessert', 'something sweet with an iced coffee'),
  ('juice', 'pastry', 'a pastry with fresh juice'),
  ('smoothie', 'pastry', 'a pastry with a smoothie'),
  ('after_meal', 'dessert', 'dessert after the meal'),
  ('after_meal', 'hot', 'coffee or tea after the meal'),
  ('after_meal', 'iced_coffee', 'an iced coffee after the meal')
) v(c, d, n)
ON CONFLICT (context_kind, candidate_kind) DO NOTHING;

/**
 * Pairs that clash whoever proposed them, the owner included: something
 * sweet with a frappé or a smoothie, which already are dessert in a glass.
 */
CREATE TABLE IF NOT EXISTS public.reco_clash (
  context_kind text NOT NULL,
  candidate_kind text NOT NULL,
  note text,
  PRIMARY KEY (context_kind, candidate_kind)
);

-- Access first, then row level security and the policies below (Supabase no
-- longer grants new tables to the API roles by default).
REVOKE ALL ON public.reco_clash FROM PUBLIC, anon;
GRANT SELECT ON public.reco_clash TO authenticated;
GRANT ALL ON public.reco_clash TO service_role;

ALTER TABLE public.reco_clash ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Staff read reco clash" ON public.reco_clash;
CREATE POLICY "Staff read reco clash" ON public.reco_clash
  FOR SELECT TO authenticated USING (public.is_staff_member());

INSERT INTO public.reco_clash(context_kind, candidate_kind, note) VALUES
  ('frappe', 'dessert', 'a frappé is already dessert'),
  ('smoothie', 'dessert', 'a smoothie is already a meal'),
  ('breakfast', 'dessert', 'breakfast is not followed by cake at the same order')
ON CONFLICT (context_kind, candidate_kind) DO NOTHING;

/**
 * Never volunteered, whatever the score: an alcoholic drink; a breakfast dish
 * outside 05:00–12:00 (Sarajevo); a dessert before 11:00 (a croissant, yes;
 * a cake with the morning coffee or after breakfast, no), nothing sweet after
 * breakfast at all, and no croissant in the evening; and, unless the owner
 * curated it, a main course, a kids' dish or combo, a dish for sharing, or an
 * energy drink.
 */
CREATE OR REPLACE FUNCTION public.reco_vetoed(
  _kind text, _role public.meal_role, _curated boolean, _at timestamptz, _placement text DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(_role = 'alcohol', false)
      OR (_kind = 'breakfast' AND h NOT BETWEEN 5 AND 11)
      OR (_kind = 'dessert' AND h BETWEEN 5 AND 10)
      OR (_kind = 'pastry' AND (h >= 18 OR h < 5))
      OR (_placement = 'after_meal' AND _kind = 'pastry' AND h BETWEEN 5 AND 10)
      OR (NOT COALESCE(_curated, false)
          AND (_kind IN ('no_suggest', 'sharing', 'kids', 'combo') OR COALESCE(_role = 'main', false)))
    FROM (SELECT EXTRACT(HOUR FROM (COALESCE(_at, now()) AT TIME ZONE 'Europe/Sarajevo')) AS h) x;
$$;

-- ---------------------------------------------------------------------
-- 1. What fits the moment, now with the running tab
-- ---------------------------------------------------------------------

/**
 * Does a candidate of this role belong in this moment?
 *
 * Unchanged except:
 *   * alcohol is never suggested — La Soul serves none;
 *   * something sweet (a dessert or a pastry) may go with a cart of drinks —
 *     coffee and cake — but never next to a meal still in the cart, curated
 *     or not: dessert has its own moment, after the meal;
 *   * a kids' combo counts as having its drink;
 *   * 'tab' (the running tab while the table waits): only a drink, only to a
 *     visit with no drink in it yet; a hot one in the morning or when there
 *     is no meal on the table, otherwise cold. Curated pairs follow the same
 *     rule there: the tab is not the place to sell a side.
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
  v_visit_meal boolean;
  v_morning boolean := EXTRACT(HOUR FROM (COALESCE(_at, now()) AT TIME ZONE 'Europe/Sarajevo')) < 11;
BEGIN
  -- Halal and alcohol-free: menu_items_no_alcohol makes such a dish
  -- impossible; this keeps the ranker from ever being the thing that offers one.
  IF _candidate_role = 'alcohol' THEN
    RETURN false;
  END IF;

  SELECT COALESCE(bool_or(mi.meal_role = 'main'), false),
         COALESCE(bool_or(mi.meal_role = 'starter'), false),
         -- An unclassified bar item still counts as a drink, and so does a
         -- combo, which comes with one.
         COALESCE(bool_or(public.role_is_drink(mi.meal_role)
                          OR (mi.meal_role IS NULL AND mi.station = 'bar')
                          OR mi.name ~* '\mcombo\M'), false),
         COALESCE(bool_or(mi.meal_role = 'dessert'), false)
    INTO v_cart_main, v_cart_starter, v_cart_drink, v_cart_dessert
    FROM public.menu_items mi
   WHERE mi.id = ANY(COALESCE(_cart, '{}'::uuid[]));

  IF _placement = 'tab' THEN
    IF NOT COALESCE(public.role_is_drink(_candidate_role), false) THEN
      RETURN false;
    END IF;
    SELECT COALESCE(bool_or(public.role_is_drink(mi.meal_role)
                            OR (mi.meal_role IS NULL AND mi.station = 'bar')
                            OR mi.name ~* '\mcombo\M'), false),
           COALESCE(bool_or(mi.meal_role IN ('main', 'starter')), false)
      INTO v_visit_drink, v_visit_meal
      FROM public.order_items oi
      JOIN public.orders o ON o.id = oi.order_id
      JOIN public.menu_items mi ON mi.id = oi.menu_item_id
     WHERE o.table_session_id = _session_id
       AND o.status NOT IN ('cancelled', 'awaiting_payment', 'payment_failed');
    IF COALESCE(v_visit_drink, false) OR v_cart_drink THEN
      RETURN false;
    END IF;
    RETURN _candidate_role = 'cold_drink'
        OR v_morning
        OR NOT (COALESCE(v_visit_meal, false) OR v_cart_main OR v_cart_starter);
  END IF;

  IF COALESCE(_is_curated, false) THEN
    -- The owner chose the pairing, so the moment is theirs to decide — but a
    -- second serving of the same course is never what they meant, and a cake
    -- or a croissant next to a meal still in the cart belongs after it.
    RETURN NOT (
         COALESCE(public.role_is_drink(_candidate_role) AND v_cart_drink, false)
      OR COALESCE(_candidate_role = 'main' AND v_cart_main, false)
      OR COALESCE(_candidate_role = 'dessert' AND (v_cart_dessert OR v_cart_main OR v_cart_starter), false)
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

  RETURN CASE _candidate_role
    WHEN 'hot_drink'  THEN NOT v_cart_drink AND (NOT (v_cart_main OR v_cart_starter) OR v_morning)
    WHEN 'cold_drink' THEN NOT v_cart_drink
    WHEN 'side'       THEN v_cart_main
    WHEN 'starter'    THEN v_cart_main
    WHEN 'main'       THEN NOT (v_cart_main OR v_cart_starter)
    -- Coffee and cake: something sweet for a cart of drinks only; with a
    -- meal it waits for the after-meal moment.
    WHEN 'dessert'    THEN NOT (v_cart_main OR v_cart_starter OR v_cart_dessert)
    ELSE false
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.reco_role_fits(public.meal_role, text, text, boolean, uuid[], uuid, timestamptz, boolean)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. The ranker: quantity, the tab, and profit once it is known
-- ---------------------------------------------------------------------

-- The result gains a column, which CREATE OR REPLACE cannot do.
DROP FUNCTION IF EXISTS public.rank_recommendations(uuid[], text, text, int, uuid, text[]);

/**
 * Rank suggestions for a cart, a dish page, the running tab or the
 * after-meal moment. As in 20261025100000_reco_learning_v3.sql, plus:
 *
 *   * `_cart_quantities` (parallel to `_cart_item_ids`) and the visit's own
 *     lines give the portions on the table; `suggested_quantity` is how many
 *     of a drink to offer at the cart or the tab — one for each person (covers,
 *     or mains if more) still without a drink, 1 to 6 — and 1 otherwise. It
 *     never changes the ranking: the ranker picks WHAT, the table decides how
 *     many.
 *   * placement 'tab': curated rules match what the table ordered, and basket
 *     completion offers a drink to a visit with food and no drink.
 *   * curated and observed scores shrink towards a fifth as the pair's
 *     evidence grows, so expected profit decides once it is measured;
 *   * the relevance gate (reco_vetoed, reco_fit) before any scoring, and
 *     price_fit in the expected value until the pair has a record;
 *   * basket completion names the dish it completes, and popularity is
 *     labelled 'popular' at every placement.
 */
CREATE OR REPLACE FUNCTION public.rank_recommendations(
  _cart_item_ids uuid[] DEFAULT '{}'::uuid[],
  _placement text DEFAULT 'cart',
  _language text DEFAULT 'en',
  _limit int DEFAULT 4,
  _session_id uuid DEFAULT NULL,
  _exclude_allergens text[] DEFAULT '{}'::text[],
  _cart_quantities int[] DEFAULT NULL
)
RETURNS TABLE(id uuid, name text, name_bs text, name_ar text, price numeric, image_url text,
              dietary_tags text[], recommendation_type text, reason text, source_item_id uuid,
              suggested_quantity int)
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
      CASE WHEN _placement IN ('cart', 'after_meal', 'item', 'tab') THEN _placement ELSE 'cart' END AS placement,
      CASE WHEN _language IN ('en', 'bs', 'ar') THEN _language ELSE 'en' END AS lang,
      public.reco_now() AS at,
      (public.reco_now() AT TIME ZONE 'Europe/Sarajevo')::time AS now_time,
      public.daypart_of(public.reco_now()) AS daypart,
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
      (COALESCE(_cart_item_ids, '{}'::uuid[]) || COALESCE(sc.ordered_item_ids, '{}'::uuid[])) AS context,
      -- Portions on the table, this round and earlier ones: who is eating,
      -- and how many of them already have a drink.
      u.food_units,
      u.drink_units,
      CASE WHEN GREATEST(COALESCE(sc.covers, 0), u.main_units) >= 2
           THEN LEAST(GREATEST(GREATEST(COALESCE(sc.covers, 0), u.main_units) - u.drink_units, 1), 6)
           ELSE 1 END AS table_qty
    FROM public.session_context(_session_id) sc
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
    SELECT item_id, source_item_id, rtype, 0::numeric, observed_score FROM grammar
    UNION ALL
    SELECT item_id, source_item_id, rtype, 0::numeric, observed_score FROM completion
    UNION ALL
    SELECT item_id, source_item_id, rtype, 0::numeric, observed_score FROM fallback
  ),
  rolled AS (
    SELECT item_id,
           -- Say where it came from, strongest claim first: the owner's pairing,
           -- then evidence, then completing the order, then the fit graph,
           -- then popularity.
           (array_agg(source_item_id ORDER BY curated_score DESC NULLS LAST,
                      CASE rtype WHEN 'frequently_bought_together' THEN 0 WHEN 'after_meal' THEN 0
                                 WHEN 'add_on' THEN 1 WHEN 'goes_with' THEN 2 ELSE 3 END,
                      observed_score DESC))[1] AS source_item_id,
           (array_agg(rtype ORDER BY curated_score DESC,
                      CASE rtype WHEN 'frequently_bought_together' THEN 0 WHEN 'after_meal' THEN 0
                                 WHEN 'add_on' THEN 1 WHEN 'goes_with' THEN 2 ELSE 3 END,
                      observed_score DESC))[1] AS rtype,
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
      -- to a fifth, and measured expected profit decides.
      ( GREATEST(0.2, 1 - v.evidence) * (s.w_curated * v.curated_score + s.w_observed * v.observed_score)
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
$$;

REVOKE ALL ON FUNCTION public.rank_recommendations(uuid[], text, text, int, uuid, text[], int[]) FROM PUBLIC, anon;


-- ---------------------------------------------------------------------
-- 3. The wrapper: quantities in, quantity recorded, halal not a filter
-- ---------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.guest_get_recommendations(uuid, text, uuid[], text, text, int, text[], text[], uuid[]);

/*
 * Same behaviour as before, plus:
 *   * `_cart_quantities` is passed to the ranker for drinks for the table;
 *   * the decision records `suggested_quantity`, and the shortlist each
 *     candidate's `qty`;
 *   * 'halal', 'alcohol_free' and 'no_alcohol' are dropped from the required
 *     tags: every dish here is all three, tagged or not.
 * A client that does not send quantities still gets the old behaviour, a
 * quantity of 1 unless the table's earlier rounds say otherwise.
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
  _exclude_item_ids uuid[] DEFAULT '{}',
  _cart_quantities int[] DEFAULT NULL
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
  source_item_id uuid,
  suggested_quantity int
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
  -- Everything La Soul serves is halal and alcohol-free, so those are not
  -- filters here: a dish nobody got round to tagging "halal" is still halal
  -- and must not drop out of the suggestions for it.
  v_tags text[] := ARRAY(SELECT tg FROM unnest(COALESCE(_require_tags, '{}'::text[])) tg
                          WHERE tg NOT IN ('halal', 'alcohol_free', 'no_alcohol'));
BEGIN
  PERFORM public.assert_guest_session(_session_id, _session_token);

  -- Twice in one transaction must not fail on the temp table.
  DROP TABLE IF EXISTS pg_temp._ranked;

  CREATE TEMP TABLE _ranked ON COMMIT DROP AS
    SELECT f.*, row_number() OVER (ORDER BY f.ord) AS rnk
      FROM (
        SELECT r.*
          FROM public.rank_recommendations(
                 _cart_item_ids, _placement, _language, 8, _session_id, v_allergens, _cart_quantities)
               WITH ORDINALITY AS r(id, name, name_bs, name_ar, price, image_url, dietary_tags,
                                    recommendation_type, reason, source_item_id, suggested_quantity, ord)
         WHERE NOT (r.id = ANY(COALESCE(_exclude_item_ids, '{}'::uuid[])))
           AND v_tags <@ COALESCE(r.dietary_tags, '{}'::text[])
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
           'item_id', r.id, 'type', r.recommendation_type, 'price', r.price, 'rank', r.rnk,
           'qty', r.suggested_quantity
         ) ORDER BY r.rnk), '[]'::jsonb)
    INTO v_candidates FROM _ranked r;

  SELECT * INTO v_top FROM _ranked r ORDER BY r.rnk LIMIT 1;

  INSERT INTO public.recommendation_decisions(
    session_id, placement, policy_version, experiment_id, arm,
    candidates, chosen_item_id, source_item_id, recommendation_type, action_probability,
    cart_value, suggested_quantity)
  VALUES (
    _session_id, _placement, public.reco_policy_version(), v_experiment, v_arm,
    v_candidates, v_top.id, v_top.source_item_id, v_top.recommendation_type,
    -- Deterministic ranker: the top item was certain to be chosen.
    1.0,
    COALESCE(v_cart_value, 0),
    v_top.suggested_quantity)
  RETURNING recommendation_decisions.id INTO v_decision_id;

  RETURN QUERY
    SELECT v_decision_id, r.id, r.name, r.name_bs, r.name_ar, r.price, r.image_url,
           r.dietary_tags, r.recommendation_type, r.reason, r.source_item_id, r.suggested_quantity
      FROM _ranked r
     ORDER BY r.rnk;
END;
$$;

REVOKE ALL ON FUNCTION public.guest_get_recommendations(uuid, text, uuid[], text, text, int, text[], text[], uuid[], int[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guest_get_recommendations(uuid, text, uuid[], text, text, int, text[], text[], uuid[], int[]) TO anon, authenticated;

-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- 4. Learning keeps the tab apart from the cart
-- ---------------------------------------------------------------------

/*
 * refresh_suggestion_stats (20261025100000) folded any placement it did not
 * know into 'cart'. A guarded rewrite of that one line, which this batch
 * itself created: it raises if the line is not there, and does nothing if it
 * already knows the tab.
 */
DO $$
DECLARE
  v_def text;
  v_before text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'refresh_suggestion_stats';
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'refresh_suggestion_stats is missing — migrations are out of order';
  END IF;
  v_def := replace(v_def, chr(13) || chr(10), chr(10));
  IF v_def ~ 'IN \(''cart'', ''after_meal'', ''item'', ''tab''\)' THEN
    RETURN;
  END IF;
  v_before := v_def;
  v_def := regexp_replace(v_def,
    'd\.placement[[:space:]]+IN[[:space:]]*\(''cart'',[[:space:]]*''after_meal'',[[:space:]]*''item''\)',
    'd.placement IN (''cart'', ''after_meal'', ''item'', ''tab'')');
  IF v_def = v_before THEN
    RAISE EXCEPTION 'refresh_suggestion_stats rewrite: placement list not found';
  END IF;
  EXECUTE v_def;
END $$;

-- ---------------------------------------------------------------------
-- 5. House pairings that lean towards margin
-- ---------------------------------------------------------------------

/*
 * Every rule seeded by 20261024180000_house_pairings.sql that still has its
 * seeded priority (so the owner has not touched it) moves by
 *
 *     round(10 · (unit margin / average unit margin in its group − 1)),
 *     clamped to ±10
 *
 * where the group is the rules for one section (or the after-meal list).
 * Fries still lead with a burger; a 4 KM cola gives a little ground to an
 * 8 KM lemonade, an espresso after dessert to a cappuccino. Matched by name,
 * trimmed and case-insensitive, with both spellings of cappuccino; a dish
 * that is gone is skipped. Re-running changes nothing: a moved rule no
 * longer has its seeded priority.
 */
DO $$
DECLARE
  v_changed int;
  v_added int := 0;
  r record;
  v_item uuid;
BEGIN
  WITH seeded(source_section, dish, seeded_priority) AS (VALUES
      ('Burgers', 'Regular Fries', 90), ('Burgers', 'La Soul Fries', 80),
      ('Burgers', 'Seasoned Truffle Fries', 60), ('Burgers', 'Strawberry Lemonade', 70),
      ('Burgers', 'Classic Mojito', 65), ('Burgers', 'Coca-Cola', 60), ('Burgers', 'Lemon Iced Tea', 55),
      ('Sliders', 'Regular Fries', 85), ('Sliders', 'La Soul Fries', 75),
      ('Sliders', 'Peach Lemonade', 65), ('Sliders', 'Coca-Cola', 60),
      ('Appetizer', 'Classic Mojito', 65), ('Appetizer', 'Coca-Cola', 60),
      ('Fries', 'Coca-Cola', 60), ('Fries', 'Strawberry Lemonade', 55),
      ('Breakfast', 'Fresh Orange Juice', 90), ('Breakfast', 'Cappucino', 85),
      ('Breakfast', 'Flat White', 70), ('Breakfast', 'Spanish Latte', 65),
      ('Breakfast', 'Fresh Lemon & Mint Juice', 60),
      ('Pasta', 'Lemon Iced Tea', 70), ('Pasta', 'Peach Iced Tea', 65),
      ('Pasta', 'Sparkling Water', 60), ('Pasta', 'Shopska Salad', 55),
      ('Risotto', 'Sparkling Water', 65), ('Risotto', 'Hibiscus Iced Tea', 60), ('Risotto', 'Shopska Salad', 55),
      ('Salads', 'Fresh Lemon & Mint Juice', 70), ('Salads', 'Sparkling Water', 60),
      ('Soups', 'Sparkling Water', 55),
      ('Kids Menu', 'Apple Juice', 80), ('Kids Menu', 'Strawberry Juice', 70),
      ('Coffee', 'Butter Croissant', 80), ('Coffee', 'Tiramisu Cup', 70), ('Coffee', 'San Sebastian Cheesecake', 65),
      ('Filter Coffee', 'Butter Croissant', 70), ('Filter Coffee', 'San Sebastian Cheesecake', 60),
      ('Iced Coffee', 'Butter Croissant', 65), ('Iced Coffee', 'Red Velvet Cup', 55),
      ('Hot Drinks', 'Churros', 75), ('Hot Drinks', 'Butter Croissant', 65),
      ('Tea', 'Butter Croissant', 60),
      ('Frappe', 'Chocolate Mousse Cup', 50),
      ('Desserts', 'Espresso', 85), ('Desserts', 'Cappucino', 75), ('Desserts', 'Spanish Latte', 60),
      (NULL, 'Tiramisu with Espresso Coffee Shot', 80), (NULL, 'San Sebastian Cheesecake', 75),
      (NULL, 'Lava Cake', 70), (NULL, 'Espresso', 70), (NULL, 'Creme Brulee', 60), (NULL, 'Cappucino', 55)
  ),
  rules AS (
    SELECT DISTINCT ON (rec.id)
           rec.id, rec.priority, s.seeded_priority,
           COALESCE(s.source_section, '(after the meal)') AS grp,
           um.unit_cm
      FROM seeded s
      JOIN public.menu_items mi
        ON replace(lower(trim(mi.name)), 'cappuccino', 'cappucino') = lower(s.dish)
      JOIN public.menu_unit_margins() um ON um.item_id = mi.id
      JOIN public.menu_item_recommendations rec
        ON rec.recommended_item_id = mi.id AND rec.source_item_id IS NULL
      LEFT JOIN public.subcategories sub ON sub.id = rec.source_subcategory_id
     WHERE (s.source_section IS NULL AND rec.recommendation_type = 'after_meal'
            AND rec.source_subcategory_id IS NULL)
        OR (s.source_section IS NOT NULL AND lower(trim(sub.name)) = lower(s.source_section))
     ORDER BY rec.id
  ),
  nudged AS (
    SELECT id, seeded_priority,
           LEAST(100, GREATEST(0, seeded_priority + LEAST(10, GREATEST(-10,
             round(10 * (unit_cm / NULLIF(avg(unit_cm) OVER (PARTITION BY grp), 0) - 1))::int)))) AS new_priority
      FROM rules
  ),
  moved AS (
    UPDATE public.menu_item_recommendations rec
       SET priority = n.new_priority
      FROM nudged n
     WHERE rec.id = n.id
       AND rec.priority = n.seeded_priority
       AND n.new_priority IS NOT NULL
       AND n.new_priority <> n.seeded_priority
    RETURNING 1
  )
  SELECT count(*) INTO v_changed FROM moved;

  -- Two more after the meal, both high-margin: a dessert the house pairings
  -- predate, and a latte for tables that want more than an espresso.
  FOR r IN SELECT * FROM (VALUES ('Banana Pudding', 65), ('Spanish Latte', 55)) AS t(dish, priority) LOOP
    SELECT mi.id INTO v_item FROM public.menu_items mi WHERE lower(trim(mi.name)) = lower(r.dish) LIMIT 1;
    CONTINUE WHEN v_item IS NULL;
    IF NOT EXISTS (
      SELECT 1 FROM public.menu_item_recommendations m
       WHERE m.recommendation_type = 'after_meal' AND m.recommended_item_id = v_item
         AND m.source_item_id IS NULL AND m.source_subcategory_id IS NULL
    ) THEN
      INSERT INTO public.menu_item_recommendations(recommended_item_id, recommendation_type, priority)
      VALUES (v_item, 'after_meal', r.priority);
      v_added := v_added + 1;
    END IF;
  END LOOP;

  RAISE NOTICE 'house pairings: % moved towards margin, % after-meal rules added', v_changed, v_added;
END $$;
