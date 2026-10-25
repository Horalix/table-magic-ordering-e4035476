-- =====================================================================
-- Why did sales change?
--
-- "Net sales −8%" is a fact; it is not yet something a manager can act on.
-- Fewer tables is a marketing or a staffing question; the same tables
-- spending less is a menu, pricing or upselling one. They need different
-- fixes, and the headline cannot tell them apart.
--
-- Net sales factor exactly into parts:
--
--     net = visits × items per visit × net per item
--
-- and, when staff recorded a head count on at least 70% of visits in BOTH
-- periods:
--
--     net = visits × guests per visit × items per guest × net per item
--
-- Taking logs turns the product into a sum, so the change splits with no
-- remainder and no "interaction" term to explain away:
--
--     Δ ln(net) = Σ Δ ln(component)
--
-- Each component's Δ ln is reported, and the page turns the largest into a
-- sentence ("10% fewer tables at lunch; spend per table +2%").
--
-- A comparison period of a different length is scaled to the current one:
-- comparing a week with the four weeks before it compares it with the
-- AVERAGE of those weeks, and with the same weekdays (four of each). Only
-- the counts scale — visits and net — the ratios are left alone.
--
-- Everything is on the Sarajevo trading day (05:00 to 05:00), so the 00:30
-- round belongs to the evening before it, and on completed sales only.
-- New functions only.
-- =====================================================================

/**
 * The raw parts of net sales in a range of trading days, overall
 * ('all') and per daypart.
 *
 * A visit is a table session on one trading day. Per daypart, a visit counts
 * in each daypart it ordered in, so the daypart rows need not sum to 'all'.
 * Covers are the head count staff entered; `covered_visits` says on how many
 * visits they did.
 */
CREATE OR REPLACE FUNCTION public.sales_components(_from date, _to date)
RETURNS TABLE(
  daypart text,
  net numeric,
  visits int,
  units bigint,
  covered_visits int,
  covers bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_from timestamptz;
  v_to timestamptz;
BEGIN
  IF NOT public.is_staff_member() THEN
    RAISE EXCEPTION 'Only staff can read analytics' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _from IS NULL OR _to IS NULL OR _to < _from THEN
    RETURN;
  END IF;

  SELECT starts_at INTO v_from FROM public.business_day_range(_from);
  SELECT ends_at INTO v_to FROM public.business_day_range(_to);

  RETURN QUERY
  WITH s AS (
    SELECT co.id AS o_id,
           co.table_session_id AS o_session,
           public.business_day(co.created_at) AS o_day,
           public.daypart_of(co.created_at) AS o_part,
           co.total - COALESCE(co.tip_amount, 0) - COALESCE(co.refunded_amount, 0) AS o_net
      FROM public.completed_orders co
     WHERE co.created_at >= v_from AND co.created_at < v_to
  ),
  q AS (
    SELECT oi.order_id AS q_order, sum(oi.quantity)::bigint AS q_units
      FROM public.order_items oi
      JOIN s ON s.o_id = oi.order_id
     GROUP BY 1
  ),
  x AS (
    SELECT s.*, COALESCE(q.q_units, 0) AS o_units,
           CASE WHEN ts.covers > 0 THEN ts.covers END AS o_covers
      FROM s
      LEFT JOIN q ON q.q_order = s.o_id
      LEFT JOIN public.table_sessions ts ON ts.id = s.o_session
  ),
  visit_all AS (
    SELECT 'all'::text AS v_part, sum(o_net) AS v_net, sum(o_units) AS v_units, max(o_covers) AS v_covers
      FROM x GROUP BY o_session, o_day
  ),
  visit_part AS (
    SELECT o_part AS v_part, sum(o_net) AS v_net, sum(o_units) AS v_units, max(o_covers) AS v_covers
      FROM x GROUP BY o_session, o_day, o_part
  )
  SELECT v.v_part,
         COALESCE(sum(v.v_net), 0),
         count(*)::int,
         COALESCE(sum(v.v_units), 0)::bigint,
         (count(*) FILTER (WHERE v.v_covers IS NOT NULL))::int,
         COALESCE(sum(v.v_covers), 0)::bigint
    FROM (SELECT * FROM visit_all UNION ALL SELECT * FROM visit_part) v
   GROUP BY v.v_part;
END;
$$;

REVOKE ALL ON FUNCTION public.sales_components(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sales_components(date, date) TO authenticated;


/**
 * Split the change in net sales between two periods into exact log terms.
 *
 * `_scale` multiplies the comparison's counts (visits, net) to put it on the
 * current period's length. Returns NULL terms (and `comparable: false`) when
 * any component is zero or negative on either side, because a log of nothing
 * is not a percentage.
 *
 * Pure arithmetic over its arguments: reads no table and needs no staff check.
 */
CREATE OR REPLACE FUNCTION public.sales_change_terms(
  _net numeric, _visits numeric, _units numeric, _covered numeric, _covers numeric,
  _cmp_net numeric, _cmp_visits numeric, _cmp_units numeric, _cmp_covered numeric, _cmp_covers numeric,
  _scale numeric, _use_covers boolean
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cmp_net numeric := _cmp_net * _scale;
  v_cmp_visits numeric := _cmp_visits * _scale;
  v_terms jsonb := '[]'::jsonb;
  v_cur numeric[];
  v_old numeric[];
  v_keys text[];
  i int;
BEGIN
  IF COALESCE(_net, 0) <= 0 OR COALESCE(_visits, 0) <= 0 OR COALESCE(_units, 0) <= 0
     OR COALESCE(v_cmp_net, 0) <= 0 OR COALESCE(v_cmp_visits, 0) <= 0 OR COALESCE(_cmp_units, 0) <= 0 THEN
    RETURN jsonb_build_object(
      'comparable', false,
      'net', round(COALESCE(_net, 0), 2),
      'compare_net', round(COALESCE(v_cmp_net, 0), 2),
      'change_pct', CASE WHEN COALESCE(v_cmp_net, 0) > 0
                         THEN round(100 * (COALESCE(_net, 0) / v_cmp_net - 1), 1) END,
      'terms', '[]'::jsonb);
  END IF;

  IF _use_covers AND COALESCE(_covered, 0) > 0 AND COALESCE(_cmp_covered, 0) > 0
     AND COALESCE(_covers, 0) > 0 AND COALESCE(_cmp_covers, 0) > 0 THEN
    -- Guests per visit from the visits that recorded one; items per guest is
    -- then whatever makes the product exact.
    v_keys := ARRAY['visits', 'guests_per_visit', 'items_per_guest', 'net_per_item'];
    v_cur := ARRAY[_visits, _covers / _covered,
                   _units / (_visits * (_covers / _covered)), _net / _units];
    v_old := ARRAY[v_cmp_visits, _cmp_covers / _cmp_covered,
                   _cmp_units / (_cmp_visits * (_cmp_covers / _cmp_covered)), _cmp_net / _cmp_units];
  ELSE
    v_keys := ARRAY['visits', 'items_per_visit', 'net_per_item'];
    v_cur := ARRAY[_visits, _units / _visits, _net / _units];
    v_old := ARRAY[v_cmp_visits, _cmp_units / _cmp_visits, _cmp_net / _cmp_units];
  END IF;

  FOR i IN 1 .. array_length(v_keys, 1) LOOP
    v_terms := v_terms || jsonb_build_object(
      'key', v_keys[i],
      'current', round(v_cur[i], 4),
      'compare', round(v_old[i], 4),
      'dlog', ln(v_cur[i] / v_old[i]),
      'change_pct', round(100 * (v_cur[i] / v_old[i] - 1), 1));
  END LOOP;

  RETURN jsonb_build_object(
    'comparable', true,
    'net', round(_net, 2),
    'compare_net', round(v_cmp_net, 2),
    'change_pct', round(100 * (_net / v_cmp_net - 1), 1),
    'dlog', ln(_net / v_cmp_net),
    'terms', v_terms);
END;
$$;

REVOKE ALL ON FUNCTION public.sales_change_terms(numeric, numeric, numeric, numeric, numeric,
  numeric, numeric, numeric, numeric, numeric, numeric, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sales_change_terms(numeric, numeric, numeric, numeric, numeric,
  numeric, numeric, numeric, numeric, numeric, numeric, boolean) TO authenticated;


/**
 * Why net sales changed between two ranges of trading days.
 *
 * Defaults: the last seven COMPLETE trading days against the seven before.
 * Pass `_cmp_from`/`_cmp_to` for any other baseline — the page also asks for
 * the 28 days before the current week, i.e. the same weekdays of the four
 * prior weeks, scaled to one week.
 */
CREATE OR REPLACE FUNCTION public.sales_decomposition(
  _from date DEFAULT NULL,
  _to date DEFAULT NULL,
  _cmp_from date DEFAULT NULL,
  _cmp_to date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_to date := COALESCE(_to, public.business_day() - 1);
  v_from date;
  v_cmp_to date;
  v_cmp_from date;
  v_scale numeric;
  v_use_covers boolean;
  v_cur jsonb;
  v_cmp jsonb;
  v_all jsonb;
  v_old jsonb;
  v_parts jsonb := '[]'::jsonb;
  r record;
BEGIN
  IF NOT public.is_staff_member() THEN
    RAISE EXCEPTION 'Only staff can read analytics' USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_from := COALESCE(_from, v_to - 6);
  v_cmp_to := COALESCE(_cmp_to, v_from - 1);
  v_cmp_from := COALESCE(_cmp_from, v_cmp_to - (v_to - v_from));

  IF v_to < v_from OR v_cmp_to < v_cmp_from THEN
    RAISE EXCEPTION 'End date is before start date';
  END IF;
  IF (v_to - v_from) > 400 OR (v_cmp_to - v_cmp_from) > 400 THEN
    RAISE EXCEPTION 'Range is limited to 400 days';
  END IF;

  v_scale := (v_to - v_from + 1)::numeric / (v_cmp_to - v_cmp_from + 1);

  SELECT COALESCE(jsonb_object_agg(c.daypart, to_jsonb(c)), '{}'::jsonb) INTO v_cur
    FROM public.sales_components(v_from, v_to) c;
  SELECT COALESCE(jsonb_object_agg(c.daypart, to_jsonb(c)), '{}'::jsonb) INTO v_cmp
    FROM public.sales_components(v_cmp_from, v_cmp_to) c;

  v_all := COALESCE(v_cur -> 'all', '{}'::jsonb);
  v_old := COALESCE(v_cmp -> 'all', '{}'::jsonb);

  -- Head counts are only trusted when recorded on most visits on both sides.
  v_use_covers := COALESCE((v_all ->> 'visits')::numeric, 0) > 0
    AND COALESCE((v_old ->> 'visits')::numeric, 0) > 0
    AND (v_all ->> 'covered_visits')::numeric / (v_all ->> 'visits')::numeric >= 0.7
    AND (v_old ->> 'covered_visits')::numeric / (v_old ->> 'visits')::numeric >= 0.7;

  FOR r IN
    SELECT d.daypart AS part, v_cur -> d.daypart AS c, v_cmp -> d.daypart AS o
      FROM (VALUES ('morning', 1), ('lunch', 2), ('afternoon', 3), ('evening', 4), ('late', 5)) d(daypart, ord)
     WHERE v_cur ? d.daypart OR v_cmp ? d.daypart
     ORDER BY d.ord
  LOOP
    v_parts := v_parts || (jsonb_build_object(
        'daypart', r.part,
        'visits', COALESCE((r.c ->> 'visits')::int, 0),
        'compare_visits', round(COALESCE((r.o ->> 'visits')::numeric, 0) * v_scale, 1))
      || public.sales_change_terms(
           (r.c ->> 'net')::numeric, (r.c ->> 'visits')::numeric, (r.c ->> 'units')::numeric, 0, 0,
           (r.o ->> 'net')::numeric, (r.o ->> 'visits')::numeric, (r.o ->> 'units')::numeric, 0, 0,
           v_scale, false));
  END LOOP;

  RETURN jsonb_build_object(
    'from', v_from, 'to', v_to,
    'cmp_from', v_cmp_from, 'cmp_to', v_cmp_to,
    'scale', v_scale,
    'basis', CASE WHEN v_use_covers THEN 'covers' ELSE 'visits' END,
    'measure', 'net_sales_excl_tips_and_refunds',
    'current', jsonb_build_object(
      'net', round(COALESCE((v_all ->> 'net')::numeric, 0), 2),
      'visits', COALESCE((v_all ->> 'visits')::int, 0),
      'units', COALESCE((v_all ->> 'units')::bigint, 0),
      'covered_visits', COALESCE((v_all ->> 'covered_visits')::int, 0),
      'covers', COALESCE((v_all ->> 'covers')::bigint, 0)),
    'compare', jsonb_build_object(
      'net', round(COALESCE((v_old ->> 'net')::numeric, 0), 2),
      'visits', COALESCE((v_old ->> 'visits')::int, 0),
      'units', COALESCE((v_old ->> 'units')::bigint, 0),
      'covered_visits', COALESCE((v_old ->> 'covered_visits')::int, 0),
      'covers', COALESCE((v_old ->> 'covers')::bigint, 0)),
    'total', public.sales_change_terms(
      (v_all ->> 'net')::numeric, (v_all ->> 'visits')::numeric, (v_all ->> 'units')::numeric,
      (v_all ->> 'covered_visits')::numeric, (v_all ->> 'covers')::numeric,
      (v_old ->> 'net')::numeric, (v_old ->> 'visits')::numeric, (v_old ->> 'units')::numeric,
      (v_old ->> 'covered_visits')::numeric, (v_old ->> 'covers')::numeric,
      v_scale, v_use_covers),
    'dayparts', v_parts
  );
END;
$$;

REVOKE ALL ON FUNCTION public.sales_decomposition(date, date, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sales_decomposition(date, date, date, date) TO authenticated;
