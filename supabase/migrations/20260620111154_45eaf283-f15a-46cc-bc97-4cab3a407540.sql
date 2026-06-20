-- Production hardening: guests use narrow token-validated RPCs; staff/admin
-- keep authenticated access through RLS. Operational tables are no longer
-- directly readable/writable by anonymous clients.

CREATE OR REPLACE FUNCTION public.is_staff_member()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'staff'::public.app_role);
$$;

REVOKE ALL ON FUNCTION public.is_staff_member() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_staff_member() TO authenticated;

-- Replace the later insecure heartbeat RPC with the token-checked version.
DROP FUNCTION IF EXISTS public.touch_session(uuid);
DROP FUNCTION IF EXISTS public.touch_session(uuid, text);

CREATE OR REPLACE FUNCTION public.touch_session(_id uuid, _token text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.table_sessions
     SET last_heartbeat_at = now()
   WHERE id = _id
     AND token = _token
     AND is_active = true;

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.touch_session(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.touch_session(uuid, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.assert_guest_session(_session_id uuid, _session_token text)
RETURNS public.table_sessions
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session public.table_sessions;
BEGIN
  SELECT *
    INTO v_session
    FROM public.table_sessions
   WHERE id = _session_id
     AND token = _session_token
     AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid or expired table session';
  END IF;

  RETURN v_session;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_guest_session(uuid, text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.guest_inspect_table(
  _table_number int,
  _qr_token text,
  _client_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_table public.tables;
  v_session public.table_sessions;
  v_join public.session_join_requests;
BEGIN
  SELECT *
    INTO v_table
    FROM public.tables
   WHERE table_number = _table_number
     AND qr_token = _qr_token;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;

  SELECT *
    INTO v_session
    FROM public.table_sessions
   WHERE table_id = v_table.id
     AND is_active = true
   ORDER BY opened_at DESC
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'empty');
  END IF;

  IF v_session.host_client_id = _client_id THEN
    RETURN jsonb_build_object(
      'status', 'returning',
      'role', 'host',
      'session_id', v_session.id,
      'session_token', v_session.token,
      'guest_name', v_session.guest_name
    );
  END IF;

  SELECT *
    INTO v_join
    FROM public.session_join_requests
   WHERE table_session_id = v_session.id
     AND client_id = _client_id
     AND status = 'approved'
   ORDER BY resolved_at DESC NULLS LAST, created_at DESC
   LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'status', 'returning',
      'role', 'joiner',
      'session_id', v_session.id,
      'session_token', v_session.token,
      'guest_name', v_join.guest_name
    );
  END IF;

  RETURN jsonb_build_object('status', 'join_required', 'session_id', v_session.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.guest_start_table_session(
  _table_number int,
  _qr_token text,
  _client_id text,
  _guest_name text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_table public.tables;
  v_session public.table_sessions;
  v_join public.session_join_requests;
  v_name text := nullif(left(trim(coalesce(_guest_name, '')), 80), '');
BEGIN
  SELECT *
    INTO v_table
    FROM public.tables
   WHERE table_number = _table_number
     AND qr_token = _qr_token;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;

  SELECT *
    INTO v_session
    FROM public.table_sessions
   WHERE table_id = v_table.id
     AND is_active = true
   ORDER BY opened_at DESC
   LIMIT 1;

  IF NOT FOUND THEN
    INSERT INTO public.table_sessions(table_id, host_client_id, guest_name)
    VALUES (v_table.id, nullif(_client_id, ''), COALESCE(v_name, 'Guest'))
    RETURNING * INTO v_session;

    RETURN jsonb_build_object(
      'status', 'created',
      'role', 'host',
      'session_id', v_session.id,
      'session_token', v_session.token,
      'guest_name', v_session.guest_name
    );
  END IF;

  IF v_session.host_client_id = _client_id THEN
    IF v_name IS NOT NULL AND v_session.guest_name IS DISTINCT FROM v_name THEN
      UPDATE public.table_sessions
         SET guest_name = v_name
       WHERE id = v_session.id
       RETURNING * INTO v_session;
    END IF;

    RETURN jsonb_build_object(
      'status', 'returning',
      'role', 'host',
      'session_id', v_session.id,
      'session_token', v_session.token,
      'guest_name', COALESCE(v_session.guest_name, v_name)
    );
  END IF;

  SELECT *
    INTO v_join
    FROM public.session_join_requests
   WHERE table_session_id = v_session.id
     AND client_id = _client_id
     AND status = 'approved'
   ORDER BY resolved_at DESC NULLS LAST, created_at DESC
   LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'status', 'returning',
      'role', 'joiner',
      'session_id', v_session.id,
      'session_token', v_session.token,
      'guest_name', COALESCE(v_join.guest_name, v_name)
    );
  END IF;

  RETURN jsonb_build_object('status', 'join_required', 'session_id', v_session.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.guest_request_join(
  _table_number int,
  _qr_token text,
  _client_id text,
  _guest_name text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_table public.tables;
  v_session public.table_sessions;
  v_request public.session_join_requests;
  v_name text := COALESCE(nullif(left(trim(coalesce(_guest_name, '')), 80), ''), 'Guest');
BEGIN
  SELECT *
    INTO v_table
    FROM public.tables
   WHERE table_number = _table_number
     AND qr_token = _qr_token;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;

  SELECT *
    INTO v_session
    FROM public.table_sessions
   WHERE table_id = v_table.id
     AND is_active = true
   ORDER BY opened_at DESC
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_active');
  END IF;

  SELECT *
    INTO v_request
    FROM public.session_join_requests
   WHERE table_session_id = v_session.id
     AND client_id = _client_id
     AND status IN ('pending', 'approved')
   ORDER BY created_at DESC
   LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'status', v_request.status,
      'request_id', v_request.id,
      'session_id', v_session.id,
      'session_token', CASE WHEN v_request.status = 'approved' THEN v_session.token ELSE NULL END
    );
  END IF;

  INSERT INTO public.session_join_requests(table_session_id, guest_name, client_id, status)
  VALUES (v_session.id, v_name, _client_id, 'pending')
  RETURNING * INTO v_request;

  RETURN jsonb_build_object(
    'status', 'pending',
    'request_id', v_request.id,
    'session_id', v_session.id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.guest_get_join_request(
  _session_id uuid,
  _request_id uuid,
  _client_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request public.session_join_requests;
  v_session public.table_sessions;
BEGIN
  SELECT *
    INTO v_request
    FROM public.session_join_requests
   WHERE id = _request_id
     AND table_session_id = _session_id
     AND client_id = _client_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'missing');
  END IF;

  SELECT *
    INTO v_session
    FROM public.table_sessions
   WHERE id = v_request.table_session_id
     AND is_active = true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'expired');
  END IF;

  RETURN jsonb_build_object(
    'status', v_request.status,
    'session_id', v_session.id,
    'session_token', CASE WHEN v_request.status = 'approved' THEN v_session.token ELSE NULL END,
    'guest_name', v_request.guest_name
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.guest_auto_approve_join_request(
  _table_number int,
  _qr_token text,
  _session_id uuid,
  _request_id uuid,
  _client_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_table public.tables;
  v_session public.table_sessions;
  v_request public.session_join_requests;
BEGIN
  SELECT *
    INTO v_table
    FROM public.tables
   WHERE table_number = _table_number
     AND qr_token = _qr_token;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;

  SELECT *
    INTO v_session
    FROM public.table_sessions
   WHERE id = _session_id
     AND table_id = v_table.id
     AND is_active = true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'expired');
  END IF;

  UPDATE public.session_join_requests
     SET status = 'approved',
         resolved_by_name = 'auto'
   WHERE id = _request_id
     AND table_session_id = _session_id
     AND client_id = _client_id
     AND status = 'pending'
     AND created_at <= now() - interval '30 seconds'
   RETURNING * INTO v_request;

  IF NOT FOUND THEN
    RETURN public.guest_get_join_request(_session_id, _request_id, _client_id);
  END IF;

  RETURN jsonb_build_object(
    'status', 'approved',
    'session_id', v_session.id,
    'session_token', v_session.token,
    'guest_name', v_request.guest_name
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.guest_list_pending_join_requests(
  _session_id uuid,
  _session_token text,
  _client_id text
)
RETURNS TABLE(id uuid, guest_name text, client_id text, status text, created_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.assert_guest_session(_session_id, _session_token);

  RETURN QUERY
  SELECT r.id, r.guest_name, r.client_id, r.status, r.created_at
    FROM public.session_join_requests r
   WHERE r.table_session_id = _session_id
     AND r.status = 'pending'
     AND r.client_id IS DISTINCT FROM _client_id
   ORDER BY r.created_at ASC;
END;
$$;

CREATE OR REPLACE FUNCTION public.guest_resolve_join_request(
  _session_id uuid,
  _session_token text,
  _request_id uuid,
  _status text,
  _resolved_by_name text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request public.session_join_requests;
BEGIN
  PERFORM public.assert_guest_session(_session_id, _session_token);

  IF _status NOT IN ('approved', 'declined') THEN
    RAISE EXCEPTION 'Invalid join request status';
  END IF;

  UPDATE public.session_join_requests
     SET status = _status,
         resolved_by_name = nullif(left(trim(coalesce(_resolved_by_name, '')), 80), '')
   WHERE id = _request_id
     AND table_session_id = _session_id
     AND status = 'pending'
   RETURNING * INTO v_request;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'missing');
  END IF;

  RETURN jsonb_build_object('status', v_request.status, 'request_id', v_request.id);
END;
$$;

-- Kitchen/POS ticket queue.
CREATE TABLE IF NOT EXISTS public.order_ticket_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  ticket_type text NOT NULL DEFAULT 'kitchen',
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'exported', 'printed', 'failed', 'cancelled')),
  format text NOT NULL DEFAULT 'json'
    CHECK (format IN ('json', 'text', 'csv', 'escpos')),
  destination text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  exported_at timestamptz,
  printed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(order_id, ticket_type)
);

CREATE INDEX IF NOT EXISTS idx_order_ticket_events_status
  ON public.order_ticket_events(status, created_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_ticket_events TO authenticated;
GRANT ALL ON public.order_ticket_events TO service_role;

ALTER TABLE public.order_ticket_events ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.enqueue_order_ticket(
  _order_id uuid,
  _ticket_type text DEFAULT 'kitchen'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payload jsonb;
  v_ticket_id uuid;
BEGIN
  SELECT jsonb_build_object(
           'order_id', o.id,
           'created_at', o.created_at,
           'status', o.status,
           'payment_method', o.payment_method,
           'payment_status', o.payment_status,
           'guest_name', o.guest_name,
           'total', o.total,
           'table_number', t.table_number,
           'section_id', t.section_id,
           'items', COALESCE(
             (
               SELECT jsonb_agg(jsonb_build_object(
                        'id', oi.id,
                        'menu_item_id', oi.menu_item_id,
                        'name', mi.name,
                        'quantity', oi.quantity,
                        'notes', oi.notes,
                        'status', oi.status
                      ) ORDER BY oi.created_at ASC)
                 FROM public.order_items oi
                 JOIN public.menu_items mi ON mi.id = oi.menu_item_id
                WHERE oi.order_id = o.id
             ),
             '[]'::jsonb
           )
         )
    INTO v_payload
    FROM public.orders o
    JOIN public.table_sessions s ON s.id = o.table_session_id
    JOIN public.tables t ON t.id = s.table_id
   WHERE o.id = _order_id;

  IF v_payload IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  INSERT INTO public.order_ticket_events(order_id, ticket_type, status, format, payload)
  VALUES (_order_id, COALESCE(nullif(_ticket_type, ''), 'kitchen'), 'queued', 'json', v_payload)
  ON CONFLICT (order_id, ticket_type)
  DO UPDATE SET
    payload = EXCLUDED.payload,
    updated_at = now()
  RETURNING id INTO v_ticket_id;

  RETURN v_ticket_id;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_order_ticket(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_order_ticket(uuid, text) TO authenticated;

-- Monri payment attempt ledger. Edge Functions hold merchant credentials and
-- write status here after Monri create-payment responses and callbacks.
CREATE TABLE IF NOT EXISTS public.payment_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'monri',
  monri_payment_id text,
  monri_order_number text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'created'
    CHECK (status IN ('created', 'pending', 'approved', 'declined', 'cancelled', 'error', 'refunded')),
  amount_minor integer NOT NULL CHECK (amount_minor > 0),
  currency text NOT NULL DEFAULT 'BAM',
  transaction_type text NOT NULL DEFAULT 'purchase'
    CHECK (transaction_type IN ('purchase', 'authorize')),
  provider_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_transactions_order
  ON public.payment_transactions(order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_provider_id
  ON public.payment_transactions(provider, monri_payment_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_transactions TO authenticated;
GRANT ALL ON public.payment_transactions TO service_role;

ALTER TABLE public.payment_transactions ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.guest_place_order(
  _session_id uuid,
  _session_token text,
  _guest_name text,
  _payment_method text,
  _items jsonb
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
  v_total numeric(10,2);
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

  UPDATE public.table_sessions
     SET last_heartbeat_at = now()
   WHERE id = v_session.id;

  SELECT count(*)
    INTO v_order_count
    FROM public.orders
   WHERE table_session_id = v_session.id
     AND status <> 'cancelled';

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
    INTO v_total
    FROM requested r
    JOIN public.menu_items mi ON mi.id = r.menu_item_id AND mi.is_available = true;

  IF v_total IS NULL OR v_total <= 0 THEN
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

  INSERT INTO public.orders(table_session_id, total, status, guest_name, payment_method, payment_status)
  VALUES (
    v_session.id,
    v_total,
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
    'payment_method', v_order.payment_method,
    'payment_status', v_order.payment_status,
    'ticket_id', v_ticket_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.guest_call_waiter(
  _session_id uuid,
  _session_token text,
  _reason text DEFAULT 'assist'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session public.table_sessions;
  v_call public.waiter_calls;
  v_reason text := CASE WHEN _reason IN ('assist', 'pay') THEN _reason ELSE 'assist' END;
BEGIN
  v_session := public.assert_guest_session(_session_id, _session_token);

  UPDATE public.table_sessions
     SET last_heartbeat_at = now()
   WHERE id = v_session.id;

  INSERT INTO public.waiter_calls(table_session_id, reason)
  VALUES (v_session.id, v_reason)
  RETURNING * INTO v_call;

  RETURN jsonb_build_object('call_id', v_call.id, 'status', v_call.status);
END;
$$;

CREATE OR REPLACE FUNCTION public.guest_request_bill(
  _session_id uuid,
  _session_token text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session public.table_sessions;
  v_bill public.bill_requests;
BEGIN
  v_session := public.assert_guest_session(_session_id, _session_token);

  SELECT *
    INTO v_bill
    FROM public.bill_requests
   WHERE table_session_id = v_session.id
     AND status = 'pending'
   ORDER BY created_at DESC
   LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object('bill_request_id', v_bill.id, 'status', v_bill.status);
  END IF;

  INSERT INTO public.bill_requests(table_session_id)
  VALUES (v_session.id)
  RETURNING * INTO v_bill;

  RETURN jsonb_build_object('bill_request_id', v_bill.id, 'status', v_bill.status);
END;
$$;

CREATE OR REPLACE FUNCTION public.guest_get_tab(
  _session_id uuid,
  _session_token text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session public.table_sessions;
  v_orders jsonb;
  v_bill jsonb;
  v_members jsonb;
BEGIN
  v_session := public.assert_guest_session(_session_id, _session_token);

  SELECT COALESCE(jsonb_agg(
           jsonb_build_object(
             'id', o.id,
             'status', o.status,
             'total', o.total,
             'notes', o.notes,
             'guest_name', o.guest_name,
             'payment_method', o.payment_method,
             'payment_status', o.payment_status,
             'created_at', o.created_at,
             'order_items', COALESCE(
               (
                 SELECT jsonb_agg(jsonb_build_object(
                          'id', oi.id,
                          'quantity', oi.quantity,
                          'unit_price', oi.unit_price,
                          'notes', oi.notes,
                          'status', oi.status,
                          'menu_items', jsonb_build_object(
                            'name', mi.name,
                            'name_ar', mi.name_ar,
                            'name_bs', mi.name_bs
                          )
                        ) ORDER BY oi.created_at ASC)
                   FROM public.order_items oi
                   JOIN public.menu_items mi ON mi.id = oi.menu_item_id
                  WHERE oi.order_id = o.id
               ),
               '[]'::jsonb
             )
           )
           ORDER BY o.created_at DESC
         ), '[]'::jsonb)
    INTO v_orders
    FROM public.orders o
   WHERE o.table_session_id = v_session.id;

  SELECT to_jsonb(b)
    INTO v_bill
    FROM public.bill_requests b
   WHERE b.table_session_id = v_session.id
     AND b.status = 'pending'
   ORDER BY b.created_at DESC
   LIMIT 1;

  SELECT COALESCE(jsonb_agg(name), '[]'::jsonb)
    INTO v_members
    FROM (
      SELECT DISTINCT name
        FROM (
          SELECT v_session.guest_name AS name
          UNION ALL
          SELECT guest_name
            FROM public.session_join_requests
           WHERE table_session_id = v_session.id
             AND status = 'approved'
        ) n
       WHERE name IS NOT NULL AND trim(name) <> ''
    ) names;

  RETURN jsonb_build_object(
    'orders', v_orders,
    'bill_request', v_bill,
    'members', v_members
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.guest_get_waiter_for_review(
  _session_id uuid,
  _session_token text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session public.table_sessions;
  v_waiter jsonb;
BEGIN
  v_session := public.assert_guest_session(_session_id, _session_token);

  SELECT jsonb_build_object('id', w.id, 'display_name', w.display_name)
    INTO v_waiter
    FROM public.waiters w
   WHERE w.id = v_session.assigned_waiter_id
     AND w.is_active = true;

  RETURN COALESCE(v_waiter, 'null'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.guest_submit_visit_rating(
  _session_id uuid,
  _session_token text,
  _rating int
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session public.table_sessions;
  v_rating public.ratings;
BEGIN
  v_session := public.assert_guest_session(_session_id, _session_token);

  INSERT INTO public.ratings(table_session_id, rating)
  VALUES (v_session.id, _rating)
  RETURNING * INTO v_rating;

  RETURN jsonb_build_object('rating_id', v_rating.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.guest_submit_server_rating(
  _session_id uuid,
  _session_token text,
  _waiter_id uuid,
  _rating int,
  _comment text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session public.table_sessions;
  v_rating public.server_ratings;
BEGIN
  v_session := public.assert_guest_session(_session_id, _session_token);

  IF _waiter_id IS NULL OR _waiter_id IS DISTINCT FROM v_session.assigned_waiter_id THEN
    RAISE EXCEPTION 'Invalid waiter for this session';
  END IF;

  INSERT INTO public.server_ratings(table_session_id, waiter_id, rating, comment)
  VALUES (v_session.id, _waiter_id, _rating, nullif(left(trim(coalesce(_comment, '')), 500), ''))
  RETURNING * INTO v_rating;

  RETURN jsonb_build_object('rating_id', v_rating.id);
END;
$$;

REVOKE ALL ON FUNCTION public.guest_inspect_table(int, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guest_start_table_session(int, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guest_request_join(int, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guest_get_join_request(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guest_auto_approve_join_request(int, text, uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guest_list_pending_join_requests(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guest_resolve_join_request(uuid, text, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guest_place_order(uuid, text, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guest_call_waiter(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guest_request_bill(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guest_get_tab(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guest_get_waiter_for_review(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guest_submit_visit_rating(uuid, text, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guest_submit_server_rating(uuid, text, uuid, int, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.guest_inspect_table(int, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guest_start_table_session(int, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guest_request_join(int, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guest_get_join_request(uuid, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guest_auto_approve_join_request(int, text, uuid, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guest_list_pending_join_requests(uuid, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guest_resolve_join_request(uuid, text, uuid, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guest_place_order(uuid, text, text, text, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guest_call_waiter(uuid, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guest_request_bill(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guest_get_tab(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guest_get_waiter_for_review(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guest_submit_visit_rating(uuid, text, int) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guest_submit_server_rating(uuid, text, uuid, int, text) TO anon, authenticated;

-- Harden RLS policies.
DROP POLICY IF EXISTS "Anyone can view tables" ON public.tables;
DROP POLICY IF EXISTS "Admin/staff can manage tables" ON public.tables;
DROP POLICY IF EXISTS "Staff can manage tables" ON public.tables;
CREATE POLICY "Staff can manage tables"
  ON public.tables FOR ALL TO authenticated
  USING (public.is_staff_member())
  WITH CHECK (public.is_staff_member());

DROP POLICY IF EXISTS "Anyone can view active sessions" ON public.table_sessions;
DROP POLICY IF EXISTS "Anyone can create sessions" ON public.table_sessions;
DROP POLICY IF EXISTS "Sessions created for valid tables" ON public.table_sessions;
DROP POLICY IF EXISTS "Admin/staff can update sessions" ON public.table_sessions;
DROP POLICY IF EXISTS "Staff can manage table sessions" ON public.table_sessions;
CREATE POLICY "Staff can manage table sessions"
  ON public.table_sessions FOR ALL TO authenticated
  USING (public.is_staff_member())
  WITH CHECK (public.is_staff_member());

DROP POLICY IF EXISTS "Anyone can view orders" ON public.orders;
DROP POLICY IF EXISTS "Anyone can create orders" ON public.orders;
DROP POLICY IF EXISTS "Orders for active sessions only" ON public.orders;
DROP POLICY IF EXISTS "Admin/staff can update orders" ON public.orders;
DROP POLICY IF EXISTS "Admins can delete orders" ON public.orders;
DROP POLICY IF EXISTS "Staff can manage orders" ON public.orders;
CREATE POLICY "Staff can manage orders"
  ON public.orders FOR ALL TO authenticated
  USING (public.is_staff_member())
  WITH CHECK (public.is_staff_member());

DROP POLICY IF EXISTS "Anyone can view order items" ON public.order_items;
DROP POLICY IF EXISTS "Anyone can create order items" ON public.order_items;
DROP POLICY IF EXISTS "Order items for valid orders and items" ON public.order_items;
DROP POLICY IF EXISTS "Admin/staff can update order items" ON public.order_items;
DROP POLICY IF EXISTS "Admins can delete order items" ON public.order_items;
DROP POLICY IF EXISTS "Staff can manage order items" ON public.order_items;
CREATE POLICY "Staff can manage order items"
  ON public.order_items FOR ALL TO authenticated
  USING (public.is_staff_member())
  WITH CHECK (public.is_staff_member());

DROP POLICY IF EXISTS "Anyone can create waiter calls for active sessions" ON public.waiter_calls;
DROP POLICY IF EXISTS "Anyone can view waiter calls" ON public.waiter_calls;
DROP POLICY IF EXISTS "Admin/staff can update waiter calls" ON public.waiter_calls;
DROP POLICY IF EXISTS "Staff can manage waiter calls" ON public.waiter_calls;
CREATE POLICY "Staff can manage waiter calls"
  ON public.waiter_calls FOR ALL TO authenticated
  USING (public.is_staff_member())
  WITH CHECK (public.is_staff_member());

DROP POLICY IF EXISTS "Anyone can view bill requests" ON public.bill_requests;
DROP POLICY IF EXISTS "Anyone can create bill requests for active sessions" ON public.bill_requests;
DROP POLICY IF EXISTS "Admin/staff can update bill requests" ON public.bill_requests;
DROP POLICY IF EXISTS "Staff can manage bill requests" ON public.bill_requests;
CREATE POLICY "Staff can manage bill requests"
  ON public.bill_requests FOR ALL TO authenticated
  USING (public.is_staff_member())
  WITH CHECK (public.is_staff_member());

DROP POLICY IF EXISTS "Anyone can view join requests" ON public.session_join_requests;
DROP POLICY IF EXISTS "Anyone can create join requests for active sessions" ON public.session_join_requests;
DROP POLICY IF EXISTS "Anyone can resolve join requests for active sessions" ON public.session_join_requests;
DROP POLICY IF EXISTS "Staff manage join requests" ON public.session_join_requests;
DROP POLICY IF EXISTS "Staff can manage join requests" ON public.session_join_requests;
CREATE POLICY "Staff can manage join requests"
  ON public.session_join_requests FOR ALL TO authenticated
  USING (public.is_staff_member())
  WITH CHECK (public.is_staff_member());

DROP POLICY IF EXISTS "Anyone can view waiters" ON public.waiters;
DROP POLICY IF EXISTS "Admins manage waiters" ON public.waiters;
DROP POLICY IF EXISTS "Staff can view waiters" ON public.waiters;
DROP POLICY IF EXISTS "Admins can manage waiters" ON public.waiters;
CREATE POLICY "Staff can view waiters"
  ON public.waiters FOR SELECT TO authenticated
  USING (public.is_staff_member());
CREATE POLICY "Admins can manage waiters"
  ON public.waiters FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Anyone can view section assignments" ON public.section_assignments;
DROP POLICY IF EXISTS "Admins manage assignments" ON public.section_assignments;
DROP POLICY IF EXISTS "Staff can view section assignments" ON public.section_assignments;
DROP POLICY IF EXISTS "Admins can manage section assignments" ON public.section_assignments;
CREATE POLICY "Staff can view section assignments"
  ON public.section_assignments FOR SELECT TO authenticated
  USING (public.is_staff_member());
CREATE POLICY "Admins can manage section assignments"
  ON public.section_assignments FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Anyone can create ratings" ON public.ratings;
DROP POLICY IF EXISTS "Admin can view ratings" ON public.ratings;
DROP POLICY IF EXISTS "Staff can view ratings" ON public.ratings;
CREATE POLICY "Staff can view ratings"
  ON public.ratings FOR SELECT TO authenticated
  USING (public.is_staff_member());

DROP POLICY IF EXISTS "Anyone can submit server rating for active session" ON public.server_ratings;
DROP POLICY IF EXISTS "Admins/staff view server ratings" ON public.server_ratings;
DROP POLICY IF EXISTS "Staff can view server ratings" ON public.server_ratings;
CREATE POLICY "Staff can view server ratings"
  ON public.server_ratings FOR SELECT TO authenticated
  USING (public.is_staff_member());

DROP POLICY IF EXISTS "Staff can manage ticket events" ON public.order_ticket_events;
CREATE POLICY "Staff can manage ticket events"
  ON public.order_ticket_events FOR ALL TO authenticated
  USING (public.is_staff_member())
  WITH CHECK (public.is_staff_member());

DROP POLICY IF EXISTS "Staff can view payment transactions" ON public.payment_transactions;
DROP POLICY IF EXISTS "Admins can manage payment transactions" ON public.payment_transactions;
CREATE POLICY "Staff can view payment transactions"
  ON public.payment_transactions FOR SELECT TO authenticated
  USING (public.is_staff_member());
CREATE POLICY "Admins can manage payment transactions"
  ON public.payment_transactions FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

REVOKE SELECT, INSERT, UPDATE, DELETE ON
  public.tables,
  public.table_sessions,
  public.orders,
  public.order_items,
  public.waiter_calls,
  public.bill_requests,
  public.session_join_requests,
  public.ratings,
  public.server_ratings,
  public.section_assignments,
  public.order_ticket_events,
  public.payment_transactions
FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.tables,
  public.table_sessions,
  public.orders,
  public.order_items,
  public.waiter_calls,
  public.bill_requests,
  public.session_join_requests,
  public.ratings,
  public.server_ratings,
  public.section_assignments,
  public.order_ticket_events,
  public.payment_transactions
TO authenticated;