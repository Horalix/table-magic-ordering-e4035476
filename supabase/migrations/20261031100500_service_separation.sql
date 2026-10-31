-- =====================================================================
-- One evening at both restaurants: what still crossed, closed
-- (supabase/tests/two-restaurants-evening.test.ts, docs/two-restaurants.md)
-- =====================================================================
--
-- A whole service at La Soul and Vera Italia at once, through the functions
-- the app calls, found these. Each is fixed here, starting from the latest
-- definition in the chain; the evening test asserts each the way it should
-- behave.
--
--   1. A Vera Italia table joined La Soul's suggestion hold-out (the session
--      took whichever experiment was running). Now its own restaurant's; the
--      tables already put in the other restaurant's are taken out again.
--   2. Who read the suggestion ledger — decisions, sightings, hold-out
--      assignments — was "staff anywhere". Now staff of its restaurant, the
--      one being shown, like every other list.
--   3. The close of day expected in the drawer only orders whose payment was
--      exactly 'paid': a partly refunded order dropped out whole. Now every
--      order's total by the way it was paid, less the refunds given back,
--      each by the way it was given.
--   4. Staff functions answered with the other restaurant's state before
--      checking who asked (already paid, already released, owes 12 KM...),
--      and filed their audit entry under the restaurant the app happened to
--      show. Now: load the row, refuse anyone who does not work at its
--      restaurant, then act at that restaurant.
--   5. A guest's order could name another table's suggestion — another
--      restaurant's — and credit it with the sale. Now only this table's own
--      suggestion that offered this dish, and only a source dish on this
--      restaurant's menu; the suggestion funnel checks the same.
--   6. Resuming a table used the idle timeout of the restaurant the phone
--      named, not the table's.
--   7. A signed-in waiter browsing the other restaurant's menu page saw their
--      own restaurant's menu, and their visit counted there. The menu and its
--      counts now follow the page for everyone (menu_venue()); everything
--      staff-only still keeps to where they work (current_venue()).
--   8. The kitchen estimate for an order answered anyone with the order's id.
--      It now takes the table's token as well.

-- ---------------------------------------------------------------------
-- 1. Each restaurant's own experiment
-- ---------------------------------------------------------------------

-- Latest: 20260803002004. The session's restaurant's running experiment.
CREATE OR REPLACE FUNCTION public.assign_session_to_experiment(_session_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exp public.experiments;
  v_venue uuid;
  v_arm text;
BEGIN
  SELECT venue_id INTO v_venue FROM public.table_sessions WHERE id = _session_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  -- One running per restaurant (experiments_one_running_per_venue).
  SELECT * INTO v_exp FROM public.experiments WHERE ended_at IS NULL AND venue_id = v_venue LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT arm INTO v_arm FROM public.session_experiment_assignment WHERE session_id = _session_id;
  IF FOUND THEN RETURN v_arm; END IF;

  v_arm := CASE WHEN random() * 100 < v_exp.holdout_pct THEN 'holdout' ELSE 'treatment' END;

  INSERT INTO public.session_experiment_assignment(session_id, experiment_id, arm)
  VALUES (_session_id, v_exp.id, v_arm)
  ON CONFLICT (session_id) DO NOTHING;

  SELECT arm INTO v_arm FROM public.session_experiment_assignment WHERE session_id = _session_id;
  RETURN v_arm;
END;
$$;

REVOKE ALL ON FUNCTION public.assign_session_to_experiment(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assign_session_to_experiment(uuid) TO anon, authenticated;

-- Tables already put in the other restaurant's experiment: out of it, and
-- their suggestions no longer counted as its arms.
UPDATE public.recommendation_decisions d
   SET experiment_id = NULL, arm = NULL
  FROM public.table_sessions s, public.experiments e
 WHERE s.id = d.session_id AND e.id = d.experiment_id AND e.venue_id <> s.venue_id;
DELETE FROM public.session_experiment_assignment a
 USING public.table_sessions s, public.experiments e
 WHERE s.id = a.session_id AND e.id = a.experiment_id AND e.venue_id <> s.venue_id;

-- ---------------------------------------------------------------------
-- 2. The suggestion ledger, read per restaurant
-- ---------------------------------------------------------------------
-- A decision belongs to its table's restaurant; one with no table, to its
-- dish's (as reco_funnel reads them): the restaurant the request is about,
-- for someone who works there.

DROP POLICY IF EXISTS "Staff read decisions" ON public.recommendation_decisions;
CREATE POLICY "Staff read decisions" ON public.recommendation_decisions FOR SELECT TO authenticated
  USING ((session_id IN (SELECT s.id FROM public.table_sessions s WHERE s.venue_id = (SELECT public.current_venue()))
          OR (session_id IS NULL
              AND chosen_item_id IN (SELECT public.venue_menu_item_ids((SELECT public.current_venue())))))
         AND (SELECT public.can_staff(public.current_venue())));

-- A sighting is its decision's: readable exactly when the decision is.
DROP POLICY IF EXISTS "Staff read impressions" ON public.recommendation_impressions;
CREATE POLICY "Staff read impressions" ON public.recommendation_impressions FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.recommendation_decisions d WHERE d.id = decision_id));

DROP POLICY IF EXISTS "Staff read assignments" ON public.session_experiment_assignment;
CREATE POLICY "Staff read assignments" ON public.session_experiment_assignment FOR SELECT TO authenticated
  USING (session_id IN (SELECT s.id FROM public.table_sessions s WHERE s.venue_id = (SELECT public.current_venue()))
         AND (SELECT public.can_staff(public.current_venue())));

-- ---------------------------------------------------------------------
-- 3. What the drawer and the terminal batch should hold
-- ---------------------------------------------------------------------

/*
 * Latest: 20261028100000_two_restaurants_context.sql. paid_online, paid_cash
 * and paid_pos_terminal are the day's orders' totals by the way each was paid
 * — paid, partly refunded or refunded alike — less the completed refunds on
 * those orders, each by the way the money went back. A partly refunded order
 * used to drop out whole: La Soul's terminal batch showed 31 KM where 44 had
 * been taken, Vera Italia's drawer 0 where 35 was in it. close_shift() takes
 * its expected cash and terminal from here.
 */
CREATE OR REPLACE FUNCTION public.day_reconciliation(_day date DEFAULT business_day())
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_venue uuid := public.current_venue();
  v_result jsonb;
  v_from timestamptz;
  v_to timestamptz;
BEGIN
  IF NOT public.can_staff(v_venue) THEN
    RAISE EXCEPTION 'Only staff can read reconciliation' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT starts_at, ends_at INTO v_from, v_to FROM public.business_day_range(_day);

  WITH day_orders AS (
    SELECT co.*
      FROM public.completed_orders co
     WHERE co.created_at >= v_from AND co.created_at < v_to
       AND EXISTS (SELECT 1 FROM public.orders vo WHERE vo.id = co.id AND vo.venue_id = v_venue)
  ),
  given_back AS (
    SELECT r.method, sum(r.amount) AS amount
      FROM public.order_refunds r
      JOIN day_orders d ON d.id = r.order_id
     WHERE r.status = 'completed'
     GROUP BY r.method
  ),
  taken AS (
    SELECT d.payment_method AS method, sum(d.total) AS amount
      FROM day_orders d
     WHERE d.payment_status IN ('paid', 'partially_refunded', 'refunded')
     GROUP BY d.payment_method
  )
  SELECT jsonb_build_object(
    'day', _day,
    'orders', count(*),
    'gross', COALESCE(sum(total), 0),
    'tips', COALESCE(sum(tip_amount), 0),
    'refunded', COALESCE(sum(refunded_amount), 0),
    'net', COALESCE(sum(total) - sum(refunded_amount), 0),
    'paid_online', COALESCE((SELECT amount FROM taken WHERE method = 'card_online'), 0)
                   - COALESCE((SELECT amount FROM given_back WHERE method = 'card_online'), 0),
    'paid_cash', COALESCE((SELECT amount FROM taken WHERE method = 'cash'), 0)
                 - COALESCE((SELECT amount FROM given_back WHERE method = 'cash'), 0),
    'paid_pos_terminal', COALESCE((SELECT amount FROM taken WHERE method = 'pos_terminal'), 0)
                         - COALESCE((SELECT amount FROM given_back WHERE method = 'pos_terminal'), 0),
    'outstanding', COALESCE(sum(total) FILTER (WHERE payment_status IN ('unpaid', 'pending')), 0),
    'outstanding_orders', count(*) FILTER (WHERE payment_status IN ('unpaid', 'pending')),
    'unfiscalized', COALESCE(sum(total) FILTER (WHERE fiscalization_status <> 'fiscalized'), 0),
    'unfiscalized_orders', count(*) FILTER (WHERE fiscalization_status <> 'fiscalized'),
    'average_order', COALESCE(round(avg(total), 2), 0)
  )
  INTO v_result
  FROM day_orders;

  -- Money that started but never landed: the queue staff must clear.
  SELECT v_result || jsonb_build_object(
    'stuck_payments', COALESCE(count(*), 0),
    'stuck_amount', COALESCE(round(sum(o.total), 2), 0),
    'cancelled_orders', (SELECT count(*) FROM public.orders c
                          WHERE c.venue_id = v_venue
                            AND c.status = 'cancelled'
                            AND c.created_at >= v_from AND c.created_at < v_to),
    -- A callback naming no order we know has no restaurant; La Soul, which
    -- received every callback before there were two, keeps counting those.
    'callback_problems', (SELECT count(*) FROM public.payment_callback_events e
                           WHERE (e.venue_id = v_venue
                                  OR (e.venue_id IS NULL AND v_venue = public.default_venue()))
                             AND e.outcome IN ('amount_mismatch', 'currency_mismatch', 'unknown_transaction')
                             AND e.created_at >= v_from AND e.created_at < v_to)
  )
  INTO v_result
  FROM public.orders o
  WHERE o.venue_id = v_venue
    AND o.status IN ('awaiting_payment', 'payment_failed')
    AND o.created_at >= v_from AND o.created_at < v_to;

  RETURN v_result;
END;
$$;

-- ---------------------------------------------------------------------
-- 4. Staff functions: who asks first, then the answer — at the row's restaurant
-- ---------------------------------------------------------------------
-- The pattern of staff_bump_order_item: load the row, refuse anyone who does
-- not work at its restaurant (the owner does), then switch the request to it
-- (use_venue), so its settings and its audit entry are that restaurant's
-- whatever the app was showing. Otherwise each is its latest definition.

-- Latest: 20260801181252 (gate widened since). Waiters take the money at their own tables.
CREATE OR REPLACE FUNCTION public.record_table_payment(_order_id uuid, _method text, _note text DEFAULT NULL::text)
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

  IF NOT public.can_staff(v_order.venue_id) THEN
    RAISE EXCEPTION 'You do not work at this restaurant' USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM public.use_venue(v_order.venue_id);

  IF v_order.payment_status = 'paid' THEN
    RETURN jsonb_build_object('status', 'already_paid', 'payment_method', v_order.payment_method);
  END IF;

  -- Paid, then given back. Recording it as paid again would count the same
  -- money twice and leave the drawer short by exactly the refund.
  IF v_order.payment_status IN ('refunded', 'partially_refunded')
     OR COALESCE(v_order.refunded_amount, 0) > 0
  THEN
    RAISE EXCEPTION 'This order has been refunded — it cannot be marked paid again'
      USING ERRCODE = 'check_violation';
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

-- Latest: 20261024190000_order_abuse_guards.sql.
CREATE OR REPLACE FUNCTION public.staff_release_held_order(_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders;
  v_ticket uuid;
BEGIN
  IF NOT public.is_staff_member() THEN
    RAISE EXCEPTION 'Only staff can confirm an order' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = _order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  IF NOT public.can_staff(v_order.venue_id) THEN
    RAISE EXCEPTION 'You do not work at this restaurant' USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM public.use_venue(v_order.venue_id);

  IF v_order.status = 'cancelled' THEN
    RAISE EXCEPTION 'This order was already rejected' USING ERRCODE = 'check_violation';
  END IF;

  IF v_order.released_to_kitchen_at IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'already_released', 'order_id', v_order.id);
  END IF;

  -- An unreleased order that is not held is a card order waiting for money.
  -- Staff confirming it would print food nobody has paid for.
  IF v_order.held_reason IS NULL THEN
    RAISE EXCEPTION 'This order is not waiting for confirmation' USING ERRCODE = 'check_violation';
  END IF;

  PERFORM set_config('lasoul.financial_ctx', 'on', true);

  UPDATE public.orders
     SET released_to_kitchen_at = now(),
         held_reason = NULL
   WHERE id = _order_id;

  PERFORM public.mark_session_seen(v_order.table_session_id);

  -- The same call guest_place_order makes for an order that was never held.
  v_ticket := public.enqueue_station_tickets(_order_id);

  PERFORM public.write_audit('order.hold_released', 'order', _order_id,
    jsonb_build_object('held_reason', v_order.held_reason, 'held_at', v_order.held_at),
    jsonb_build_object('released_to_kitchen_at', now()), NULL);

  RETURN jsonb_build_object('status', 'released', 'order_id', _order_id, 'ticket_id', v_ticket);
END;
$$;

-- Latest: 20260801182038.
CREATE OR REPLACE FUNCTION public.staff_update_order_status(_order_id uuid, _status order_status)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders;
  v_item_status public.order_item_status;
BEGIN
  IF NOT public.is_staff_member() THEN
    RAISE EXCEPTION 'Only staff can change an order status' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = _order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;

  IF NOT public.can_staff(v_order.venue_id) THEN
    RAISE EXCEPTION 'You do not work at this restaurant' USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM public.use_venue(v_order.venue_id);

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

  -- Order first, THEN items. See sync_order_status_from_items: this ordering is
  -- what prevents the derivation trigger from recursing.
  UPDATE public.orders SET status = _status WHERE id = _order_id;

  v_item_status := CASE _status
    WHEN 'served' THEN 'served' WHEN 'ready' THEN 'ready'
    WHEN 'preparing' THEN 'preparing' ELSE NULL END::public.order_item_status;

  IF v_item_status IS NOT NULL THEN
    PERFORM set_config('lasoul.item_ctx', 'on', true);
    UPDATE public.order_items
       SET status = v_item_status,
           started_at = CASE WHEN v_item_status >= 'preparing' THEN COALESCE(started_at, now()) ELSE started_at END,
           ready_at   = CASE WHEN v_item_status IN ('ready', 'served') THEN COALESCE(ready_at, now()) ELSE ready_at END,
           served_at  = CASE WHEN v_item_status = 'served' THEN COALESCE(served_at, now()) ELSE served_at END
     WHERE order_id = _order_id
       AND public.order_item_status_rank(status) < public.order_item_status_rank(v_item_status);
  END IF;

  PERFORM public.write_audit('order.status_changed', 'order', _order_id,
    jsonb_build_object('status', v_order.status), jsonb_build_object('status', _status));

  RETURN jsonb_build_object('status', _status);
END;
$$;

-- Latest: 20261024140000_staff_safety.sql.
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

  IF NOT public.can_staff(v_session.venue_id) THEN
    RAISE EXCEPTION 'You do not work at this restaurant' USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM public.use_venue(v_session.venue_id);

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

-- Latest: 20260801182219.
CREATE OR REPLACE FUNCTION public.staff_ack_waiter_call(_call_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_call public.waiter_calls;
  v_me uuid := auth.uid();
BEGIN
  IF NOT public.is_staff_member() THEN
    RAISE EXCEPTION 'Only staff can take a call' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_call FROM public.waiter_calls WHERE id = _call_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Call not found'; END IF;

  IF NOT public.can_staff(v_call.venue_id) THEN
    RAISE EXCEPTION 'You do not work at this restaurant' USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM public.use_venue(v_call.venue_id);

  IF v_call.status = 'resolved' THEN
    RETURN jsonb_build_object('status', 'resolved', 'claimed_by', v_call.resolved_by, 'mine', false);
  END IF;

  -- Someone else has it and is still plausibly walking there.
  IF v_call.acknowledged_by IS NOT NULL
     AND v_call.acknowledged_by <> v_me
     AND v_call.acknowledged_at > now() - interval '3 minutes'
  THEN
    RETURN jsonb_build_object('status', 'acknowledged', 'claimed_by', v_call.acknowledged_by, 'mine', false);
  END IF;

  UPDATE public.waiter_calls
     SET status = 'acknowledged', acknowledged_by = v_me, acknowledged_at = now()
   WHERE id = _call_id;

  RETURN jsonb_build_object('status', 'acknowledged', 'claimed_by', v_me, 'mine', true);
END;
$$;

-- Latest: 20260801182219.
CREATE OR REPLACE FUNCTION public.staff_ack_bill_request(_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req public.bill_requests;
  v_me uuid := auth.uid();
BEGIN
  IF NOT public.is_staff_member() THEN
    RAISE EXCEPTION 'Only staff can take a bill request' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_req FROM public.bill_requests WHERE id = _request_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Bill request not found'; END IF;

  IF NOT public.can_staff(v_req.venue_id) THEN
    RAISE EXCEPTION 'You do not work at this restaurant' USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM public.use_venue(v_req.venue_id);

  IF v_req.status = 'resolved' THEN
    RETURN jsonb_build_object('status', 'resolved', 'claimed_by', v_req.resolved_by, 'mine', false);
  END IF;

  IF v_req.acknowledged_by IS NOT NULL
     AND v_req.acknowledged_by <> v_me
     AND v_req.acknowledged_at > now() - interval '3 minutes'
  THEN
    RETURN jsonb_build_object('status', 'acknowledged', 'claimed_by', v_req.acknowledged_by, 'mine', false);
  END IF;

  UPDATE public.bill_requests
     SET status = 'acknowledged', acknowledged_by = v_me, acknowledged_at = now()
   WHERE id = _request_id;

  RETURN jsonb_build_object('status', 'acknowledged', 'claimed_by', v_me, 'mine', true);
END;
$$;

-- Latest: 20261024190000_order_abuse_guards.sql.
CREATE OR REPLACE FUNCTION public.staff_mark_session_seen(_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_venue uuid;
BEGIN
  IF NOT public.is_staff_member() THEN
    RAISE EXCEPTION 'Only staff can do this' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT venue_id INTO v_venue FROM public.table_sessions WHERE id = _session_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Table session not found';
  END IF;
  IF NOT public.can_staff(v_venue) THEN
    RAISE EXCEPTION 'You do not work at this restaurant' USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM public.use_venue(v_venue);
  PERFORM public.mark_session_seen(_session_id);
  RETURN jsonb_build_object('seen', true);
END;
$$;

-- ---------------------------------------------------------------------
-- 5. A sale credits only this table's own suggestion
-- ---------------------------------------------------------------------

/*
 * Latest: 20261028100000_two_restaurants_context.sql. Only the attribution
 * changes: the client sends from_suggestion {decision_id, source_item_id},
 * which was stored as sent. A Vera Italia order naming La Soul table 7's
 * decision and La Soul's burger credited La Soul's suggestions with Vera
 * Italia's money (and a made-up id failed the whole order on its foreign
 * key). Now the decision is kept only when it is this table session's and
 * offered this dish (chosen, or on its shortlist), the source dish only when
 * it is on this restaurant's menu; anything else is recorded as a sale with
 * no suggestion to credit.
 */
CREATE OR REPLACE FUNCTION public.guest_place_order(_session_id uuid, _session_token text, _guest_name text, _payment_method text, _items jsonb, _tip numeric DEFAULT 0, _client_order_id uuid DEFAULT NULL::uuid)
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
  v_unavailable_ids text;
  v_qty int;
  v_hold text;
BEGIN
  v_session := public.assert_guest_session(_session_id, _session_token);

  IF _client_order_id IS NOT NULL THEN
    SELECT * INTO v_order
      FROM public.orders o
     WHERE o.table_session_id = v_session.id AND o.client_order_id = _client_order_id;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'order_id', v_order.id,
        'order_code', v_order.order_code,
        'status', v_order.status,
        'total', v_order.total,
        'tip_amount', v_order.tip_amount,
        'payment_method', v_order.payment_method,
        'payment_status', v_order.payment_status,
        'awaiting_payment', v_order.status = 'awaiting_payment',
        'ticket_id', NULL,
        'replayed', true,
        'held', v_order.held_reason IS NOT NULL AND v_order.released_to_kitchen_at IS NULL
      );
    END IF;
  END IF;

  IF NOT COALESCE((SELECT ordering_enabled FROM public.restaurant_settings WHERE venue_id = v_session.venue_id), true) THEN
    RAISE EXCEPTION 'Ordering is paused' USING ERRCODE = 'feature_not_supported';
  END IF;

  v_method := CASE
    WHEN _payment_method IN ('card', 'card_online') THEN 'card_online'
    WHEN _payment_method = 'pos_terminal' THEN 'pos_terminal'
    ELSE 'cash'
  END;
  v_is_card := v_method = 'card_online';

  IF v_is_card AND NOT public.online_card_payments_enabled() THEN
    RAISE EXCEPTION 'Online card payment is currently unavailable' USING ERRCODE = 'feature_not_supported';
  END IF;

  IF jsonb_typeof(_items) <> 'array' THEN
    RAISE EXCEPTION 'Order items must be an array';
  END IF;

  SELECT jsonb_array_length(_items) INTO v_item_count;
  IF v_item_count < 1 OR v_item_count > 20 THEN
    RAISE EXCEPTION 'Invalid order size';
  END IF;

  SELECT COALESCE(sum(LEAST(GREATEST(COALESCE((item->>'quantity')::int, 1), 1), 10)), 0)::int
    INTO v_qty
    FROM jsonb_array_elements(_items) AS item;
  IF v_qty > 60 THEN
    RAISE EXCEPTION 'Invalid order size';
  END IF;

  UPDATE public.table_sessions SET last_heartbeat_at = now() WHERE id = v_session.id;

  SELECT count(*) INTO v_order_count
    FROM public.orders
   WHERE table_session_id = v_session.id;
  IF v_order_count >= 30 THEN
    RAISE EXCEPTION 'Maximum orders reached for this session';
  END IF;

  WITH requested AS (
    SELECT DISTINCT (item->>'menu_item_id')::uuid AS menu_item_id
      FROM jsonb_array_elements(_items) AS item
  )
  SELECT string_agg(COALESCE(mi.name, 'Unknown item'), ', '),
         jsonb_agg(r.menu_item_id)::text
    INTO v_unavailable, v_unavailable_ids
    FROM requested r
    LEFT JOIN public.menu_items mi ON mi.id = r.menu_item_id
   WHERE mi.id IS NULL OR mi.venue_id <> v_session.venue_id OR NOT public.menu_item_orderable(mi);

  IF v_unavailable IS NOT NULL THEN
    RAISE EXCEPTION 'Unavailable: %', v_unavailable
      USING ERRCODE = 'no_data_found', DETAIL = v_unavailable_ids;
  END IF;

  WITH requested AS (
    SELECT
      (item->>'menu_item_id')::uuid AS menu_item_id,
      LEAST(GREATEST(COALESCE((item->>'quantity')::int, 1), 1), 10) AS quantity
    FROM jsonb_array_elements(_items) AS item
  )
  SELECT round(sum(pl.unit_price * pl.quantity)::numeric, 2)
    INTO v_items_total
    FROM public.price_order_lines(_items) pl;

  IF v_items_total IS NULL OR v_items_total <= 0 THEN
    RAISE EXCEPTION 'No available menu items found';
  END IF;

  v_tip := round(GREATEST(COALESCE(_tip, 0), 0)::numeric, 2);
  v_tip := LEAST(v_tip, round(v_items_total * 0.40, 2), 200);

  v_status := CASE WHEN v_is_card THEN 'awaiting_payment'::public.order_status
                   ELSE 'pending'::public.order_status END;

  -- Pay-at-table orders print on arrival. The suspicious ones wait for staff
  -- instead (see order_hold_reason). Card orders are already gated on money.
  IF NOT v_is_card THEN
    v_hold := public.order_hold_reason(v_session.id, v_items_total, v_qty);
  END IF;

  INSERT INTO public.orders(
    table_session_id, total, tip_amount, status, guest_name,
    payment_method, payment_status, order_code, released_to_kitchen_at, client_order_id,
    held_reason, held_at
  )
  VALUES (
    v_session.id, v_items_total + v_tip, v_tip, v_status,
    nullif(left(trim(coalesce(_guest_name, '')), 80), ''),
    v_method,
    CASE WHEN v_is_card THEN 'pending' ELSE 'unpaid' END,
    public.next_order_code(v_session.venue_id),
    CASE WHEN v_is_card OR v_hold IS NOT NULL THEN NULL ELSE now() END,
    _client_order_id,
    v_hold,
    CASE WHEN v_hold IS NULL THEN NULL ELSE now() END
  )
  RETURNING * INTO v_order;

  WITH requested AS (
    SELECT
      (item->>'menu_item_id')::uuid AS menu_item_id,
      LEAST(GREATEST(COALESCE((item->>'quantity')::int, 1), 1), 10) AS quantity,
      nullif(left(trim(coalesce(item->>'notes', '')), 500), '') AS notes
    FROM jsonb_array_elements(_items) AS item
  )
  INSERT INTO public.order_items(order_id, menu_item_id, quantity, unit_price, notes, status, regular_unit_price, components)
  SELECT v_order.id, pl.menu_item_id, pl.quantity, pl.unit_price, pl.notes, 'pending', pl.regular_unit_price, pl.components
    FROM public.price_order_lines(_items) pl
   ORDER BY pl.line_no;

  -- Attribution. Priced from menu_items, never from the client; the
  -- suggestion and its source dish only when they are this table's own.
  INSERT INTO public.suggestion_conversions(
    order_id, source_item_id, recommended_item_id, placement, quantity, line_total, decision_id)
  SELECT
    v_order.id,
    (SELECT src.id FROM public.menu_items src
      WHERE src.id = public.analytics_uuid(item->'from_suggestion'->>'source_item_id')
        AND src.venue_id = v_session.venue_id),
    (item->>'menu_item_id')::uuid,
    COALESCE(nullif(item->'from_suggestion'->>'placement', ''), 'cart'),
    LEAST(GREATEST(COALESCE((item->>'quantity')::int, 1), 1), 10),
    round(public.menu_item_unit_price(mi) * LEAST(GREATEST(COALESCE((item->>'quantity')::int, 1), 1), 10), 2),
    (SELECT d.id FROM public.recommendation_decisions d
      WHERE d.id = public.analytics_uuid(item->'from_suggestion'->>'decision_id')
        AND d.session_id = v_session.id
        AND (d.chosen_item_id = mi.id
             OR d.candidates @> jsonb_build_array(jsonb_build_object('item_id', mi.id))))
  FROM jsonb_array_elements(_items) AS item
  JOIN public.menu_items mi ON mi.id = (item->>'menu_item_id')::uuid
  WHERE jsonb_typeof(item->'from_suggestion') = 'object';

  IF NOT v_is_card AND v_hold IS NULL THEN
    v_ticket_id := public.enqueue_station_tickets(v_order.id);
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
    'ticket_id', v_ticket_id,
    'held', v_hold IS NOT NULL,
    'held_reason', v_hold
  );
END;
$$;

/*
 * Latest: 20261028100000_two_restaurants_context.sql. A sale counts for a
 * decision only on an order of this restaurant and on a dish that decision
 * offered — the same test guest_place_order now applies on the way in, for
 * rows written before it did.
 */
CREATE OR REPLACE FUNCTION public.reco_funnel(_days integer DEFAULT 28)
RETURNS TABLE(placement text, week_start date, decisions bigint, with_suggestion bigint, seen bigint, tapped bigint, paid bigint, paid_km numeric, km_per_1000_seen numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_since timestamptz := public.analytics_window_start(LEAST(GREATEST(COALESCE(_days, 28), 1), 180));
  v_venue uuid := public.current_venue();
BEGIN
  IF NOT public.can_staff(v_venue) THEN
    RAISE EXCEPTION 'Only staff can read menu intelligence' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  WITH d AS (
    SELECT rd.id AS d_id, rd.placement AS d_placement, rd.chosen_item_id AS d_chosen, rd.created_at AS d_at,
           rd.candidates AS d_candidates
      FROM public.recommendation_decisions rd
     WHERE rd.created_at >= v_since
       -- A decision is its table's restaurant's; one with no table, its dish's.
       AND COALESCE((SELECT s.venue_id FROM public.table_sessions s WHERE s.id = rd.session_id),
                    (SELECT mi.venue_id FROM public.menu_items mi WHERE mi.id = rd.chosen_item_id),
                    public.default_venue()) = v_venue
  ),
  sightings AS (
    SELECT DISTINCT i.decision_id AS s_id
      FROM public.recommendation_impressions i
      JOIN d ON d.d_id = i.decision_id
  ),
  taps AS (
    -- A tap belongs to a decision only when it carries the decision's id AND
    -- is on the dish that decision chose. The guest app sends the id only in
    -- that case (CartSuggestion); requiring the dish as well keeps older
    -- clients, which sent the id with any card, from crediting a decision
    -- with a tap on something it did not pick. Taps on other cards have no
    -- session on them (analytics is per phone visit, not per table), so they
    -- cannot be tied to a decision honestly and are not counted here.
    SELECT DISTINCT d.d_id AS t_id
      FROM public.analytics_events e
      JOIN d ON d.d_id = public.analytics_uuid(e.props->>'decision_id')
     WHERE e.event = 'suggestion_accepted'
       AND e.occurred_at >= v_since - interval '1 day'
       AND (public.analytics_uuid(e.props->>'item_id') IS NULL
            OR public.analytics_uuid(e.props->>'item_id') = d.d_chosen)
  ),
  conv AS (
    SELECT sc.decision_id AS c_id, sum(sc.line_total) AS c_km
      FROM public.suggestion_conversions sc
      JOIN public.completed_orders co ON co.id = sc.order_id
      JOIN public.orders ov ON ov.id = sc.order_id AND ov.venue_id = v_venue
      JOIN d ON d.d_id = sc.decision_id
     WHERE sc.recommended_item_id = d.d_chosen
        OR d.d_candidates @> jsonb_build_array(jsonb_build_object('item_id', sc.recommended_item_id))
     GROUP BY sc.decision_id
  ),
  flagged AS (
    SELECT d.*,
           c.c_id IS NOT NULL AS is_paid,
           COALESCE(c.c_km, 0) AS km,
           (t.t_id IS NOT NULL OR c.c_id IS NOT NULL) AS is_tapped,
           (s.s_id IS NOT NULL OR t.t_id IS NOT NULL OR c.c_id IS NOT NULL) AS is_seen
      FROM d
      LEFT JOIN sightings s ON s.s_id = d.d_id
      LEFT JOIN taps t ON t.t_id = d.d_id
      LEFT JOIN conv c ON c.c_id = d.d_id
  )
  SELECT f.d_placement,
         date_trunc('week', public.business_day(f.d_at)::timestamp)::date,
         count(*)::bigint,
         (count(*) FILTER (WHERE f.d_chosen IS NOT NULL OR f.is_seen))::bigint,
         (count(*) FILTER (WHERE f.is_seen))::bigint,
         (count(*) FILTER (WHERE f.is_tapped))::bigint,
         (count(*) FILTER (WHERE f.is_paid))::bigint,
         round(sum(f.km), 2),
         CASE WHEN count(*) FILTER (WHERE f.is_seen) > 0
              THEN round(1000 * sum(f.km) / count(*) FILTER (WHERE f.is_seen), 2) END
    FROM flagged f
   GROUP BY 1, 2
   ORDER BY 2 DESC, 1;
END;
$$;

-- ---------------------------------------------------------------------
-- 6. A table keeps its own restaurant's idle timeout
-- ---------------------------------------------------------------------

-- Latest: 20260801181519. The timeout is the table's restaurant's, not the
-- one the phone's header names (a phone that sends none got La Soul's).
CREATE OR REPLACE FUNCTION public.guest_resume_session(_session_id uuid, _session_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session public.table_sessions;
  v_timeout int;
  v_table_number int;
BEGIN
  SELECT * INTO v_session
    FROM public.table_sessions
   WHERE id = _session_id AND token = _session_token;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'unknown');
  END IF;

  IF NOT v_session.is_active THEN
    RETURN jsonb_build_object('status', 'closed');
  END IF;

  v_timeout := COALESCE((SELECT session_idle_timeout_minutes FROM public.restaurant_settings
                          WHERE venue_id = v_session.venue_id), 180);

  IF COALESCE(v_session.last_heartbeat_at, v_session.opened_at) <= now() - make_interval(mins => v_timeout) THEN
    RETURN jsonb_build_object('status', 'expired');
  END IF;

  SELECT table_number INTO v_table_number FROM public.tables WHERE id = v_session.table_id;

  RETURN jsonb_build_object(
    'status', 'active',
    'session_id', v_session.id,
    'table_number', v_table_number,
    'guest_name', v_session.guest_name,
    'opened_at', v_session.opened_at
  );
END;
$$;

-- ---------------------------------------------------------------------
-- 7. The menu follows the page, for everyone
-- ---------------------------------------------------------------------

/**
 * The restaurant whose menu this request shows: what the request already
 * proved (a table session, use_venue()); otherwise the restaurant the page
 * names in its x-venue header, for anyone — a guest, or a signed-in waiter of
 * the other restaurant opening this one's menu; otherwise current_venue().
 * Only for what is public anyway: the menus, their search and combos, and
 * the counts of who browsed them. Everything staff-only keeps to
 * current_venue(), which honours a signed-in user's header only where they
 * work.
 */
CREATE OR REPLACE FUNCTION public.menu_venue()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_set text := nullif(current_setting('lasoul.venue', true), '');
  v_asked text;
  v_id uuid;
BEGIN
  IF v_set IS NOT NULL THEN
    RETURN v_set::uuid;
  END IF;
  BEGIN
    v_asked := nullif(current_setting('request.headers', true), '')::json ->> 'x-venue';
  EXCEPTION WHEN others THEN
    v_asked := NULL;
  END;
  IF v_asked IS NOT NULL THEN
    SELECT id INTO v_id FROM public.venues WHERE slug = v_asked OR id::text = v_asked;
    IF FOUND THEN
      RETURN v_id;
    END IF;
  END IF;
  RETURN public.current_venue();
END;
$$;

REVOKE ALL ON FUNCTION public.menu_venue() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.menu_venue() TO anon, authenticated, service_role;

-- The public menu policies of 20261028100000, on menu_venue().
DO $menus$
DECLARE
  p record;
BEGIN
  FOR p IN
    SELECT * FROM (VALUES
      ('categories', 'Anyone can view categories', 'public'),
      ('subcategories', 'Anyone can view subcategories', 'public'),
      ('menu_items', 'Anyone can view available menu items', 'public'),
      ('menu_combo_slots', 'Anyone can view combo slots', 'anon, authenticated'),
      ('menu_combo_options', 'Anyone can view combo options', 'anon, authenticated')
    ) AS t(tbl, name, roles)
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p.name, p.tbl);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO %s USING (venue_id = (SELECT public.menu_venue()))',
                   p.name, p.tbl, p.roles);
  END LOOP;
END
$menus$;

-- Latest: 20261028100000. The menu being shown.
CREATE OR REPLACE FUNCTION public.guest_search_menu(_query text, _limit integer DEFAULT 20)
RETURNS TABLE(id uuid, name text, name_bs text, name_ar text, description text, description_bs text, description_ar text, price numeric, image_url text, dietary_tags text[], merchandising_tags text[], is_available boolean, subcategory_id uuid, category_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT mi.id, mi.name, mi.name_bs, mi.name_ar,
         mi.description, mi.description_bs, mi.description_ar,
         mi.price, mi.image_url, mi.dietary_tags, mi.merchandising_tags,
         mi.is_available, mi.subcategory_id, c.name
    FROM public.menu_items mi
    JOIN public.subcategories s ON s.id = mi.subcategory_id
    JOIN public.categories c ON c.id = s.category_id
   WHERE length(btrim(COALESCE(_query, ''))) >= 2
     AND mi.venue_id = public.menu_venue()
     AND (
       mi.name ILIKE '%' || btrim(_query) || '%'
       OR COALESCE(mi.name_bs, '') ILIKE '%' || btrim(_query) || '%'
       OR COALESCE(mi.name_ar, '') ILIKE '%' || btrim(_query) || '%'
       OR COALESCE(mi.description, '') ILIKE '%' || btrim(_query) || '%'
       OR s.name ILIKE '%' || btrim(_query) || '%'
     )
   ORDER BY mi.is_available DESC,
            (mi.name ILIKE btrim(_query) || '%') DESC,
            mi.sort_order ASC
   LIMIT LEAST(GREATEST(COALESCE(_limit, 20), 1), 50);
$$;

-- Latest: 20261028100000. The menu being shown.
CREATE OR REPLACE FUNCTION public.guest_get_combos()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(c.combo ORDER BY c.combo_item_id), '[]'::jsonb)
    FROM (
      SELECT s.combo_item_id,
             jsonb_build_object(
               'combo_item_id', s.combo_item_id,
               'slots', jsonb_agg(jsonb_build_object(
                 'id', s.id,
                 'label', s.label,
                 'label_bs', s.label_bs,
                 'label_ar', s.label_ar,
                 'sort_order', s.sort_order,
                 'options', (
                   SELECT COALESCE(jsonb_agg(jsonb_build_object(
                            'item_id', mi.id,
                            'surcharge', o.surcharge,
                            'name', mi.name,
                            'name_bs', mi.name_bs,
                            'name_ar', mi.name_ar,
                            'price', mi.price,
                            'image_url', mi.image_url,
                            'is_available', mi.is_available,
                            'available_from', mi.available_from,
                            'available_to', mi.available_to,
                            'sale_kind', mi.sale_kind,
                            'sale_value', mi.sale_value,
                            'sale_starts_at', mi.sale_starts_at,
                            'sale_ends_at', mi.sale_ends_at,
                            'station', mi.station
                          ) ORDER BY o.sort_order, mi.name), '[]'::jsonb)
                     FROM public.menu_combo_options o
                     JOIN public.menu_items mi ON mi.id = o.item_id
                    WHERE o.slot_id = s.id
                 )
               ) ORDER BY s.sort_order, s.id)
             ) AS combo
        FROM public.menu_combo_slots s
       WHERE s.venue_id = public.menu_venue()
       GROUP BY s.combo_item_id
    ) c;
$$;

-- Latest: 20261028100000. The menu being shown.
CREATE OR REPLACE FUNCTION public.get_popular_items(_limit integer DEFAULT 8, _days integer DEFAULT 30)
RETURNS TABLE(menu_item_id uuid, qty bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT oi.menu_item_id, sum(oi.quantity)::bigint AS qty
    FROM public.completed_orders o
    JOIN public.order_items oi ON oi.order_id = o.id
   WHERE o.created_at > now() - make_interval(days => GREATEST(COALESCE(_days, 30), 1))
     AND oi.venue_id = public.menu_venue()
   GROUP BY oi.menu_item_id
  HAVING count(DISTINCT o.id) >= 3
   ORDER BY qty DESC, oi.menu_item_id
   LIMIT LEAST(GREATEST(COALESCE(_limit, 8), 1), 50);
$$;

-- Latest: 20261028100000. Whether the restaurant being shown takes orders.
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
  WHERE s.venue_id = public.menu_venue();
$$;

/*
 * Latest: 20261028100000 (as rewritten since). Each event is counted for the
 * restaurant whose page sent it (the batch's x-venue header; the client sends
 * one batch per restaurant, src/lib/analytics.ts) — a signed-in waiter's phone
 * on the other restaurant's menu included.
 */
CREATE OR REPLACE FUNCTION public.record_analytics_events(_visit_id text, _events jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_visit text := left(COALESCE(nullif(trim(_visit_id), ''), 'anonymous'), 64);
  v_recent int;
  v_venue_recent int;
  v_inserted int := 0;
BEGIN
  IF _events IS NULL OR jsonb_typeof(_events) <> 'array' OR jsonb_array_length(_events) = 0 THEN
    RETURN 0;
  END IF;
  IF jsonb_array_length(_events) > 25 THEN
    RETURN 0;
  END IF;

  -- Volume cap per visit per hour: a bored client cannot fill the table.
  SELECT count(*) INTO v_recent
    FROM public.analytics_events
   WHERE visit_id = v_visit AND created_at > now() - interval '1 hour';
  IF v_recent > 500 THEN
    RETURN 0;
  END IF;

  -- Bounded count: stop at the cap rather than counting a flood.
  SELECT count(*) INTO v_venue_recent
    FROM (SELECT 1 FROM public.analytics_events
           WHERE created_at > now() - interval '1 minute'
           LIMIT 3000) recent;
  IF v_venue_recent >= 3000 THEN
    RETURN 0;
  END IF;

  WITH incoming AS (
    SELECT CASE WHEN jsonb_typeof(e) = 'object' THEN e->>'event' END AS event,
           COALESCE(
             (SELECT jsonb_object_agg(k, v)
                FROM jsonb_each(CASE WHEN jsonb_typeof(e->'props') = 'object'
                                     THEN e->'props' ELSE '{}'::jsonb END) AS kv(k, v)
               WHERE jsonb_typeof(v) IN ('string', 'number', 'boolean', 'null')
                 AND length(k) <= 40
                 -- An id that is not an id is worse than no id: drop the key.
                 AND (k NOT IN ('item_id', 'source_item_id')
                      OR (jsonb_typeof(v) = 'string' AND public.analytics_uuid(v #>> '{}') IS NOT NULL))),
             '{}'::jsonb
           ) AS props,
           CASE WHEN jsonb_typeof(e) = 'object' AND jsonb_typeof(e->'at') = 'string'
                THEN public.analytics_timestamptz(e->>'at') END AS claimed_at
      FROM jsonb_array_elements(_events) AS e
  )
  INSERT INTO public.analytics_events(visit_id, event, props, occurred_at, venue_id)
  SELECT v_visit, i.event, i.props,
         LEAST(GREATEST(COALESCE(i.claimed_at, now()), now() - interval '1 hour'),
               now() + interval '1 minute'),
         public.menu_venue()
    FROM incoming i
   WHERE i.event IS NOT NULL
     AND public.analytics_event_allowed(i.event);

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$$;

-- ---------------------------------------------------------------------
-- 8. The kitchen estimate needs the table's token
-- ---------------------------------------------------------------------

-- Latest: 20261028100000. An order's estimate for the phone that holds its
-- table's token, and nobody else: the order id alone no longer answers.
DROP FUNCTION IF EXISTS public.guest_order_eta(uuid);

CREATE OR REPLACE FUNCTION public.guest_order_eta(_order_id uuid, _session_token text)
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
  IF nullif(btrim(COALESCE(_session_token, '')), '') IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT o.* INTO v_order
    FROM public.orders o
    JOIN public.table_sessions s ON s.id = o.table_session_id
   WHERE o.id = _order_id AND s.token = _session_token;
  IF NOT FOUND THEN RETURN NULL; END IF;

  -- Nothing to wait for.
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

  -- The whole order is only as fast as its slowest dish, but if we know
  -- nothing about any dish on it we say so rather than inventing a figure.
  IF v_known = 0 THEN
    RETURN jsonb_build_object('confidence', 'none', 'reason', 'no_prep_data');
  END IF;

  SELECT COALESCE(kitchen_capacity_minutes, 25)::numeric, COALESCE(kitchen_delay_minutes, 0)
    INTO v_capacity, v_delay
    FROM public.restaurant_settings WHERE venue_id = v_order.venue_id;

  -- Work ahead of this order, excluding its own lines.
  SELECT COALESCE(sum(oi.quantity * COALESCE(e.minutes, 8)), 0)
    INTO v_backlog
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    CROSS JOIN LATERAL public.item_prep_estimate(oi.menu_item_id) e
   WHERE oi.status IN ('pending', 'preparing')
     AND o.released_to_kitchen_at IS NOT NULL
     AND o.released_to_kitchen_at < v_order.released_to_kitchen_at
     AND o.status IN ('pending', 'confirmed', 'preparing')
     AND o.venue_id = v_order.venue_id;

  v_queue := v_backlog / GREATEST(v_capacity, 1);

  -- The manager's manual "we are slammed" dial still applies on top; it exists
  -- for the things no model sees, like one cook off sick.
  v_low := GREATEST(1, ceil(v_base + v_queue + v_delay))::int;
  v_high := GREATEST(v_low + 2, ceil((v_base * 1.35) + v_queue + v_delay))::int;

  v_confidence := CASE
    WHEN v_known < v_total THEN 'low'      -- some dish on the order is unknown
    WHEN v_observed = v_total THEN 'high'  -- every dish has real history
    ELSE 'medium'                          -- menu settings only
  END;

  RETURN jsonb_build_object(
    'confidence', v_confidence,
    'low_minutes', v_low,
    'high_minutes', v_high,
    'backlog_minutes', round(v_backlog, 1),
    'based_on', CASE WHEN v_observed = v_total THEN 'our own kitchen'
                     WHEN v_observed > 0 THEN 'part history, part menu'
                     ELSE 'menu settings' END,
    -- Enough to render "ready around 20:35" without a second round trip.
    'ready_from', now() + make_interval(mins => v_low),
    'ready_to', now() + make_interval(mins => v_high)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.guest_order_eta(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guest_order_eta(uuid, text) TO anon, authenticated;
