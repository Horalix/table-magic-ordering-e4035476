-- =====================================================================
-- NOTE ON THIS FILENAME
--
-- Applied to the live database under this timestamp by the Lovable Supabase
-- integration, which copied the migration rather than running the original.
-- The filename is kept because it is what `supabase_migrations.schema_migrations`
-- records; renaming it would make a future `supabase db push` try to apply the
-- same schema a second time.
--
-- The body below is the original, restored — Lovable's copy dropped the
-- comments, and several of them document invariants that are not visible from
-- the SQL (statement ordering that prevents trigger recursion, why the all-day
-- ids come back split, why a print claim is not a print). Any GRANT or RLS
-- statement Lovable added is preserved at the end.
-- =====================================================================

-- =====================================================================
-- Monri callback ledger + staff financial operations.
--
-- Everything here runs as SECURITY DEFINER and is the ONLY way money state
-- changes. The Edge Functions call these RPCs with the service role; they no
-- longer write orders/payment_transactions directly (the integrity trigger
-- from 20260731090100 would reject them anyway).
-- =====================================================================

-- =====================================================================
-- 1. Payment attempt ledger — richer status + amount linkage
-- =====================================================================

ALTER TABLE public.payment_transactions
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS failure_reason text,
  ADD COLUMN IF NOT EXISTS refunded_minor integer NOT NULL DEFAULT 0 CHECK (refunded_minor >= 0);

CREATE INDEX IF NOT EXISTS idx_payment_transactions_status
  ON public.payment_transactions(status, created_at DESC);

/**
 * Every callback we have ever accepted, keyed by a deterministic hash of the
 * raw body. A provider retry hashes identically and is rejected as a replay
 * before it can produce a second side effect.
 */
CREATE TABLE IF NOT EXISTS public.payment_callback_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'monri',
  event_hash text NOT NULL,
  monri_order_number text,
  payment_transaction_id uuid REFERENCES public.payment_transactions(id) ON DELETE SET NULL,
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  normalized_status text,
  amount_minor integer,
  currency text,
  outcome text NOT NULL,
  detail text,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, event_hash)
);

CREATE INDEX IF NOT EXISTS idx_payment_callback_events_order
  ON public.payment_callback_events(order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_callback_events_outcome
  ON public.payment_callback_events(outcome, created_at DESC);

ALTER TABLE public.payment_callback_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read callback events" ON public.payment_callback_events;
CREATE POLICY "Admins read callback events"
  ON public.payment_callback_events FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

REVOKE ALL ON public.payment_callback_events FROM anon;
GRANT SELECT ON public.payment_callback_events TO authenticated;

-- =====================================================================
-- 2. Attempt registration — idempotent per (order, amount)
-- =====================================================================

/**
 * Reserve a payment attempt for an order.
 *
 * If a live attempt (created/pending) already exists for the same order AND
 * the same amount, it is returned unchanged — a double-tapped Pay button, a
 * refresh, or a retried network call all land on the same Monri order number
 * instead of creating a second chargeable attempt.
 *
 * Returns { status, reuse, payment_transaction_id, monri_order_number, amount_minor }
 */
CREATE OR REPLACE FUNCTION public.monri_register_attempt(
  _order_id uuid,
  _session_id uuid,
  _session_token text,
  _currency text DEFAULT 'BAM',
  _transaction_type text DEFAULT 'purchase'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders;
  v_session public.table_sessions;
  v_existing public.payment_transactions;
  v_amount_minor int;
  v_currency text := upper(COALESCE(nullif(trim(_currency), ''), 'BAM'));
  v_type text := CASE WHEN _transaction_type = 'authorize' THEN 'authorize' ELSE 'purchase' END;
  v_number text;
  v_id uuid;
BEGIN
  IF NOT public.online_card_payments_enabled() THEN
    RETURN jsonb_build_object('status', 'card_disabled');
  END IF;

  SELECT * INTO v_session
    FROM public.table_sessions
   WHERE id = _session_id AND token = _session_token AND is_active = true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'invalid_session');
  END IF;

  SELECT * INTO v_order
    FROM public.orders
   WHERE id = _order_id AND table_session_id = v_session.id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'order_not_found');
  END IF;

  IF v_order.payment_status = 'paid' THEN
    RETURN jsonb_build_object('status', 'already_paid');
  END IF;

  IF v_order.status NOT IN ('awaiting_payment', 'payment_failed') THEN
    RETURN jsonb_build_object('status', 'not_payable', 'order_status', v_order.status);
  END IF;

  v_amount_minor := round(v_order.total * 100)::int;
  IF v_amount_minor IS NULL OR v_amount_minor <= 0 THEN
    RETURN jsonb_build_object('status', 'invalid_amount');
  END IF;

  SELECT * INTO v_existing
    FROM public.payment_transactions
   WHERE order_id = v_order.id
     AND status IN ('created', 'pending')
     AND amount_minor = v_amount_minor
     AND currency = v_currency
   ORDER BY created_at DESC
   LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'status', 'ok',
      'reuse', true,
      'payment_transaction_id', v_existing.id,
      'monri_order_number', v_existing.monri_order_number,
      'amount_minor', v_existing.amount_minor,
      'currency', v_existing.currency,
      'provider_payload', v_existing.provider_payload
    );
  END IF;

  -- Any stale live attempt at a different amount is void: the order changed.
  UPDATE public.payment_transactions
     SET status = 'cancelled',
         failure_reason = 'superseded by a new amount',
         updated_at = now()
   WHERE order_id = v_order.id AND status IN ('created', 'pending');

  v_number := 'LS-' || upper(substr(replace(v_order.id::text, '-', ''), 1, 8))
              || '-' || to_char(now(), 'YYYYMMDDHH24MISS');

  INSERT INTO public.payment_transactions(
    order_id, monri_order_number, amount_minor, currency, transaction_type, status
  )
  VALUES (v_order.id, v_number, v_amount_minor, v_currency, v_type, 'created')
  RETURNING id INTO v_id;

  PERFORM public.write_audit('payment.attempt_created', 'order', v_order.id, NULL,
    jsonb_build_object('payment_transaction_id', v_id, 'amount_minor', v_amount_minor, 'currency', v_currency),
    NULL, 'monri');

  RETURN jsonb_build_object(
    'status', 'ok',
    'reuse', false,
    'payment_transaction_id', v_id,
    'monri_order_number', v_number,
    'amount_minor', v_amount_minor,
    'currency', v_currency
  );
END;
$$;

REVOKE ALL ON FUNCTION public.monri_register_attempt(uuid, uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.monri_register_attempt(uuid, uuid, text, text, text) TO service_role;

/** Record what the provider said when we created the payment. */
CREATE OR REPLACE FUNCTION public.monri_record_attempt_response(
  _payment_transaction_id uuid,
  _ok boolean,
  _monri_payment_id text,
  _payload jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.payment_transactions
     SET status = CASE WHEN _ok THEN 'pending' ELSE 'error' END,
         monri_payment_id = COALESCE(_monri_payment_id, monri_payment_id),
         provider_payload = COALESCE(_payload, '{}'::jsonb),
         failure_reason = CASE WHEN _ok THEN NULL ELSE left(COALESCE(_payload->>'message', 'provider error'), 500) END,
         updated_at = now()
   WHERE id = _payment_transaction_id
     AND status IN ('created', 'pending');
END;
$$;

REVOKE ALL ON FUNCTION public.monri_record_attempt_response(uuid, boolean, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.monri_record_attempt_response(uuid, boolean, text, jsonb) TO service_role;

-- =====================================================================
-- 3. Callback application — verify, de-duplicate, release exactly once
-- =====================================================================

/** created → pending → approved → refunded. declined/cancelled/error terminal. */
CREATE OR REPLACE FUNCTION public.payment_status_rank(_status text)
RETURNS int
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE _status
    WHEN 'created'   THEN 0
    WHEN 'pending'   THEN 1
    WHEN 'declined'  THEN 2
    WHEN 'cancelled' THEN 2
    WHEN 'error'     THEN 2
    WHEN 'approved'  THEN 3
    WHEN 'refunded'  THEN 4
    ELSE -1
  END;
$$;

/**
 * Apply one verified provider callback.
 *
 * The Edge Function has already checked the signature. This function owns
 * everything that can go wrong afterwards:
 *   - replay          → the (provider, event_hash) unique index rejects it
 *   - wrong amount    → recorded as amount_mismatch, order NOT released
 *   - wrong currency  → recorded as currency_mismatch, order NOT released
 *   - out-of-order    → a lower-ranked status never overwrites a higher one
 *   - duplicate approve → release_order_to_kitchen() is a no-op the second time
 *
 * Returns { outcome, released, order_id, order_code, ... }.
 */
CREATE OR REPLACE FUNCTION public.monri_apply_callback(
  _event_hash text,
  _monri_order_number text,
  _monri_payment_id text,
  _normalized_status text,
  _amount_minor int,
  _currency text,
  _raw jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tx public.payment_transactions;
  v_order public.orders;
  v_outcome text;
  v_detail text;
  v_released boolean := false;
  v_currency text := upper(COALESCE(nullif(trim(_currency), ''), ''));
  v_new_payment_status text;
BEGIN
  IF _event_hash IS NULL OR _event_hash = '' THEN
    RAISE EXCEPTION 'event_hash is required';
  END IF;

  -- Replay guard. Reserve the hash first; a duplicate raises unique_violation.
  BEGIN
    INSERT INTO public.payment_callback_events(
      event_hash, monri_order_number, normalized_status, amount_minor, currency, outcome, raw_payload
    )
    VALUES (_event_hash, _monri_order_number, _normalized_status, _amount_minor, v_currency, 'processing', COALESCE(_raw, '{}'::jsonb));
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('outcome', 'duplicate', 'released', false);
  END;

  SELECT * INTO v_tx
    FROM public.payment_transactions
   WHERE monri_order_number = _monri_order_number;

  IF NOT FOUND THEN
    UPDATE public.payment_callback_events
       SET outcome = 'unknown_transaction'
     WHERE event_hash = _event_hash AND provider = 'monri';
    RETURN jsonb_build_object('outcome', 'unknown_transaction', 'released', false);
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = v_tx.order_id;

  -- --- Verification: the money must match what we asked for. ---
  IF _normalized_status = 'approved' THEN
    IF _amount_minor IS DISTINCT FROM v_tx.amount_minor THEN
      v_outcome := 'amount_mismatch';
      v_detail := format('expected %s, callback %s', v_tx.amount_minor, COALESCE(_amount_minor::text, 'null'));
    ELSIF v_currency <> v_tx.currency THEN
      v_outcome := 'currency_mismatch';
      v_detail := format('expected %s, callback %s', v_tx.currency, COALESCE(nullif(v_currency, ''), 'null'));
    END IF;

    IF v_outcome IS NOT NULL THEN
      UPDATE public.payment_transactions
         SET status = 'error',
             failure_reason = v_outcome || ': ' || v_detail,
             provider_payload = COALESCE(_raw, '{}'::jsonb),
             updated_at = now()
       WHERE id = v_tx.id;

      UPDATE public.payment_callback_events
         SET outcome = v_outcome, detail = v_detail,
             payment_transaction_id = v_tx.id, order_id = v_tx.order_id
       WHERE event_hash = _event_hash AND provider = 'monri';

      PERFORM public.write_audit('payment.callback_rejected', 'order', v_tx.order_id,
        to_jsonb(v_tx), COALESCE(_raw, '{}'::jsonb), v_outcome || ': ' || v_detail, 'monri');

      -- Explicitly NOT released. The guest sees "confirmation delayed"; staff
      -- see the order in the payment-problem queue.
      RETURN jsonb_build_object('outcome', v_outcome, 'detail', v_detail, 'released', false);
    END IF;
  END IF;

  -- --- Monotonic status: never move backwards. ---
  IF public.payment_status_rank(_normalized_status) <= public.payment_status_rank(v_tx.status)
     AND _normalized_status <> v_tx.status
  THEN
    UPDATE public.payment_callback_events
       SET outcome = 'stale_status',
           detail = format('%s after %s', _normalized_status, v_tx.status),
           payment_transaction_id = v_tx.id, order_id = v_tx.order_id
     WHERE event_hash = _event_hash AND provider = 'monri';
    RETURN jsonb_build_object('outcome', 'stale_status', 'released', false);
  END IF;

  UPDATE public.payment_transactions
     SET status = _normalized_status,
         monri_payment_id = COALESCE(_monri_payment_id, monri_payment_id),
         provider_payload = COALESCE(_raw, provider_payload),
         approved_at = CASE WHEN _normalized_status = 'approved' THEN COALESCE(approved_at, now()) ELSE approved_at END,
         failure_reason = CASE WHEN _normalized_status IN ('declined', 'cancelled', 'error')
                               THEN left(COALESCE(_raw->>'response_message', _raw->>'message', _normalized_status), 500)
                               ELSE failure_reason END,
         updated_at = now()
   WHERE id = v_tx.id;

  v_new_payment_status := CASE _normalized_status
    WHEN 'approved'  THEN 'paid'
    WHEN 'refunded'  THEN 'refunded'
    WHEN 'declined'  THEN 'failed'
    WHEN 'cancelled' THEN 'failed'
    WHEN 'error'     THEN 'failed'
    ELSE 'pending'
  END;

  PERFORM set_config('lasoul.financial_ctx', 'on', true);

  UPDATE public.orders
     SET payment_status = v_new_payment_status,
         paid_at = CASE WHEN _normalized_status = 'approved' THEN COALESCE(paid_at, now()) ELSE paid_at END
   WHERE id = v_tx.order_id;

  IF _normalized_status = 'approved' THEN
    v_released := public.release_order_to_kitchen(v_tx.order_id);
    v_outcome := CASE WHEN v_released THEN 'approved_released' ELSE 'approved_already_released' END;
  ELSIF _normalized_status IN ('declined', 'cancelled', 'error') THEN
    -- Park the order out of the kitchen's way; the guest can retry or switch.
    PERFORM set_config('lasoul.financial_ctx', 'on', true);
    UPDATE public.orders
       SET status = 'payment_failed'
     WHERE id = v_tx.order_id
       AND status = 'awaiting_payment';
    v_outcome := 'payment_failed';
  ELSE
    v_outcome := 'pending';
  END IF;

  UPDATE public.payment_callback_events
     SET outcome = v_outcome,
         payment_transaction_id = v_tx.id,
         order_id = v_tx.order_id
   WHERE event_hash = _event_hash AND provider = 'monri';

  PERFORM public.write_audit('payment.callback_applied', 'order', v_tx.order_id, NULL,
    jsonb_build_object('status', _normalized_status, 'outcome', v_outcome, 'released', v_released),
    NULL, 'monri');

  SELECT * INTO v_order FROM public.orders WHERE id = v_tx.order_id;

  RETURN jsonb_build_object(
    'outcome', v_outcome,
    'released', v_released,
    'order_id', v_tx.order_id,
    'order_code', v_order.order_code,
    'payment_status', v_order.payment_status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.monri_apply_callback(text, text, text, text, int, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.monri_apply_callback(text, text, text, text, int, text, jsonb) TO service_role;

-- =====================================================================
-- 4. Staff financial operations
-- =====================================================================

/**
 * Record that the table paid in person.
 *
 * `_method` distinguishes cash from the physical Monri POS terminal — the two
 * reconcile against different things at close of day, so the system refuses to
 * collapse them into one "paid" state.
 */
CREATE OR REPLACE FUNCTION public.record_table_payment(
  _order_id uuid,
  _method text,
  _note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders;
  v_method text;
BEGIN
  IF NOT public.is_staff_member() THEN
    RAISE EXCEPTION 'Only staff can record a payment' USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_method := CASE WHEN _method IN ('cash', 'pos_terminal') THEN _method ELSE NULL END;
  IF v_method IS NULL THEN
    RAISE EXCEPTION 'Payment method must be cash or pos_terminal';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = _order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  IF v_order.payment_status = 'paid' THEN
    RETURN jsonb_build_object('status', 'already_paid', 'payment_method', v_order.payment_method);
  END IF;

  IF v_order.payment_method = 'card_online'
     AND EXISTS (SELECT 1 FROM public.payment_transactions
                  WHERE order_id = v_order.id AND status IN ('pending', 'approved'))
  THEN
    RAISE EXCEPTION 'An online card payment is still in flight for this order — resolve it first';
  END IF;

  PERFORM set_config('lasoul.financial_ctx', 'on', true);

  UPDATE public.orders
     SET payment_method = v_method,
         payment_status = 'paid',
         paid_at = now(),
         paid_by = auth.uid(),
         payment_note = nullif(left(trim(coalesce(_note, '')), 300), '')
   WHERE id = _order_id;

  -- A card order that was never paid online still needs to reach the kitchen
  -- if the guest ended up paying at the table.
  PERFORM public.release_order_to_kitchen(_order_id);

  PERFORM public.write_audit(
    CASE v_method WHEN 'cash' THEN 'payment.recorded_cash' ELSE 'payment.recorded_pos_terminal' END,
    'order', _order_id, to_jsonb(v_order),
    jsonb_build_object('payment_method', v_method, 'total', v_order.total), _note);

  RETURN jsonb_build_object('status', 'paid', 'payment_method', v_method, 'total', v_order.total);
END;
$$;

REVOKE ALL ON FUNCTION public.record_table_payment(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_table_payment(uuid, text, text) TO authenticated;

/** Validated status move for staff clients (kitchen / waiter / admin). */
CREATE OR REPLACE FUNCTION public.staff_update_order_status(
  _order_id uuid,
  _status public.order_status
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders;
BEGIN
  IF NOT public.is_staff_member() THEN
    RAISE EXCEPTION 'Only staff can change an order status' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = _order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  IF _status IN ('awaiting_payment', 'payment_failed') THEN
    RAISE EXCEPTION 'Payment states are set by the payment system, not by staff';
  END IF;

  IF v_order.status IN ('awaiting_payment', 'payment_failed') THEN
    RAISE EXCEPTION 'This order has not been paid for yet — it is not in the kitchen';
  END IF;

  IF NOT public.order_transition_allowed(v_order.status, _status) THEN
    RAISE EXCEPTION 'Cannot move an order from % to %', v_order.status, _status
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.orders SET status = _status WHERE id = _order_id;

  PERFORM public.write_audit('order.status_changed', 'order', _order_id,
    jsonb_build_object('status', v_order.status), jsonb_build_object('status', _status));

  RETURN jsonb_build_object('status', _status);
END;
$$;

REVOKE ALL ON FUNCTION public.staff_update_order_status(uuid, public.order_status) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_update_order_status(uuid, public.order_status) TO authenticated;

/** Cancel an order with a recorded reason. Admin-only once food is being made. */
CREATE OR REPLACE FUNCTION public.cancel_order(
  _order_id uuid,
  _reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders;
  v_is_admin boolean := public.has_role(auth.uid(), 'admin'::public.app_role);
BEGIN
  IF NOT public.is_staff_member() THEN
    RAISE EXCEPTION 'Only staff can cancel an order' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF nullif(trim(coalesce(_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'A cancellation reason is required';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = _order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  IF v_order.status = 'cancelled' THEN
    RETURN jsonb_build_object('status', 'already_cancelled');
  END IF;

  -- Once the kitchen has started, or money has moved, a manager must decide.
  IF NOT v_is_admin AND (v_order.status IN ('preparing', 'ready', 'served') OR v_order.payment_status = 'paid') THEN
    RAISE EXCEPTION 'A manager must cancel an order that is in production or already paid'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  PERFORM set_config('lasoul.financial_ctx', 'on', true);

  UPDATE public.orders
     SET status = 'cancelled',
         cancelled_at = now(),
         cancelled_by = auth.uid(),
         cancel_reason = left(trim(_reason), 500)
   WHERE id = _order_id;

  UPDATE public.order_ticket_events
     SET status = 'cancelled', updated_at = now()
   WHERE order_id = _order_id AND status IN ('queued', 'exported');

  PERFORM public.write_audit('order.cancelled', 'order', _order_id,
    to_jsonb(v_order), jsonb_build_object('status', 'cancelled'), _reason);

  RETURN jsonb_build_object('status', 'cancelled',
    'requires_refund', v_order.payment_status = 'paid',
    'total', v_order.total);
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_order(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_order(uuid, text) TO authenticated;

-- =====================================================================
-- 5. Refunds — recorded internally; the provider call stays gated
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.order_refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  payment_transaction_id uuid REFERENCES public.payment_transactions(id) ON DELETE SET NULL,
  amount numeric(10,2) NOT NULL CHECK (amount > 0),
  method text NOT NULL CHECK (method IN ('card_online', 'cash', 'pos_terminal')),
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested', 'completed', 'failed', 'cancelled')),
  provider_reference text,
  failure_reason text,
  requested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  completed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_order_refunds_order ON public.order_refunds(order_id, created_at DESC);

ALTER TABLE public.order_refunds ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage refunds" ON public.order_refunds;
CREATE POLICY "Admins manage refunds"
  ON public.order_refunds FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

REVOKE ALL ON public.order_refunds FROM anon;
GRANT SELECT ON public.order_refunds TO authenticated;

/**
 * Record a refund. Admin-only.
 *
 * For cash/POS refunds this is the complete record (the money moves in the
 * room). For card_online it records the intent — the provider call is a
 * separate, deliberately gated step, because refunding through Monri requires
 * production credentials that do not exist yet. See docs/monri-go-live.md.
 */
CREATE OR REPLACE FUNCTION public.record_order_refund(
  _order_id uuid,
  _amount numeric,
  _method text,
  _reason text,
  _mark_completed boolean DEFAULT false,
  _provider_reference text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders;
  v_amount numeric(10,2) := round(COALESCE(_amount, 0)::numeric, 2);
  v_refundable numeric(10,2);
  v_method text := CASE WHEN _method IN ('card_online', 'cash', 'pos_terminal') THEN _method ELSE NULL END;
  v_id uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only a manager can refund an order' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_method IS NULL THEN RAISE EXCEPTION 'Invalid refund method'; END IF;
  IF nullif(trim(coalesce(_reason, '')), '') IS NULL THEN RAISE EXCEPTION 'A refund reason is required'; END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = _order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;

  IF v_order.payment_status NOT IN ('paid', 'partially_refunded') THEN
    RAISE EXCEPTION 'Only a paid order can be refunded';
  END IF;

  v_refundable := v_order.total - v_order.refunded_amount;
  IF v_amount <= 0 OR v_amount > v_refundable THEN
    RAISE EXCEPTION 'Refund must be between 0 and % KM', v_refundable;
  END IF;

  INSERT INTO public.order_refunds(order_id, amount, method, reason, status, provider_reference, requested_by, completed_by, completed_at)
  VALUES (_order_id, v_amount, v_method, left(trim(_reason), 500),
          CASE WHEN _mark_completed THEN 'completed' ELSE 'requested' END,
          nullif(trim(coalesce(_provider_reference, '')), ''),
          auth.uid(),
          CASE WHEN _mark_completed THEN auth.uid() ELSE NULL END,
          CASE WHEN _mark_completed THEN now() ELSE NULL END)
  RETURNING id INTO v_id;

  IF _mark_completed THEN
    PERFORM set_config('lasoul.financial_ctx', 'on', true);
    UPDATE public.orders
       SET refunded_amount = refunded_amount + v_amount,
           payment_status = CASE WHEN refunded_amount + v_amount >= total THEN 'refunded' ELSE 'partially_refunded' END
     WHERE id = _order_id;
  END IF;

  PERFORM public.write_audit(
    CASE WHEN _mark_completed THEN 'refund.completed' ELSE 'refund.requested' END,
    'order', _order_id, to_jsonb(v_order),
    jsonb_build_object('refund_id', v_id, 'amount', v_amount, 'method', v_method), _reason);

  RETURN jsonb_build_object('refund_id', v_id, 'amount', v_amount,
    'status', CASE WHEN _mark_completed THEN 'completed' ELSE 'requested' END);
END;
$$;

REVOKE ALL ON FUNCTION public.record_order_refund(uuid, numeric, text, text, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_order_refund(uuid, numeric, text, text, boolean, text) TO authenticated;

-- =====================================================================
-- 6. Fiscalization — status, actor, receipt reference, failure
-- =====================================================================

CREATE OR REPLACE FUNCTION public.set_order_fiscalization(
  _order_id uuid,
  _status text,
  _receipt_number text DEFAULT NULL,
  _provider_reference text DEFAULT NULL,
  _error text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders;
  v_status text := CASE WHEN _status IN ('not_fiscalized', 'fiscalized', 'failed') THEN _status ELSE NULL END;
BEGIN
  IF NOT public.is_staff_member() THEN
    RAISE EXCEPTION 'Only staff can record fiscalization' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_status IS NULL THEN RAISE EXCEPTION 'Invalid fiscalization status'; END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = _order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;

  PERFORM set_config('lasoul.financial_ctx', 'on', true);

  UPDATE public.orders
     SET fiscalization_status = v_status,
         fiscalized = (v_status = 'fiscalized'),
         fiscalized_at = CASE WHEN v_status = 'fiscalized' THEN now() ELSE NULL END,
         fiscalized_by = CASE WHEN v_status = 'fiscalized' THEN auth.uid() ELSE NULL END,
         fiscal_receipt_number = nullif(trim(coalesce(_receipt_number, '')), ''),
         fiscal_provider_reference = nullif(trim(coalesce(_provider_reference, '')), ''),
         fiscalization_error = CASE WHEN v_status = 'failed'
                                    THEN nullif(left(trim(coalesce(_error, '')), 500), '') END
   WHERE id = _order_id;

  PERFORM public.write_audit('order.fiscalization_set', 'order', _order_id,
    jsonb_build_object('fiscalization_status', v_order.fiscalization_status),
    jsonb_build_object('fiscalization_status', v_status, 'receipt', _receipt_number));

  RETURN jsonb_build_object('fiscalization_status', v_status);
END;
$$;

REVOKE ALL ON FUNCTION public.set_order_fiscalization(uuid, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_order_fiscalization(uuid, text, text, text, text) TO authenticated;

-- =====================================================================
-- 7. Printing — one ticket, one print, claimed atomically
-- =====================================================================

ALTER TABLE public.order_ticket_events
  ADD COLUMN IF NOT EXISTS claimed_by_device text,
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz;

/**
 * Atomically claim a queued ticket for printing.
 *
 * Returns true only for the caller that won the claim, so two kitchen devices
 * (or a page reload inside the 60-second auto-print window) cannot both print
 * the same ticket. A device that fails to print calls report_ticket_print with
 * ok=false, which returns the ticket to the queue and surfaces a Reprint.
 */
CREATE OR REPLACE FUNCTION public.claim_ticket_print(
  _order_id uuid,
  _device_id text,
  _ticket_type text DEFAULT 'kitchen'
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows int := 0;
BEGIN
  IF NOT public.is_staff_member() THEN
    RAISE EXCEPTION 'Only staff can print tickets' USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE public.order_ticket_events
     SET status = 'printed',
         printed_at = now(),
         claimed_by_device = left(coalesce(_device_id, 'unknown'), 80),
         claimed_at = now(),
         attempts = attempts + 1,
         updated_at = now()
   WHERE order_id = _order_id
     AND ticket_type = COALESCE(nullif(_ticket_type, ''), 'kitchen')
     AND status IN ('queued', 'failed');

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_ticket_print(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_ticket_print(uuid, text, text) TO authenticated;

/** Report the outcome of a claimed print; failure re-queues it visibly. */
CREATE OR REPLACE FUNCTION public.report_ticket_print(
  _order_id uuid,
  _ok boolean,
  _error text DEFAULT NULL,
  _ticket_type text DEFAULT 'kitchen'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_staff_member() THEN
    RAISE EXCEPTION 'Only staff can report a print' USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE public.order_ticket_events
     SET status = CASE WHEN _ok THEN 'printed' ELSE 'failed' END,
         printed_at = CASE WHEN _ok THEN now() ELSE NULL END,
         last_error = CASE WHEN _ok THEN NULL ELSE left(coalesce(_error, 'print failed'), 300) END,
         updated_at = now()
   WHERE order_id = _order_id
     AND ticket_type = COALESCE(nullif(_ticket_type, ''), 'kitchen');
END;
$$;

REVOKE ALL ON FUNCTION public.report_ticket_print(uuid, boolean, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_ticket_print(uuid, boolean, text, text) TO authenticated;

/** Put a ticket back in the queue so it prints again (staff-initiated). */
CREATE OR REPLACE FUNCTION public.requeue_ticket_print(_order_id uuid, _ticket_type text DEFAULT 'kitchen')
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_rows int := 0;
BEGIN
  IF NOT public.is_staff_member() THEN
    RAISE EXCEPTION 'Only staff can reprint' USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE public.order_ticket_events
     SET status = 'queued', printed_at = NULL, claimed_by_device = NULL, claimed_at = NULL, updated_at = now()
   WHERE order_id = _order_id AND ticket_type = COALESCE(nullif(_ticket_type, ''), 'kitchen');

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  PERFORM public.write_audit('ticket.reprint_requested', 'order', _order_id);
  RETURN v_rows > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.requeue_ticket_print(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.requeue_ticket_print(uuid, text) TO authenticated;

-- Realtime so a ticket claim reaches every kitchen device immediately.
DO $$ BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.order_ticket_events; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

-- ---------------------------------------------------------------------
-- Added by the Lovable integration when this was applied. Kept so the
-- file matches what is actually live.
-- ---------------------------------------------------------------------
alter table public.order_code_counters enable row level security;
grant all on public.order_code_counters to service_role;
grant all on public.order_refunds to service_role;
grant all on public.payment_callback_events to service_role;
revoke all on public.order_code_counters from anon, authenticated;
