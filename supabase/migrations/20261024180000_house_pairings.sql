-- =====================================================================
-- House pairings: good suggestions from the first night
--
-- The ranker learns from orders, and La Soul has almost none yet. Until it
-- does, the only thing it could offer was "a drink" — any drink. This file
-- writes down what a good waiter at La Soul would suggest, as ordinary curated
-- rules the owner can switch off or edit in Admin → Service & suggestions:
--
--   a burger or slider    → fries, a lemonade, a mojito, a cola
--   breakfast             → fresh orange juice, a cappuccino, a flat white
--   pasta or risotto      → an iced tea, sparkling water, a Shopska salad
--   a coffee on its own   → a croissant, a tiramisu cup, cheesecake
--   a hot chocolate       → churros
--   dessert in the cart   → an espresso, a cappuccino
--   after the meal        → tiramisu with an espresso shot, cheesecake, lava
--                           cake, crème brûlée, an espresso
--
-- Learning still runs on top: observed pairs, acceptance and exploration keep
-- reordering these as real orders arrive, and a rule nobody accepts is retired
-- by the same threshold as any other suggestion.
--
-- One rule changes with it. A curated pair used to pass every role guardrail,
-- which was fine while there were none; with these rules it would have offered
-- a lemonade to a table that already has a Coke. A curated pair may now break
-- the MOMENT rules (coffee with breakfast, a croissant with a latte) but never
-- DUPLICATE a course already in the cart: no second drink, no second main, no
-- second dessert.
-- =====================================================================

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
  v_cart_dessert boolean;
  v_visit_drink boolean;
  v_morning boolean;
BEGIN
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
    -- serving of the same course is never what they meant.
    RETURN NOT (
         (public.role_is_drink(_candidate_role) AND v_cart_drink)
      OR (_candidate_role = 'main' AND v_cart_main)
      OR (_candidate_role = 'dessert' AND v_cart_dessert)
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

REVOKE ALL ON FUNCTION public.reco_role_fits(public.meal_role, text, text, boolean, uuid[], uuid, timestamptz)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------
-- The pairings. Matched by name (trimmed, case-insensitive) so the file reads
-- like a menu; a dish that has been renamed or removed is skipped, never an
-- error. Re-running adds nothing twice.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_added int := 0;
  v_skipped text[] := '{}';
  r record;
  v_sub uuid;
  v_item uuid;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      -- source section, suggested dish, type, priority (0-100)
      ('Burgers', 'Regular Fries', 'pair_with', 90),
      ('Burgers', 'La Soul Fries', 'pair_with', 80),
      ('Burgers', 'Seasoned Truffle Fries', 'upgrade_to', 60),
      ('Burgers', 'Strawberry Lemonade', 'pair_with', 70),
      ('Burgers', 'Classic Mojito', 'pair_with', 65),
      ('Burgers', 'Coca-Cola', 'pair_with', 60),
      ('Burgers', 'Lemon Iced Tea', 'pair_with', 55),
      ('Sliders', 'Regular Fries', 'pair_with', 85),
      ('Sliders', 'La Soul Fries', 'pair_with', 75),
      ('Sliders', 'Peach Lemonade', 'pair_with', 65),
      ('Sliders', 'Coca-Cola', 'pair_with', 60),
      ('Appetizer', 'Classic Mojito', 'pair_with', 65),
      ('Appetizer', 'Coca-Cola', 'pair_with', 60),
      ('Fries', 'Coca-Cola', 'pair_with', 60),
      ('Fries', 'Strawberry Lemonade', 'pair_with', 55),
      ('Breakfast', 'Fresh Orange Juice', 'pair_with', 90),
      ('Breakfast', 'Cappucino', 'pair_with', 85),
      ('Breakfast', 'Flat White', 'pair_with', 70),
      ('Breakfast', 'Spanish Latte', 'pair_with', 65),
      ('Breakfast', 'Fresh Lemon & Mint Juice', 'pair_with', 60),
      ('Pasta', 'Lemon Iced Tea', 'pair_with', 70),
      ('Pasta', 'Peach Iced Tea', 'pair_with', 65),
      ('Pasta', 'Sparkling Water', 'pair_with', 60),
      ('Pasta', 'Shopska Salad', 'pair_with', 55),
      ('Risotto', 'Sparkling Water', 'pair_with', 65),
      ('Risotto', 'Hibiscus Iced Tea', 'pair_with', 60),
      ('Risotto', 'Shopska Salad', 'pair_with', 55),
      ('Salads', 'Fresh Lemon & Mint Juice', 'pair_with', 70),
      ('Salads', 'Sparkling Water', 'pair_with', 60),
      ('Soups', 'Sparkling Water', 'pair_with', 55),
      ('Kids Menu', 'Apple Juice', 'pair_with', 80),
      ('Kids Menu', 'Strawberry Juice', 'pair_with', 70),
      ('Coffee', 'Butter Croissant', 'pair_with', 80),
      ('Coffee', 'Tiramisu Cup', 'pair_with', 70),
      ('Coffee', 'San Sebastian Cheesecake', 'pair_with', 65),
      ('Filter Coffee', 'Butter Croissant', 'pair_with', 70),
      ('Filter Coffee', 'San Sebastian Cheesecake', 'pair_with', 60),
      ('Iced Coffee', 'Butter Croissant', 'pair_with', 65),
      ('Iced Coffee', 'Red Velvet Cup', 'pair_with', 55),
      ('Hot Drinks', 'Churros', 'pair_with', 75),
      ('Hot Drinks', 'Butter Croissant', 'pair_with', 65),
      ('Tea', 'Butter Croissant', 'pair_with', 60),
      ('Frappe', 'Chocolate Mousse Cup', 'pair_with', 50),
      ('Desserts', 'Espresso', 'pair_with', 85),
      ('Desserts', 'Cappucino', 'pair_with', 75),
      ('Desserts', 'Spanish Latte', 'pair_with', 60)
    ) AS t(source_section, dish, rtype, priority)
  LOOP
    SELECT s.id INTO v_sub FROM public.subcategories s WHERE lower(trim(s.name)) = lower(r.source_section) LIMIT 1;
    SELECT mi.id INTO v_item FROM public.menu_items mi WHERE lower(trim(mi.name)) = lower(r.dish) LIMIT 1;
    IF v_sub IS NULL OR v_item IS NULL THEN
      v_skipped := v_skipped || (r.source_section || ' → ' || r.dish);
      CONTINUE;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.menu_item_recommendations m
       WHERE m.source_subcategory_id = v_sub AND m.recommended_item_id = v_item AND m.source_item_id IS NULL
    ) THEN
      INSERT INTO public.menu_item_recommendations(source_subcategory_id, recommended_item_id, recommendation_type, priority)
      VALUES (v_sub, v_item, r.rtype, r.priority);
      v_added := v_added + 1;
    END IF;
  END LOOP;

  -- After the meal: no source, offered once a main has been served.
  FOR r IN
    SELECT * FROM (VALUES
      ('Tiramisu with Espresso Coffee Shot', 80),
      ('San Sebastian Cheesecake', 75),
      ('Lava Cake', 70),
      ('Espresso', 70),
      ('Creme Brulee', 60),
      ('Cappucino', 55)
    ) AS t(dish, priority)
  LOOP
    SELECT mi.id INTO v_item FROM public.menu_items mi WHERE lower(trim(mi.name)) = lower(r.dish) LIMIT 1;
    IF v_item IS NULL THEN
      v_skipped := v_skipped || ('after the meal → ' || r.dish);
      CONTINUE;
    END IF;
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

  RAISE NOTICE 'house pairings added: %; skipped (name not on the menu): %', v_added, v_skipped;
END $$;

-- ---------------------------------------------------------------------
-- Say WHICH dish a section-level pairing goes with.
--
-- A rule written against "Burgers" has no source item, so the guest could
-- only be told "complete your order". Resolving it to the burger actually in
-- the cart lets the card say "Goes with your La Soul Burger", lets the
-- evidence line work, and lets learning tell burgers apart.
-- ---------------------------------------------------------------------
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
  v_def := replace(v_def, chr(13) || chr(10), chr(10));
  IF position('house pairing source' in v_def) > 0 THEN
    RAISE NOTICE 'rank_recommendations already resolves section sources';
    RETURN;
  END IF;

  v_before := v_def;
  v_def := replace(v_def,
    '    SELECT r.recommended_item_id AS item_id,
           r.source_item_id,
           r.recommendation_type AS rtype,
           max(r.priority)::numeric / 100 AS curated_score',
    '    SELECT r.recommended_item_id AS item_id,
           -- house pairing source: a section rule names the cart dish it matched
           COALESCE(r.source_item_id,
                    (SELECT ci.id FROM public.menu_items ci
                      WHERE ci.id = ANY(p.cart) AND ci.subcategory_id = r.source_subcategory_id
                      ORDER BY ci.price DESC, ci.id LIMIT 1)) AS source_item_id,
           r.recommendation_type AS rtype,
           max(r.priority)::numeric / 100 AS curated_score');
  IF v_def = v_before THEN
    RAISE EXCEPTION 'rank_recommendations rewrite: curated source column not found';
  END IF;
  EXECUTE v_def;
END $$;
