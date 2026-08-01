-- =====================================================================
-- Payment safety + server-controlled order state machine.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.order_code_counters (
  day date PRIMARY KEY,
  last_value int NOT NULL DEFAULT 0
);

CREATE OR REPLACE FUNCTION public.next_order_code()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_value int;
BEGIN
  INSERT INTO public.order_code_counters(day, last_value)
  VALUES (CURRENT_DATE, 1)
  ON CONFLICT (day) DO UPDATE SET last_value = public.order_code_counters.last_value + 1
  RETURNING last_value INTO v_value;

  RETURN lpad(((v_value - 1) % 999 + 1)::text, 3, '0');
END;
$$;

REVOKE ALL ON FUNCTION public.next_order_code() FROM PUBLIC, anon, authenticated;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS order_code text,
  ADD COLUMN IF NOT EXISTS released_to_kitchen_at timestamptz,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS paid_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS payment_note text,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cancel_reason text,
  ADD COLUMN IF NOT EXISTS refunded_amount numeric(10,2) NOT NULL DEFAULT 0 CHECK (refunded_amount >= 0),
  ADD COLUMN IF NOT EXISTS fiscalization_status text NOT NULL DEFAULT 'not_fiscalized',
  ADD COLUMN IF NOT EXISTS fiscalized_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS fiscal_receipt_number text,
  ADD COLUMN IF NOT EXISTS fiscal_provider_reference text,
  ADD COLUMN IF NOT EXISTS fiscalization_error text;

DO $$ BEGIN
  ALTER TABLE public.orders
    ADD CONSTRAINT orders_fiscalization_status_check
    CHECK (fiscalization_status IN ('not_fiscalized', 'fiscalized', 'failed'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.orders
    ADD CONSTRAINT orders_payment_status_check
    CHECK (payment_status IN ('unpaid', 'pending', 'paid', 'failed', 'refunded', 'partially_refunded'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

UPDATE public.orders SET payment_method = 'card_online' WHERE payment_method = 'card';

DO $$ BEGIN
  ALTER TABLE public.orders
    ADD CONSTRAINT orders_payment_method_check
    CHECK (payment_method IS NULL OR payment_method IN ('card_online', 'cash', 'pos_terminal', 'card'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

UPDATE public.orders
   SET released_to_kitchen_at = COALESCE(released_to_kitchen_at, created_at)
 WHERE released_to_kitchen_at IS NULL
   AND status <> 'cancelled';

UPDATE public.orders
   SET fiscalization_status = 'fiscalized'
 WHERE fiscalized = true
   AND fiscalization_status = 'not_fiscalized';

CREATE INDEX IF NOT EXISTS idx_orders_status_created ON public.orders(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_payment_status ON public.orders(payment_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_session ON public.orders(table_session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_code_day ON public.orders(order_code, created_at DESC);

-- =====================================================================
-- 2. Audit log
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_label text,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  before_state jsonb,
  after_state jsonb,
  reason text,
  correlation_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON public.audit_log(entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON public.audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON public.audit_log(action, created_at DESC);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read audit log" ON public.audit_log;
CREATE POLICY "Admins read audit log"
  ON public.audit_log FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

REVOKE INSERT, UPDATE, DELETE ON public.audit_log FROM anon, authenticated;
GRANT SELECT ON public.audit_log TO authenticated;
GRANT ALL ON public.audit_log TO service_role;

CREATE OR REPLACE FUNCTION public.write_audit(
  _action text,
  _entity_type text,
  _entity_id uuid,
  _before jsonb DEFAULT NULL,
  _after jsonb DEFAULT NULL,
  _reason text DEFAULT NULL,
  _actor_label text DEFAULT NULL,
  _correlation_id text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.audit_log(
    actor_user_id, actor_label, action, entity_type, entity_id,
    before_state, after_state, reason, correlation_id
  )
  VALUES (
    auth.uid(), nullif(left(trim(coalesce(_actor_label, '')), 120), ''),
    _action, _entity_type, _entity_id, _before, _after,
    nullif(left(trim(coalesce(_reason, '')), 500), ''), _correlation_id
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.write_audit(text, text, uuid, jsonb, jsonb, text, text, text) FROM PUBLIC, anon, authenticated;

-- =====================================================================
-- 3. The state machine
-- =====================================================================

CREATE OR REPLACE FUNCTION public.order_transition_allowed(
  _from public.order_status,
  _to public.order_status
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN _from = _to THEN true
    WHEN _from = 'awaiting_payment' AND _to IN ('pending', 'payment_failed', 'cancelled') THEN true
    WHEN _from = 'payment_failed'   AND _to IN ('awaiting_payment', 'pending', 'cancelled') THEN true
    WHEN _from = 'pending'          AND _to IN ('confirmed', 'preparing', 'ready', 'cancelled') THEN true
    WHEN _from = 'confirmed'        AND _to IN ('preparing', 'ready', 'cancelled') THEN true
    WHEN _from = 'preparing'        AND _to IN ('ready', 'served', 'cancelled') THEN true
    WHEN _from = 'ready'            AND _to IN ('served', 'cancelled') THEN true
    WHEN _from = 'served'           AND _to = 'cancelled' THEN true
    ELSE false
  END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_order_integrity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_privileged boolean := coalesce(current_setting('lasoul.financial_ctx', true), '') = 'on';
BEGIN
  IF NOT v_privileged THEN
    IF NEW.total IS DISTINCT FROM OLD.total
       OR NEW.tip_amount IS DISTINCT FROM OLD.tip_amount
       OR NEW.payment_status IS DISTINCT FROM OLD.payment_status
       OR NEW.payment_method IS DISTINCT FROM OLD.payment_method
       OR NEW.paid_at IS DISTINCT FROM OLD.paid_at
       OR NEW.paid_by IS DISTINCT FROM OLD.paid_by
       OR NEW.refunded_amount IS DISTINCT FROM OLD.refunded_amount
       OR NEW.released_to_kitchen_at IS DISTINCT FROM OLD.released_to_kitchen_at
       OR NEW.order_code IS DISTINCT FROM OLD.order_code
       OR NEW.fiscalization_status IS DISTINCT FROM OLD.fiscalization_status
       OR NEW.fiscal_receipt_number IS DISTINCT FROM OLD.fiscal_receipt_number
       OR NEW.fiscalized IS DISTINCT FROM OLD.fiscalized
    THEN
      RAISE EXCEPTION 'Financial fields can only be changed through an authorised operation'
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status
       AND (OLD.status IN ('awaiting_payment', 'payment_failed')
            OR NEW.status IN ('awaiting_payment', 'payment_failed'))
    THEN
      RAISE EXCEPTION 'Payment-gated status changes require an authorised operation'
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF OLD.status = 'served' AND NEW.status = 'cancelled' THEN
      RAISE EXCEPTION 'Voiding a served order requires an authorised operation'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT public.order_transition_allowed(OLD.status, NEW.status)
  THEN
    RAISE EXCEPTION 'Illegal order transition % -> %', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_order_integrity ON public.orders;
CREATE TRIGGER enforce_order_integrity
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.enforce_order_integrity();

-- =====================================================================
-- 4. Kitchen release
-- =====================================================================

CREATE OR REPLACE FUNCTION public.release_order_to_kitchen(_order_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows int := 0;
  v_released boolean := false;
BEGIN
  PERFORM set_config('lasoul.financial_ctx', 'on', true);

  UPDATE public.orders
     SET status = 'pending',
         released_to_kitchen_at = now(),
         order_code = COALESCE(order_code, public.next_order_code())
   WHERE id = _order_id
     AND status IN ('awaiting_payment', 'payment_failed')
     AND released_to_kitchen_at IS NULL;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_released := v_rows > 0;

  IF v_released THEN
    PERFORM public.enqueue_order_ticket(_order_id, 'kitchen');
    PERFORM public.write_audit('order.released_to_kitchen', 'order', _order_id);
  END IF;

  RETURN v_released;
END;
$$;

REVOKE ALL ON FUNCTION public.release_order_to_kitchen(uuid) FROM PUBLIC, anon, authenticated;

-- =====================================================================
-- 4b. Ordering + payment availability switches
-- =====================================================================

ALTER TABLE public.restaurant_settings
  ADD COLUMN IF NOT EXISTS ordering_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS online_card_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pay_at_table_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS ordering_paused_message text,
  ADD COLUMN IF NOT EXISTS last_order_time time,
  ADD COLUMN IF NOT EXISTS kitchen_delay_minutes int NOT NULL DEFAULT 0 CHECK (kitchen_delay_minutes >= 0),
  ADD COLUMN IF NOT EXISTS recommendations_enabled boolean NOT NULL DEFAULT true;

CREATE OR REPLACE FUNCTION public.online_card_payments_enabled()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT online_card_enabled FROM public.restaurant_settings WHERE id = 1), false);
$$;

REVOKE ALL ON FUNCTION public.online_card_payments_enabled() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.online_card_payments_enabled() TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.guest_get_service_status()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'ordering_enabled', COALESCE(s.ordering_enabled, true),
    'online_card_enabled', COALESCE(s.online_card_enabled, false),
    'pay_at_table_enabled', COALESCE(s.pay_at_table_enabled, true),
    'paused_message', s.ordering_paused_message,
    'last_order_time', s.last_order_time,
    'kitchen_delay_minutes', COALESCE(s.kitchen_delay_minutes, 0),
    'recommendations_enabled', COALESCE(s.recommendations_enabled, true)
  )
  FROM public.restaurant_settings s
  WHERE s.id = 1;
$$;

REVOKE ALL ON FUNCTION public.guest_get_service_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guest_get_service_status() TO anon, authenticated;

-- =====================================================================
-- 5. guest_place_order v3
-- =====================================================================

DROP FUNCTION IF EXISTS public.guest_place_order(uuid, text, text, text, jsonb);
DROP FUNCTION IF EXISTS public.guest_place_order(uuid, text, text, text, jsonb, numeric);

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
  v_method text;
  v_is_card boolean;
  v_status public.order_status;
  v_ticket_id uuid;
  v_unavailable text;
BEGIN
  v_session := public.assert_guest_session(_session_id, _session_token);

  IF NOT COALESCE((SELECT ordering_enabled FROM public.restaurant_settings WHERE id = 1), true) THEN
    RAISE EXCEPTION 'Ordering is paused'
      USING ERRCODE = 'feature_not_supported';
  END IF;

  v_method := CASE
    WHEN _payment_method IN ('card', 'card_online') THEN 'card_online'
    WHEN _payment_method = 'pos_terminal' THEN 'pos_terminal'
    ELSE 'cash'
  END;
  v_is_card := v_method = 'card_online';

  IF v_is_card AND NOT public.online_card_payments_enabled() THEN
    RAISE EXCEPTION 'Online card payment is currently unavailable'
      USING ERRCODE = 'feature_not_supported';
  END IF;

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
    SELECT DISTINCT (item->>'menu_item_id')::uuid AS menu_item_id
      FROM jsonb_array_elements(_items) AS item
  )
  SELECT string_agg(COALESCE(mi.name, 'Unknown item'), ', ')
    INTO v_unavailable
    FROM requested r
    LEFT JOIN public.menu_items mi ON mi.id = r.menu_item_id
   WHERE mi.id IS NULL OR mi.is_available = false;

  IF v_unavailable IS NOT NULL THEN
    RAISE EXCEPTION 'Unavailable: %', v_unavailable
      USING ERRCODE = 'no_data_found';
  END IF;

  WITH requested AS (
    SELECT
      (item->>'menu_item_id')::uuid AS menu_item_id,
      LEAST(GREATEST(COALESCE((item->>'quantity')::int, 1), 1), 10) AS quantity
    FROM jsonb_array_elements(_items) AS item
  )
  SELECT round(sum(mi.price * r.quantity)::numeric, 2)
    INTO v_items_total
    FROM requested r
    JOIN public.menu_items mi ON mi.id = r.menu_item_id AND mi.is_available = true;

  IF v_items_total IS NULL OR v_items_total <= 0 THEN
    RAISE EXCEPTION 'No available menu items found';
  END IF;

  v_tip := round(GREATEST(COALESCE(_tip, 0), 0)::numeric, 2);
  v_tip := LEAST(v_tip, round(v_items_total * 0.40, 2), 200);

  v_status := CASE WHEN v_is_card THEN 'awaiting_payment'::public.order_status
                   ELSE 'pending'::public.order_status END;

  INSERT INTO public.orders(
    table_session_id, total, tip_amount, status, guest_name,
    payment_method, payment_status, order_code, released_to_kitchen_at
  )
  VALUES (
    v_session.id,
    v_items_total + v_tip,
    v_tip,
    v_status,
    nullif(left(trim(coalesce(_guest_name, '')), 80), ''),
    v_method,
    CASE WHEN v_is_card THEN 'pending' ELSE 'unpaid' END,
    public.next_order_code(),
    CASE WHEN v_is_card THEN NULL ELSE now() END
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

  IF NOT v_is_card THEN
    v_ticket_id := public.enqueue_order_ticket(v_order.id, 'kitchen');
  END IF;

  RETURN jsonb_build_object(
    'order_id', v_order.id,
    'order_code', v_order.order_code,
    'status', v_order.status,
    'total', v_order.total,
    'tip_amount', v_order.tip_amount,
    'payment_method', v_order.payment_method,
    'payment_status', v_order.payment_status,
    'awaiting_payment', v_is_card,
    'ticket_id', v_ticket_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.guest_place_order(uuid, text, text, text, jsonb, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guest_place_order(uuid, text, text, text, jsonb, numeric) TO anon, authenticated;

-- =====================================================================
-- 6. Guest-facing payment status
-- =====================================================================

CREATE OR REPLACE FUNCTION public.guest_get_order_payment(
  _session_id uuid,
  _session_token text,
  _order_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session public.table_sessions;
  v_order public.orders;
BEGIN
  v_session := public.assert_guest_session(_session_id, _session_token);

  SELECT * INTO v_order
    FROM public.orders
   WHERE id = _order_id AND table_session_id = v_session.id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  RETURN jsonb_build_object(
    'status', 'ok',
    'order_id', v_order.id,
    'order_code', v_order.order_code,
    'order_status', v_order.status,
    'payment_status', v_order.payment_status,
    'payment_method', v_order.payment_method,
    'total', v_order.total,
    'released', v_order.released_to_kitchen_at IS NOT NULL
  );
END;
$$;

REVOKE ALL ON FUNCTION public.guest_get_order_payment(uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guest_get_order_payment(uuid, text, uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.guest_switch_to_pay_at_table(
  _session_id uuid,
  _session_token text,
  _order_id uuid,
  _method text DEFAULT 'cash'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session public.table_sessions;
  v_order public.orders;
  v_method text := CASE WHEN _method = 'pos_terminal' THEN 'pos_terminal' ELSE 'cash' END;
BEGIN
  v_session := public.assert_guest_session(_session_id, _session_token);

  SELECT * INTO v_order
    FROM public.orders
   WHERE id = _order_id
     AND table_session_id = v_session.id
     AND status IN ('awaiting_payment', 'payment_failed');

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_switchable');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.payment_transactions
     WHERE order_id = v_order.id AND status IN ('pending', 'approved')
  ) THEN
    RETURN jsonb_build_object('status', 'payment_in_flight');
  END IF;

  PERFORM set_config('lasoul.financial_ctx', 'on', true);

  UPDATE public.orders
     SET payment_method = v_method,
         payment_status = 'unpaid'
   WHERE id = v_order.id;

  PERFORM public.release_order_to_kitchen(v_order.id);
  PERFORM public.write_audit('order.switched_to_pay_at_table', 'order', v_order.id,
                             to_jsonb(v_order), NULL, v_method, 'guest');

  SELECT * INTO v_order FROM public.orders WHERE id = v_order.id;

  RETURN jsonb_build_object(
    'status', 'released',
    'order_code', v_order.order_code,
    'payment_method', v_order.payment_method
  );
END;
$$;

REVOKE ALL ON FUNCTION public.guest_switch_to_pay_at_table(uuid, text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guest_switch_to_pay_at_table(uuid, text, uuid, text) TO anon, authenticated;