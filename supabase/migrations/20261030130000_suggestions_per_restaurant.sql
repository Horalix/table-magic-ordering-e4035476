-- Suggestions learn per restaurant (docs/two-restaurants.md, "Suggestions").
--
-- La Soul and Vera Italia share no dish, and no dish of one was ever
-- suggested at the other. But four things the suggestions are measured
-- against were counted over both restaurants at once:
--
--   * reco_learning's visit total and per-kind totals ('all', 'kind'): the
--     baseline every learned pair is compared with;
--   * refresh_menu_affinity's and refresh_session_affinity's order and visit
--     totals: what "more often than chance" means for every dish pair and
--     section pair;
--   * suggestion_priors' placement fallback: how often a guest takes a
--     suggestion at all.
--
-- So Vera Italia's guests would have nudged La Soul's suggestions, and the
-- other way round. From here every one of them is one restaurant's: a learned
-- counter carries its restaurant; the refreshes run once per restaurant
-- against that restaurant's orders; a prior carries its restaurant. Readers
-- read their own restaurant's. Everything learned so far is La Soul's (Vera
-- Italia has taken no order), and is kept.

-- ---------------------------------------------------------------------
-- 1. Learned counters carry their restaurant
-- ---------------------------------------------------------------------

ALTER TABLE public.reco_learning
  ADD COLUMN IF NOT EXISTS venue_id uuid REFERENCES public.venues(id) ON DELETE CASCADE;

-- A dish or section counter is its dish's or section's; the visit and kind
-- totals so far are La Soul's.
UPDATE public.reco_learning r
   SET venue_id = COALESCE(
         (SELECT mi.venue_id FROM public.menu_items mi WHERE mi.id = r.item_id),
         CASE r.ctx_level
           WHEN 'item' THEN (SELECT mi.venue_id FROM public.menu_items mi WHERE mi.id::text = r.ctx_key)
           WHEN 'section' THEN (SELECT s.venue_id FROM public.subcategories s WHERE s.id::text = r.ctx_key)
         END,
         public.default_venue())
 WHERE r.venue_id IS NULL;

ALTER TABLE public.reco_learning ALTER COLUMN venue_id SET DEFAULT public.current_venue();
ALTER TABLE public.reco_learning ALTER COLUMN venue_id SET NOT NULL;

DROP INDEX IF EXISTS public.reco_learning_key;
CREATE UNIQUE INDEX reco_learning_key
  ON public.reco_learning (venue_id, ctx_level, ctx_key, (COALESCE(item_id, '00000000-0000-0000-0000-000000000000'::uuid)));

DROP POLICY IF EXISTS "Staff read reco learning" ON public.reco_learning;
CREATE POLICY "Staff read reco learning" ON public.reco_learning
  FOR SELECT TO authenticated USING (public.can_staff(venue_id));

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
  v_venue uuid;
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

  -- Whose visit it is: a table session, and every order in it, is one restaurant's.
  SELECT o.venue_id INTO v_venue
    FROM public.orders o
   WHERE o.table_session_id = _visit OR (o.table_session_id IS NULL AND o.id = _visit)
   LIMIT 1;

  SELECT COALESCE(array_agg(lv.item_id), '{}'::uuid[]) INTO v_known
    FROM public.reco_learned_visits lv WHERE lv.visit_id = _visit;

  IF v_items <@ v_known THEN
    RETURN 0;
  END IF;

  INSERT INTO public.reco_learned_visits(visit_id, item_id)
  SELECT _visit, i FROM unnest(v_items) i WHERE NOT (i = ANY(v_known))
  ON CONFLICT DO NOTHING;

  INSERT INTO public.reco_learning AS l (venue_id, ctx_level, ctx_key, item_id, tables, w, w_at, last_at)
  SELECT v_venue, k.ctx_level, k.ctx_key, k.item_id, 1, public.basket_weight(v_started, now(), 45), now(), now()
    FROM (
      SELECT * FROM public.reco_learning_keys(v_items)
      EXCEPT
      SELECT * FROM public.reco_learning_keys(v_known)
    ) k
   ORDER BY k.ctx_level, k.ctx_key, k.item_id NULLS FIRST
  ON CONFLICT (venue_id, ctx_level, ctx_key, (COALESCE(item_id, '00000000-0000-0000-0000-000000000000'::uuid)))
  DO UPDATE SET tables = l.tables + 1,
                w = public.reco_decayed(l.w, l.w_at, now()) + EXCLUDED.w,
                w_at = now(),
                last_at = now();

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$;

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
      SELECT COALESCE(o.table_session_id, o.id) AS visit, ov.venue_id AS venue, o.created_at, oi.menu_item_id AS item_id
        FROM public.completed_orders o
        JOIN public.orders ov ON ov.id = o.id
        JOIN public.order_items oi ON oi.order_id = o.id
       WHERE o.created_at > now() - make_interval(days => v_days)
         AND NOT EXISTS (
               SELECT 1 FROM public.suggestion_conversions sc
                WHERE sc.order_id = o.id AND sc.recommended_item_id = oi.menu_item_id)
    ),
    visits AS (
      SELECT visit, min(created_at) AS started, max(created_at) AS last_at FROM lines GROUP BY visit
    )
    SELECT DISTINCT l.visit, l.venue, v.started, v.last_at, l.item_id,
           mi.subcategory_id::text AS sub,
           public.reco_kind(mi.name, sub.name, mi.meal_role, mi.station) AS kind,
           public.basket_weight(v.started, now(), 45) AS w
      FROM lines l
      JOIN visits v ON v.visit = l.visit
      JOIN public.menu_items mi ON mi.id = l.item_id
      LEFT JOIN public.subcategories sub ON sub.id = mi.subcategory_id;

  DELETE FROM public.reco_learning;

  INSERT INTO public.reco_learning(venue_id, ctx_level, ctx_key, item_id, tables, w, w_at, last_at)
  SELECT k.venue, k.lvl, k.key, k.item_id, count(*)::int, round(sum(k.w), 6), now(), max(k.last_at)
    FROM (
      SELECT visit, venue, w, last_at, 'all'::text AS lvl, '*'::text AS key, NULL::uuid AS item_id FROM _rl_vi
      UNION
      SELECT visit, venue, w, last_at, 'item', item_id::text, NULL::uuid FROM _rl_vi
      UNION
      SELECT visit, venue, w, last_at, 'section', sub, NULL::uuid FROM _rl_vi WHERE sub IS NOT NULL
      UNION
      SELECT visit, venue, w, last_at, 'kind', kind, NULL::uuid FROM _rl_vi
      UNION
      SELECT a.visit, a.venue, a.w, a.last_at, 'item', a.item_id::text, b.item_id
        FROM _rl_vi a JOIN _rl_vi b ON b.visit = a.visit AND b.item_id <> a.item_id
      UNION
      SELECT a.visit, a.venue, a.w, a.last_at, 'section', a.sub, b.item_id
        FROM _rl_vi a JOIN _rl_vi b ON b.visit = a.visit AND b.item_id <> a.item_id
       WHERE a.sub IS NOT NULL AND b.sub IS DISTINCT FROM a.sub
      UNION
      SELECT a.visit, a.venue, a.w, a.last_at, 'kind', a.kind, b.item_id
        FROM _rl_vi a JOIN _rl_vi b ON b.visit = a.visit AND b.item_id <> a.item_id
       WHERE b.kind <> a.kind
    ) k
   GROUP BY k.venue, k.lvl, k.key, k.item_id;

  GET DIAGNOSTICS v_pairs = ROW_COUNT;

  -- The learner's memory of today's visits, consistent with the counters.
  DELETE FROM public.reco_learned_visits;
  INSERT INTO public.reco_learned_visits(visit_id, item_id)
  SELECT DISTINCT visit, item_id FROM _rl_vi WHERE started > now() - interval '24 hours';

  SELECT count(DISTINCT visit) INTO v_visits FROM _rl_vi;

  RETURN jsonb_build_object('visits', v_visits, 'counters', v_pairs);
END;
$$;

-- ---------------------------------------------------------------------
-- 2. Reading them: only the restaurant asked about
-- ---------------------------------------------------------------------

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
$function$;

CREATE OR REPLACE FUNCTION public.menu_pairings(_limit integer DEFAULT 30)
 RETURNS TABLE(item_a uuid, name_a text, item_b uuid, name_b text, pair_orders integer, confidence numeric, lift numeric, already_curated boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  v_venue uuid := public.current_venue();
BEGIN
  IF NOT public.can_staff(v_venue) THEN
    RAISE EXCEPTION 'Only staff can read menu intelligence' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  WITH everyone AS (
    SELECT GREATEST(COALESCE(max(public.reco_decayed(r.w, r.w_at, now())), 0), 1) AS w
      FROM (SELECT * FROM public.reco_learning WHERE venue_id = v_venue) r
     WHERE r.ctx_level = 'all' AND r.ctx_key = '*' AND r.item_id IS NULL
  ),
  dish AS (
    SELECT r.ctx_key AS id, r.tables, public.reco_decayed(r.w, r.w_at, now()) AS w
      FROM (SELECT * FROM public.reco_learning WHERE venue_id = v_venue) r
     WHERE r.ctx_level = 'item' AND r.item_id IS NULL
  ),
  learned AS (
    SELECT r.ctx_key::uuid AS a, r.item_id AS b, r.tables AS together,
           public.reco_decayed(r.w, r.w_at, now()) AS w_ab,
           da.tables AS a_tables, da.w AS w_a, db.w AS w_b, e.w AS w_all
      FROM (SELECT * FROM public.reco_learning WHERE venue_id = v_venue) r
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
   WHERE ma.venue_id = v_venue
     AND mb.venue_id = v_venue
   ORDER BY x.strength DESC, x.together DESC
   LIMIT LEAST(GREATEST(COALESCE(_limit, 30), 1), 100);
END;
$function$;

CREATE OR REPLACE FUNCTION public.recommendation_engine_health()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_venue uuid := public.current_venue();
  v jsonb;
  v_learning jsonb;
BEGIN
  IF NOT public.can_staff(v_venue) THEN
    RAISE EXCEPTION 'Only staff can read menu intelligence' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Every learned counter is one restaurant's (20261030130000).
  SELECT jsonb_build_object(
    'tables', COALESCE((SELECT r.tables FROM (SELECT * FROM public.reco_learning WHERE venue_id = v_venue) r
                         WHERE r.ctx_level = 'all' AND r.ctx_key = '*' AND r.item_id IS NULL), 0),
    'dish_pairs', (SELECT count(*) FROM (SELECT * FROM public.reco_learning WHERE venue_id = v_venue) r
                     JOIN public.menu_items mi ON mi.id = r.item_id
                    WHERE r.ctx_level = 'item' AND r.item_id IS NOT NULL AND r.tables >= 3
                      AND r.ctx_key < r.item_id::text
                      AND mi.venue_id = v_venue),
    'family_pairs', (SELECT count(*) FROM (SELECT * FROM public.reco_learning WHERE venue_id = v_venue) r
                       JOIN public.menu_items mi ON mi.id = r.item_id
                      WHERE r.ctx_level IN ('section', 'kind') AND r.item_id IS NOT NULL AND r.tables >= 3
                        AND mi.venue_id = v_venue),
    'last_learned_at', (SELECT max(r.last_at) FROM (SELECT * FROM public.reco_learning WHERE venue_id = v_venue) r
                          JOIN public.menu_items mi ON mi.id::text = r.ctx_key
                         WHERE r.ctx_level = 'item'
                           AND mi.venue_id = v_venue),
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
    'curated_rules', (SELECT count(*) FROM public.menu_item_recommendations r
                        JOIN public.menu_items mi ON mi.id = r.recommended_item_id
                       WHERE r.enabled AND mi.venue_id = v_venue),
    'learned_pairs', (SELECT count(*) FROM public.menu_item_affinity a
                        JOIN public.menu_items mi ON mi.id = a.item_a
                       WHERE a.eb05 > 1 AND mi.venue_id = v_venue),
    'learned_section_pairs', (SELECT count(*) FROM public.subcategory_affinity sa
                                JOIN public.subcategories sub ON sub.id = sa.sub_a
                               WHERE sa.eb05 > 1 AND sub.venue_id = v_venue),
    'tracked_pairs', (SELECT count(*) FROM public.suggestion_stats st
                        JOIN public.menu_items mi ON mi.id = st.recommended_item_id
                       WHERE st.daypart IS NULL AND mi.venue_id = v_venue),
    'pairs_still_learning', (SELECT count(*) FROM public.suggestion_stats st
                               JOIN public.menu_items mi ON mi.id = st.recommended_item_id
                              WHERE st.daypart IS NULL AND st.shown < 20 AND mi.venue_id = v_venue),
    'pairs_retired', (
      SELECT count(*) FROM public.suggestion_stats st
        JOIN public.menu_items mi ON mi.id = st.recommended_item_id
      CROSS JOIN LATERAL public.suggestion_prior(st.recommended_item_id, st.placement) pr
       WHERE st.daypart IS NULL
         AND mi.venue_id = v_venue
         AND st.shown >= s.reco_retire_after_impressions
         AND public.acceptance_retired(st.accepted, st.shown, pr.alpha0, pr.beta0, s.reco_min_acceptance)),
    'affinity_computed_at', (SELECT max(a.computed_at) FROM public.menu_item_affinity a
                               JOIN public.menu_items mi ON mi.id = a.item_a
                              WHERE mi.venue_id = v_venue),
    'stats_updated_at', (SELECT max(st.updated_at) FROM public.suggestion_stats st
                           JOIN public.menu_items mi ON mi.id = st.recommended_item_id
                          WHERE mi.venue_id = v_venue),
    'window_days', 90,
    'orders_analysed', (SELECT count(*) FROM public.completed_orders co
                          JOIN public.orders o ON o.id = co.id
                         WHERE co.created_at > now() - interval '90 days'
                           AND o.venue_id = v_venue),
    'learning', v_learning
  ) INTO v
  FROM public.restaurant_settings s WHERE s.venue_id = v_venue;

  RETURN v;
END;
$function$;

-- ---------------------------------------------------------------------
-- 3. Pair strength, at order and at visit grain, per restaurant
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.refresh_menu_affinity(_days int DEFAULT 90, _min_pair_orders int DEFAULT 3)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows int := 0;
  v_count int;
  v_venue uuid;
  v_total_orders int;
  v_recent_orders int;
  v_n numeric;
BEGIN
  IF NOT public.is_trusted_caller() THEN
    RAISE EXCEPTION 'Only staff can refresh menu intelligence' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Each restaurant against its own orders: its pairs, and the totals they are
  -- measured against, never the other restaurant's.
  FOR v_venue IN SELECT id FROM public.venues ORDER BY id LOOP
    DROP TABLE IF EXISTS pg_temp._basket, pg_temp._item_counts, pg_temp._sbasket, pg_temp._sub_counts;

    CREATE TEMP TABLE _basket ON COMMIT DROP AS
      SELECT co.id AS order_id,
             oi.menu_item_id AS item_id,
             mi.subcategory_id,
             public.daypart_of(co.created_at) AS daypart,
             public.basket_weight(co.created_at, now(), 45) AS w,
             co.created_at > now() - interval '90 days' AS recent
        FROM public.completed_orders co
        JOIN public.order_items oi ON oi.order_id = co.id
        JOIN public.menu_items mi ON mi.id = oi.menu_item_id
       WHERE co.created_at > now() - make_interval(days => GREATEST(COALESCE(_days, 90), 1))
         AND mi.venue_id = v_venue
       GROUP BY co.id, co.created_at, oi.menu_item_id, mi.subcategory_id;

    SELECT count(DISTINCT order_id) INTO v_total_orders FROM _basket;
    IF COALESCE(v_total_orders, 0) < 5 THEN
      -- Not enough history to say anything honest yet.
      CONTINUE;
    END IF;

    SELECT sum(w) INTO v_n FROM (SELECT max(w) AS w FROM _basket GROUP BY order_id) o;
    SELECT count(DISTINCT order_id) INTO v_recent_orders FROM _basket WHERE recent;

    CREATE TEMP TABLE _item_counts ON COMMIT DROP AS
      SELECT item_id, count(*) FILTER (WHERE recent)::int AS orders, sum(w) AS w
        FROM _basket GROUP BY item_id;

    DELETE FROM public.menu_item_affinity a USING public.menu_items mi
     WHERE mi.id = a.item_a AND mi.venue_id = v_venue;

    INSERT INTO public.menu_item_affinity(
      item_a, item_b, pair_orders, a_orders, confidence, lift,
      w_pair, w_expected, eb05, eb_mean, computed_at)
    SELECT p.item_a,
           p.item_b,
           p.pair_orders,
           ca.orders,
           COALESCE(round(p.pair_orders::numeric / NULLIF(ca.orders, 0), 4), 0),
           COALESCE(round((p.pair_orders::numeric / NULLIF(ca.orders, 0))
                          / NULLIF(cb.orders::numeric / NULLIF(v_recent_orders, 0), 0), 4), 0),
           round(p.w_pair, 4),
           round(ca.w * cb.w / v_n, 4),
           public.eb_lower05(p.w_pair, ca.w * cb.w / v_n),
           public.eb_posterior_mean(p.w_pair, ca.w * cb.w / v_n),
           now()
      FROM (
        SELECT b1.item_id AS item_a, b2.item_id AS item_b,
               count(*) FILTER (WHERE b1.recent)::int AS pair_orders, sum(b1.w) AS w_pair
          FROM _basket b1
          JOIN _basket b2 ON b2.order_id = b1.order_id AND b2.item_id <> b1.item_id
         GROUP BY b1.item_id, b2.item_id
        HAVING count(*) >= GREATEST(COALESCE(_min_pair_orders, 3), 1)
      ) p
      JOIN _item_counts ca ON ca.item_id = p.item_a
      JOIN _item_counts cb ON cb.item_id = p.item_b;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_rows := v_rows + v_count;

    -- The same computation one level up: sections, one basket each per order.
    CREATE TEMP TABLE _sbasket ON COMMIT DROP AS
      SELECT order_id, subcategory_id, max(w) AS w
        FROM _basket WHERE subcategory_id IS NOT NULL
       GROUP BY order_id, subcategory_id;

    CREATE TEMP TABLE _sub_counts ON COMMIT DROP AS
      SELECT subcategory_id, count(*)::int AS orders, sum(w) AS w FROM _sbasket GROUP BY subcategory_id;

    DELETE FROM public.subcategory_affinity a USING public.subcategories s
     WHERE s.id = a.sub_a AND s.venue_id = v_venue;

    INSERT INTO public.subcategory_affinity(
      sub_a, sub_b, pair_orders, a_orders, w_pair, w_expected, eb05, eb_mean, computed_at)
    SELECT p.sub_a, p.sub_b, p.pair_orders, ca.orders,
           round(p.w_pair, 4),
           round(ca.w * cb.w / v_n, 4),
           public.eb_lower05(p.w_pair, ca.w * cb.w / v_n),
           public.eb_posterior_mean(p.w_pair, ca.w * cb.w / v_n),
           now()
      FROM (
        SELECT s1.subcategory_id AS sub_a, s2.subcategory_id AS sub_b,
               count(*)::int AS pair_orders, sum(s1.w) AS w_pair
          FROM _sbasket s1
          JOIN _sbasket s2 ON s2.order_id = s1.order_id AND s2.subcategory_id <> s1.subcategory_id
         GROUP BY s1.subcategory_id, s2.subcategory_id
        HAVING count(*) >= GREATEST(COALESCE(_min_pair_orders, 3), 1)
      ) p
      JOIN _sub_counts ca ON ca.subcategory_id = p.sub_a
      JOIN _sub_counts cb ON cb.subcategory_id = p.sub_b;

    -- Which dish of a section to offer, by daypart.
    DELETE FROM public.item_section_share x USING public.menu_items mi
     WHERE mi.id = x.item_id AND mi.venue_id = v_venue;

    WITH dayparts(dp) AS (VALUES ('morning'), ('lunch'), ('afternoon'), ('evening'), ('late')),
    item_all AS (
      SELECT item_id, subcategory_id, sum(w) AS n FROM _basket
       WHERE subcategory_id IS NOT NULL GROUP BY item_id, subcategory_id
    ),
    item_dp AS (
      SELECT item_id, daypart, sum(w) AS n FROM _basket
       WHERE subcategory_id IS NOT NULL GROUP BY item_id, daypart
    ),
    sub_all AS (SELECT subcategory_id, sum(n) AS n FROM item_all GROUP BY subcategory_id),
    sub_dp AS (
      SELECT subcategory_id, daypart, sum(w) AS n FROM _basket
       WHERE subcategory_id IS NOT NULL GROUP BY subcategory_id, daypart
    ),
    base AS (
      SELECT ia.item_id, ia.subcategory_id, ia.n / NULLIF(sa.n, 0) AS s_all
        FROM item_all ia JOIN sub_all sa ON sa.subcategory_id = ia.subcategory_id
    )
    INSERT INTO public.item_section_share(item_id, subcategory_id, daypart, share, computed_at)
    SELECT b.item_id, b.subcategory_id, NULL, round(COALESCE(b.s_all, 0), 6), now()
      FROM base b
    UNION ALL
    SELECT b.item_id, b.subcategory_id, d.dp,
           round((COALESCE(idp.n, 0) + 5 * COALESCE(b.s_all, 0)) / (COALESCE(sdp.n, 0) + 5), 6),
           now()
      FROM base b
      CROSS JOIN dayparts d
      LEFT JOIN item_dp idp ON idp.item_id = b.item_id AND idp.daypart = d.dp
      LEFT JOIN sub_dp sdp ON sdp.subcategory_id = b.subcategory_id AND sdp.daypart = d.dp;

  END LOOP;

  RETURN v_rows;
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_session_affinity(_days int DEFAULT 90, _min_pair_sessions int DEFAULT 3)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows int := 0;
  v_count int;
  v_venue uuid;
  v_total int;
  v_recent int;
  v_n numeric;
BEGIN
  IF NOT public.is_trusted_caller() THEN
    RAISE EXCEPTION 'Only staff can refresh menu intelligence' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Each restaurant against its own orders: its pairs, and the totals they are
  -- measured against, never the other restaurant's.
  FOR v_venue IN SELECT id FROM public.venues ORDER BY id LOOP
    DROP TABLE IF EXISTS pg_temp._vbasket, pg_temp._vcounts;

    -- One basket per VISIT, not per round.
    CREATE TEMP TABLE _vbasket ON COMMIT DROP AS
      WITH lines AS (
        SELECT co.table_session_id AS session_id, oi.menu_item_id AS item_id, co.created_at
          FROM public.completed_orders co
          JOIN public.order_items oi ON oi.order_id = co.id
          JOIN public.menu_items mi ON mi.id = oi.menu_item_id
         WHERE co.created_at > now() - make_interval(days => GREATEST(COALESCE(_days, 90), 1))
           AND co.table_session_id IS NOT NULL
           AND mi.venue_id = v_venue
      ),
      visit AS (
        SELECT session_id, public.basket_weight(min(created_at), now(), 45) AS w,
               min(created_at) > now() - interval '90 days' AS recent
          FROM lines GROUP BY session_id
      )
      SELECT DISTINCT l.session_id, l.item_id, v.w, v.recent
        FROM lines l JOIN visit v ON v.session_id = l.session_id;

    SELECT count(DISTINCT session_id) INTO v_total FROM _vbasket;
    IF COALESCE(v_total, 0) < 5 THEN
      CONTINUE;   -- not enough history to say anything honest
    END IF;

    SELECT sum(w) INTO v_n FROM (SELECT max(w) AS w FROM _vbasket GROUP BY session_id) s;
    SELECT count(DISTINCT session_id) INTO v_recent FROM _vbasket WHERE recent;

    CREATE TEMP TABLE _vcounts ON COMMIT DROP AS
      SELECT item_id, count(*) FILTER (WHERE recent)::int AS sessions, sum(w) AS w
        FROM _vbasket GROUP BY item_id;

    DELETE FROM public.session_item_affinity a USING public.menu_items mi
     WHERE mi.id = a.item_a AND mi.venue_id = v_venue;

    INSERT INTO public.session_item_affinity(
      item_a, item_b, pair_sessions, a_sessions, confidence, lift, confidence_low,
      w_pair, w_expected, eb05, eb_mean, computed_at)
    SELECT p.item_a,
           p.item_b,
           p.pair_sessions,
           ca.sessions,
           COALESCE(round(p.pair_sessions::numeric / NULLIF(ca.sessions, 0), 4), 0),
           COALESCE(round((p.pair_sessions::numeric / NULLIF(ca.sessions, 0))
                          / NULLIF(cb.sessions::numeric / NULLIF(v_recent, 0), 0), 4), 0),
           public.wilson_lower(p.pair_sessions, ca.sessions),
           round(p.w_pair, 4),
           round(ca.w * cb.w / v_n, 4),
           public.eb_lower05(p.w_pair, ca.w * cb.w / v_n),
           public.eb_posterior_mean(p.w_pair, ca.w * cb.w / v_n),
           now()
      FROM (
        SELECT b1.item_id AS item_a, b2.item_id AS item_b,
               count(*) FILTER (WHERE b1.recent)::int AS pair_sessions, sum(b1.w) AS w_pair
          FROM _vbasket b1
          JOIN _vbasket b2 ON b2.session_id = b1.session_id AND b2.item_id <> b1.item_id
         GROUP BY b1.item_id, b2.item_id
        HAVING count(*) >= GREATEST(COALESCE(_min_pair_sessions, 3), 1)
      ) p
      JOIN _vcounts ca ON ca.item_id = p.item_a
      JOIN _vcounts cb ON cb.item_id = p.item_b;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_rows := v_rows + v_count;
  END LOOP;

  RETURN v_rows;
END;
$$;

-- ---------------------------------------------------------------------
-- 4. How often guests take a suggestion, per restaurant
-- ---------------------------------------------------------------------

ALTER TABLE public.suggestion_priors
  ADD COLUMN IF NOT EXISTS venue_id uuid REFERENCES public.venues(id) ON DELETE CASCADE;

UPDATE public.suggestion_priors sp
   SET venue_id = COALESCE((SELECT mi.venue_id FROM public.menu_items mi WHERE mi.id = sp.recommended_item_id),
                           public.default_venue())
 WHERE sp.venue_id IS NULL;

ALTER TABLE public.suggestion_priors ALTER COLUMN venue_id SET DEFAULT public.current_venue();
ALTER TABLE public.suggestion_priors ALTER COLUMN venue_id SET NOT NULL;

-- A dish's prior is its dish's restaurant's, whatever it was given.
DROP TRIGGER IF EXISTS aa_inherit_venue ON public.suggestion_priors;
CREATE TRIGGER aa_inherit_venue BEFORE INSERT OR UPDATE ON public.suggestion_priors
  FOR EACH ROW EXECUTE FUNCTION public.inherit_venue('menu_items', 'recommended_item_id');

DROP INDEX IF EXISTS public.suggestion_priors_key;
CREATE UNIQUE INDEX suggestion_priors_key
  ON public.suggestion_priors (venue_id, placement, COALESCE(recommended_item_id, '00000000-0000-0000-0000-000000000000'::uuid));

DROP POLICY IF EXISTS "Staff read suggestion priors" ON public.suggestion_priors;
CREATE POLICY "Staff read suggestion priors" ON public.suggestion_priors
  FOR SELECT TO authenticated USING (public.can_staff(venue_id));

/** The prior for a dish at a placement: its own, its restaurant's placement's, or Beta(1,12). */
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
      SELECT sp.alpha0, sp.beta0, 0, 1
        FROM public.suggestion_priors sp
       WHERE sp.recommended_item_id IS NULL AND sp.placement = _placement
         AND sp.venue_id = (SELECT mi.venue_id FROM public.menu_items mi WHERE mi.id = _item_id)
      UNION ALL
      SELECT 1::numeric, 12::numeric, 0, 2
    ) x
   ORDER BY x.pref
   LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.refresh_suggestion_priors()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows int := 0;
  v_count int;
  v_venue uuid;
BEGIN
  IF NOT public.is_trusted_caller() THEN
    RAISE EXCEPTION 'Only staff can refresh menu intelligence' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Each restaurant's guests, each restaurant's rate: its own fallback per placement.
  FOR v_venue IN SELECT id FROM public.venues ORDER BY id LOOP
    DELETE FROM public.suggestion_priors WHERE venue_id = v_venue;

    WITH item AS (
      SELECT st.recommended_item_id, st.placement,
             sum(GREATEST(st.shown, 0))::int AS shown,
             -- Browser-era rows could hold more taps than sightings.
             sum(LEAST(GREATEST(st.accepted, 0), GREATEST(st.shown, 0)))::int AS accepted
        FROM public.suggestion_stats st
        JOIN public.menu_items mi ON mi.id = st.recommended_item_id
       WHERE st.daypart IS NULL AND st.recommended_item_id IS NOT NULL
         AND mi.venue_id = v_venue
       GROUP BY 1, 2
    ),
    base AS (
      SELECT placement, (sum(accepted) + 1)::numeric / (sum(shown) + 13) AS m_p
        FROM item GROUP BY placement
    ),
    ins AS (
      INSERT INTO public.suggestion_priors(venue_id, recommended_item_id, placement, alpha0, beta0, item_shown, item_accepted)
      SELECT v_venue, NULL::uuid, b.placement, round(20 * b.m_p, 6), round(20 * (1 - b.m_p), 6), 0, 0
        FROM base b
      UNION ALL
      SELECT v_venue, i.recommended_item_id, i.placement,
             round(20 * ((i.accepted + 50 * b.m_p) / (i.shown + 50)), 6),
             round(20 * (1 - (i.accepted + 50 * b.m_p) / (i.shown + 50)), 6),
             i.shown, i.accepted
        FROM item i JOIN base b ON b.placement = i.placement
      RETURNING 1
    )
    SELECT count(*) INTO v_count FROM ins;
    v_rows := v_rows + v_count;

  END LOOP;

  RETURN v_rows;
END;
$$;
