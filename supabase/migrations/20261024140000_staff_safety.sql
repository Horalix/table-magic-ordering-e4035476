-- =====================================================================
-- Staff safety: a table cannot be freed while it owes money, and a refunded
-- order cannot be marked paid again
--
-- Found in the October staff-screen audit. Both are the same shape of bug: a
-- single tap on a staff screen could make money disappear from the books, and
-- the database — the only place that sees every screen — did not object.
--
-- 1. FREEING A TABLE THAT STILL OWES
--
--    Three screens freed a table with a plain UPDATE on table_sessions: the
--    kitchen's bill-request tick, the waiter phone's "Free table" and the admin
--    Tables page. None of them looked at the bill. A closed session is a table
--    nobody looks at again, so an unpaid order behind it is simply lost — it
--    does not show on the floor, the waiter phone or the kitchen, and it only
--    surfaces at close of day as an "outstanding" figure with no table to walk
--    to. `staff_close_session` is now the one way to free a table, and it
--    refuses, with the amount, while anything is owed.
--
--    `staff_resolve_bill_request(_, true)` already refused, but counted every
--    order not marked `paid` as owed — including refunded ones, which were
--    paid and then given back. It now asks the same function, so there is one
--    definition of "owes money".
--
-- 2. PAYING A REFUNDED ORDER AGAIN
--
--    `record_table_payment` only refused `paid`. After a refund the order is
--    `refunded` or `partially_refunded`, so the Paid buttons reappeared on every
--    screen and a tap recorded the same money a second time — inflating the
--    expected drawer by exactly the amount that had just been handed back.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Freeing a table
-- ---------------------------------------------------------------------

/**
 * What a seated table still owes.
 *
 * Counted: orders that reached the kitchen (or will — `pending` onwards) and
 * are not settled. Not counted: cancelled orders, card orders still waiting for
 * or refused by the payment provider (the kitchen never saw them, so there is
 * nothing to collect), orders that were paid and later refunded, and zero-total
 * orders, which would otherwise pin a comped table open forever.
 */
CREATE OR REPLACE FUNCTION public.session_outstanding(_session_id uuid)
RETURNS TABLE(outstanding numeric, unpaid_orders int)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(sum(o.total), 0)::numeric, count(*)::int
    FROM public.orders o
   WHERE o.table_session_id = _session_id
     AND o.status NOT IN ('cancelled', 'awaiting_payment', 'payment_failed')
     AND o.payment_status NOT IN ('paid', 'refunded', 'partially_refunded')
     AND o.total > 0;
$$;

REVOKE ALL ON FUNCTION public.session_outstanding(uuid) FROM PUBLIC, anon, authenticated;

/**
 * Free a table — the guests have gone.
 *
 * Refuses while money is owed and says how much, so the screen can tell the
 * waiter "Table 7 still owes 24.00 KM" instead of quietly hiding the order.
 * Closing also clears any call or bill request still open on the session: a
 * table that has left cannot still be waving.
 *
 * Idempotent: freeing a table that is already free reports success, so two
 * people tapping at once both see the outcome they expected.
 */
CREATE OR REPLACE FUNCTION public.staff_close_session(_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session public.table_sessions;
  v_outstanding numeric := 0;
  v_unpaid int := 0;
  v_me uuid := auth.uid();
BEGIN
  IF NOT public.is_staff_member() THEN
    RAISE EXCEPTION 'Only staff can free a table' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Locked, so a payment and a close racing on the same table serialise.
  SELECT * INTO v_session FROM public.table_sessions WHERE id = _session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Table session not found'; END IF;

  IF NOT v_session.is_active THEN
    RETURN jsonb_build_object('closed', true, 'already_closed', true, 'outstanding', 0, 'unpaid_orders', 0);
  END IF;

  SELECT s.outstanding, s.unpaid_orders INTO v_outstanding, v_unpaid
    FROM public.session_outstanding(_session_id) s;

  IF v_unpaid > 0 THEN
    RETURN jsonb_build_object(
      'closed', false, 'already_closed', false,
      'outstanding', v_outstanding, 'unpaid_orders', v_unpaid);
  END IF;

  UPDATE public.table_sessions
     SET is_active = false, closed_at = now()
   WHERE id = _session_id;

  UPDATE public.waiter_calls
     SET status = 'resolved', resolved_at = now(), resolved_by = v_me
   WHERE table_session_id = _session_id AND status <> 'resolved';

  UPDATE public.bill_requests
     SET status = 'resolved', resolved_at = now(), resolved_by = v_me
   WHERE table_session_id = _session_id AND status <> 'resolved';

  PERFORM public.write_audit('table.freed', 'table_session', _session_id,
    jsonb_build_object('is_active', true, 'table_id', v_session.table_id),
    jsonb_build_object('is_active', false), NULL);

  RETURN jsonb_build_object('closed', true, 'already_closed', false, 'outstanding', 0, 'unpaid_orders', 0);
END;
$$;

REVOKE ALL ON FUNCTION public.staff_close_session(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_close_session(uuid) TO authenticated;

/**
 * Close a bill request, and optionally free the table.
 *
 * Unchanged in shape — `{ resolved, closed, outstanding }` — and still resolves
 * the request even when it refuses to close, because "the bill was brought" and
 * "the table may be freed" are different facts. Only the definition of "owes
 * money" moved, to the one place every screen now shares.
 */
CREATE OR REPLACE FUNCTION public.staff_resolve_bill_request(
  _request_id uuid,
  _close_session boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req public.bill_requests;
  v_me uuid := auth.uid();
  v_close jsonb;
BEGIN
  IF NOT public.is_staff_member() THEN
    RAISE EXCEPTION 'Only staff can resolve a bill request' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_req FROM public.bill_requests WHERE id = _request_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Bill request not found'; END IF;

  UPDATE public.bill_requests
     SET status = 'resolved', resolved_at = now(), resolved_by = v_me
   WHERE id = _request_id AND status <> 'resolved';

  IF NOT _close_session THEN
    RETURN jsonb_build_object('resolved', true, 'closed', false, 'outstanding', 0);
  END IF;

  v_close := public.staff_close_session(v_req.table_session_id);
  RETURN jsonb_build_object(
    'resolved', true,
    'closed', (v_close->>'closed')::boolean,
    'outstanding', (v_close->>'outstanding')::numeric);
END;
$$;

REVOKE ALL ON FUNCTION public.staff_resolve_bill_request(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_resolve_bill_request(uuid, boolean) TO authenticated;

-- ---------------------------------------------------------------------
-- 2. A refunded order is not payable
-- ---------------------------------------------------------------------

DO $$
DECLARE v_def text; v_new text;
BEGIN
  /*
   * Rewritten in place rather than re-declared, so whatever else has been
   * layered onto record_table_payment since it was written (release to the
   * kitchen, the in-flight card guard, the audit entry) is kept exactly as it
   * is. The new check sits directly after the "already paid" answer, before
   * anything is written.
   */
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'record_table_payment';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'record_table_payment is missing — migrations are out of order';
  END IF;

  -- Line endings are not content; see .gitattributes.
  v_def := replace(v_def, chr(13) || chr(10), chr(10));

  v_new := replace(v_def,
$old$    RETURN jsonb_build_object('status', 'already_paid', 'payment_method', v_order.payment_method);
  END IF;
$old$,
$new$    RETURN jsonb_build_object('status', 'already_paid', 'payment_method', v_order.payment_method);
  END IF;

  -- Paid, then given back. Recording it as paid again would count the same
  -- money twice and leave the drawer short by exactly the refund.
  IF v_order.payment_status IN ('refunded', 'partially_refunded')
     OR COALESCE(v_order.refunded_amount, 0) > 0
  THEN
    RAISE EXCEPTION 'This order has been refunded — it cannot be marked paid again'
      USING ERRCODE = 'check_violation';
  END IF;
$new$);

  IF v_new = v_def THEN
    RAISE EXCEPTION 'record_table_payment refund guard did not match';
  END IF;

  EXECUTE v_new;
  RAISE NOTICE 'record_table_payment now refuses refunded orders';
END $$;
