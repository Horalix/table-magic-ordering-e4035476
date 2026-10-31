-- =====================================================================
-- Suggestions a head waiter would sign, and that learn the right way round
-- (supabase/tests/reco-quality.test.ts)
-- =====================================================================
--
-- A review of every dish of both restaurants, at breakfast, lunch, the
-- afternoon and dinner, in all four places a suggestion is shown, with and
-- without a month of La Soul's orders, found no suggestion a waiter would call
-- wrong on the first night — and these, each fixed here:
--
--   1. Feedback ran backwards. A pair guests took 40% of the time fell below
--      drinks never shown: once a pair had a record, the owner's priority
--      and what tables taught shrank to a fifth, and the profit term that
--      replaced them could not make up for it. Now the pair's own record
--      takes their place on the same scale — as often as suggestions are
--      taken here counts as a middling house priority, more often as a good
--      one (0.6), and beyond that what it earns decides — so a pair guests
--      keep taking rises and one they ignore falls. With no record nothing
--      changes.
--   2. What tables taught was popularity, not pairing. A learned pair ranked
--      by how often A's tables ordered B; Coca-Cola, ordered with every kind
--      of meal, became the first drink for every pasta, risotto and salad,
--      over the house's own (and dearer) pairings. Now a learned pair counts
--      in full only when the tables that carry it take B at least half again
--      as often as tables with comparable food of another kind do (same
--      family: breakfast, other savoury food, sweet, drinks), on the same
--      pessimistic reading as every other pair, and not at all when no more
--      often. Real preferences — burger tables taking to a Peach Lemonade —
--      still lead, as before; a drink everybody has with every meal, or one
--      of twenty that came up a few times more with a salad, does not.
--   3. A guest who said no to a lemonade was offered a mojito, then an iced
--      tea. The shortlist now puts one of each before two of anything (the
--      best stays first; the best of each other group with a pairing behind
--      it comes before a second of any group, unless that leads by more than
--      0.15): a burger gets a drink, then fries. And what the guest dismissed
--      this visit moves its whole group back.
--   4. A table with a drink each was offered another soft drink in the next
--      round (fries after a burger and a Coke: a Coke Zero). Cold drinks are
--      offered with food only while the table has fewer than people.
--   5. A child's meal counted as a person for "drinks for the table": a kid
--      and a grown-up were offered two apple juices. A drink suggested for a
--      kids' dish is counted for the kids' dishes; the grown-ups' for them.
--   6. The dish page offered what went with the cart, not with the dish:
--      fries on the Lava Cake's page because a burger was in the cart.
--      Something that goes only with another dish in the cart is pushed
--      below what goes with the dish itself (0.60), not hidden.
--   7. A breakfast for two read as "for sharing", so cake was offered after
--      it at lunchtime. It is breakfast. And Vera Italia's rib-eye platter
--      (fries, walnut salad and baguette already on it) is offered the
--      caprese before two starters of bread (scripts/vera-italia/menu.json).
--   8. The fit graph and its clashes were one list for both restaurants: a
--      row added for Vera Italia changed La Soul. A row may now belong to one
--      restaurant (venue_id); every row so far stays both restaurants'.
--   9. The ledger recorded every choice as certain (probability 1) while
--      exploration changed the first card at about three tables in ten. It
--      now records the probability the choice actually had under the
--      exploration in force, so the ledger can be read off-policy. And what a
--      dish does on the cart now informs its dish page, and the other way
--      round, before either has a record of its own.
--
-- La Soul's first night keeps its first cards — every one the waiter
-- scenarios hold (supabase/tests/reco-waiter-scenarios.test.ts) — except where
-- one of the fixes above is the point (after a breakfast for two; a second
-- round; a dish page with something else in the cart). The halal and
-- alcohol-free rules are untouched.
--
-- The ranker now lives in reco_rank_scored, which also returns what it
-- scored; rank_recommendations keeps its signature and result and reads it,
-- so older migrations that restate rank_recommendations still apply.
-- Safe to run twice. Runs after 20261031110000_owner_overview.sql.

-- ---------------------------------------------------------------------
-- 0. Groups and families of kinds
-- ---------------------------------------------------------------------

/**
 * What a guest would call "the same thing again", for variety on the
 * shortlist and for "no thanks": any cold drink, an iced coffee, a hot
 * drink, something sweet, a starter, fries, a salad, an extra, a main.
 */
CREATE OR REPLACE FUNCTION public.reco_kind_group(_kind text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN _kind IN ('refresher', 'soft', 'mocktail', 'juice', 'smoothie', 'water', 'no_suggest') THEN 'cold_drink'
    WHEN _kind IN ('iced_coffee', 'frappe') THEN 'iced_coffee'
    WHEN _kind = 'hot' THEN 'hot_drink'
    WHEN _kind IN ('dessert', 'pastry') THEN 'sweet'
    WHEN _kind IN ('appetizer', 'soup') THEN 'starter'
    WHEN _kind IN ('handheld', 'plate', 'breakfast', 'kids', 'combo', 'sharing', 'other_food') THEN 'main'
    ELSE COALESCE(_kind, 'other')
  END;
$$;

/**
 * Comparable tables, for what learning calls "more often than usual":
 * breakfast, other savoury food, something sweet, or a drink. Breakfast is
 * its own: a morning table orders no cola, and counting it with the lunch
 * tables made every lunch dish look like a cola pairing.
 */
CREATE OR REPLACE FUNCTION public.reco_kind_family(_kind text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN _kind = 'breakfast' THEN 'breakfast'
    WHEN _kind IN ('dessert', 'pastry') THEN 'sweet'
    WHEN _kind IN ('hot', 'iced_coffee', 'frappe', 'refresher', 'juice', 'smoothie', 'mocktail', 'soft', 'water', 'no_suggest')
      THEN 'drink'
    ELSE 'savoury'
  END;
$$;

-- ---------------------------------------------------------------------
-- 1. A breakfast for two is breakfast (7)
-- ---------------------------------------------------------------------

/** As in 20261031090000_vera_suggestions.sql, except a breakfast dish for two is breakfast, not "sharing". */
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
    -- A breakfast for two is breakfast: coffee or juice with it, no cake after it.
    WHEN n ~ '(box set|for two|for 2|to share)' AND s <> 'breakfast' THEN 'sharing'
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
-- 2. The fit graph may be one restaurant's (8)
-- ---------------------------------------------------------------------
-- NULL: both restaurants, as every row so far. The key stays (context,
-- candidate): a pair is either both restaurants' or one's.
ALTER TABLE public.reco_fit ADD COLUMN IF NOT EXISTS venue_id uuid REFERENCES public.venues(id) ON DELETE CASCADE;
ALTER TABLE public.reco_clash ADD COLUMN IF NOT EXISTS venue_id uuid REFERENCES public.venues(id) ON DELETE CASCADE;
COMMENT ON COLUMN public.reco_fit.venue_id IS 'The one restaurant this row is for; NULL for both.';
COMMENT ON COLUMN public.reco_clash.venue_id IS 'The one restaurant this row is for; NULL for both.';

-- ---------------------------------------------------------------------
-- 3. Learned pairs: specific, not merely popular (2)
-- ---------------------------------------------------------------------

/**
 * As in 20261030130000_suggestions_per_restaurant.sql, except the strength:
 * 1 − exp(−θ_A / 0.12) as before, times how specific the pair is — in full
 * once the tables that carry it take B half again as often as tables with
 * comparable food of another kind (same family: breakfast, other savoury
 * food, sweet, drinks), on eb_lower05's pessimistic reading; nothing when
 * no more often. Gates, levels, counts and the other columns are unchanged.
 */
CREATE OR REPLACE FUNCTION public.reco_learned_pairs(_context uuid[], _at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(item_id uuid, source_item_id uuid, level text, tables integer, attach numeric, lift numeric, strength numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH prm AS (
    SELECT COALESCE(_at, public.reco_now()) AS at,
           5::numeric    AS m,         -- pseudo-tables of prior at each level
           3             AS support,   -- tables before a pair is believed
           0.12::numeric AS ref        -- strength 1 − exp(−share / ref): 0.81 at one in five
  ),
  ctx AS (
    SELECT DISTINCT mi.id AS a, mi.venue_id AS v, mi.subcategory_id::text AS s,
           public.reco_kind(mi.name, sub.name, mi.meal_role, mi.station) AS k
      FROM public.menu_items mi
      LEFT JOIN public.subcategories sub ON sub.id = mi.subcategory_id
     WHERE mi.id = ANY(COALESCE(_context, '{}'::uuid[]))
  ),
  keyed AS (
    SELECT c.a, 'item'::text AS lvl, c.a::text AS key FROM ctx c
    UNION ALL
    SELECT c.a, 'section', c.s FROM ctx c WHERE c.s IS NOT NULL
    UNION ALL
    SELECT c.a, 'kind', c.k FROM ctx c
  ),
  counted AS (
    SELECT kd.a, kd.lvl, r.item_id AS b, r.tables, public.reco_decayed(r.w, r.w_at, prm.at) AS w
      FROM keyed kd
      JOIN (SELECT * FROM public.reco_learning WHERE venue_id IN (SELECT cv.v FROM ctx cv)) r ON r.ctx_level = kd.lvl AND r.ctx_key = kd.key
      CROSS JOIN prm
  ),
  -- A pair never crosses restaurants: B is a dish of A's restaurant.
  cand AS (
    SELECT DISTINCT c.a, c.b
      FROM counted c
      JOIN ctx x ON x.a = c.a
      JOIN public.menu_items mb ON mb.id = c.b AND mb.venue_id = x.v
     WHERE c.b IS NOT NULL
  ),
  base AS (
    SELECT r.ctx_key AS b, public.reco_decayed(r.w, r.w_at, prm.at) AS w
      FROM (SELECT * FROM public.reco_learning WHERE venue_id IN (SELECT cv.v FROM ctx cv)) r CROSS JOIN prm
     WHERE r.ctx_level = 'item' AND r.item_id IS NULL
       AND r.ctx_key IN (SELECT c.b::text FROM cand c)
  ),
  everyone AS (
    SELECT COALESCE(max(public.reco_decayed(r.w, r.w_at, prm.at)), 0) AS w
      FROM (SELECT * FROM public.reco_learning WHERE venue_id IN (SELECT cv.v FROM ctx cv)) r CROSS JOIN prm
     WHERE r.ctx_level = 'all' AND r.ctx_key = '*' AND r.item_id IS NULL
  ),
  /*
   * What comparable tables order: B's share among visits with food of the
   * same family as A (breakfast, other savoury food, something sweet, a
   * drink) but of another kind — or, where the family is A's kind alone,
   * among its other dishes' tables — leaving out B's own kind. A pair is
   * specific when A's tables take B more often than that, on a pessimistic
   * reading of how many tables say so: Coca-Cola, taken with every kind of
   * meal alike, is not a pasta pairing however often pasta tables order it,
   * and one drink of twenty that happened to come up a few times more with
   * a salad is not one either.
   */
  kind_tot AS (
    SELECT r.ctx_key AS kk, public.reco_kind_family(r.ctx_key) AS fam, public.reco_decayed(r.w, r.w_at, prm.at) AS w
      FROM (SELECT * FROM public.reco_learning WHERE venue_id IN (SELECT cv.v FROM ctx cv)) r CROSS JOIN prm
     WHERE r.ctx_level = 'kind' AND r.item_id IS NULL
  ),
  kind_b AS (
    SELECT r.ctx_key AS kk, public.reco_kind_family(r.ctx_key) AS fam, r.item_id AS b,
           public.reco_decayed(r.w, r.w_at, prm.at) AS w
      FROM (SELECT * FROM public.reco_learning WHERE venue_id IN (SELECT cv.v FROM ctx cv)) r CROSS JOIN prm
     WHERE r.ctx_level = 'kind' AND r.item_id IN (SELECT c.b FROM cand c)
  ),
  b_kind AS (
    SELECT DISTINCT c.b, public.reco_kind(mi.name, sub.name, mi.meal_role, mi.station) AS bk
      FROM cand c
      JOIN public.menu_items mi ON mi.id = c.b
      LEFT JOIN public.subcategories sub ON sub.id = mi.subcategory_id
  ),
  fam AS (
    SELECT c.a, c.b,
           COALESCE((SELECT sum(kb.w) FROM kind_b kb
                      WHERE kb.b = c.b AND kb.fam = public.reco_kind_family(x.k) AND kb.kk <> bk.bk), 0) AS w_fb,
           COALESCE((SELECT sum(kt.w) FROM kind_tot kt
                      WHERE kt.fam = public.reco_kind_family(x.k) AND kt.kk <> bk.bk), 0) AS w_f,
           COALESCE((SELECT sum(kb.w) FROM kind_b kb WHERE kb.b = c.b AND kb.kk = x.k AND kb.kk <> bk.bk), 0) AS w_fb_own_kind,
           COALESCE((SELECT sum(kt.w) FROM kind_tot kt WHERE kt.kk = x.k AND kt.kk <> bk.bk), 0) AS w_f_own_kind,
           -- A's own tables are in those sums unless A is of B's kind.
           (x.k <> bk.bk) AS a_counted
      FROM cand c
      JOIN ctx x ON x.a = c.a
      JOIN b_kind bk ON bk.b = c.b
  ),
  m AS (
    SELECT c.a, c.b,
           COALESCE(pi.w, 0) AS w_ab, COALESCE(pi.tables, 0) AS n_ab, COALESCE(ti.w, 0) AS w_a,
           COALESCE(ps.w, 0) AS w_sb, COALESCE(ps.tables, 0) AS n_sb, COALESCE(ts.w, 0) AS w_s,
           COALESCE(pk.w, 0) AS w_kb, COALESCE(pk.tables, 0) AS n_kb, COALESCE(tk.w, 0) AS w_k,
           COALESCE(bs.w, 0) AS w_b,
           GREATEST(e.w, 1) AS w_all
      FROM cand c
      CROSS JOIN everyone e
      LEFT JOIN counted pi ON pi.a = c.a AND pi.lvl = 'item'    AND pi.b = c.b
      LEFT JOIN counted ps ON ps.a = c.a AND ps.lvl = 'section' AND ps.b = c.b
      LEFT JOIN counted pk ON pk.a = c.a AND pk.lvl = 'kind'    AND pk.b = c.b
      LEFT JOIN counted ti ON ti.a = c.a AND ti.lvl = 'item'    AND ti.b IS NULL
      LEFT JOIN counted ts ON ts.a = c.a AND ts.lvl = 'section' AND ts.b IS NULL
      LEFT JOIN counted tk ON tk.a = c.a AND tk.lvl = 'kind'    AND tk.b IS NULL
      LEFT JOIN base bs ON bs.b = c.b::text
  ),
  shrunk AS (
    SELECT m.*, x.beta, y.th_k, z.th_s, t.th_a,
           (m.n_ab >= prm.support AND public.eb_lower05(m.w_ab, m.w_a * m.w_b / m.w_all) > 1) AS item_ok,
           (m.n_sb >= prm.support AND public.eb_lower05(m.w_sb, m.w_s * m.w_b / m.w_all) > 1) AS section_ok,
           (m.n_kb >= prm.support AND public.eb_lower05(m.w_kb, m.w_k * m.w_b / m.w_all) > 1) AS kind_ok,
           prm.ref
      FROM m
      CROSS JOIN prm
      CROSS JOIN LATERAL (SELECT (m.w_b + 0.5) / (m.w_all + 1) AS beta) x
      CROSS JOIN LATERAL (SELECT (m.w_kb + prm.m * x.beta) / (m.w_k + prm.m) AS th_k) y
      CROSS JOIN LATERAL (SELECT (m.w_sb + prm.m * y.th_k) / (m.w_s + prm.m) AS th_s) z
      CROSS JOIN LATERAL (SELECT (m.w_ab + prm.m * z.th_s) / (m.w_a + prm.m) AS th_a) t
  )
  SELECT s.b, s.a,
         CASE WHEN s.item_ok THEN 'item' WHEN s.section_ok THEN 'section' ELSE 'kind' END,
         CASE WHEN s.item_ok THEN s.n_ab WHEN s.section_ok THEN s.n_sb ELSE s.n_kb END,
         round(s.th_a, 4),
         round(s.th_a / NULLIF(s.beta, 0), 2),
         -- As before, how likely a table with A is to want B — counted in
         -- full once the tables that carry the pair take B at least 1.5 times
         -- as often as comparable tables, on the same pessimistic reading as
         -- every other pair (eb_lower05), and not at all when no more often.
         round((1 - exp(-s.th_a / s.ref))
               * LEAST(1, GREATEST(0, (public.eb_lower05(ff.n_lvl, ff.w_lvl * ff.th_fam) - 1) / 0.5)), 4)
    FROM shrunk s
    JOIN fam f ON f.a = s.a AND f.b = s.b
    CROSS JOIN LATERAL (
      SELECT CASE WHEN f.w_f - f.w_f_own_kind >= 10
                  THEN (GREATEST(f.w_fb - f.w_fb_own_kind, 0) + 0.5) / (GREATEST(f.w_f - f.w_f_own_kind, 0) + 1)
                  ELSE (GREATEST(f.w_fb - CASE WHEN f.a_counted THEN s.w_ab ELSE 0 END, 0) + 0.5)
                     / (GREATEST(f.w_f - CASE WHEN f.a_counted THEN s.w_a ELSE 0 END, 0) + 1)
             END AS th_fam,
             -- The tables that carry the pair: A's own, its section's or its kind's.
             CASE WHEN s.item_ok THEN s.w_ab WHEN s.section_ok THEN s.w_sb ELSE s.w_kb END AS n_lvl,
             CASE WHEN s.item_ok THEN s.w_a WHEN s.section_ok THEN s.w_s ELSE s.w_k END AS w_lvl
    ) ff
   WHERE s.item_ok OR s.section_ok OR s.kind_ok;
$function$;

-- ---------------------------------------------------------------------
-- 4. A dish's record on the cart informs its dish page, and back (9)
-- ---------------------------------------------------------------------

/** As in 20261030130000_suggestions_per_restaurant.sql, plus the dish's prior at the sibling placement. */
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
      -- The cart and the dish page ask the same question of the same dish.
      SELECT sp.alpha0, sp.beta0, sp.item_shown, 1
        FROM public.suggestion_priors sp
       WHERE sp.recommended_item_id = _item_id
         AND sp.placement = CASE _placement WHEN 'cart' THEN 'item' WHEN 'item' THEN 'cart' END
      UNION ALL
      SELECT sp.alpha0, sp.beta0, 0, 2
        FROM public.suggestion_priors sp
       WHERE sp.recommended_item_id IS NULL AND sp.placement = _placement
         AND sp.venue_id = (SELECT mi.venue_id FROM public.menu_items mi WHERE mi.id = _item_id)
      UNION ALL
      SELECT 1::numeric, 12::numeric, 0, 3
    ) x
   ORDER BY x.pref
   LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.suggestion_prior(uuid, text) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------
-- 5. The ranker (1, 3, 4, 5, 6, 8)
-- ---------------------------------------------------------------------

/**
 * The ranker of 20261031090000_vera_suggestions.sql, with every guardrail
 * unchanged, and:
 *   - a pair's own record replaces the stand-ins on their scale (1);
 *   - one of each group before two of anything, the best always first (3);
 *   - no cold drink with food once the table has one per person, this round
 *     or an earlier one; basket completion likewise (4);
 *   - drinks for a kids' dish counted by the kids' dishes, the grown-ups'
 *     drinks by the grown-ups (5);
 *   - on the dish page, something that goes only with another dish in the
 *     cart pushed down by 0.60 (6);
 *   - reco_fit and reco_clash rows of this restaurant or of both (8);
 *   - up to 24 rows, each with its score, its exploration draw and room, its
 *     group and its place (`ord`), for the guest wrapper (9).
 */
CREATE OR REPLACE FUNCTION public.reco_rank_scored(_cart_item_ids uuid[] DEFAULT '{}'::uuid[], _placement text DEFAULT 'cart'::text, _language text DEFAULT 'en'::text, _limit integer DEFAULT 4, _session_id uuid DEFAULT NULL::uuid, _exclude_allergens text[] DEFAULT '{}'::text[], _cart_quantities integer[] DEFAULT NULL::integer[])
 RETURNS TABLE(id uuid, name text, name_bs text, name_ar text, price numeric, image_url text, dietary_tags text[], recommendation_type text, reason text, source_item_id uuid, suggested_quantity integer, score numeric, explore numeric, explore_room numeric, grp text, kind text, curated_score numeric, learned_score numeric, observed_score numeric, evidence numeric, p_accept numeric, ord integer)
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
      LEAST(GREATEST(COALESCE(_limit, 4), 1), 24) AS lim,
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
      -- Drinks for the grown-ups at the table: a child's meal is counted for
      -- the child's own drink (kids_qty), not for another lemonade.
      CASE WHEN GREATEST(COALESCE(sc.covers, 0), u.main_units) - u.kids_units >= 2
           THEN LEAST(GREATEST(GREATEST(COALESCE(sc.covers, 0), u.main_units) - u.kids_units - u.drink_units, 1), 6)
           ELSE 1 END AS table_qty,
      LEAST(GREATEST(u.kids_units, 1), 6) AS kids_qty,
      -- Cold drinks already on the table this visit (a combo comes with one),
      -- and how many people are eating: no second soft drink each.
      u.cold_units,
      GREATEST(COALESCE(sc.covers, 0), u.main_units, 1) AS people,
      -- The dish page asks about the dish first in the list; the rest is the cart.
      CASE WHEN _placement = 'item' AND cardinality(own.cart) > 1 THEN own.cart[1] END AS viewed,
      -- How often this restaurant's guests take a suggestion here at all: what
      -- a pair's own record is measured against.
      COALESCE((SELECT sp.alpha0 / NULLIF(sp.alpha0 + sp.beta0, 0)
                  FROM public.suggestion_priors sp
                 WHERE sp.recommended_item_id IS NULL
                   AND sp.venue_id = own.venue
                   AND sp.placement = CASE WHEN _placement IN ('cart', 'after_meal', 'item', 'tab') THEN _placement ELSE 'cart' END
                 LIMIT 1), 1.0 / 13) AS base_accept
    FROM public.session_context(_session_id) sc
    CROSS JOIN own
    CROSS JOIN LATERAL (
      SELECT COALESCE(sum(l.qty) FILTER (WHERE mi.meal_role = 'main'), 0)::int AS main_units,
             COALESCE(sum(l.qty) FILTER (WHERE mi.meal_role IN ('main', 'starter', 'side')
                                           OR (mi.meal_role IS NULL AND mi.station = 'kitchen')), 0)::int AS food_units,
             COALESCE(sum(l.qty) FILTER (WHERE public.role_is_drink(mi.meal_role)
                                           OR (mi.meal_role IS NULL AND mi.station = 'bar')), 0)::int AS drink_units,
             COALESCE(sum(l.qty) FILTER (WHERE mi.meal_role = 'cold_drink'
                                           OR (mi.meal_role IS NULL AND mi.station = 'bar')
                                           OR mi.name ~* '\mcombo\M'), 0)::int AS cold_units,
             COALESCE(sum(l.qty) FILTER (WHERE ks.name ~* '(kid|djec|dječ|dijete|child)'
                                           AND mi.name !~* '\mcombo\M'), 0)::int AS kids_units
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
        LEFT JOIN public.subcategories ks ON ks.id = mi.subcategory_id
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
                             AND (f.venue_id IS NULL OR f.venue_id = (SELECT venue FROM here))
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
     WHERE ((p.placement IN ('cart', 'item') AND cardinality(p.cart) > 0 AND NOT p.has_drink
             AND p.cold_units < p.people)
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
           THEN CASE WHEN EXISTS (SELECT 1 FROM public.menu_items si
                                    JOIN public.subcategories ss ON ss.id = si.subcategory_id
                                   WHERE si.id = r.source_item_id
                                     AND ss.name ~* '(kid|djec|dječ|dijete|child)')
                     THEN p.kids_qty ELSE p.table_qty END
           ELSE 1 END AS suggested_quantity,
      k.kind,
      public.reco_kind_group(k.kind) AS grp,
      -- How far exploration can lift this dish (the draw below is a share of it).
      s.w_explore * (30.0 / (30 + COALESCE(st.shown, 0))) AS explore_room,
      -- The dish page answers "what goes with THIS?": something that only goes
      -- with another dish in the cart is pushed down, not hidden.
      CASE
        WHEN p.viewed IS NULL OR r.source_item_id IS NOT DISTINCT FROM p.viewed THEN 0
        WHEN EXISTS (SELECT 1 FROM public.reco_fit vf JOIN kinds vk ON vk.id = p.viewed
                      WHERE vf.context_kind = vk.kind AND vf.candidate_kind = k.kind
                        AND (vf.venue_id IS NULL OR vf.venue_id = p.venue)) THEN 0
        ELSE 0.60
      END AS anchor_penalty,
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
               AND (f.venue_id IS NULL OR f.venue_id = p.venue)
               AND CASE WHEN p.placement = 'after_meal'
                        THEN f.context_kind = 'after_meal'
                        ELSE f.context_kind IN (SELECT ck.kind FROM context_kinds ck) END))
      -- Nothing that clashes with what is on the table, curated or not.
      AND NOT EXISTS (
            SELECT 1 FROM public.reco_clash c
             WHERE c.candidate_kind = k.kind
               AND (c.venue_id IS NULL OR c.venue_id = p.venue)
               AND c.context_kind IN (SELECT ck.kind FROM context_kinds ck))
      -- No second of a kind already in this round: we can add, not swap, so
      -- an "upgrade" to truffle fries next to regular fries is a second side.
      AND (p.placement = 'after_meal' OR k.kind NOT IN (SELECT kk.kind FROM cart_kinds kk))
      -- ---- Guardrails. Scoring cannot override any of these. ----
      AND public.menu_item_orderable(mi, p.now_time)
      -- Never re-suggest what is in the cart right now; beyond that, ask the
      -- role (a second coffee is ordinary café behaviour).
      AND NOT (mi.id = ANY(p.cart))
      -- No second soft drink each: once the table has as many cold drinks as
      -- people (this round or an earlier one), none is offered with the food.
      AND NOT (p.placement IN ('cart', 'item') AND mi.meal_role = 'cold_drink' AND p.cold_units >= p.people)
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
      ( (1 - v.evidence) * (s.w_curated * GREATEST(v.curated_score, v.learned_score)
                            + s.w_observed * v.observed_score)
      -- ...and what its own record says, on the scale of a house priority:
      -- taken as often as suggestions are taken here = 0.5, at most 0.6 (a
      -- good house priority); beyond that, what it earns (below, with how
      -- often it is taken) decides. A pair guests keep taking rises; one they
      -- ignore falls; exploration can still give a new dish its turn.
      + v.evidence * s.w_curated * LEAST(0.6, 0.5 * v.p_accept / NULLIF(p.base_accept, 0))
      -- Expected profit: a light hand while it rests on assumptions, the
      -- full weight once the pair has a record.
      + s.w_value * (0.3 + 0.7 * v.evidence)
                  * COALESCE(v.expected_value / NULLIF(max(v.expected_value) OVER (), 0), 0)
      + (0.10 * COALESCE(v.margin_score, 0)::numeric / 100 - 0.05)
      + v.explore
      - v.load_penalty
      - v.diet_penalty
      - v.price_penalty
      - v.anchor_penalty
      - 0.15 * v.passed_over
      ) AS score
    FROM valued v
    CROSS JOIN s
    CROSS JOIN p
  ),
  /*
   * One of each before two of anything: the best stays first; after it, the
   * best of each other group with a pairing behind it (the house's, what
   * tables taught, or co-occurrence) comes before a second of any group, or a
   * filler with no pairing behind it, unless those lead by more than 0.15.
   * Burger: a drink, then fries. Pasta: a drink, then the salad. A dessert:
   * an espresso, a cappuccino — not a bottle of water for variety's sake.
   */
  diversified AS (
    SELECT sc.*,
           row_number() OVER (ORDER BY sc.score DESC, sc.price ASC, sc.id) AS overall,
           row_number() OVER (PARTITION BY sc.grp ORDER BY sc.score DESC, sc.price ASC, sc.id) AS grp_rank
      FROM scored sc
  )
  SELECT d.id, d.name, d.name_bs, d.name_ar, d.price, d.image_url, d.dietary_tags,
         d.rtype AS recommendation_type,
         d.rtype AS reason,
         d.source_item_id,
         d.suggested_quantity,
         round(d.score, 6) AS score,
         round(d.explore, 6) AS explore,
         round(d.explore_room, 6) AS explore_room,
         d.grp,
         d.kind,
         round(d.curated_score, 4) AS curated_score,
         round(d.learned_score, 4) AS learned_score,
         round(d.observed_score, 4) AS observed_score,
         round(d.evidence, 4) AS evidence,
         round(d.p_accept, 4) AS p_accept,
         (row_number() OVER (ORDER BY CASE WHEN d.overall = 1 THEN 1e9
                                           WHEN d.grp_rank = 1
                                                AND (d.curated_score > 0 OR d.learned_score > 0
                                                     OR d.rtype IN ('frequently_bought_together', 'after_meal'))
                                             THEN d.score
                                           ELSE d.score - 0.15 END DESC,
                                      d.score DESC, d.price ASC, d.id))::int AS ord
    FROM diversified d
   ORDER BY ord
   LIMIT (SELECT lim FROM p);
$function$;

REVOKE ALL ON FUNCTION public.reco_rank_scored(uuid[], text, text, int, uuid, text[], int[]) FROM PUBLIC, anon;

/**
 * The ranker as it always answered — same arguments, same columns, at most
 * eight rows — read from reco_rank_scored.
 */
CREATE OR REPLACE FUNCTION public.rank_recommendations(_cart_item_ids uuid[] DEFAULT '{}'::uuid[], _placement text DEFAULT 'cart'::text, _language text DEFAULT 'en'::text, _limit integer DEFAULT 4, _session_id uuid DEFAULT NULL::uuid, _exclude_allergens text[] DEFAULT '{}'::text[], _cart_quantities integer[] DEFAULT NULL::integer[])
 RETURNS TABLE(id uuid, name text, name_bs text, name_ar text, price numeric, image_url text, dietary_tags text[], recommendation_type text, reason text, source_item_id uuid, suggested_quantity integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- house pairing source: resolved inside reco_rank_scored (20261031120000_reco_quality.sql)
  SELECT r.id, r.name, r.name_bs, r.name_ar, r.price, r.image_url, r.dietary_tags,
         r.recommendation_type, r.reason, r.source_item_id, r.suggested_quantity
    FROM public.reco_rank_scored(_cart_item_ids, _placement, _language,
                                 LEAST(GREATEST(COALESCE(_limit, 4), 1), 8),
                                 _session_id, _exclude_allergens, _cart_quantities) r
   ORDER BY r.ord;
$function$;

REVOKE ALL ON FUNCTION public.rank_recommendations(uuid[], text, text, int, uuid, text[], int[]) FROM PUBLIC, anon;

-- ---------------------------------------------------------------------
-- 6. The guest wrapper: "no thanks" by group, and an honest probability (3, 9)
-- ---------------------------------------------------------------------

/*
 * As in 20261025160000_reco_profit.sql, plus:
 *   - what the guest dismissed this visit moves its whole group to the back
 *     (a lemonade declined: the next card is the fries, not a mojito);
 *   - the decision records the probability its choice had: every dish's
 *     exploration draw is uniform within its room (reco_rank_scored), so the
 *     chance the chosen dish comes first is integrated over the draws of the
 *     candidates it competed with. 1 when nothing explores.
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
  v_declined text[];
  v_probability numeric := 1.0;
BEGIN
  PERFORM public.assert_guest_session(_session_id, _session_token);

  -- Twice in one transaction must not fail on the temp tables.
  DROP TABLE IF EXISTS pg_temp._ranked;
  DROP TABLE IF EXISTS pg_temp._scored;

  -- What the guest said no to this visit, as groups.
  v_declined := ARRAY(
    SELECT DISTINCT public.reco_kind_group(public.reco_kind(mi.name, sub.name, mi.meal_role, mi.station))
      FROM public.menu_items mi
      LEFT JOIN public.subcategories sub ON sub.id = mi.subcategory_id
     WHERE mi.id = ANY(COALESCE(_exclude_item_ids, '{}'::uuid[])));

  CREATE TEMP TABLE _scored ON COMMIT DROP AS
    SELECT r.*, (r.grp = ANY(v_declined)) AS declined
      FROM public.reco_rank_scored(
             _cart_item_ids, _placement, _language, 24, _session_id, v_allergens, _cart_quantities) r
     WHERE NOT (r.id = ANY(COALESCE(_exclude_item_ids, '{}'::uuid[])))
       AND v_tags <@ COALESCE(r.dietary_tags, '{}'::text[]);

  CREATE TEMP TABLE _ranked ON COMMIT DROP AS
    SELECT f.*, row_number() OVER (ORDER BY f.declined, f.ord) AS rnk
      FROM (SELECT sc.* FROM _scored sc ORDER BY sc.declined, sc.ord LIMIT v_limit) f;

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

  /*
   * The chance this dish was chosen: it comes first when its score, with its
   * own exploration draw u (uniform within its room), beats every rival's
   * with theirs. Integrated over u at 200 points; rivals are the dishes it
   * could have lost to (the same side of "no thanks"). Without exploration
   * it is 1.
   */
  IF v_top.id IS NOT NULL THEN
    SELECT COALESCE(round(avg(x.pr), 4), 1.0) INTO v_probability
      FROM (
        SELECT g.u,
               CASE WHEN bool_or(o.f <= 0) THEN 0 ELSE exp(sum(ln(GREATEST(o.f, 1e-300)))) END AS pr
          FROM (SELECT (k - 0.5) / 200.0 AS u
                  FROM generate_series(1, CASE WHEN v_top.explore_room > 0 THEN 200 ELSE 1 END) k) g
          CROSS JOIN LATERAL (
            SELECT CASE
                     WHEN c.explore_room > 0 THEN
                       LEAST(1, GREATEST(0, ((v_top.score - v_top.explore) + v_top.explore_room * g.u
                                             - (c.score - c.explore)) / c.explore_room))
                     WHEN (c.score - c.explore) < (v_top.score - v_top.explore) + v_top.explore_room * g.u THEN 1
                     WHEN (c.score - c.explore) = (v_top.score - v_top.explore) + v_top.explore_room * g.u
                          AND c.ord > v_top.ord THEN 1
                     ELSE 0
                   END AS f
              FROM _scored c
             WHERE c.id <> v_top.id AND c.declined = v_top.declined
          ) o
         GROUP BY g.u
      ) x;
  END IF;

  INSERT INTO public.recommendation_decisions(
    session_id, placement, policy_version, experiment_id, arm,
    candidates, chosen_item_id, source_item_id, recommendation_type, action_probability,
    cart_value, suggested_quantity)
  VALUES (
    _session_id, _placement, public.reco_policy_version(), v_experiment, v_arm,
    v_candidates, v_top.id, v_top.source_item_id, v_top.recommendation_type,
    v_probability,
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
-- 7. Vera Italia's rib-eye platter: the caprese first (7)
-- ---------------------------------------------------------------------
-- BEGIN GENERATED UPDATES by scripts/vera-italia/pairings-sql.mjs from scripts/vera-italia/menu.json
-- 3 pairings changed since 20261031090000_vera_suggestions.sql. Each moves
-- only while it still has the priority first written there: a rule the
-- owner has edited in the admin is left as they have it.
UPDATE public.menu_item_recommendations r
   SET priority = v.priority::smallint
  FROM (VALUES
    ('b7a1e000-0000-4000-8000-000000000013', 75, 45),  -- Bistecca → Baked Feta Dip: Baked feta comes with its own garlic baguette, and the platter already has fries, a walnut salad and baguette: the last of its three starters.
    ('b7a1e000-0000-4000-8000-000000000014', 70, 55),  -- Bistecca → Bruschetta: A starter to share, after the caprese: it is bread, and the platter brings its own baguette.
    ('b7a1e000-0000-4000-8000-000000000015', 55, 75)   -- Bistecca → Insalata Caprese: The platter already has fries, a walnut salad and toasted baguette: tomato and mozzarella beside it, fresh rather than more bread.
  ) AS v(id, seeded, priority)
 WHERE r.id = v.id::uuid AND r.priority = v.seeded::smallint;
-- END GENERATED UPDATES

-- ---------------------------------------------------------------------
-- 8. Learned counters, recounted
-- ---------------------------------------------------------------------
-- The breakfast for two has a new kind, and counters at the 'kind' level are
-- keyed by it. The full rebuild is what the nightly job runs; it runs here as
-- that job when this connection may run it, and is otherwise left to it.
DO $recount$
BEGIN
  PERFORM set_config('lasoul.scheduled_job', 'on', true);
  IF public.is_owner_or_scheduler() THEN
    PERFORM public.rebuild_reco_learning(365);
  ELSE
    RAISE NOTICE 'learned counters not recounted here: the next scheduled refresh does it';
  END IF;
  PERFORM set_config('lasoul.scheduled_job', '', true);
END
$recount$;
