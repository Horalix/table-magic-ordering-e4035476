-- =====================================================================
-- Suggestions that learn from what tables order, and act on it the same day
--
-- The owner's brief: "learn from users: if it sees lots of people are
-- ordering food A with drink B it should then offer someone else also like
-- that, similar." Until now the engine could not do that, for three
-- reasons, each fixed here:
--
--   1. Nothing ran the learning. Pair tables and acceptance stats were
--      rebuilt by the nightly job, which needs pg_cron, or by a manager
--      pressing Recompute. On a project without pg_cron the engine never
--      learned anything at all.
--
--      Now the event that produces evidence also records it: when an order
--      reaches the kitchen (and when a line is added to one that has), a
--      deferred trigger adds the visit to age-weighted counters — per dish,
--      per section and per kind of dish (reco_kind). No scheduler, no screen,
--      no person. The heavier tables (pair strength at order grain,
--      acceptance from the decision ledger, priors) are refreshed by
--      maybe_refresh_menu_intelligence(): at most every 30 minutes, only
--      when something new happened, never twice at once. pg_cron calls it
--      every 15 minutes where the extension exists; every staff screen (the
--      kitchen display, the admin) calls it every 5 minutes, so with or
--      without pg_cron it runs all day during service. It is never called
--      from the guest's suggestion request: Postgres cannot hand work off
--      without an extension, and a guest must not wait for a refresh.
--
--   2. A learned pair could never beat a house pairing. Observed strength
--      had a quarter of the weight, a curated pairing two fifths times its
--      priority, so "tables keep ordering Peach Lemonade with the burger"
--      lost to the curated Strawberry Lemonade however many tables did it.
--
--      Now learned evidence is read as what it is — how likely a table with
--      this dish is to want that one — on the same scale as a house
--      pairing's priority. For a dish A on the table and a candidate B:
--
--        θ_kind    = (w(kind A + B)    + 5·β_B)      / (w(kind A)    + 5)
--        θ_section = (w(section A + B) + 5·θ_kind)    / (w(section A) + 5)
--        θ_A       = (w(A + B)         + 5·θ_section) / (w(A)         + 5)
--
--      where w counts visits (tables), each weighing 0.5^(age in days / 45),
--      and β_B is B's share of all visits. A dish with no record of its own
--      inherits its section's, a section with none its kind's; a dish WITH a
--      record is pulled towards it — a burger nobody orders with lemonade
--      does not get lemonade because the other burgers do. The pair ranks
--      like a house pairing of priority 1 − exp(−θ_A / 0.12): 0.57 when one
--      table in ten with A orders B on its own, 0.81 at one in five, 0.94 at
--      one in three (the house pairings sit between 0.5 and 0.9). It keeps
--      the order — a drink half of such tables have beats one a quarter have —
--      and never exceeds the strongest pairing there could be.
--
--      Only when the evidence is real: at least 3 different tables had the
--      pair (at the level that carries it), and they had it more often than
--      chance on a pessimistic reading (EB05 > 1, as for every other pair).
--      One table, or two, changes nothing. On the real menu, after three
--      ordinary weeks (168 tables, 21 of them with the La Soul Burger and
--      a spread of drinks), tables ordering the burger with a Peach Lemonade
--      over the next three days make it the burger's drink, over the curated
--      Strawberry Lemonade, from the 4th such table; 1–3 change nothing
--      (supabase/tests/reco-adaptive.test.ts checks 0–12). Where the burger
--      is twice as busy it takes 10. Where Peach Lemonade is already a
--      quarter of ALL tables' drink, a dozen burger tables having it is not
--      a burger thing, and nothing changes: popularity is not a pairing.
--
--      Lines the guest added FROM a suggestion are left out of these
--      counts: those are measured as acceptance, and counting them again as
--      "what tables choose" would teach the engine its own suggestions.
--
--   3. Learning stays inside the relevance gate. A learned pair is ranked
--      like a house pairing but gated like any other candidate: it must fit
--      the table (reco_fit), must not be vetoed (a main, a kids' dish, an
--      energy drink, breakfast in the evening), must not clash, and passes
--      the same coursing rules. Co-occurrence can reorder good suggestions;
--      it cannot make a silly one appear.
--
-- The card says why, honestly: "Often ordered with this" (or "N% of tables
-- order this too" once the conservative bound allows) when this dish's own
-- tables taught it, "Often ordered with dishes like this" when it was
-- inherited from the section or kind. Admin → Menu intelligence lists the
-- learned pairs and says when the engine last learned and last refreshed.
--
-- rank_recommendations is restated with every guardrail of
-- 20261025160000_reco_profit.sql unchanged; the learned candidates are an
-- extra source and an extra term. Runs after 20261025160000_reco_profit.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. What tables taught it
-- ---------------------------------------------------------------------

/**
 * Age-weighted visit counters.
 *
 *   ('all', '*', NULL)            visits
 *   ('item', A, NULL)             visits with dish A
 *   ('section', S, NULL)          visits with a dish of section S
 *   ('kind', K, NULL)             visits with a dish of kind K (reco_kind)
 *   ('item', A, B)                visits with A and B
 *   ('section', S, B)             visits with a dish of S and B, B not in S
 *   ('kind', K, B)                visits with a dish of kind K and B, B not of K
 *
 * `w` is the sum of 0.5^(age / 45 days) as of `w_at` (read it through
 * reco_decayed); `tables` is the plain count, which the guard and the
 * card quote. A visit is a table session (an order without one is its own
 * visit), so six phones at one table are one table, not six.
 */
CREATE TABLE IF NOT EXISTS public.reco_learning (
  ctx_level text NOT NULL CHECK (ctx_level IN ('all', 'item', 'section', 'kind')),
  ctx_key text NOT NULL,
  item_id uuid REFERENCES public.menu_items(id) ON DELETE CASCADE,
  tables int NOT NULL DEFAULT 0,
  w numeric NOT NULL DEFAULT 0,
  w_at timestamptz NOT NULL DEFAULT now(),
  last_at timestamptz NOT NULL DEFAULT now()
);

-- Access first, then row level security and the policies below (Supabase no
-- longer grants new tables to the API roles by default).
REVOKE ALL ON public.reco_learning FROM PUBLIC, anon;
GRANT SELECT ON public.reco_learning TO authenticated;
GRANT ALL ON public.reco_learning TO service_role;

CREATE UNIQUE INDEX IF NOT EXISTS reco_learning_key
  ON public.reco_learning (ctx_level, ctx_key, (COALESCE(item_id, '00000000-0000-0000-0000-000000000000'::uuid)));

/**
 * Which dishes of a recent visit are already counted, so a second round
 * adds only what is new. Kept for a day's visits; rebuild_reco_learning()
 * resets it with the counters.
 */
CREATE TABLE IF NOT EXISTS public.reco_learned_visits (
  visit_id uuid NOT NULL,
  item_id uuid NOT NULL REFERENCES public.menu_items(id) ON DELETE CASCADE,
  learned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (visit_id, item_id)
);

-- Access first, then row level security and the policies below (Supabase no
-- longer grants new tables to the API roles by default).
REVOKE ALL ON public.reco_learned_visits FROM PUBLIC, anon;
GRANT SELECT ON public.reco_learned_visits TO authenticated;
GRANT ALL ON public.reco_learned_visits TO service_role;

-- A visit's lines are found by order. Served lines had no index on order_id
-- (only the partial one for open lines), and the learner, the ranker's
-- session context and every report read served lines.
CREATE INDEX IF NOT EXISTS idx_order_items_order ON public.order_items(order_id);

ALTER TABLE public.reco_learning ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reco_learned_visits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Staff read reco learning" ON public.reco_learning;
CREATE POLICY "Staff read reco learning" ON public.reco_learning
  FOR SELECT TO authenticated USING (public.is_staff_member());
DROP POLICY IF EXISTS "Staff read learned visits" ON public.reco_learned_visits;
CREATE POLICY "Staff read learned visits" ON public.reco_learned_visits
  FOR SELECT TO authenticated USING (public.is_staff_member());

/** A counter's weight as of `_at`: halves every 45 days. */
CREATE OR REPLACE FUNCTION public.reco_decayed(_w numeric, _w_at timestamptz, _at timestamptz)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(_w, 0) * power(0.5::numeric,
           GREATEST(EXTRACT(EPOCH FROM (_at - _w_at)), 0)::numeric / (86400.0 * 45));
$$;

/**
 * Every counter one visit with these dishes contributes to (see
 * reco_learning). The incremental learner adds keys(now) minus
 * keys(before); the rebuild computes the same keys set-wise, and a test
 * holds the two to the same totals.
 */
CREATE OR REPLACE FUNCTION public.reco_learning_keys(_items uuid[])
RETURNS TABLE(ctx_level text, ctx_key text, item_id uuid)
LANGUAGE sql
STABLE
AS $$
  WITH x AS (
    SELECT DISTINCT mi.id, mi.subcategory_id::text AS sub,
           public.reco_kind(mi.name, sub.name, mi.meal_role, mi.station) AS kind
      FROM public.menu_items mi
      LEFT JOIN public.subcategories sub ON sub.id = mi.subcategory_id
     WHERE mi.id = ANY(COALESCE(_items, '{}'::uuid[]))
  )
  SELECT 'all'::text, '*'::text, NULL::uuid FROM x HAVING count(*) > 0
  UNION
  SELECT 'item', x.id::text, NULL::uuid FROM x
  UNION
  SELECT 'section', x.sub, NULL::uuid FROM x WHERE x.sub IS NOT NULL
  UNION
  SELECT 'kind', x.kind, NULL::uuid FROM x
  UNION
  SELECT 'item', a.id::text, b.id FROM x a JOIN x b ON b.id <> a.id
  UNION
  SELECT 'section', a.sub, b.id FROM x a JOIN x b ON b.id <> a.id
   WHERE a.sub IS NOT NULL AND b.sub IS DISTINCT FROM a.sub
  UNION
  SELECT 'kind', a.kind, b.id FROM x a JOIN x b ON b.id <> a.id
   WHERE b.kind <> a.kind;
$$;

REVOKE ALL ON FUNCTION public.reco_learning_keys(uuid[]) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------
-- 1. Learn the moment an order reaches the kitchen
-- ---------------------------------------------------------------------

/**
 * Add what is new about one visit to the counters.
 *
 * The visit's dishes are read from its orders that count as sales
 * (completed_orders), less lines that came from a suggestion card. What the
 * ledger says was already counted is subtracted, so rounds, retries and the
 * several trigger events of one commit add each table once.
 *
 *   * A visit that started more than a day ago is left to the rebuild: the
 *     ledger only remembers a day.
 *   * While rebuild_reco_learning() holds the tables this returns at once
 *     (the rebuild, or the next one, counts the visit) rather than making
 *     an order wait.
 *   * One visit at a time (two phones at one table committing together);
 *     counters are updated in key order, so two visits never deadlock.
 */
CREATE OR REPLACE FUNCTION public.reco_learn_visit(_visit uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_items uuid[];
  v_known uuid[];
  v_started timestamptz;
  v_rows int := 0;
BEGIN
  IF _visit IS NULL THEN
    RETURN 0;
  END IF;
  IF NOT pg_try_advisory_xact_lock_shared(hashtext('lasoul.reco_learning')) THEN
    RETURN 0;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('lasoul.reco_visit'), hashtext(_visit::text));

  SELECT array_agg(DISTINCT oi.menu_item_id), min(o.created_at)
    INTO v_items, v_started
    FROM public.completed_orders o
    JOIN public.order_items oi ON oi.order_id = o.id
   WHERE (o.table_session_id = _visit OR (o.table_session_id IS NULL AND o.id = _visit))
     AND NOT EXISTS (
           SELECT 1 FROM public.suggestion_conversions sc
            WHERE sc.order_id = o.id AND sc.recommended_item_id = oi.menu_item_id);

  IF v_items IS NULL OR v_started < now() - interval '24 hours' THEN
    RETURN 0;
  END IF;

  SELECT COALESCE(array_agg(lv.item_id), '{}'::uuid[]) INTO v_known
    FROM public.reco_learned_visits lv WHERE lv.visit_id = _visit;

  IF v_items <@ v_known THEN
    RETURN 0;
  END IF;

  INSERT INTO public.reco_learned_visits(visit_id, item_id)
  SELECT _visit, i FROM unnest(v_items) i WHERE NOT (i = ANY(v_known))
  ON CONFLICT DO NOTHING;

  INSERT INTO public.reco_learning AS l (ctx_level, ctx_key, item_id, tables, w, w_at, last_at)
  SELECT k.ctx_level, k.ctx_key, k.item_id, 1, public.basket_weight(v_started, now(), 45), now(), now()
    FROM (
      SELECT * FROM public.reco_learning_keys(v_items)
      EXCEPT
      SELECT * FROM public.reco_learning_keys(v_known)
    ) k
   ORDER BY k.ctx_level, k.ctx_key, k.item_id NULLS FIRST
  ON CONFLICT (ctx_level, ctx_key, (COALESCE(item_id, '00000000-0000-0000-0000-000000000000'::uuid)))
  DO UPDATE SET tables = l.tables + 1,
                w = public.reco_decayed(l.w, l.w_at, now()) + EXCLUDED.w,
                w_at = now(),
                last_at = now();

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$;

REVOKE ALL ON FUNCTION public.reco_learn_visit(uuid) FROM PUBLIC, anon, authenticated;

/**
 * The trigger. Deferred to commit, so a cash order sees all of its lines
 * and its suggestion attributions, and a card order counts once its
 * payment releases it. It never fails the order: anything that goes wrong
 * here is a warning, and the next rebuild counts the visit anyway.
 */
CREATE OR REPLACE FUNCTION public.trg_reco_learn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_visit uuid;
BEGIN
  BEGIN
    IF TG_TABLE_NAME = 'orders' THEN
      v_visit := COALESCE(NEW.table_session_id, NEW.id);
    ELSE
      SELECT COALESCE(o.table_session_id, o.id) INTO v_visit
        FROM public.completed_orders o WHERE o.id = NEW.order_id;
    END IF;
    PERFORM public.reco_learn_visit(v_visit);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'suggestion learning skipped for this order (%): %', SQLSTATE, SQLERRM;
  END;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_reco_learn() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_reco_learn_order_insert ON public.orders;
CREATE CONSTRAINT TRIGGER trg_reco_learn_order_insert
  AFTER INSERT ON public.orders
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (NEW.released_to_kitchen_at IS NOT NULL
        AND NEW.status NOT IN ('awaiting_payment', 'payment_failed', 'cancelled'))
  EXECUTE FUNCTION public.trg_reco_learn();

-- Released later: a card payment clearing, or staff confirming a held order.
DROP TRIGGER IF EXISTS trg_reco_learn_order_release ON public.orders;
CREATE CONSTRAINT TRIGGER trg_reco_learn_order_release
  AFTER UPDATE OF released_to_kitchen_at, status ON public.orders
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (NEW.released_to_kitchen_at IS NOT NULL
        AND NEW.status NOT IN ('awaiting_payment', 'payment_failed', 'cancelled')
        AND (OLD.released_to_kitchen_at IS NULL
             OR OLD.status IN ('awaiting_payment', 'payment_failed', 'cancelled')))
  EXECUTE FUNCTION public.trg_reco_learn();

DROP TRIGGER IF EXISTS trg_reco_learn_item ON public.order_items;
CREATE CONSTRAINT TRIGGER trg_reco_learn_item
  AFTER INSERT ON public.order_items
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_reco_learn();

-- ---------------------------------------------------------------------
-- 2. The rebuild: the same counters from the record, for corrections
-- ---------------------------------------------------------------------

/**
 * Recompute every counter from the last `_days` of sales.
 *
 * The incremental counts drift in one direction only: an order cancelled
 * after it reached the kitchen stays counted. The refresh corrects that.
 * Everything is read once into a temporary table, under an exclusive lock
 * the learner yields to, so an order committing meanwhile is counted
 * exactly once — here, or by the learner after this commits.
 */
CREATE OR REPLACE FUNCTION public.rebuild_reco_learning(_days int DEFAULT 365)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_days int := LEAST(GREATEST(COALESCE(_days, 365), 30), 730);
  v_visits int;
  v_pairs int;
BEGIN
  IF NOT public.is_trusted_caller() THEN
    RAISE EXCEPTION 'Only staff can refresh menu intelligence' USING ERRCODE = 'insufficient_privilege';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('lasoul.reco_learning'));

  DROP TABLE IF EXISTS pg_temp._rl_vi;
  CREATE TEMP TABLE _rl_vi ON COMMIT DROP AS
    WITH lines AS (
      SELECT COALESCE(o.table_session_id, o.id) AS visit, o.created_at, oi.menu_item_id AS item_id
        FROM public.completed_orders o
        JOIN public.order_items oi ON oi.order_id = o.id
       WHERE o.created_at > now() - make_interval(days => v_days)
         AND NOT EXISTS (
               SELECT 1 FROM public.suggestion_conversions sc
                WHERE sc.order_id = o.id AND sc.recommended_item_id = oi.menu_item_id)
    ),
    visits AS (
      SELECT visit, min(created_at) AS started, max(created_at) AS last_at FROM lines GROUP BY visit
    )
    SELECT DISTINCT l.visit, v.started, v.last_at, l.item_id,
           mi.subcategory_id::text AS sub,
           public.reco_kind(mi.name, sub.name, mi.meal_role, mi.station) AS kind,
           public.basket_weight(v.started, now(), 45) AS w
      FROM lines l
      JOIN visits v ON v.visit = l.visit
      JOIN public.menu_items mi ON mi.id = l.item_id
      LEFT JOIN public.subcategories sub ON sub.id = mi.subcategory_id;

  DELETE FROM public.reco_learning;

  INSERT INTO public.reco_learning(ctx_level, ctx_key, item_id, tables, w, w_at, last_at)
  SELECT k.lvl, k.key, k.item_id, count(*)::int, round(sum(k.w), 6), now(), max(k.last_at)
    FROM (
      SELECT visit, w, last_at, 'all'::text AS lvl, '*'::text AS key, NULL::uuid AS item_id FROM _rl_vi
      UNION
      SELECT visit, w, last_at, 'item', item_id::text, NULL::uuid FROM _rl_vi
      UNION
      SELECT visit, w, last_at, 'section', sub, NULL::uuid FROM _rl_vi WHERE sub IS NOT NULL
      UNION
      SELECT visit, w, last_at, 'kind', kind, NULL::uuid FROM _rl_vi
      UNION
      SELECT a.visit, a.w, a.last_at, 'item', a.item_id::text, b.item_id
        FROM _rl_vi a JOIN _rl_vi b ON b.visit = a.visit AND b.item_id <> a.item_id
      UNION
      SELECT a.visit, a.w, a.last_at, 'section', a.sub, b.item_id
        FROM _rl_vi a JOIN _rl_vi b ON b.visit = a.visit AND b.item_id <> a.item_id
       WHERE a.sub IS NOT NULL AND b.sub IS DISTINCT FROM a.sub
      UNION
      SELECT a.visit, a.w, a.last_at, 'kind', a.kind, b.item_id
        FROM _rl_vi a JOIN _rl_vi b ON b.visit = a.visit AND b.item_id <> a.item_id
       WHERE b.kind <> a.kind
    ) k
   GROUP BY k.lvl, k.key, k.item_id;

  GET DIAGNOSTICS v_pairs = ROW_COUNT;

  -- The learner's memory of today's visits, consistent with the counters.
  DELETE FROM public.reco_learned_visits;
  INSERT INTO public.reco_learned_visits(visit_id, item_id)
  SELECT DISTINCT visit, item_id FROM _rl_vi WHERE started > now() - interval '24 hours';

  SELECT count(DISTINCT visit) INTO v_visits FROM _rl_vi;

  RETURN jsonb_build_object('visits', v_visits, 'counters', v_pairs);
END;
$$;

REVOKE ALL ON FUNCTION public.rebuild_reco_learning(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rebuild_reco_learning(int) TO authenticated;

-- ---------------------------------------------------------------------
-- 3. Reading it: what tables with this dish (or one like it) also order
-- ---------------------------------------------------------------------

/**
 * Learned pairs for the dishes on a table.
 *
 * For each dish A in `_context` and each dish B that some counter pairs
 * with A, its section or its kind: the shrunk share of A's tables that
 * also had B (θ_A, see the header of this file), whether the evidence is
 * real, and the strength the ranker uses. Rows only where the evidence is
 * real: at least 3 tables at some level, and EB05 > 1 at that level.
 *
 *   level      the deepest level that carries it: 'item' (this dish's own
 *              tables), 'section' or 'kind' (inherited)
 *   tables     how many tables had the pair at that level
 *   attach     θ_A, the shrunk share of tables with A that also had B
 *   lift       θ_A over B's share of all tables
 *   strength   1 − exp(−θ_A / 0.12), on a house pairing's priority scale
 */
CREATE OR REPLACE FUNCTION public.reco_learned_pairs(_context uuid[], _at timestamptz DEFAULT NULL)
RETURNS TABLE(item_id uuid, source_item_id uuid, level text, tables int,
              attach numeric, lift numeric, strength numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH prm AS (
    SELECT COALESCE(_at, public.reco_now()) AS at,
           5::numeric    AS m,         -- pseudo-tables of prior at each level
           3             AS support,   -- tables before a pair is believed
           0.12::numeric AS ref        -- strength 1 − exp(−share / ref): 0.81 at one in five
  ),
  ctx AS (
    SELECT DISTINCT mi.id AS a, mi.subcategory_id::text AS s,
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
      JOIN public.reco_learning r ON r.ctx_level = kd.lvl AND r.ctx_key = kd.key
      CROSS JOIN prm
  ),
  cand AS (
    SELECT DISTINCT c.a, c.b FROM counted c WHERE c.b IS NOT NULL
  ),
  base AS (
    SELECT r.ctx_key AS b, public.reco_decayed(r.w, r.w_at, prm.at) AS w
      FROM public.reco_learning r CROSS JOIN prm
     WHERE r.ctx_level = 'item' AND r.item_id IS NULL
       AND r.ctx_key IN (SELECT c.b::text FROM cand c)
  ),
  everyone AS (
    SELECT COALESCE(max(public.reco_decayed(r.w, r.w_at, prm.at)), 0) AS w
      FROM public.reco_learning r CROSS JOIN prm
     WHERE r.ctx_level = 'all' AND r.ctx_key = '*' AND r.item_id IS NULL
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
         round(1 - exp(-s.th_a / s.ref), 4)
    FROM shrunk s
   WHERE s.item_ok OR s.section_ok OR s.kind_ok;
$$;

REVOKE ALL ON FUNCTION public.reco_learned_pairs(uuid[], timestamptz) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. The ranker: learned pairs as a source and a term, every guardrail kept
-- ---------------------------------------------------------------------

/**
 * Rank suggestions for a cart, a dish page, the running tab or the
 * after-meal moment. As in 20261025160000_reco_profit.sql — same signature,
 * same result, every guardrail unchanged — plus what tables taught it:
 *
 *   * `learned`: reco_learned_pairs() for the dishes on the table, labelled
 *     'frequently_bought_together' ('after_meal' after the meal), with the
 *     table's dish as its source;
 *   * its strength ranks like a house pairing's priority: the curated term
 *     reads GREATEST(curated priority, learned strength), so a pair enough
 *     tables choose can overtake the owner's pairing, and an owner's pairing
 *     that tables also choose is not counted twice;
 *   * it is gated as what it is — evidence, not a curated pair: reco_fit,
 *     reco_vetoed, reco_clash and the coursing rules apply in full;
 *   * the card's source and type follow the strongest claim, which may now
 *     be the learned one.
 * With no learned pairs (no history) the ranking is exactly as before.
 *
 * From 20261025160000_reco_profit.sql, as in 20261025100000_reco_learning_v3.sql plus:
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
           max(learned_score)  AS learned_score
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
$$;

REVOKE ALL ON FUNCTION public.rank_recommendations(uuid[], text, text, int, uuid, text[], int[]) FROM PUBLIC, anon;

-- ---------------------------------------------------------------------
-- 5. Saying why, honestly
-- ---------------------------------------------------------------------

/**
 * What may honestly be said on the card about a pair.
 *
 * Learned evidence first:
 *   * this dish's own tables taught it → 'qualitative' ("Often ordered with
 *     this"), or 'quantified' once at least social_proof_min_sessions tables
 *     had the dish and the conservative (Wilson) bound of the share that also
 *     had this one is 20% or more — the bound is what is quoted;
 *   * inherited from its section or kind → 'similar' ("Often ordered with
 *     dishes like this"): the tables had dishes like this one, not this one.
 * Otherwise as before, from the visit-pair table: nothing unless the pair
 * beats chance on a pessimistic reading.
 */
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
  v_learned record;
  v_with_source int;
  v_low numeric;
BEGIN
  IF _source_item_id IS NULL OR _recommended_item_id IS NULL THEN
    RETURN jsonb_build_object('kind', 'none');
  END IF;

  SELECT COALESCE(social_proof_min_sessions, 20) INTO v_min
    FROM public.restaurant_settings WHERE id = 1;

  SELECT lp.level, lp.tables INTO v_learned
    FROM public.reco_learned_pairs(ARRAY[_source_item_id], NULL) lp
   WHERE lp.item_id = _recommended_item_id AND lp.source_item_id = _source_item_id
   LIMIT 1;

  IF FOUND THEN
    IF v_learned.level <> 'item' THEN
      RETURN jsonb_build_object('kind', 'similar', 'level', v_learned.level, 'tables', v_learned.tables);
    END IF;

    SELECT r.tables INTO v_with_source
      FROM public.reco_learning r
     WHERE r.ctx_level = 'item' AND r.ctx_key = _source_item_id::text AND r.item_id IS NULL;
    v_low := public.wilson_lower(v_learned.tables, COALESCE(v_with_source, 0));

    IF COALESCE(v_with_source, 0) >= v_min AND v_low >= 0.20 THEN
      RETURN jsonb_build_object('kind', 'quantified', 'percent', round(v_low * 100), 'sessions', v_with_source);
    END IF;
    RETURN jsonb_build_object('kind', 'qualitative', 'sessions', v_with_source);
  END IF;

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
-- 6. What management sees
-- ---------------------------------------------------------------------

/**
 * Discovered pairings, same columns as before.
 *
 * First what tables taught the engine (dish-to-dish, by visit, organic
 * orders only): pair_orders is the number of tables, confidence the share
 * of the first dish's tables that also had the second, lift that share over
 * the second dish's share of all tables. Then pairs the order-grain table
 * found that the counters do not (yet) carry. Strongest first.
 */
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
  WITH everyone AS (
    SELECT GREATEST(COALESCE(max(public.reco_decayed(r.w, r.w_at, now())), 0), 1) AS w
      FROM public.reco_learning r
     WHERE r.ctx_level = 'all' AND r.ctx_key = '*' AND r.item_id IS NULL
  ),
  dish AS (
    SELECT r.ctx_key AS id, r.tables, public.reco_decayed(r.w, r.w_at, now()) AS w
      FROM public.reco_learning r
     WHERE r.ctx_level = 'item' AND r.item_id IS NULL
  ),
  learned AS (
    SELECT r.ctx_key::uuid AS a, r.item_id AS b, r.tables AS together,
           public.reco_decayed(r.w, r.w_at, now()) AS w_ab,
           da.tables AS a_tables, da.w AS w_a, db.w AS w_b, e.w AS w_all
      FROM public.reco_learning r
      JOIN dish da ON da.id = r.ctx_key
      JOIN dish db ON db.id = r.item_id::text
      CROSS JOIN everyone e
     WHERE r.ctx_level = 'item' AND r.item_id IS NOT NULL
       AND r.ctx_key < r.item_id::text
       AND r.tables >= 3
  ),
  listed AS (
    SELECT l.a, l.b, l.together,
           round(l.together::numeric / NULLIF(l.a_tables, 0), 4) AS conf,
           round((l.w_ab / NULLIF(l.w_a, 0)) / NULLIF(l.w_b / l.w_all, 0), 4) AS lft,
           public.eb_lower05(l.w_ab, l.w_a * l.w_b / l.w_all) AS strength
      FROM learned l
     WHERE public.eb_lower05(l.w_ab, l.w_a * l.w_b / l.w_all) > 1
    UNION ALL
    SELECT a.item_a, a.item_b, a.pair_orders, a.confidence, a.lift, a.eb05
      FROM public.menu_item_affinity a
     WHERE a.eb05 > 1
       AND a.item_a < a.item_b
       AND NOT EXISTS (
             SELECT 1 FROM learned l WHERE l.a = a.item_a AND l.b = a.item_b
               AND public.eb_lower05(l.w_ab, l.w_a * l.w_b / l.w_all) > 1)
  )
  SELECT x.a, ma.name, x.b, mb.name, x.together, x.conf, x.lft,
         EXISTS (
           SELECT 1 FROM public.menu_item_recommendations r
            WHERE r.source_item_id = x.a
              AND r.recommended_item_id = x.b
              AND r.enabled
         )
    FROM listed x
    JOIN public.menu_items ma ON ma.id = x.a
    JOIN public.menu_items mb ON mb.id = x.b
   ORDER BY x.strength DESC, x.together DESC
   LIMIT LEAST(GREATEST(COALESCE(_limit, 30), 1), 100);
END;
$$;

/**
 * The engine's settings and state, as before, plus `learning`: how many
 * tables it has learned from, how many pairs (dish-to-dish, and inherited
 * from a section or kind) it believes, when a table last taught it
 * something, and when the heavier tables were last refreshed.
 */
CREATE OR REPLACE FUNCTION public.recommendation_engine_health()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v jsonb;
  v_learning jsonb;
BEGIN
  IF NOT public.is_staff_member() THEN
    RAISE EXCEPTION 'Only staff can read menu intelligence' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT jsonb_build_object(
    'tables', COALESCE((SELECT r.tables FROM public.reco_learning r
                         WHERE r.ctx_level = 'all' AND r.ctx_key = '*' AND r.item_id IS NULL), 0),
    'dish_pairs', (SELECT count(*) FROM public.reco_learning r
                    WHERE r.ctx_level = 'item' AND r.item_id IS NOT NULL AND r.tables >= 3
                      AND r.ctx_key < r.item_id::text),
    'family_pairs', (SELECT count(*) FROM public.reco_learning r
                      WHERE r.ctx_level IN ('section', 'kind') AND r.item_id IS NOT NULL AND r.tables >= 3),
    'last_learned_at', (SELECT max(r.last_at) FROM public.reco_learning r),
    'refreshed_at', (SELECT m.last_run_at FROM public.maintenance_runs m WHERE m.job = 'menu_intelligence'),
    'scheduler', CASE WHEN EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
                      THEN 'pg_cron and staff screens' ELSE 'staff screens' END
  ) INTO v_learning;

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
    'orders_analysed', (SELECT count(*) FROM public.completed_orders WHERE created_at > now() - interval '90 days'),
    'learning', v_learning
  ) INTO v
  FROM public.restaurant_settings s WHERE s.id = 1;

  RETURN v;
END;
$$;

-- ---------------------------------------------------------------------
-- 7. Refreshing the rest, all day, without anyone
-- ---------------------------------------------------------------------

/**
 * The full refresh, as before (pair strength at order and visit grain,
 * acceptance from the ledger, priors), plus the learned counters rebuilt
 * from the record. One at a time: a second caller waits for the first
 * rather than both rewriting the same tables. Stamps
 * maintenance_runs('menu_intelligence'), which is how
 * maybe_refresh_menu_intelligence() knows it is fresh.
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
  v_learning jsonb;
  v_result jsonb;
BEGIN
  IF NOT public.is_trusted_caller() THEN
    RAISE EXCEPTION 'Only staff can refresh menu intelligence' USING ERRCODE = 'insufficient_privilege';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('lasoul.menu_intelligence'));

  v_pairs := public.refresh_menu_affinity(365, 2);
  v_session_pairs := public.refresh_session_affinity(365, 2);
  v_stats := public.refresh_suggestion_stats(90);
  v_learning := public.rebuild_reco_learning(365);

  v_result := jsonb_build_object(
    'pairs', v_pairs,
    'session_pairs', v_session_pairs,
    'section_pairs', (SELECT count(*) FROM public.subcategory_affinity WHERE eb05 > 1),
    'suggestion_rows', v_stats,
    'learned_visits', v_learning -> 'visits',
    'refreshed_at', now());

  INSERT INTO public.maintenance_runs(job, last_run_at, last_result)
  VALUES ('menu_intelligence', now(), v_result)
  ON CONFLICT (job) DO UPDATE SET last_run_at = now(), last_result = v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_menu_intelligence() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refresh_menu_intelligence() TO authenticated;

/**
 * Refresh if it is due; otherwise return at once.
 *
 * Due means: the last refresh is older than `_max_age_minutes` (30 by
 * default, at least 10) AND something happened since — an order or a
 * suggestion decision. So a quiet night costs two index probes per call,
 * and service gets a refresh every half hour. Never twice at once: the
 * first caller takes a transaction-scoped advisory lock without waiting,
 * any other caller returns 'running', and the freshness check is repeated
 * under the lock so two callers in a row do not both refresh.
 *
 * Called by pg_cron every 15 minutes where it exists, and by every staff
 * screen every 5 minutes (useLearningHeartbeat), so it runs all day with or
 * without the extension. Not from the guest's suggestion request: that
 * would make a guest wait for it.
 */
CREATE OR REPLACE FUNCTION public.maybe_refresh_menu_intelligence(_max_age_minutes int DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_age interval := make_interval(mins => LEAST(GREATEST(COALESCE(_max_age_minutes, 30), 10), 1440));
  v_last timestamptz;
  v_result jsonb;
BEGIN
  IF NOT public.is_trusted_caller() THEN
    RAISE EXCEPTION 'Only staff can refresh menu intelligence' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT m.last_run_at INTO v_last FROM public.maintenance_runs m WHERE m.job = 'menu_intelligence';
  IF v_last IS NOT NULL AND v_last > now() - v_age THEN
    RETURN jsonb_build_object('ran', false, 'reason', 'fresh', 'refreshed_at', v_last);
  END IF;
  IF v_last IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.created_at > v_last)
     AND NOT EXISTS (SELECT 1 FROM public.recommendation_decisions d WHERE d.created_at > v_last) THEN
    RETURN jsonb_build_object('ran', false, 'reason', 'nothing_new', 'refreshed_at', v_last);
  END IF;

  IF NOT pg_try_advisory_xact_lock(hashtext('lasoul.menu_intelligence')) THEN
    RETURN jsonb_build_object('ran', false, 'reason', 'running', 'refreshed_at', v_last);
  END IF;
  -- Someone may have finished one between the check and the lock.
  SELECT m.last_run_at INTO v_last FROM public.maintenance_runs m WHERE m.job = 'menu_intelligence';
  IF v_last IS NOT NULL AND v_last > now() - v_age THEN
    RETURN jsonb_build_object('ran', false, 'reason', 'fresh', 'refreshed_at', v_last);
  END IF;

  v_result := public.refresh_menu_intelligence();
  RETURN jsonb_build_object('ran', true, 'refreshed_at', now(), 'result', v_result);
END;
$$;

REVOKE ALL ON FUNCTION public.maybe_refresh_menu_intelligence(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.maybe_refresh_menu_intelligence(int) TO authenticated;

/**
 * What pg_cron runs every 15 minutes. Same mark as run_scheduled_maintenance
 * (see is_trusted_caller): function-scoped, gone when it returns, and
 * executable by no API role.
 */
CREATE OR REPLACE FUNCTION public.run_scheduled_learning_refresh()
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
SET lasoul.scheduled_job = 'on'
AS $$
BEGIN
  RETURN public.maybe_refresh_menu_intelligence(30);
END;
$$;

REVOKE ALL ON FUNCTION public.run_scheduled_learning_refresh() FROM PUBLIC, anon, authenticated;

/*
 * Every 15 minutes where pg_cron exists (it is never required: the counters
 * learn on their own and staff screens call the refresh). cron.schedule with
 * a job name replaces an existing job of that name, so re-running is safe.
 */
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      EXECUTE $q$SELECT cron.schedule('lasoul-learning-refresh', '*/15 * * * *',
                                       'SELECT public.run_scheduled_learning_refresh()')$q$;
      RAISE NOTICE 'learning refresh scheduled with pg_cron every 15 minutes';
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'pg_cron is installed but the learning refresh could not be scheduled (%)', SQLERRM;
    END;
  ELSE
    RAISE NOTICE 'pg_cron is not available: staff screens refresh the engine, and the counters learn by trigger';
  END IF;
END $cron$;

-- ---------------------------------------------------------------------
-- 8. Learn from the history there already is
-- ---------------------------------------------------------------------

DO $$
BEGIN
  PERFORM set_config('lasoul.scheduled_job', 'on', true);
  BEGIN
    RAISE NOTICE 'menu intelligence refreshed: %', public.refresh_menu_intelligence();
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'menu intelligence will refresh on the next staff screen or schedule instead (%)', SQLERRM;
  END;
  PERFORM set_config('lasoul.scheduled_job', '', true);
END $$;

-- Internal: changes data, so not callable by guests or staff through the API;
-- the scheduler and the server role run it.
REVOKE ALL ON FUNCTION public.reco_learn_visit(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reco_learn_visit(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.run_scheduled_learning_refresh() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_scheduled_learning_refresh() TO service_role;
