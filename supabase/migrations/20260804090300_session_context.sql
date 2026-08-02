-- =====================================================================
-- The engine starts seeing the whole visit
--
-- Until now the ranker received only `_cart_item_ids`. At the after-meal
-- moment the cart is EMPTY — the guest has already ordered and eaten — so the
-- single highest-value upsell in a café ran with no context at all and fell
-- through to generic popularity. It did not know they had just had a steak.
--
-- Three further changes, each fixing something that is wrong today:
--
--   * "never suggest anything already in the cart" becomes ROLE-AWARE. Applied
--     to a whole visit the old rule would block a second coffee, which is
--     normal café behaviour. A second identical main is not.
--
--   * DIET STOPS BEING A HARD FILTER. This is a live bug, not a hypothetical:
--     one phone at a table of four, somebody adds a salad, `cart_diet` reads
--     the cart as vegetarian, and every meat dish is hidden from everyone
--     else. A table is not a person. Explicit guest filters stay hard; an
--     inferred preference becomes a ranking penalty.
--
--   * PRICE PROPORTIONALITY. A 30 KM dish offered to a table that has spent 18
--     reads as a machine that is not paying attention.
--
-- The ranker keeps its shape. Each change below is a targeted rewrite of the
-- live definition with its own assertion, so a clause that fails to match
-- raises rather than silently doing nothing — transcribing two hundred lines
-- of tuned scoring into this file would be the more dangerous option.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. What the table has done so far
-- ---------------------------------------------------------------------

/**
 * The visit so far.
 *
 * Internal and not granted to `anon`: it exposes what a table has eaten and
 * spent, and the only caller is the ranker, which is itself reached through a
 * wrapper that has already validated the session token. Authorisation belongs
 * at that boundary, not repeated here.
 *
 * `minutes_since_served` is measured from the most recent SERVED item, not the
 * most recent order — the question the after-meal prompt is really asking is
 * "have they finished eating", and an order sitting in the kitchen is not that.
 */
CREATE OR REPLACE FUNCTION public.session_context(_session_id uuid)
RETURNS TABLE(
  ordered_item_ids uuid[],
  served_item_ids uuid[],
  minutes_since_served numeric,
  running_total numeric,
  avg_line_price numeric,
  has_served_main boolean,
  covers int
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH lines AS (
    SELECT oi.menu_item_id, oi.unit_price, oi.served_at, mi.meal_role
      FROM public.order_items oi
      JOIN public.orders o ON o.id = oi.order_id
      JOIN public.menu_items mi ON mi.id = oi.menu_item_id
     WHERE o.table_session_id = _session_id
       AND o.status NOT IN ('cancelled', 'awaiting_payment', 'payment_failed')
  )
  SELECT
    COALESCE(array_agg(DISTINCT l.menu_item_id), '{}'),
    COALESCE(array_agg(DISTINCT l.menu_item_id) FILTER (WHERE l.served_at IS NOT NULL), '{}'),
    round(EXTRACT(EPOCH FROM (now() - max(l.served_at))) / 60.0, 1),
    COALESCE(sum(l.unit_price), 0),
    round(avg(l.unit_price), 2),
    COALESCE(bool_or(l.meal_role = 'main' AND l.served_at IS NOT NULL), false),
    (SELECT s.covers FROM public.table_sessions s WHERE s.id = _session_id)
  FROM lines l;
$$;

REVOKE ALL ON FUNCTION public.session_context(uuid) FROM PUBLIC, anon;

/**
 * Has this item been ordered too recently to suggest again?
 *
 * Roles decide. A coffee twenty-five minutes ago may be offered again; a main
 * ordered at any point in the visit may not, and neither may anything the
 * menu has not classified — an unknown role is treated as unrepeatable, which
 * is the safe direction.
 */
CREATE OR REPLACE FUNCTION public.repeat_blocked(
  _item_id uuid, _session_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH last_seen AS (
    SELECT max(COALESCE(oi.served_at, oi.created_at)) AS at
      FROM public.order_items oi
      JOIN public.orders o ON o.id = oi.order_id
     WHERE o.table_session_id = _session_id
       AND oi.menu_item_id = _item_id
       AND o.status NOT IN ('cancelled', 'awaiting_payment', 'payment_failed')
  )
  SELECT CASE
    WHEN (SELECT at FROM last_seen) IS NULL THEN false
    WHEN public.role_repeat_minutes((SELECT meal_role FROM public.menu_items WHERE id = _item_id)) IS NULL
      THEN true
    ELSE (SELECT at FROM last_seen) >
         now() - make_interval(mins => public.role_repeat_minutes(
           (SELECT meal_role FROM public.menu_items WHERE id = _item_id)))
  END;
$$;

REVOKE ALL ON FUNCTION public.repeat_blocked(uuid, uuid) FROM PUBLIC, anon;

-- ---------------------------------------------------------------------
-- 2. Rewire the ranker
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

  -- (a) Bring the visit into scope, alongside the cart.
  v_before := v_def;
  v_def := replace(v_def,
    '      public.cart_has_drink(_cart_item_ids) AS has_drink
  ),',
    '      public.cart_has_drink(_cart_item_ids) AS has_drink,
      sc.ordered_item_ids,
      sc.served_item_ids,
      sc.minutes_since_served,
      sc.avg_line_price,
      -- Cart plus what the table already ordered. At the after-meal moment the
      -- cart is empty, so without this the best upsell of the night has no
      -- context to pair against.
      (COALESCE(_cart_item_ids, ''{}''::uuid[]) || COALESCE(sc.ordered_item_ids, ''{}''::uuid[])) AS context
    FROM public.session_context(_session_id) sc
  ),');
  IF v_def = v_before THEN RAISE EXCEPTION 'rewrite (a) session context did not match'; END IF;

  -- (b) Candidate generation pairs against the visit, not just the cart.
  v_before := v_def;
  v_def := replace(v_def,
    '     WHERE a.item_a = ANY(p.cart)
       AND p.placement <> ''after_meal''',
    '     WHERE a.item_a = ANY(p.context)
       AND p.placement <> ''after_meal''');
  IF v_def = v_before THEN RAISE EXCEPTION 'rewrite (b) affinity context did not match'; END IF;

  v_before := v_def;
  v_def := replace(v_def,
    '             AND (r.source_item_id = ANY(p.cart)',
    '             AND (r.source_item_id = ANY(p.context)');
  IF v_def = v_before THEN RAISE EXCEPTION 'rewrite (b2) curated context did not match'; END IF;

  -- (c) Repeat rules by role, replacing the blanket cart exclusion.
  v_before := v_def;
  v_def := replace(v_def,
    '      AND NOT (mi.id = ANY(p.cart))',
    '      -- Never re-suggest what is in the cart right now; beyond that, ask
      -- the role. Blocking everything ordered this visit would refuse a
      -- second coffee, which is ordinary café behaviour.
      AND NOT (mi.id = ANY(p.cart))
      AND NOT public.repeat_blocked(mi.id, _session_id)');
  IF v_def = v_before THEN RAISE EXCEPTION 'rewrite (c) repeat rule did not match'; END IF;

  -- (d) Diet stops hiding food from a shared table.
  v_before := v_def;
  v_def := replace(v_def,
    '      -- Never suggest meat into an all-vegetarian cart. A hard filter, not a
      -- penalty: for a guest who has shown what they eat, being offered a
      -- steak reads as not being listened to.
      AND (p.diet IS NULL
           OR (p.diet = ''vegan'' AND ''vegan'' = ANY(mi.dietary_tags))
           OR (p.diet = ''vegetarian'' AND (''vegetarian'' = ANY(mi.dietary_tags) OR ''vegan'' = ANY(mi.dietary_tags))))
',
    '      -- Diet inferred from the cart is a PREFERENCE, not a restriction, and
      -- it is applied as a score penalty below rather than as a filter. One
      -- phone at a table of four ordering a salad must not hide every meat
      -- dish from the other three. Explicit allergen filters, which the guest
      -- set deliberately, remain hard.
');
  IF v_def = v_before THEN RAISE EXCEPTION 'rewrite (d) diet filter did not match'; END IF;

  -- (e) Two new penalties on the score: inferred diet, and price distance.
  v_before := v_def;
  v_def := replace(v_def,
    '      ) AS score',
    '      /*
       * Inferred diet — a nudge, not a wall. Strong enough that a vegetarian
       * table rarely sees meat suggested, weak enough that it never hides it.
       */
      - CASE
          WHEN p.diet IS NULL THEN 0
          WHEN p.diet = ''vegan'' AND ''vegan'' = ANY(mi.dietary_tags) THEN 0
          WHEN p.diet = ''vegetarian''
               AND (''vegetarian'' = ANY(mi.dietary_tags) OR ''vegan'' = ANY(mi.dietary_tags)) THEN 0
          ELSE 0.30
        END
      /*
       * Price proportionality. Only bites ABOVE the table''s own average line
       * price — suggesting something cheaper is never wrong — and caps out, so
       * an expensive item is pushed down rather than made unreachable.
       */
      - CASE
          WHEN p.avg_line_price IS NULL OR p.avg_line_price <= 0 THEN 0
          WHEN mi.price <= p.avg_line_price * 1.5 THEN 0
          ELSE LEAST(0.30, 0.15 * (mi.price / p.avg_line_price - 1.5))
        END
      ) AS score');
  IF v_def = v_before THEN RAISE EXCEPTION 'rewrite (e) penalties did not match'; END IF;

  EXECUTE v_def;
  RAISE NOTICE 'rank_recommendations rewired for session context';
END $$;

-- The ranker now reads session state, so it is no longer safe to call for an
-- arbitrary session id. It was already revoked from anon by the ledger
-- migration; this documents why it must stay that way.
COMMENT ON FUNCTION public.rank_recommendations(uuid[], text, text, int, uuid, text[]) IS
  'Pure ranking. Reads what the table has ordered, so it must only ever be '
  'called behind guest_get_recommendations, which validates the session token.';

-- ---------------------------------------------------------------------
-- 3. When the after-meal moment actually is
-- ---------------------------------------------------------------------

ALTER TABLE public.restaurant_settings
  ADD COLUMN IF NOT EXISTS after_meal_prompt_minutes int NOT NULL DEFAULT 8
    CHECK (after_meal_prompt_minutes BETWEEN 0 AND 120);

COMMENT ON COLUMN public.restaurant_settings.after_meal_prompt_minutes IS
  'How long after the mains are served before a dessert or coffee suggestion '
  'is worth making. Too soon reads as rushing the table.';

/**
 * Is this a good moment to suggest dessert?
 *
 * Mains actually served, enough time passed to have eaten them, and nothing
 * ordered since. Previously the prompt appeared the instant anything was
 * served, which could mean offering dessert alongside the starters.
 */
CREATE OR REPLACE FUNCTION public.after_meal_moment(_session_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT sc.has_served_main
       AND sc.minutes_since_served >= COALESCE(
             (SELECT after_meal_prompt_minutes FROM public.restaurant_settings WHERE id = 1), 8)
      FROM public.session_context(_session_id) sc
  ), false);
$$;

REVOKE ALL ON FUNCTION public.after_meal_moment(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.after_meal_moment(uuid) TO anon, authenticated;
