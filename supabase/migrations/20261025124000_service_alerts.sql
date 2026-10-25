-- =====================================================================
-- Is today normal? — sales anomalies, pace, and kitchen/bar ticket times
--
-- An alert that fires every day is switched off by the second week. Each one
-- here is built to stay quiet on ordinary variation:
--
-- DAILY NET SALES are compared with the SAME WEEKDAY of the previous six
-- weeks (a Tuesday is not a Saturday), using the median and the median
-- absolute deviation rather than mean and standard deviation, so one
-- holiday or one private party in the history cannot move the baseline:
--
--     robust z = (x − median) / (1.4826 · MAD)
--
-- 1.4826 makes the MAD comparable to a standard deviation for normal data.
-- The scale is floored at 5% of the median (and 1 KM): six near-identical
-- Tuesdays have a MAD close to zero, and dividing by it would turn a 2% dip
-- into an "anomaly". An alert needs |z| >= 3 and at least FOUR same-weekday
-- trading days of history; before that it says "learning", not "alert".
-- Days with no sales at all are reported as closed, not alerted on.
--
-- PACE compares today so far with the same moment on the same previous six
-- weekdays: how much of a usual day's takings had come in by now, what that
-- projects to, and the same robust z. It waits until a usual day is at least
-- 20% done before it will alert, because the first tables of the morning say
-- nothing about the evening.
--
-- TICKET TIMES. A ticket is one order at one station (kitchen or bar); its
-- time runs from reaching the kitchen (released_to_kitchen_at) to the moment
-- its LAST line was bumped ready. Per station and daypart, the 4-week p50 and
-- p90 are the baseline. "Now" is the tickets readied in the last two hours.
-- An alert needs at least 10 tickets now, at least 20 in the baseline, and a
-- p90 more than 1.3× the baseline p90.
--
-- Percentiles are percentile_disc — an observed ticket, never an
-- interpolation — so with ten tickets the p90 is the ninth-slowest, and one
-- forgotten two-hour ticket cannot raise the alarm on its own. A whole
-- service running 40% slow does.
--
-- New functions only.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.station_timings(_days int DEFAULT 28)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_days int := LEAST(GREATEST(COALESCE(_days, 28), 7), 90);
  v_today date := public.business_day();
  v_start timestamptz;
  v_now_part text := public.daypart_of(now());
  v_baseline jsonb;
  v_now jsonb;
BEGIN
  IF NOT public.is_staff_member() THEN
    RAISE EXCEPTION 'Only staff can read service times' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT starts_at INTO v_start FROM public.business_day_range(v_today - v_days);

  WITH tickets AS (
    SELECT o.id AS t_order,
           oi.station AS t_station,
           COALESCE(o.released_to_kitchen_at, o.created_at) AS t_sent,
           max(oi.ready_at) AS t_ready
      FROM public.completed_orders o
      JOIN public.order_items oi ON oi.order_id = o.id
     WHERE o.created_at >= v_start
     GROUP BY o.id, oi.station, COALESCE(o.released_to_kitchen_at, o.created_at)
    -- A ticket is done when every one of its lines is.
    HAVING count(*) = count(oi.ready_at)
  ),
  t AS (
    SELECT t_station AS station,
           public.business_day(t_sent) AS day,
           public.daypart_of(t_sent) AS part,
           t_ready AS ready,
           EXTRACT(EPOCH FROM (t_ready - t_sent)) / 60.0 AS minutes
      FROM tickets
     WHERE t_ready >= t_sent
  ),
  base AS (
    SELECT station, part, count(*)::int AS n,
           percentile_disc(0.5) WITHIN GROUP (ORDER BY minutes) AS p50,
           percentile_disc(0.9) WITHIN GROUP (ORDER BY minutes) AS p90
      FROM t WHERE day < v_today
     GROUP BY GROUPING SETS ((station, part), (station))
  ),
  recent AS (
    SELECT station, count(*)::int AS n,
           percentile_disc(0.5) WITHIN GROUP (ORDER BY minutes) AS p50,
           percentile_disc(0.9) WITHIN GROUP (ORDER BY minutes) AS p90
      FROM t WHERE ready >= now() - interval '2 hours'
     GROUP BY station
  ),
  compared AS (
    SELECT r.station, r.n, r.p50, r.p90,
           -- The same daypart's baseline when it has enough tickets, else the
           -- station's whole-day baseline.
           CASE WHEN bp.n >= 20 THEN bp.p90 ELSE ba.p90 END AS b_p90,
           CASE WHEN bp.n >= 20 THEN bp.n ELSE ba.n END AS b_n,
           CASE WHEN bp.n >= 20 THEN v_now_part ELSE 'all' END AS b_part
      FROM recent r
      LEFT JOIN base bp ON bp.station = r.station AND bp.part = v_now_part
      LEFT JOIN base ba ON ba.station = r.station AND ba.part IS NULL
  )
  SELECT
    (SELECT COALESCE(jsonb_agg(jsonb_build_object(
              'station', b.station, 'daypart', COALESCE(b.part, 'all'), 'tickets', b.n,
              'p50', round(b.p50::numeric, 1), 'p90', round(b.p90::numeric, 1))
            ORDER BY b.station, b.part NULLS FIRST), '[]'::jsonb) FROM base b),
    (SELECT COALESCE(jsonb_agg(jsonb_build_object(
              'station', c.station, 'daypart', v_now_part, 'tickets', c.n,
              'p50', round(c.p50::numeric, 1), 'p90', round(c.p90::numeric, 1),
              'baseline_p90', round(c.b_p90::numeric, 1), 'baseline_tickets', COALESCE(c.b_n, 0),
              'baseline_daypart', c.b_part,
              'ratio', CASE WHEN c.b_p90 > 0 THEN round((c.p90 / c.b_p90)::numeric, 2) END,
              'status', CASE
                          WHEN COALESCE(c.b_n, 0) < 20 THEN 'learning'
                          WHEN c.n < 10 THEN 'too_few_tickets'
                          WHEN c.p90 > 1.3 * c.b_p90 THEN 'slow'
                          ELSE 'normal' END,
              'alert', COALESCE(c.b_n, 0) >= 20 AND c.n >= 10 AND c.p90 > 1.3 * c.b_p90)
            ORDER BY c.station), '[]'::jsonb) FROM compared c)
    INTO v_baseline, v_now;

  RETURN jsonb_build_object(
    'window_days', v_days,
    'daypart_now', v_now_part,
    'baseline', v_baseline,
    'now', v_now);
END;
$$;

REVOKE ALL ON FUNCTION public.station_timings(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.station_timings(int) TO authenticated;


CREATE OR REPLACE FUNCTION public.daily_anomalies()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := public.business_day();
  v_today_start timestamptz;
  v_start timestamptz;
  v_offset interval;
  v_days jsonb;
  v_pace jsonb;
BEGIN
  IF NOT public.is_staff_member() THEN
    RAISE EXCEPTION 'Only staff can read analytics' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT starts_at INTO v_today_start FROM public.business_day_range(v_today);
  SELECT starts_at INTO v_start FROM public.business_day_range(v_today - 56);
  v_offset := now() - v_today_start;

  -- The last fourteen complete trading days, each against its own weekday.
  WITH daily AS (
    SELECT public.business_day(co.created_at) AS day,
           sum(co.total - COALESCE(co.tip_amount, 0) - COALESCE(co.refunded_amount, 0)) AS net
      FROM public.completed_orders co
     WHERE co.created_at >= v_start AND co.created_at < v_today_start
     GROUP BY 1
  ),
  eval AS (
    SELECT g::date AS d FROM generate_series(v_today - 14, v_today - 1, interval '1 day') g
  ),
  hist AS (
    SELECT e.d, h.net
      FROM eval e
      JOIN daily h ON h.day = ANY (ARRAY[e.d - 7, e.d - 14, e.d - 21, e.d - 28, e.d - 35, e.d - 42])
  ),
  med AS (
    SELECT d, count(*)::int AS n, percentile_cont(0.5) WITHIN GROUP (ORDER BY net) AS med
      FROM hist GROUP BY d
  ),
  mad AS (
    SELECT h.d, percentile_cont(0.5) WITHIN GROUP (ORDER BY abs(h.net - m.med)) AS mad
      FROM hist h JOIN med m ON m.d = h.d GROUP BY h.d
  ),
  scored AS (
    SELECT e.d, COALESCE(dl.net, 0) AS net, dl.day IS NOT NULL AS traded,
           COALESCE(m.n, 0) AS n, m.med,
           GREATEST(1.4826 * COALESCE(md.mad, 0), 0.05 * COALESCE(m.med, 0), 1) AS scale
      FROM eval e
      LEFT JOIN daily dl ON dl.day = e.d
      LEFT JOIN med m ON m.d = e.d
      LEFT JOIN mad md ON md.d = e.d
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'day', s.d,
           'weekday', to_char(s.d, 'FMDay'),
           'net', round(s.net::numeric, 2),
           'traded', s.traded,
           'history', s.n,
           'median', round(s.med::numeric, 2),
           'z', CASE WHEN s.med IS NOT NULL THEN round(((s.net - s.med) / s.scale)::numeric, 2) END,
           'status', CASE
                       WHEN NOT s.traded THEN 'closed'
                       WHEN s.n < 4 THEN 'learning'
                       WHEN abs((s.net - s.med) / s.scale) >= 3 THEN
                         CASE WHEN s.net < s.med THEN 'low' ELSE 'high' END
                       ELSE 'normal' END,
           'alert', s.traded AND s.n >= 4 AND abs((s.net - s.med) / s.scale) >= 3)
         ORDER BY s.d DESC), '[]'::jsonb)
    INTO v_days
    FROM scored s;

  -- Today so far, against the same moment of the same previous weekdays.
  WITH past AS (
    SELECT k, r.starts_at AS s0, r.ends_at AS s1
      FROM generate_series(1, 6) k
      CROSS JOIN LATERAL public.business_day_range(v_today - 7 * k) r
  ),
  past_net AS (
    SELECT p.k,
           sum(co.total - COALESCE(co.tip_amount, 0) - COALESCE(co.refunded_amount, 0)) AS full_net,
           COALESCE(sum(co.total - COALESCE(co.tip_amount, 0) - COALESCE(co.refunded_amount, 0))
                      FILTER (WHERE co.created_at < p.s0 + v_offset), 0) AS part_net
      FROM past p
      JOIN public.completed_orders co ON co.created_at >= p.s0 AND co.created_at < p.s1
     GROUP BY p.k
    HAVING sum(co.total) > 0
  ),
  stats AS (
    SELECT count(*)::int AS n,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY full_net) AS usual_full,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY part_net) AS usual_part,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY part_net / NULLIF(full_net, 0)) AS usual_share
      FROM past_net
  ),
  spread AS (
    SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY abs(p.part_net - s.usual_part)) AS mad
      FROM past_net p CROSS JOIN stats s
  ),
  today AS (
    SELECT COALESCE(sum(co.total - COALESCE(co.tip_amount, 0) - COALESCE(co.refunded_amount, 0)), 0) AS so_far
      FROM public.completed_orders co
     WHERE co.created_at >= v_today_start AND co.created_at < now()
  ),
  scored AS (
    SELECT t.so_far, s.n, s.usual_full, s.usual_part, s.usual_share,
           GREATEST(1.4826 * COALESCE(sp.mad, 0), 0.05 * COALESCE(s.usual_part, 0), 1) AS scale
      FROM today t CROSS JOIN stats s CROSS JOIN spread sp
  )
  SELECT jsonb_build_object(
           'day', v_today,
           'so_far', round(s.so_far::numeric, 2),
           'history', s.n,
           'usual_so_far', round(s.usual_part::numeric, 2),
           'usual_total', round(s.usual_full::numeric, 2),
           'usual_share', round(s.usual_share::numeric, 3),
           'pace', CASE WHEN s.usual_part > 0 THEN round((s.so_far / s.usual_part)::numeric, 2) END,
           'projected', CASE WHEN s.usual_share >= 0.2 THEN round((s.so_far / s.usual_share)::numeric, 0) END,
           'z', CASE WHEN s.usual_part IS NOT NULL THEN round(((s.so_far - s.usual_part) / s.scale)::numeric, 2) END,
           'status', CASE
                       WHEN s.n < 4 THEN 'learning'
                       WHEN COALESCE(s.usual_share, 0) < 0.2 THEN 'too_early'
                       WHEN abs((s.so_far - s.usual_part) / s.scale) >= 3 THEN
                         CASE WHEN s.so_far < s.usual_part THEN 'behind' ELSE 'ahead' END
                       ELSE 'normal' END,
           'alert', s.n >= 4 AND COALESCE(s.usual_share, 0) >= 0.2
                    AND abs((s.so_far - s.usual_part) / s.scale) >= 3)
    INTO v_pace
    FROM scored s;

  RETURN jsonb_build_object('today', v_pace, 'days', v_days);
END;
$$;

REVOKE ALL ON FUNCTION public.daily_anomalies() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.daily_anomalies() TO authenticated;
