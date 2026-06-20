-- Kitchen printing settings + tipping. Additive / idempotent.

-- =====================================================================
-- 1. Restaurant settings (singleton) — drives kitchen ticket printing.
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.restaurant_settings (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  print_enabled boolean NOT NULL DEFAULT true,
  print_auto boolean NOT NULL DEFAULT true,
  print_paper_width int NOT NULL DEFAULT 80 CHECK (print_paper_width IN (58, 80)),
  print_header text NOT NULL DEFAULT 'La Soul',
  print_footer text NOT NULL DEFAULT 'Hvala / Thank you',
  print_show_prices boolean NOT NULL DEFAULT true,
  print_copies int NOT NULL DEFAULT 1 CHECK (print_copies BETWEEN 1 AND 3),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.restaurant_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.restaurant_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff can view settings" ON public.restaurant_settings;
CREATE POLICY "Staff can view settings"
  ON public.restaurant_settings FOR SELECT TO authenticated
  USING (public.is_staff_member());

DROP POLICY IF EXISTS "Admins manage settings" ON public.restaurant_settings;
CREATE POLICY "Admins manage settings"
  ON public.restaurant_settings FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

GRANT SELECT, INSERT, UPDATE ON public.restaurant_settings TO authenticated;

-- Realtime so a settings change reaches the kitchen display live.
DO $$ BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.restaurant_settings; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

-- =====================================================================
-- 2. Tipping — total = items_total + tip (still computed server-side).
-- =====================================================================
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS tip_amount numeric(10,2) NOT NULL DEFAULT 0 CHECK (tip_amount >= 0);

-- Replace the 5-arg signature with the tip-aware 6-arg one.
DROP FUNCTION IF EXISTS public.guest_place_order(uuid, text, text, text, jsonb);

CREATE OR REPLACE FUNCTION public.guest_place_order(
  _session_id uuid,
  _session_token text,
  _guest_name text,
  _payment_method text,
  _items jsonb,
  _tip numeric DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session public.table_sessions;
  v_order public.orders;
  v_item_count int;
  v_order_count int;
  v_items_total numeric(10,2);
  v_tip numeric(10,2);
  v_payment_method text := CASE WHEN _payment_method IN ('cash', 'card') THEN _payment_method ELSE 'cash' END;
  v_ticket_id uuid;
BEGIN
  v_session := public.assert_guest_session(_session_id, _session_token);

  IF jsonb_typeof(_items) <> 'array' THEN
    RAISE EXCEPTION 'Order items must be an array';
  END IF;

  SELECT jsonb_array_length(_items) INTO v_item_count;
  IF v_item_count < 1 OR v_item_count > 40 THEN
    RAISE EXCEPTION 'Invalid order size';
  END IF;

  UPDATE public.table_sessions SET last_heartbeat_at = now() WHERE id = v_session.id;

  SELECT count(*) INTO v_order_count
    FROM public.orders
   WHERE table_session_id = v_session.id AND status <> 'cancelled';
  IF v_order_count >= 10 THEN
    RAISE EXCEPTION 'Maximum orders reached for this session';
  END IF;

  WITH requested AS (
    SELECT
      (item->>'menu_item_id')::uuid AS menu_item_id,
      LEAST(GREATEST(COALESCE((item->>'quantity')::int, 1), 1), 10) AS quantity,
      nullif(left(trim(coalesce(item->>'notes', '')), 500), '') AS notes
    FROM jsonb_array_elements(_items) AS item
  )
  SELECT round(sum(mi.price * r.quantity)::numeric, 2)
    INTO v_items_total
    FROM requested r
    JOIN public.menu_items mi ON mi.id = r.menu_item_id AND mi.is_available = true;

  IF v_items_total IS NULL OR v_items_total <= 0 THEN
    RAISE EXCEPTION 'No available menu items found';
  END IF;

  WITH requested AS (
    SELECT (item->>'menu_item_id')::uuid AS menu_item_id
      FROM jsonb_array_elements(_items) AS item
  )
  SELECT count(*)
    INTO v_item_count
    FROM requested r
    LEFT JOIN public.menu_items mi ON mi.id = r.menu_item_id AND mi.is_available = true
   WHERE mi.id IS NULL;
  IF v_item_count > 0 THEN
    RAISE EXCEPTION 'One or more menu items are unavailable';
  END IF;

  -- Clamp the tip: non-negative, and at most 40% of items or 200 KM.
  v_tip := round(GREATEST(COALESCE(_tip, 0), 0)::numeric, 2);
  v_tip := LEAST(v_tip, round(v_items_total * 0.40, 2), 200);

  INSERT INTO public.orders(table_session_id, total, tip_amount, status, guest_name, payment_method, payment_status)
  VALUES (
    v_session.id,
    v_items_total + v_tip,
    v_tip,
    'pending',
    nullif(left(trim(coalesce(_guest_name, '')), 80), ''),
    v_payment_method,
    CASE WHEN v_payment_method = 'card' THEN 'pending' ELSE 'unpaid' END
  )
  RETURNING * INTO v_order;

  WITH requested AS (
    SELECT
      (item->>'menu_item_id')::uuid AS menu_item_id,
      LEAST(GREATEST(COALESCE((item->>'quantity')::int, 1), 1), 10) AS quantity,
      nullif(left(trim(coalesce(item->>'notes', '')), 500), '') AS notes
    FROM jsonb_array_elements(_items) AS item
  )
  INSERT INTO public.order_items(order_id, menu_item_id, quantity, unit_price, notes, status)
  SELECT v_order.id, r.menu_item_id, r.quantity, mi.price, r.notes, 'pending'
    FROM requested r
    JOIN public.menu_items mi ON mi.id = r.menu_item_id AND mi.is_available = true;

  v_ticket_id := public.enqueue_order_ticket(v_order.id, 'kitchen');

  RETURN jsonb_build_object(
    'order_id', v_order.id,
    'total', v_order.total,
    'tip_amount', v_order.tip_amount,
    'payment_method', v_order.payment_method,
    'payment_status', v_order.payment_status,
    'ticket_id', v_ticket_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.guest_place_order(uuid, text, text, text, jsonb, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guest_place_order(uuid, text, text, text, jsonb, numeric) TO anon, authenticated;
