-- =====================================================================
-- What kind of thing a dish is
--
-- `station` says where an item is MADE — kitchen or bar. That is the only
-- classification the menu has, and it is the wrong axis for every question the
-- suggestion engine needs to answer:
--
--   "suggest a dessert once the mains are down"      — cannot be expressed
--   "never offer a third main to a table of two"     — cannot be enforced
--   "a second coffee is fine, a second steak is not" — indistinguishable
--
-- A tiramisu and a steak are both `kitchen`. An espresso and a beer are both
-- `bar`. Coursing logic needs the other axis.
--
-- Deliberately a small, fixed vocabulary rather than free text: it is used in
-- rules, and a rule that depends on someone typing "Dessert" the same way
-- twice is not a rule.
-- =====================================================================

DO $$ BEGIN
  CREATE TYPE public.meal_role AS ENUM (
    'starter', 'main', 'side', 'dessert', 'hot_drink', 'cold_drink', 'alcohol'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.menu_items
  ADD COLUMN IF NOT EXISTS meal_role public.meal_role;

COMMENT ON COLUMN public.menu_items.meal_role IS
  'What kind of thing this is, for coursing and repeat rules. NULL means '
  'unclassified — rules that need it skip the item rather than guessing.';

/*
 * A first pass from the names, so the feature is useful on day one.
 *
 * Deliberately conservative: anything it cannot place stays NULL, and NULL
 * means "do not apply role rules to this", not "treat it as a main". A wrong
 * guess here would silently mis-course a real menu; an absent guess only means
 * a manager corrects it in the editor, where the column is now visible.
 *
 * Bosnian and English both, since the menu carries both.
 */
UPDATE public.menu_items mi
   SET meal_role = COALESCE(mi.meal_role, r.role)
  FROM (
    SELECT m.id,
           CASE
             WHEN lower(c.name || ' ' || s.name) ~ '(dessert|slatk|kolač|kolac|torta|sladoled)' THEN 'dessert'
             WHEN lower(c.name || ' ' || s.name) ~ '(predjelo|starter|appetiz|salad|salat|soup|supa|čorba|corba)' THEN 'starter'
             WHEN lower(c.name || ' ' || s.name) ~ '(prilog|side|fries|pomfrit)' THEN 'side'
             WHEN lower(c.name || ' ' || s.name) ~ '(wine|vino|beer|pivo|rakij|cocktail|koktel|spirit|žest|zest)' THEN 'alcohol'
             WHEN lower(c.name || ' ' || s.name) ~ '(coffee|kafa|kava|espresso|tea|čaj|caj|hot drink|topli)' THEN 'hot_drink'
             WHEN m.station = 'bar' THEN 'cold_drink'
             WHEN lower(c.name || ' ' || s.name) ~ '(main|glavno|burger|pizza|pasta|grill|roštilj|rostilj|steak)' THEN 'main'
             ELSE NULL
           END::public.meal_role AS role
      FROM public.menu_items m
      JOIN public.subcategories s ON s.id = m.subcategory_id
      JOIN public.categories c ON c.id = s.category_id
  ) r
 WHERE r.id = mi.id AND r.role IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_menu_items_meal_role
  ON public.menu_items(meal_role) WHERE meal_role IS NOT NULL;

/** Is this role a drink? Drinks are the repeatable ones. */
CREATE OR REPLACE FUNCTION public.role_is_drink(_role public.meal_role)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT _role IN ('hot_drink', 'cold_drink', 'alcohol');
$$;

/**
 * How long before offering the same thing again is reasonable.
 *
 * A second coffee twenty minutes later is normal café behaviour and the engine
 * should not block it. A second identical main in one sitting almost never is.
 * NULL means never re-suggest within the visit.
 */
CREATE OR REPLACE FUNCTION public.role_repeat_minutes(_role public.meal_role)
RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE _role
    WHEN 'hot_drink'  THEN 25
    WHEN 'cold_drink' THEN 20
    WHEN 'alcohol'    THEN 20
    WHEN 'side'       THEN 45
    WHEN 'dessert'    THEN 60
    WHEN 'starter'    THEN 60
    ELSE NULL           -- mains, and anything unclassified
  END;
$$;
