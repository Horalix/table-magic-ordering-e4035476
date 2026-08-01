CREATE OR REPLACE FUNCTION public.sales_analytics(
  _from date DEFAULT (CURRENT_DATE - 6),
  _to date DEFAULT CURRENT_DATE
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from timestamptz;
  v_to timestamptz;
  v_result jsonb;
BEGIN
  IF NOT public.is_staff_member() THEN
    RAISE EXCEPTION 'Only staff can read analytics' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF _to < _from THEN
    RAISE EXCEPTION 'End date is before start date';
  END IF;
  IF (_to - _from) > 400 THEN
    RAISE EXCEPTION 'Range is limited to 400 days';
  END IF;

  v_from := _from::timestamptz;
  v_to := (_to + 1)::timestamptz;

  WITH sales AS (
    SELECT co.id, co.total, co.tip_amount, co.created_at, co.table_session_id
      FROM public.completed_orders co
     WHERE co.created_at >= v_from AND co.created_at < v_to
  ),
  lines AS (
    SELECT oi.menu_item_id, oi.quantity, oi.unit_price, s.id AS order_id
      FROM public.order_items oi
      JOIN sales s ON s.id = oi.order_id
  )
  SELECT jsonb_build_object(
    'from', _from,
    'to', _to,

    'totals', (
      SELECT jsonb_build_object(
        'revenue', COALESCE(round(sum(total), 2), 0),
        'tips', COALESCE(round(sum(tip_amount), 2), 0),
        'orders', count(*),
        'average_order', COALESCE(round(avg(total), 2), 0),
        'items_per_order', COALESCE(
          round((SELECT sum(quantity)::numeric FROM lines) / NULLIF(count(*), 0), 2), 0)
      ) FROM sales
    ),

    'by_day', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('day', d::date, 'revenue', COALESCE(r.revenue, 0), 'orders', COALESCE(r.orders, 0))
                       ORDER BY d)
        FROM generate_series(_from, _to, interval '1 day') d
        LEFT JOIN (
          SELECT date_trunc('day', created_at)::date AS day,
                 round(sum(total), 2) AS revenue,
                 count(*) AS orders
            FROM sales GROUP BY 1
        ) r ON r.day = d::date
    ), '[]'::jsonb),

    'by_hour', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('hour', h, 'orders', COALESCE(o.orders, 0), 'revenue', COALESCE(o.revenue, 0))
                       ORDER BY h)
        FROM generate_series(0, 23) h
        LEFT JOIN (
          SELECT extract(hour FROM created_at)::int AS hour,
                 count(*) AS orders,
                 round(sum(total), 2) AS revenue
            FROM sales GROUP BY 1
        ) o ON o.hour = h
    ), '[]'::jsonb),

    'by_category', COALESCE((
      SELECT jsonb_agg(x ORDER BY (x->>'revenue')::numeric DESC) FROM (
        SELECT jsonb_build_object(
                 'name', COALESCE(c.name, 'Other'),
                 'revenue', round(sum(l.quantity * l.unit_price), 2),
                 'units', sum(l.quantity)
               ) AS x
          FROM lines l
          LEFT JOIN public.menu_items mi ON mi.id = l.menu_item_id
          LEFT JOIN public.subcategories sc ON sc.id = mi.subcategory_id
          LEFT JOIN public.categories c ON c.id = sc.category_id
         GROUP BY c.name
      ) t
    ), '[]'::jsonb),

    'top_items', COALESCE((
      SELECT jsonb_agg(x ORDER BY (x->>'units')::int DESC) FROM (
        SELECT jsonb_build_object(
                 'item_id', l.menu_item_id,
                 'name', COALESCE(mi.name, 'Unknown'),
                 'units', sum(l.quantity)::int,
                 'revenue', round(sum(l.quantity * l.unit_price), 2)
               ) AS x
          FROM lines l
          LEFT JOIN public.menu_items mi ON mi.id = l.menu_item_id
         GROUP BY l.menu_item_id, mi.name
         ORDER BY sum(l.quantity) DESC
         LIMIT 12
      ) t
    ), '[]'::jsonb),

    'table_turnover', COALESCE((
      SELECT jsonb_agg(x ORDER BY (x->>'table_number')::int) FROM (
        SELECT jsonb_build_object(
                 'table_number', t.table_number,
                 'sittings', count(*)::int,
                 'avg_minutes', round(avg(
                   EXTRACT(EPOCH FROM (COALESCE(ts.closed_at, now()) - ts.opened_at)) / 60
                 ))
               ) AS x
          FROM public.table_sessions ts
          JOIN public.tables t ON t.id = ts.table_id
         WHERE ts.opened_at >= v_from AND ts.opened_at < v_to
         GROUP BY t.table_number
      ) t
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.sales_analytics(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sales_analytics(date, date) TO authenticated;

CREATE INDEX IF NOT EXISTS idx_order_items_menu_item ON public.order_items(menu_item_id);
CREATE INDEX IF NOT EXISTS idx_table_sessions_opened ON public.table_sessions(opened_at DESC);