CREATE OR REPLACE FUNCTION public.daypart_of(_at timestamptz DEFAULT now())
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN EXTRACT(HOUR FROM (_at AT TIME ZONE 'Europe/Sarajevo')) < 11 THEN 'morning'
    WHEN EXTRACT(HOUR FROM (_at AT TIME ZONE 'Europe/Sarajevo')) < 16 THEN 'lunch'
    WHEN EXTRACT(HOUR FROM (_at AT TIME ZONE 'Europe/Sarajevo')) < 18 THEN 'afternoon'
    WHEN EXTRACT(HOUR FROM (_at AT TIME ZONE 'Europe/Sarajevo')) < 23 THEN 'evening'
    ELSE 'late'
  END;
$$;

CREATE TABLE IF NOT EXISTS public.menu_item_prep_stats (
  menu_item_id uuid PRIMARY KEY REFERENCES public.menu_items(id) ON DELETE CASCADE,
  samples int NOT NULL DEFAULT 0,
  median_minutes numeric(6,2),
  p80_minutes numeric(6,2),
  computed_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.menu_item_prep_stats TO anon, authenticated;
GRANT ALL ON public.menu_item_prep_stats TO service_role;

ALTER TABLE public.menu_item_prep_stats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone reads prep stats" ON public.menu_item_prep_stats;
CREATE POLICY "Anyone reads prep stats"
  ON public.menu_item_prep_stats FOR SELECT TO anon, authenticated USING (true);

CREATE OR REPLACE FUNCTION public.prep_confidence_threshold()
RETURNS int LANGUAGE sql IMMUTABLE AS $$ SELECT 5 $$;

CREATE OR REPLACE FUNCTION public.refresh_prep_stats(_days int DEFAULT 30)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_rows int := 0;
BEGIN
  IF NOT public.is_staff_member() THEN
    RAISE EXCEPTION 'Only staff can refresh prep stats' USING ERRCODE = 'insufficient_privilege';
  END IF;

  WITH observed AS (
    SELECT oi.menu_item_id,
           EXTRACT(EPOCH FROM (oi.ready_at - oi.started_at)) / 60.0 AS minutes
      FROM public.order_items oi
     WHERE oi.started_at IS NOT NULL
       AND oi.ready_at IS NOT NULL
       AND oi.ready_at > oi.started_at
       AND oi.ready_at >= now() - make_interval(days => GREATEST(1, LEAST(365, _days)))
       AND oi.ready_at - oi.started_at < interval '2 hours'
  ),
  agg AS (
    SELECT menu_item_id,
           count(*)::int AS samples,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY minutes)::numeric(6,2) AS median_minutes,
           percentile_cont(0.8) WITHIN GROUP (ORDER BY minutes)::numeric(6,2) AS p80_minutes
      FROM observed
     GROUP BY menu_item_id
  )
  INSERT INTO public.menu_item_prep_stats(menu_item_id, samples, median_minutes, p80_minutes, computed_at)
  SELECT menu_item_id, samples, median_minutes, p80_minutes, now() FROM agg
  ON CONFLICT (menu_item_id) DO UPDATE SET
    samples = EXCLUDED.samples,
    median_minutes = EXCLUDED.median_minutes,
    p80_minutes = EXCLUDED.p80_minutes,
    computed_at = now();

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_prep_stats(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refresh_prep_stats(int) TO authenticated;

CREATE OR REPLACE FUNCTION public.item_prep_estimate(_item_id uuid)
RETURNS TABLE(minutes numeric, source text)
LANGUAGE sql
STABLE
AS $$
  SELECT
    CASE
      WHEN ps.samples >= public.prep_confidence_threshold() THEN ps.median_minutes
      ELSE mi.prep_minutes::numeric
    END,
    CASE
      WHEN ps.samples >= public.prep_confidence_threshold() THEN 'observed'
      WHEN mi.prep_minutes IS NOT NULL THEN 'menu'
      ELSE 'unknown'
    END
  FROM public.menu_items mi
  LEFT JOIN public.menu_item_prep_stats ps ON ps.menu_item_id = mi.id
  WHERE mi.id = _item_id;
$$;

ALTER TABLE public.restaurant_settings
  ADD COLUMN IF NOT EXISTS kitchen_capacity_minutes int NOT NULL DEFAULT 25
    CHECK (kitchen_capacity_minutes BETWEEN 5 AND 240);

COMMENT ON COLUMN public.restaurant_settings.kitchen_capacity_minutes IS
  'Roughly how many minutes of prep the kitchen absorbs in parallel. Tune it '
  'against real service; it scales every ETA.';

CREATE OR REPLACE FUNCTION public.kitchen_load()
RETURNS TABLE(station text, open_items int, backlog_minutes numeric, load_factor numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH cap AS (
    SELECT COALESCE(kitchen_capacity_minutes, 25)::numeric AS capacity
      FROM public.restaurant_settings WHERE id = 1
  ),
  open_lines AS (
    SELECT oi.station,
           oi.quantity,
           COALESCE(
             (SELECT e.minutes FROM public.item_prep_estimate(oi.menu_item_id) e),
             8
           ) AS minutes
      FROM public.order_items oi
      JOIN public.orders o ON o.id = oi.order_id
     WHERE oi.status IN ('pending', 'preparing')
       AND o.released_to_kitchen_at IS NOT NULL
       AND o.status IN ('pending', 'confirmed', 'preparing')
  )
  SELECT s.station,
         COALESCE(sum(l.quantity), 0)::int,
         COALESCE(sum(l.quantity * l.minutes), 0)::numeric(8,2),
         round(COALESCE(sum(l.quantity * l.minutes), 0) / (SELECT capacity FROM cap), 2)
    FROM (VALUES ('kitchen'), ('bar')) AS s(station)
    LEFT JOIN open_lines l ON l.station = s.station
   GROUP BY s.station;
$$;

REVOKE ALL ON FUNCTION public.kitchen_load() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kitchen_load() TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.guest_order_eta(_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders;
  v_base numeric;
  v_known int := 0;
  v_total int := 0;
  v_observed int := 0;
  v_backlog numeric := 0;
  v_capacity numeric;
  v_delay int;
  v_queue numeric;
  v_low int;
  v_high int;
  v_confidence text;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = _order_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  IF v_order.status IN ('served', 'cancelled', 'awaiting_payment', 'payment_failed')
     OR v_order.released_to_kitchen_at IS NULL THEN
    RETURN jsonb_build_object('confidence', 'none', 'reason', 'not_in_kitchen');
  END IF;

  SELECT COALESCE(max(e.minutes), 0),
         count(*) FILTER (WHERE e.minutes IS NOT NULL),
         count(*),
         count(*) FILTER (WHERE e.source = 'observed')
    INTO v_base, v_known, v_total, v_observed
    FROM public.order_items oi
    CROSS JOIN LATERAL public.item_prep_estimate(oi.menu_item_id) e
   WHERE oi.order_id = _order_id
     AND oi.status IN ('pending', 'preparing');

  IF v_total = 0 THEN
    RETURN jsonb_build_object('confidence', 'none', 'reason', 'nothing_outstanding');
  END IF;

  IF v_known = 0 THEN
    RETURN jsonb_build_object('confidence', 'none', 'reason', 'no_prep_data');
  END IF;

  SELECT COALESCE(kitchen_capacity_minutes, 25)::numeric, COALESCE(kitchen_delay_minutes, 0)
    INTO v_capacity, v_delay
    FROM public.restaurant_settings WHERE id = 1;

  SELECT COALESCE(sum(oi.quantity * COALESCE(e.minutes, 8)), 0)
    INTO v_backlog
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    CROSS JOIN LATERAL public.item_prep_estimate(oi.menu_item_id) e
   WHERE oi.status IN ('pending', 'preparing')
     AND o.released_to_kitchen_at IS NOT NULL
     AND o.released_to_kitchen_at < v_order.released_to_kitchen_at
     AND o.status IN ('pending', 'confirmed', 'preparing');

  v_queue := v_backlog / GREATEST(v_capacity, 1);

  v_low := GREATEST(1, ceil(v_base + v_queue + v_delay))::int;
  v_high := GREATEST(v_low + 2, ceil((v_base * 1.35) + v_queue + v_delay))::int;

  v_confidence := CASE
    WHEN v_known < v_total THEN 'low'
    WHEN v_observed = v_total THEN 'high'
    ELSE 'medium'
  END;

  RETURN jsonb_build_object(
    'confidence', v_confidence,
    'low_minutes', v_low,
    'high_minutes', v_high,
    'backlog_minutes', round(v_backlog, 1),
    'based_on', CASE WHEN v_observed = v_total THEN 'our own kitchen'
                     WHEN v_observed > 0 THEN 'part history, part menu'
                     ELSE 'menu settings' END,
    'ready_from', now() + make_interval(mins => v_low),
    'ready_to', now() + make_interval(mins => v_high)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.guest_order_eta(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guest_order_eta(uuid) TO anon, authenticated;