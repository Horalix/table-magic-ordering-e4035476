-- =====================================================================
-- Suggestions that make sense on a plate
--
-- Walking the guest flow against the real menu (166 items, almost no order
-- history, curated pairs empty) showed what the ranker actually does when it
-- has nothing to learn from: it falls through to generic popularity, and
-- popularity knows nothing about what a meal is. A burger in the cart was
-- offered another burger; a coffee was offered a second coffee; a kids' meal
-- was offered to a table of adults; and the after-meal prompt could suggest a
-- main course. The fallback was also labelled `frequently_bought_together`,
-- which is a claim about evidence that did not exist.
--
-- This migration:
--
--   1. lets the nightly job run the functions it calls (they were staff-only,
--      and a scheduler is not staff);
--   2. adds coursing rules — `reco_role_fits` — that the ranker cannot score
--      its way past, and labels the fallback honestly as `popular`;
--   3. evaluates time windows on the Sarajevo clock instead of UTC;
--   4. fixes `meal_role` where the name-regex classifier left it empty or
--      wrong, since every rule above depends on it;
--   5. makes "popular" mean paid-for, and at least three orders of it;
--   6. returns suggestions in ranked order, filtered by the guest's explicit
--      diet filter and by what they have already dismissed — inside the
--      wrapper, so the decision ledger records what the guest actually saw;
--   7. schedules the nightly job with pg_cron where the extension exists.
--
-- Every change to an existing function is a textual rewrite of its live
-- definition that raises if it matched nothing, as in the earlier ranker
-- migrations — a silent miss is how the session-affinity refresh went unwired.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. The nightly job may run what it calls
-- ---------------------------------------------------------------------

/*
 * run_daily_maintenance() now accepts the scheduler (see is_trusted_caller in
 * the maintenance migration), but everything it calls still checked
 * is_staff_member() and would refuse it one level down. Each guard below is
 * widened to is_trusted_caller(), which still includes every staff member, so
 * nothing a manager can do today changes.
 */
DO $$
DECLARE
  v_fn text;
  r record;
  v_def text;
  v_before text;
  v_seen int;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'refresh_menu_intelligence', 'refresh_menu_affinity', 'refresh_suggestion_stats',
    'refresh_session_affinity', 'refresh_guest_profiles', 'close_stale_orders'
  ] LOOP
    v_seen := 0;
    FOR r IN
      SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = v_fn
    LOOP
      v_seen := v_seen + 1;
      -- Line endings are not content; see .gitattributes.
      v_def := replace(pg_get_functiondef(r.oid), chr(13) || chr(10), chr(10));
      CONTINUE WHEN position('public.is_trusted_caller()' in v_def) > 0;

      v_before := v_def;
      v_def := replace(v_def, 'IF NOT public.is_staff_member() THEN', 'IF NOT public.is_trusted_caller() THEN');
      IF v_def = v_before THEN
        RAISE EXCEPTION '%: staff guard did not match', v_fn;
      END IF;
      EXECUTE v_def;
    END LOOP;

    IF v_seen = 0 THEN
      RAISE EXCEPTION '% is missing — migrations are out of order', v_fn;
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- 2. Coursing rules
-- ---------------------------------------------------------------------

/**
 * Does a candidate of this role belong in this moment?
 *
 * A hard guardrail, not a score: a second main offered next to a burger is
 * not a slightly worse suggestion, it is a wrong one, and no amount of
 * popularity should be able to outbid that. Kept as its own function so the
 * rules can be read in one place and tested without building a whole ranking.
 *
 * The rules, in the order a waiter would apply them:
 *
 *   * A pair the owner curated always passes. They chose it; this function
 *     second-guessing them would make the curation screen look broken.
 *     Curated pairs still obey availability, diet and allergen guardrails,
 *     which live in the ranker and are not relaxed here.
 *
 *   * After the meal: dessert or a hot drink. A cold drink only if the table
 *     has had nothing to drink all visit. Never a main.
 *
 *   * In the cart, or on a dish page:
 *       - a drink only if there is no drink in the cart yet;
 *       - with a main or starter, a COLD drink — a cappuccino with a burger
 *         is not how anyone eats, except at breakfast, so before 11:00
 *         Sarajevo time hot drinks are fine too;
 *       - alcohol only on observed evidence that this table's kind of order
 *         goes with it, never as a blind completion;
 *       - a side or starter only alongside a main;
 *       - never a main when a main or starter is already there;
 *       - never a dessert — dessert has its own moment, after the meal;
 *       - an unclassified item (NULL role) only on observed evidence, since
 *         with no role there is nothing to reason about.
 *
 * `_rtype` 'observed' (or 'frequently_bought_together') means the pair has
 * real co-occurrence behind it; the ranker passes 'observed' whenever the
 * item came out of either affinity table, whichever label won the roll-up.
 * `_at` exists so the morning rule can be tested; callers leave it alone.
 */
CREATE OR REPLACE FUNCTION public.reco_role_fits(
  _candidate_role public.meal_role,
  _placement text,
  _rtype text,
  _is_curated boolean,
  _cart uuid[],
  _session_id uuid,
  _at timestamptz DEFAULT now()
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
  v_visit_drink boolean;
  v_morning boolean;
BEGIN
  IF COALESCE(_is_curated, false) THEN
    RETURN true;
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
      ) OR EXISTS (
        SELECT 1 FROM public.menu_items mi
         WHERE mi.id = ANY(COALESCE(_cart, '{}'::uuid[]))
           AND (public.role_is_drink(mi.meal_role) OR (mi.meal_role IS NULL AND mi.station = 'bar'))
      ) INTO v_visit_drink;
      RETURN NOT v_visit_drink;
    END IF;
    RETURN false;
  END IF;

  -- 'cart' and 'item' share one set of rules: the dish page asks the same
  -- question about the dish being looked at plus whatever is in the cart.
  SELECT COALESCE(bool_or(mi.meal_role = 'main'), false),
         COALESCE(bool_or(mi.meal_role = 'starter'), false),
         -- An unclassified bar item still counts as a drink: the cart should
         -- not be offered a cola because someone forgot to tag the lemonade.
         COALESCE(bool_or(public.role_is_drink(mi.meal_role)
                          OR (mi.meal_role IS NULL AND mi.station = 'bar')), false)
    INTO v_cart_main, v_cart_starter, v_cart_drink
    FROM public.menu_items mi
   WHERE mi.id = ANY(COALESCE(_cart, '{}'::uuid[]));

  IF _candidate_role IS NULL THEN
    RETURN v_evidence;
  END IF;

  v_morning := EXTRACT(HOUR FROM (_at AT TIME ZONE 'Europe/Sarajevo')) < 11;

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
REVOKE ALL ON FUNCTION public.reco_role_fits(public.meal_role, text, text, boolean, uuid[], uuid, timestamptz)
  FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  v_def text;
  v_before text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'rank_recommendations';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'rank_recommendations is missing — migrations are out of order';
  END IF;

  -- Line endings are not content; see .gitattributes.
  v_def := replace(v_def, chr(13) || chr(10), chr(10));

  IF position('reco_role_fits' in v_def) > 0 THEN
    RAISE NOTICE 'rank_recommendations already has coursing guardrails';
    RETURN;
  END IF;

  /*
   * (a) The clock. LOCALTIME is the database's time zone, which on hosted
   * Supabase is UTC — so a breakfast window of 08:00–11:00 opened at 09:00
   * or 10:00 in Sarajevo and closed at noon or one. daypart_of() already used
   * Sarajevo time; the windows now agree with it.
   */
  v_before := v_def;
  v_def := replace(v_def,
    '      LOCALTIME AS now_time,',
    '      (now() AT TIME ZONE ''Europe/Sarajevo'')::time AS now_time,');
  IF v_def = v_before THEN RAISE EXCEPTION 'guardrails (a) Sarajevo clock did not match'; END IF;

  /*
   * (b) Basket completion by role, not by station. `station = ''bar''` also
   * matched the affogato and anything else the bar happens to plate, and
   * missed nothing it should have — but the role is what the rule is about.
   * It now runs on the dish page too: someone looking at a burger with no
   * drink anywhere is the same gap as a cart with a burger and no drink.
   * Which drink fits (cold with a main, hot in the morning) is decided by
   * reco_role_fits below.
   */
  v_before := v_def;
  v_def := replace(v_def,
    '     WHERE p.placement = ''cart''
       AND cardinality(p.cart) > 0
       AND NOT p.has_drink
       AND mi.station = ''bar''',
    '     WHERE p.placement IN (''cart'', ''item'')
       AND cardinality(p.cart) > 0
       AND NOT p.has_drink
       AND public.role_is_drink(mi.meal_role)');
  IF v_def = v_before THEN RAISE EXCEPTION 'guardrails (b) completion did not match'; END IF;

  /*
   * (c) The fallback says what it is. Generic popularity labelled
   * `frequently_bought_together` claimed co-occurrence evidence it did not
   * have, and that label flows into the decision ledger and the analytics.
   */
  v_before := v_def;
  v_def := replace(v_def,
    'CASE WHEN p.placement = ''after_meal'' THEN ''after_meal'' ELSE ''frequently_bought_together'' END::text AS rtype,',
    'CASE WHEN p.placement = ''after_meal'' THEN ''after_meal'' ELSE ''popular'' END::text AS rtype,');
  IF v_def = v_before THEN RAISE EXCEPTION 'guardrails (c) fallback label did not match'; END IF;

  /*
   * (d) Coursing and kids' dishes, as hard guardrails.
   *
   * "Curated" is read off the roll-up as curated_score > 0, so a curated pair
   * at priority 0 is treated like any other candidate. Priority 0 means
   * "lowest", and those rows are rare enough that carrying a separate flag
   * through four CTEs was not worth it.
   */
  v_before := v_def;
  v_def := replace(v_def,
    '      AND NOT (mi.allergens && p.blocked_allergens)
  )',
    '      AND NOT (mi.allergens && p.blocked_allergens)
      -- Coursing: what kind of dish fits this moment. See reco_role_fits.
      AND public.reco_role_fits(
            mi.meal_role,
            p.placement,
            CASE WHEN EXISTS (SELECT 1 FROM observed ob WHERE ob.item_id = mi.id)
                   OR EXISTS (SELECT 1 FROM observed_session obs WHERE obs.item_id = mi.id)
                 THEN ''observed'' ELSE r.rtype END,
            r.curated_score > 0,
            p.cart,
            _session_id)
      -- A kids'' meal is for a child the menu cannot see. Offered unprompted
      -- to whoever is holding the phone it reads as a mistake, so it is only
      -- ever suggested when the owner curated it.
      AND (r.curated_score > 0 OR NOT EXISTS (
            SELECT 1 FROM public.subcategories ks
             WHERE ks.id = mi.subcategory_id
               AND ks.name ~* ''(kid|djec|dječ|dijete|child)''))
  )');
  IF v_def = v_before THEN RAISE EXCEPTION 'guardrails (d) coursing splice did not match'; END IF;

  EXECUTE v_def;
  RAISE NOTICE 'rank_recommendations now applies coursing guardrails';
END $$;

/*
 * The substitute path had the same UTC clock: it passed LOCALTIME explicitly,
 * which overrides the Sarajevo default of menu_item_orderable().
 */
DO $$
DECLARE
  v_def text;
  v_before text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'guest_get_substitutes';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'guest_get_substitutes is missing — migrations are out of order';
  END IF;
  v_def := replace(v_def, chr(13) || chr(10), chr(10));

  IF position('LOCALTIME' in v_def) > 0 THEN
    v_before := v_def;
    v_def := replace(v_def,
      'public.menu_item_orderable(mi, LOCALTIME)',
      'public.menu_item_orderable(mi, (now() AT TIME ZONE ''Europe/Sarajevo'')::time)');
    IF v_def = v_before THEN RAISE EXCEPTION 'guest_get_substitutes clock did not match'; END IF;
    EXECUTE v_def;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 3. Roles the classifier missed or got wrong
-- ---------------------------------------------------------------------

/**
 * Fill in `meal_role` from the subcategory where that is unambiguous.
 *
 * The name-regex pass in the meal-role migration left Breakfast, Risotto,
 * Sliders and the kids' menu mostly NULL, and labelled every iced tea a hot
 * drink because the subcategory name contains "tea". Every coursing rule
 * reads this column, so a wrong role is a wrong suggestion.
 *
 * Conservative in the same way the original was:
 *
 *   * only rows that are NULL, or whose role contradicts the subcategory in
 *     an obvious way (a food subcategory holding a "drink", an iced drink
 *     labelled hot), are touched;
 *   * a role that is merely different — the affogato is a dessert that lives
 *     on the drinks list, a manager may have set something deliberately — is
 *     left alone;
 *   * hot versus cold inside the drinks is decided by the item NAME where the
 *     name says so ("Iced …", "Cold Brew", "V60 Cold", "Hot Chocolate"),
 *     otherwise by the subcategory.
 *
 * Subcategories are matched by name, case-insensitively. Idempotent; returns
 * how many rows changed, by target role. Not granted to any API role — it is
 * run by this migration, and can be re-run from the SQL editor after a menu
 * import.
 */
CREATE OR REPLACE FUNCTION public.reclassify_meal_roles()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_counts jsonb;
BEGIN
  WITH classified AS (
    SELECT m.id,
           m.meal_role AS current_role,
           d.default_role,
           d.is_drink_subcategory,
           lower(btrim(s.name)) IN ('iced coffee', 'iced tea', 'frappe') AS iced_subcategory,
           m.name ~* '(\miced?\M|\mcold\M|frapp)' AS says_cold,
           m.name ~* '\mhot\M' AS says_hot
      FROM public.menu_items m
      JOIN public.subcategories s ON s.id = m.subcategory_id
      CROSS JOIN LATERAL (
        SELECT CASE lower(btrim(s.name))
                 WHEN 'breakfast' THEN 'main'
                 WHEN 'risotto' THEN 'main'
                 WHEN 'sliders' THEN 'main'
                 WHEN 'burgers' THEN 'main'
                 WHEN 'pasta' THEN 'main'
                 WHEN 'kids menu' THEN 'main'
                 WHEN 'kids' THEN 'main'
                 WHEN 'salads' THEN 'starter'
                 WHEN 'soups' THEN 'starter'
                 WHEN 'appetizer' THEN 'starter'
                 WHEN 'appetizers' THEN 'starter'
                 WHEN 'fries' THEN 'side'
                 WHEN 'desserts' THEN 'dessert'
                 WHEN 'coffee' THEN 'hot_drink'
                 WHEN 'filter coffee' THEN 'hot_drink'
                 WHEN 'hot drinks' THEN 'hot_drink'
                 WHEN 'tea' THEN 'hot_drink'
                 WHEN 'iced coffee' THEN 'cold_drink'
                 WHEN 'iced tea' THEN 'cold_drink'
                 WHEN 'fresh juice' THEN 'cold_drink'
                 WHEN 'mojito' THEN 'cold_drink'
                 WHEN 'frappe' THEN 'cold_drink'
                 WHEN 'lemonade' THEN 'cold_drink'
                 WHEN 'other' THEN 'cold_drink'
                 WHEN 'special drinks' THEN 'cold_drink'
               END::public.meal_role AS default_role,
               lower(btrim(s.name)) IN (
                 'coffee', 'filter coffee', 'hot drinks', 'tea', 'iced coffee', 'iced tea',
                 'fresh juice', 'mojito', 'frappe', 'lemonade', 'other', 'special drinks'
               ) AS is_drink_subcategory
      ) d
     WHERE d.default_role IS NOT NULL
  ),
  targeted AS (
    SELECT c.id,
           CASE
             WHEN NOT c.is_drink_subcategory THEN
               CASE
                 WHEN c.current_role IS NULL THEN c.default_role
                 -- A drink role on a dish is the classifier's mistake, not a choice.
                 WHEN c.current_role IN ('hot_drink', 'cold_drink') THEN c.default_role
               END
             -- Drinks: the name decides temperature when it says so.
             WHEN c.current_role IS NULL THEN
               CASE WHEN c.says_cold THEN 'cold_drink'::public.meal_role
                    WHEN c.says_hot THEN 'hot_drink'::public.meal_role
                    ELSE c.default_role END
             WHEN c.current_role = 'hot_drink' AND (c.says_cold OR (c.iced_subcategory AND NOT c.says_hot))
               THEN 'cold_drink'::public.meal_role
             WHEN c.current_role = 'cold_drink' AND c.says_hot AND NOT c.says_cold
               THEN 'hot_drink'::public.meal_role
           END AS new_role
      FROM classified c
  ),
  changed AS (
    UPDATE public.menu_items m
       SET meal_role = t.new_role, updated_at = now()
      FROM targeted t
     WHERE m.id = t.id
       AND t.new_role IS NOT NULL
       AND m.meal_role IS DISTINCT FROM t.new_role
    RETURNING t.new_role
  )
  SELECT COALESCE(jsonb_object_agg(new_role, n), '{}'::jsonb) INTO v_counts
    FROM (SELECT new_role::text, count(*) AS n FROM changed GROUP BY new_role) x;

  RETURN v_counts;
END;
$$;

REVOKE ALL ON FUNCTION public.reclassify_meal_roles() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE v_counts jsonb;
BEGIN
  v_counts := public.reclassify_meal_roles();
  RAISE NOTICE 'meal_role reclassified: %', v_counts;
END $$;

-- ---------------------------------------------------------------------
-- 4. "Popular" means paid for, more than twice
-- ---------------------------------------------------------------------

/**
 * Most-ordered items over a window.
 *
 * Feeds the guest menu's Popular badge and the ranker's fallback. It counted
 * every order not cancelled — including ones still awaiting a card payment
 * that never came — and needed only ONE order to rank, so on a quiet week a
 * single table's lunch became the "popular" row. It now counts completed
 * orders only (the one definition of a sale), and an item needs at least
 * three separate orders to appear at all: "popular" is a claim printed in
 * front of guests, and one order is an anecdote.
 *
 * Same signature and return type as before, so every caller is unchanged.
 */
CREATE OR REPLACE FUNCTION public.get_popular_items(_limit int DEFAULT 8, _days int DEFAULT 30)
RETURNS TABLE(menu_item_id uuid, qty bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT oi.menu_item_id, sum(oi.quantity)::bigint AS qty
    FROM public.completed_orders o
    JOIN public.order_items oi ON oi.order_id = o.id
   WHERE o.created_at > now() - make_interval(days => GREATEST(COALESCE(_days, 30), 1))
   GROUP BY oi.menu_item_id
  HAVING count(DISTINCT o.id) >= 3
   ORDER BY qty DESC, oi.menu_item_id
   LIMIT LEAST(GREATEST(COALESCE(_limit, 8), 1), 50);
$$;

GRANT EXECUTE ON FUNCTION public.get_popular_items(int, int) TO anon, authenticated;

-- ---------------------------------------------------------------------
-- 5. The wrapper: ranked order, the guest's own filters, honest ledger
-- ---------------------------------------------------------------------

/*
 * Three changes to guest_get_recommendations, restated rather than rewritten
 * because the signature changes:
 *
 *   * ORDER. The rows went through a temp table and came back with no ORDER
 *     BY, so "the first suggestion" was whatever order the table scan
 *     produced — usually the ranked one, guaranteed never. The ranker's order
 *     is now carried as an explicit rank.
 *
 *   * THE GUEST'S DIET FILTER. The menu shows only dishes carrying every
 *     diet tag the guest switched on. Suggestions only knew about two of
 *     those tags, as allergens, so a guest filtering for vegetarian or halal
 *     could be offered something the menu itself was hiding from them.
 *     `_require_tags` applies exactly the menu's rule: every tag must be on
 *     the dish.
 *
 *   * DISMISSALS. `_exclude_item_ids` is what the guest already said no to
 *     this visit. Filtering it here rather than in the browser means the
 *     decision recorded in the ledger is the suggestion actually shown —
 *     a client-side filter would log the dismissed dish as the choice and
 *     credit its impression to something else.
 *
 * The ranker is asked for its full shortlist and the filters applied after,
 * so filtering does not leave the guest with nothing when there was
 * something suitable just below the cut.
 */
DROP FUNCTION IF EXISTS public.guest_get_recommendations(uuid, text, uuid[], text, text, int, text[]);

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
BEGIN
  PERFORM public.assert_guest_session(_session_id, _session_token);

  -- Twice in one transaction must not fail on the temp table.
  DROP TABLE IF EXISTS pg_temp._ranked;

  CREATE TEMP TABLE _ranked ON COMMIT DROP AS
    SELECT f.*, row_number() OVER (ORDER BY f.ord) AS rnk
      FROM (
        SELECT r.*
          FROM public.rank_recommendations(
                 _cart_item_ids, _placement, _language, 8, _session_id, _exclude_allergens)
               WITH ORDINALITY AS r(id, name, name_bs, name_ar, price, image_url, dietary_tags,
                                    recommendation_type, reason, source_item_id, ord)
         WHERE NOT (r.id = ANY(COALESCE(_exclude_item_ids, '{}'::uuid[])))
           AND COALESCE(_require_tags, '{}'::text[]) <@ COALESCE(r.dietary_tags, '{}'::text[])
         ORDER BY r.ord
         LIMIT v_limit
      ) f;

  SELECT a.arm, a.experiment_id INTO v_arm, v_experiment
    FROM public.session_experiment_assignment a WHERE a.session_id = _session_id;

  -- The shortlist, not just the winner, in the order it was ranked: needed
  -- to estimate a policy you did not run.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'item_id', r.id, 'type', r.recommendation_type, 'price', r.price, 'rank', r.rnk
         ) ORDER BY r.rnk), '[]'::jsonb)
    INTO v_candidates FROM _ranked r;

  SELECT * INTO v_top FROM _ranked r ORDER BY r.rnk LIMIT 1;

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
      FROM _ranked r
     ORDER BY r.rnk;
END;
$$;

REVOKE ALL ON FUNCTION public.guest_get_recommendations(uuid, text, uuid[], text, text, int, text[], text[], uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guest_get_recommendations(uuid, text, uuid[], text, text, int, text[], text[], uuid[]) TO anon, authenticated;

-- ---------------------------------------------------------------------
-- 6. Run the nightly job without a browser
-- ---------------------------------------------------------------------

/*
 * 02:30 UTC is 04:30 in Sarajevo in summer and 03:30 in winter: after the
 * last table has gone and before the 05:00 business-day rollover, every day
 * of the year. pg_cron schedules in UTC and has no per-job time zone, so one
 * of the two seasons is an hour early; both are dead hours for a café.
 *
 * Only where pg_cron exists. The extension is enabled if the server offers
 * it; anywhere it does not — the test harness, a project without it — this
 * says so and moves on, because a missing scheduler must not block the
 * migrations that the rest of the app depends on. Without it, point any
 * scheduler at run_daily_maintenance() with the service_role key.
 *
 * cron.schedule with a job name replaces an existing job of that name, so
 * re-running this is safe.
 */
DO $cron$
BEGIN
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
       AND EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
      EXECUTE 'CREATE EXTENSION IF NOT EXISTS pg_cron';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pg_cron could not be enabled here (%)', SQLERRM;
  END;

  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      EXECUTE $q$SELECT cron.schedule('lasoul-daily-maintenance', '30 2 * * *',
                                       'SELECT public.run_scheduled_maintenance()')$q$;
      RAISE NOTICE 'nightly maintenance scheduled with pg_cron at 02:30 UTC';
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'pg_cron is installed but the job could not be scheduled (%)', SQLERRM;
    END;
  ELSE
    RAISE NOTICE 'pg_cron is not available: schedule run_daily_maintenance() another way';
  END IF;
END $cron$;
