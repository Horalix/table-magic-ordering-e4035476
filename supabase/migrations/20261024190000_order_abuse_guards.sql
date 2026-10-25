-- =====================================================================
-- Fake orders: hold the suspicious ones, let staff decide
--
-- The venue QR is one printed code that never changes, and a phone that
-- scanned it once keeps it. Anyone with a photo of the code — or the link from
-- a group chat — can open any free table from the tram stop and order. A
-- pay-at-table order is released to the kitchen the moment it is inserted, so
-- the first anyone hears of it is the printer. Nothing about the order says
-- whether a person is sitting at that table.
--
-- Turning the printer off is not an option, and asking staff to confirm every
-- order would undo the reason the venue uses QR ordering. So this migration
-- does what a waiter would do: it lets ordinary orders through as before and
-- HOLDS the ones that look wrong, until a member of staff confirms or rejects
-- them from the kitchen display, the waiter phone or the floor monitor.
--
-- A held order is a normal pay-at-table order that has not been released:
--
--     status = 'pending' AND released_to_kitchen_at IS NULL
--                        AND held_reason IS NOT NULL
--
-- No new order_status value. The state machine, enforce_order_integrity and
-- every report keep working unchanged, and the kitchen already ignores
-- unreleased orders because that is how unpaid card orders are kept off it.
--
-- An order is held only while NO member of staff has done anything for its
-- table session yet (table_sessions.staff_seen_at). Once a waiter has set the
-- covers, taken a call, bumped a dish or confirmed a held order, the table is
-- known to be real and nothing more is held. The rules, each a nullable
-- setting where NULL switches it off:
--
--   outside_hours            restaurant_settings.service_open/service_close
--                            (Sarajevo wall clock, may cross midnight)
--   table_recently_blocked   staff blocked another session on this table in
--                            the last hour (always on)
--   auto_admitted            someone joined the session without approval
--                            (hold_auto_admitted)
--   second_session           another live session on the same table
--                            (hold_second_session)
--   venue_burst              more than hold_burst_sessions (3) unseen sessions
--                            opened within five minutes of this one
--   large_first_order        first order over hold_first_order_km (60 KM) or
--                            hold_first_order_items (10) portions
--   unpaid_exposure:<km>     released + held unpaid total would pass
--                            hold_unpaid_km (150 KM)
--
-- Also here, because each is one of the same holes:
--
--   * staff_release_held_order / staff_block_session / staff_mark_session_seen;
--   * cancelled orders count toward the 30-order cap, an order is capped at 20
--     lines and 60 portions;
--   * guest_start_table_session is serialised per table, so two phones that
--     scan in the same instant cannot both open a session;
--   * a join request is only auto-approved when the whole table has been idle
--     for two minutes, and a session admitted that way is marked so its next
--     order is held; join requests are capped per session;
--   * a venue-wide ceiling on analytics events.
--
-- Existing functions are changed by rewriting their live definitions, as the
-- earlier migrations do, and every rewrite raises if it did not match. Every
-- rewrite also checks for its own marker first, so the file can be applied
-- twice.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS held_reason text,
  ADD COLUMN IF NOT EXISTS held_at timestamptz;

COMMENT ON COLUMN public.orders.held_reason IS
  'Why this pay-at-table order is waiting for staff before it prints. NULL = not held. Cleared on release; held_at stays as history.';

ALTER TABLE public.table_sessions
  ADD COLUMN IF NOT EXISTS staff_seen_at timestamptz,
  ADD COLUMN IF NOT EXISTS blocked_at timestamptz,
  ADD COLUMN IF NOT EXISTS auto_admitted_at timestamptz;

COMMENT ON COLUMN public.table_sessions.staff_seen_at IS
  'First time a member of staff did anything for this session. From then on nothing is held.';
COMMENT ON COLUMN public.table_sessions.blocked_at IS
  'Staff blocked this session as fake. Every guest RPC refuses it.';
COMMENT ON COLUMN public.table_sessions.auto_admitted_at IS
  'Someone joined this session through auto-approval, without the host or staff saying yes.';

ALTER TABLE public.restaurant_settings
  ADD COLUMN IF NOT EXISTS hold_first_order_km numeric(10,2) DEFAULT 60,
  ADD COLUMN IF NOT EXISTS hold_first_order_items integer DEFAULT 10,
  ADD COLUMN IF NOT EXISTS hold_unpaid_km numeric(10,2) DEFAULT 150,
  ADD COLUMN IF NOT EXISTS hold_burst_sessions integer DEFAULT 3,
  ADD COLUMN IF NOT EXISTS hold_auto_admitted boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS hold_second_session boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS service_open time,
  ADD COLUMN IF NOT EXISTS service_close time;

-- A zero or negative threshold would hold every order; NULL is how a rule is
-- switched off, so say that instead of silently accepting nonsense.
DO $$ BEGIN
  ALTER TABLE public.restaurant_settings ADD CONSTRAINT restaurant_settings_hold_thresholds_positive CHECK (
    (hold_first_order_km IS NULL OR hold_first_order_km > 0)
    AND (hold_first_order_items IS NULL OR hold_first_order_items > 0)
    AND (hold_unpaid_km IS NULL OR hold_unpaid_km > 0)
    AND (hold_burst_sessions IS NULL OR hold_burst_sessions > 0));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- The staff screens ask for exactly this set, on every realtime nudge.
CREATE INDEX IF NOT EXISTS idx_orders_held
  ON public.orders(created_at)
  WHERE held_reason IS NOT NULL AND released_to_kitchen_at IS NULL;

-- The venue-wide analytics ceiling counts by server time; occurred_at is
-- partly client-claimed and cannot be trusted for a rate limit.
CREATE INDEX IF NOT EXISTS idx_analytics_created ON public.analytics_events(created_at);

-- ---------------------------------------------------------------------
-- 2. Deciding whether to hold
-- ---------------------------------------------------------------------

/**
 * Is `_at` inside service hours? Both ends are Sarajevo wall-clock times.
 *
 * NULL at either end means there are no hours to be outside of. Hours may
 * cross midnight (18:00–02:00 means after six OR before two), and equal ends
 * mean open around the clock rather than never.
 */
CREATE OR REPLACE FUNCTION public.in_service_hours(_at time, _open time, _close time)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN _open IS NULL OR _close IS NULL OR _open = _close THEN true
    WHEN _open < _close THEN _at >= _open AND _at < _close
    ELSE _at >= _open OR _at < _close
  END;
$$;

/**
 * Should this pay-at-table order wait for staff? Returns the reason, or NULL.
 *
 * Kept separate from guest_place_order so each rule can be tested on its own
 * and so the order function only learns one new line. `_items_total` is the
 * food and drink total without tip; `_item_count` is portions, not lines.
 *
 * Rules are checked from the most to the least suspicious, so the reason
 * staff read is the one that matters most.
 */
CREATE OR REPLACE FUNCTION public.order_hold_reason(_session_id uuid, _items_total numeric, _item_count integer)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session public.table_sessions;
  v_cfg public.restaurant_settings;
  v_timeout int := public.session_idle_timeout();
  v_prior int;
  v_exposure numeric;
  v_burst int;
BEGIN
  SELECT * INTO v_session FROM public.table_sessions WHERE id = _session_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- A member of staff has dealt with this table: it is real.
  IF v_session.staff_seen_at IS NOT NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_cfg FROM public.restaurant_settings WHERE id = 1;

  IF NOT public.in_service_hours((now() AT TIME ZONE 'Europe/Sarajevo')::time,
                                 v_cfg.service_open, v_cfg.service_close) THEN
    RETURN 'outside_hours';
  END IF;

  -- Blocking a session ends it; the same person can scan again and start a
  -- fresh one on the same table. For an hour, that fresh one waits.
  IF EXISTS (
    SELECT 1 FROM public.table_sessions s
     WHERE s.table_id = v_session.table_id
       AND s.id <> v_session.id
       AND s.blocked_at > now() - interval '1 hour'
  ) THEN
    RETURN 'table_recently_blocked';
  END IF;

  IF COALESCE(v_cfg.hold_auto_admitted, false) AND v_session.auto_admitted_at IS NOT NULL THEN
    RETURN 'auto_admitted';
  END IF;

  IF COALESCE(v_cfg.hold_second_session, false) AND EXISTS (
    SELECT 1 FROM public.table_sessions s
     WHERE s.table_id = v_session.table_id
       AND s.id <> v_session.id
       AND s.is_active
       AND s.blocked_at IS NULL
       AND COALESCE(s.last_heartbeat_at, s.opened_at) > now() - make_interval(mins => v_timeout)
  ) THEN
    RETURN 'second_session';
  END IF;

  -- Many tables appearing at once is what a script, or a photo of the QR
  -- passed around a group chat, looks like. The window is anchored on THIS
  -- session's opening rather than on now(), so opening ten sessions and
  -- waiting five minutes before ordering does not get under it, and an old
  -- table is not held because of an unrelated rush.
  IF v_cfg.hold_burst_sessions IS NOT NULL THEN
    SELECT count(*) INTO v_burst
      FROM public.table_sessions s
     WHERE s.staff_seen_at IS NULL
       AND s.opened_at BETWEEN v_session.opened_at - interval '5 minutes'
                           AND v_session.opened_at + interval '5 minutes';
    IF v_burst > v_cfg.hold_burst_sessions THEN
      RETURN 'venue_burst';
    END IF;
  END IF;

  SELECT count(*) INTO v_prior
    FROM public.orders o
   WHERE o.table_session_id = _session_id AND o.status <> 'cancelled';
  IF v_prior = 0 AND (
       (v_cfg.hold_first_order_km IS NOT NULL AND _items_total > v_cfg.hold_first_order_km)
    OR (v_cfg.hold_first_order_items IS NOT NULL AND _item_count > v_cfg.hold_first_order_items)
  ) THEN
    RETURN 'large_first_order';
  END IF;

  -- Released and held orders the table has not paid for. Card orders still
  -- waiting for money are not exposure; nothing was cooked for them.
  IF v_cfg.hold_unpaid_km IS NOT NULL THEN
    SELECT COALESCE(sum(o.total), 0) INTO v_exposure
      FROM public.orders o
     WHERE o.table_session_id = _session_id
       AND o.status NOT IN ('cancelled', 'awaiting_payment', 'payment_failed')
       AND o.payment_status NOT IN ('paid', 'refunded', 'partially_refunded');
    IF v_exposure + _items_total > v_cfg.hold_unpaid_km THEN
      -- The threshold travels with the reason so the staff card can say
      -- "Over 150 KM unpaid" without a second query.
      RETURN 'unpaid_exposure:' || rtrim(rtrim(v_cfg.hold_unpaid_km::text, '0'), '.');
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.in_service_hours(time, time, time) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.in_service_hours(time, time, time) TO anon, authenticated;
-- Internal: guests must not be able to probe the thresholds one call at a time.
REVOKE ALL ON FUNCTION public.order_hold_reason(uuid, numeric, integer) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. "A member of staff has seen this table"
-- ---------------------------------------------------------------------

/** Stamp a session as seen by staff. Only the first stamp is kept. Internal. */
CREATE OR REPLACE FUNCTION public.mark_session_seen(_session_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.table_sessions
     SET staff_seen_at = now()
   WHERE id = _session_id AND staff_seen_at IS NULL;
$$;

REVOKE ALL ON FUNCTION public.mark_session_seen(uuid) FROM PUBLIC, anon, authenticated;

/**
 * The explicit version, for a waiter who has walked past the table and seen
 * people sitting at it.
 */
CREATE OR REPLACE FUNCTION public.staff_mark_session_seen(_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_staff_member() THEN
    RAISE EXCEPTION 'Only staff can do this' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.table_sessions WHERE id = _session_id) THEN
    RAISE EXCEPTION 'Table session not found';
  END IF;
  PERFORM public.mark_session_seen(_session_id);
  RETURN jsonb_build_object('seen', true);
END;
$$;

REVOKE ALL ON FUNCTION public.staff_mark_session_seen(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.staff_mark_session_seen(uuid) TO authenticated;

/*
 * Everything else a member of staff does for a table marks it seen too. That
 * is done with triggers rather than by editing a dozen staff functions: it
 * covers every route (RPCs, the admin screens, a direct UPDATE under RLS) and
 * cannot be forgotten by the next staff function someone writes.
 *
 * "Staff" is is_staff_member(), i.e. the signed-in caller. Guest RPCs run as
 * anon, the payment callback and cron run without a user, so none of those
 * count — which is the point.
 *
 * Cancelling an order does NOT mark the table seen: rejecting a fake order
 * must not wave the next one from the same phone straight through.
 */
CREATE OR REPLACE FUNCTION public.mark_session_seen_by_staff()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session uuid;
BEGIN
  IF NOT public.is_staff_member() THEN
    RETURN NULL;
  END IF;

  IF TG_TABLE_NAME = 'orders' THEN
    IF NEW.status = 'cancelled' THEN RETURN NULL; END IF;
    v_session := NEW.table_session_id;
  ELSIF TG_TABLE_NAME = 'order_items' THEN
    SELECT o.table_session_id INTO v_session
      FROM public.orders o WHERE o.id = NEW.order_id AND o.status <> 'cancelled';
  ELSE
    -- waiter_calls, bill_requests
    v_session := NEW.table_session_id;
  END IF;

  IF v_session IS NOT NULL THEN
    PERFORM public.mark_session_seen(v_session);
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_session_seen_by_staff() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_staff_seen_orders ON public.orders;
CREATE TRIGGER trg_staff_seen_orders
  AFTER UPDATE ON public.orders
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status
        OR OLD.payment_status IS DISTINCT FROM NEW.payment_status
        OR OLD.released_to_kitchen_at IS DISTINCT FROM NEW.released_to_kitchen_at)
  EXECUTE FUNCTION public.mark_session_seen_by_staff();

DROP TRIGGER IF EXISTS trg_staff_seen_order_items ON public.order_items;
CREATE TRIGGER trg_staff_seen_order_items
  AFTER UPDATE ON public.order_items
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.mark_session_seen_by_staff();

DROP TRIGGER IF EXISTS trg_staff_seen_waiter_calls ON public.waiter_calls;
CREATE TRIGGER trg_staff_seen_waiter_calls
  AFTER UPDATE ON public.waiter_calls
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.mark_session_seen_by_staff();

DROP TRIGGER IF EXISTS trg_staff_seen_bill_requests ON public.bill_requests;
CREATE TRIGGER trg_staff_seen_bill_requests
  AFTER UPDATE ON public.bill_requests
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.mark_session_seen_by_staff();

/** Covers are only ever set by a waiter standing at the table. */
CREATE OR REPLACE FUNCTION public.mark_session_seen_on_covers()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_staff_member() THEN
    NEW.staff_seen_at := COALESCE(NEW.staff_seen_at, now());
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_session_seen_on_covers() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_staff_seen_covers ON public.table_sessions;
CREATE TRIGGER trg_staff_seen_covers
  BEFORE UPDATE ON public.table_sessions
  FOR EACH ROW
  WHEN (OLD.covers IS DISTINCT FROM NEW.covers)
  EXECUTE FUNCTION public.mark_session_seen_on_covers();

/*
 * A held order cannot be cooked around. Without this, a cook bumping a line of
 * a held order (or a waiter advancing it from a list that does not filter
 * holds) would move it into the kitchen flow with no ticket and no decision.
 * The only ways out of a hold are staff_release_held_order and cancelling.
 */
CREATE OR REPLACE FUNCTION public.guard_held_order()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.held_reason IS NOT NULL AND OLD.released_to_kitchen_at IS NULL
     AND NEW.released_to_kitchen_at IS NULL AND NEW.status <> 'cancelled'
     AND (NEW.status IS DISTINCT FROM OLD.status OR NEW.held_reason IS NULL)
  THEN
    RAISE EXCEPTION 'This order is waiting for a member of staff to confirm it'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_held_order ON public.orders;
CREATE TRIGGER trg_guard_held_order
  BEFORE UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_held_order();

-- ---------------------------------------------------------------------
-- 4. Staff decisions
-- ---------------------------------------------------------------------

/**
 * Confirm a held order: it prints now, exactly as it would have on arrival.
 *
 * Idempotent: two waiters tapping Confirm on two screens produce one ticket.
 * The row lock makes the second one wait and then find it already released.
 * Rejecting is cancel_order() with a reason, the same as any void.
 */
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

REVOKE ALL ON FUNCTION public.staff_release_held_order(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.staff_release_held_order(uuid) TO authenticated;

/**
 * This table is fake: void what has not been made, end the session, and make
 * every guest RPC refuse it from now on.
 *
 * Only orders nobody has started and nobody has paid for are cancelled, and
 * only if no printer has taken their ticket yet. Anything already printed,
 * in production or paid stays, so staff can see it and decide by hand; the
 * result says how many were left.
 */
CREATE OR REPLACE FUNCTION public.staff_block_session(_session_id uuid, _reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session public.table_sessions;
  v_reason text := COALESCE(nullif(left(trim(coalesce(_reason, '')), 400), ''), 'Blocked by staff');
  v_me uuid := auth.uid();
  v_cancelled uuid[];
  v_kept int;
BEGIN
  IF NOT public.is_staff_member() THEN
    RAISE EXCEPTION 'Only staff can block a table' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_session FROM public.table_sessions WHERE id = _session_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Table session not found';
  END IF;

  IF v_session.blocked_at IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'already_blocked', 'cancelled_orders', 0);
  END IF;

  PERFORM set_config('lasoul.financial_ctx', 'on', true);

  WITH doomed AS (
    SELECT o.id
      FROM public.orders o
     WHERE o.table_session_id = _session_id
       AND o.status IN ('pending', 'confirmed')
       AND o.payment_status NOT IN ('paid', 'refunded', 'partially_refunded')
       AND NOT EXISTS (
         SELECT 1 FROM public.order_ticket_events te
          WHERE te.order_id = o.id
            AND (te.printed_at IS NOT NULL OR te.status IN ('claimed', 'printed')))
     FOR UPDATE
  ), done AS (
    UPDATE public.orders o
       SET status = 'cancelled',
           cancelled_at = now(),
           cancelled_by = v_me,
           cancel_reason = left('Table blocked: ' || v_reason, 500)
      FROM doomed d
     WHERE o.id = d.id
    RETURNING o.id
  )
  SELECT COALESCE(array_agg(id), '{}') INTO v_cancelled FROM done;

  UPDATE public.order_ticket_events
     SET status = 'cancelled', updated_at = now()
   WHERE order_id = ANY(v_cancelled) AND status IN ('queued', 'exported', 'failed');

  SELECT count(*) INTO v_kept
    FROM public.orders
   WHERE table_session_id = _session_id AND status <> 'cancelled';

  UPDATE public.table_sessions
     SET is_active = false,
         closed_at = COALESCE(closed_at, now()),
         blocked_at = now()
   WHERE id = _session_id;

  UPDATE public.session_join_requests
     SET status = 'declined', resolved_by_name = 'staff'
   WHERE table_session_id = _session_id AND status = 'pending';

  UPDATE public.waiter_calls
     SET status = 'resolved', resolved_at = now(), resolved_by = v_me
   WHERE table_session_id = _session_id AND status <> 'resolved';

  UPDATE public.bill_requests
     SET status = 'resolved', resolved_at = now(), resolved_by = v_me
   WHERE table_session_id = _session_id AND status <> 'resolved';

  PERFORM public.write_audit('table_session.blocked', 'table_session', _session_id,
    jsonb_build_object('is_active', v_session.is_active, 'table_id', v_session.table_id),
    jsonb_build_object('blocked', true, 'cancelled_orders', to_jsonb(v_cancelled), 'orders_left', v_kept),
    v_reason);

  RETURN jsonb_build_object(
    'status', 'blocked',
    'cancelled_orders', COALESCE(array_length(v_cancelled, 1), 0),
    'orders_left', v_kept);
END;
$$;

REVOKE ALL ON FUNCTION public.staff_block_session(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.staff_block_session(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------
-- 5. Rewrites of live functions
-- ---------------------------------------------------------------------

-- 5a. assert_guest_session: a blocked session is dead to every guest RPC.
-- Blocking also deactivates it, but is_active is the flag other code flips
-- back and forth; blocked_at is only ever set.
DO $$
DECLARE
  v_def text;
  v_before text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'assert_guest_session';
  IF v_def IS NULL THEN RAISE EXCEPTION 'assert_guest_session is missing'; END IF;
  v_def := replace(v_def, chr(13) || chr(10), chr(10));

  IF position('blocked_at IS NULL' in v_def) > 0 THEN
    RAISE NOTICE 'assert_guest_session already refuses blocked sessions';
    RETURN;
  END IF;

  v_before := v_def;
  v_def := replace(v_def,
    '     AND token = _session_token
     AND is_active = true
',
    '     AND token = _session_token
     AND is_active = true
     AND blocked_at IS NULL
');
  IF v_def = v_before THEN RAISE EXCEPTION 'assert_guest_session rewrite: session filter not found'; END IF;

  EXECUTE v_def;
END $$;

-- 5b. guest_place_order: caps, and the hold.
DO $$
DECLARE
  v_def text;
  v_before text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'guest_place_order';
  IF v_def IS NULL THEN RAISE EXCEPTION 'guest_place_order is missing — migrations are out of order'; END IF;
  v_def := replace(v_def, chr(13) || chr(10), chr(10));

  IF position('order_hold_reason' in v_def) > 0 THEN
    RAISE NOTICE 'guest_place_order already holds suspicious orders';
    RETURN;
  END IF;

  v_before := v_def;
  v_def := replace(v_def,
    '  v_unavailable_ids text;
',
    '  v_unavailable_ids text;
  v_qty int;
  v_hold text;
');
  IF v_def = v_before THEN RAISE EXCEPTION 'guest_place_order rewrite: declarations not found'; END IF;

  -- Twenty lines and sixty portions is a very large table. Each line is still
  -- clamped to 1..10 further down; this bounds the order as a whole.
  v_before := v_def;
  v_def := replace(v_def,
    '  IF v_item_count < 1 OR v_item_count > 40 THEN
    RAISE EXCEPTION ''Invalid order size'';
  END IF;
',
    '  IF v_item_count < 1 OR v_item_count > 20 THEN
    RAISE EXCEPTION ''Invalid order size'';
  END IF;

  SELECT COALESCE(sum(LEAST(GREATEST(COALESCE((item->>''quantity'')::int, 1), 1), 10)), 0)::int
    INTO v_qty
    FROM jsonb_array_elements(_items) AS item;
  IF v_qty > 60 THEN
    RAISE EXCEPTION ''Invalid order size'';
  END IF;
');
  IF v_def = v_before THEN RAISE EXCEPTION 'guest_place_order rewrite: size check not found'; END IF;

  -- A cancelled order still came from this session. Not counting it let a
  -- phone place, get voided, and place again without end.
  v_before := v_def;
  v_def := replace(v_def,
    '   WHERE table_session_id = v_session.id AND status <> ''cancelled'';
  IF v_order_count >= 30 THEN',
    '   WHERE table_session_id = v_session.id;
  IF v_order_count >= 30 THEN');
  IF v_def = v_before THEN RAISE EXCEPTION 'guest_place_order rewrite: order cap not found'; END IF;

  v_before := v_def;
  v_def := replace(v_def,
    '  v_status := CASE WHEN v_is_card THEN ''awaiting_payment''::public.order_status
                   ELSE ''pending''::public.order_status END;
',
    '  v_status := CASE WHEN v_is_card THEN ''awaiting_payment''::public.order_status
                   ELSE ''pending''::public.order_status END;

  -- Pay-at-table orders print on arrival. The suspicious ones wait for staff
  -- instead (see order_hold_reason). Card orders are already gated on money.
  IF NOT v_is_card THEN
    v_hold := public.order_hold_reason(v_session.id, v_items_total, v_qty);
  END IF;
');
  IF v_def = v_before THEN RAISE EXCEPTION 'guest_place_order rewrite: status assignment not found'; END IF;

  v_before := v_def;
  v_def := replace(v_def,
    'payment_method, payment_status, order_code, released_to_kitchen_at, client_order_id
  )',
    'payment_method, payment_status, order_code, released_to_kitchen_at, client_order_id,
    held_reason, held_at
  )');
  IF v_def = v_before THEN RAISE EXCEPTION 'guest_place_order rewrite: insert columns not found'; END IF;

  v_before := v_def;
  v_def := replace(v_def,
    '    CASE WHEN v_is_card THEN NULL ELSE now() END,
    _client_order_id
  )
  RETURNING * INTO v_order;',
    '    CASE WHEN v_is_card OR v_hold IS NOT NULL THEN NULL ELSE now() END,
    _client_order_id,
    v_hold,
    CASE WHEN v_hold IS NULL THEN NULL ELSE now() END
  )
  RETURNING * INTO v_order;');
  IF v_def = v_before THEN RAISE EXCEPTION 'guest_place_order rewrite: insert values not found'; END IF;

  v_before := v_def;
  v_def := replace(v_def,
    '  IF NOT v_is_card THEN
    v_ticket_id := public.enqueue_station_tickets(v_order.id);',
    '  IF NOT v_is_card AND v_hold IS NULL THEN
    v_ticket_id := public.enqueue_station_tickets(v_order.id);');
  IF v_def = v_before THEN RAISE EXCEPTION 'guest_place_order rewrite: ticket enqueue not found'; END IF;

  -- The guest screen says "your waiter will confirm it"; it never shows why.
  v_before := v_def;
  v_def := replace(v_def,
    '    ''ticket_id'', v_ticket_id
  );',
    '    ''ticket_id'', v_ticket_id,
    ''held'', v_hold IS NOT NULL,
    ''held_reason'', v_hold
  );');
  IF v_def = v_before THEN RAISE EXCEPTION 'guest_place_order rewrite: result not found'; END IF;

  -- A replayed checkout must not tell the guest a held order is cooking.
  v_before := v_def;
  v_def := replace(v_def,
    '        ''replayed'', true
      );',
    '        ''replayed'', true,
        ''held'', v_order.held_reason IS NOT NULL AND v_order.released_to_kitchen_at IS NULL
      );');
  IF v_def = v_before THEN RAISE EXCEPTION 'guest_place_order rewrite: replay result not found'; END IF;

  EXECUTE v_def;
END $$;

-- 5c. guest_get_tab: the running tab says which orders are waiting for staff.
DO $$
DECLARE
  v_def text;
  v_before text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'guest_get_tab';
  IF v_def IS NULL THEN RAISE EXCEPTION 'guest_get_tab is missing'; END IF;
  v_def := replace(v_def, chr(13) || chr(10), chr(10));

  IF position('''held''' in v_def) > 0 THEN
    RAISE NOTICE 'guest_get_tab already reports held orders';
    RETURN;
  END IF;

  v_before := v_def;
  v_def := replace(v_def,
    '             ''created_at'', o.created_at,
',
    '             ''created_at'', o.created_at,
             ''held'', o.held_reason IS NOT NULL AND o.released_to_kitchen_at IS NULL,
');
  IF v_def = v_before THEN RAISE EXCEPTION 'guest_get_tab rewrite: order fields not found'; END IF;

  EXECUTE v_def;
END $$;

-- 5d. guest_start_table_session: one session per table, even under a race;
-- and a phone that was just blocked from a table does not get a fresh session
-- there by scanning again.
DO $$
DECLARE
  v_def text;
  v_before text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'guest_start_table_session';
  IF v_def IS NULL THEN RAISE EXCEPTION 'guest_start_table_session is missing'; END IF;
  v_def := replace(v_def, chr(13) || chr(10), chr(10));

  IF position('pg_advisory_xact_lock' in v_def) > 0 THEN
    RAISE NOTICE 'guest_start_table_session already serialised';
    RETURN;
  END IF;

  v_before := v_def;
  v_def := replace(v_def,
    '  IF v_table.id IS NULL THEN
    RETURN jsonb_build_object(''status'', ''invalid'');
  END IF;
',
    '  IF v_table.id IS NULL THEN
    RETURN jsonb_build_object(''status'', ''invalid'');
  END IF;

  -- Two phones scanning the same table in the same second both found no
  -- session and both opened one. Held until commit, so the second caller sees
  -- the first one''s session and is offered a join instead.
  PERFORM pg_advisory_xact_lock(hashtext(v_table.id::text));

  IF nullif(_client_id, '''') IS NOT NULL AND EXISTS (
    SELECT 1
      FROM public.table_sessions bs
      LEFT JOIN public.session_join_requests jr
        ON jr.table_session_id = bs.id AND jr.status = ''approved'' AND jr.client_id = _client_id
     WHERE bs.table_id = v_table.id
       AND bs.blocked_at > now() - interval ''12 hours''
       AND (bs.host_client_id = _client_id OR jr.id IS NOT NULL)
  ) THEN
    RETURN jsonb_build_object(''status'', ''invalid'');
  END IF;
');
  IF v_def = v_before THEN RAISE EXCEPTION 'guest_start_table_session rewrite: table check not found'; END IF;

  EXECUTE v_def;
END $$;

-- The lock above is the real guarantee. The index is a second one, but only
-- if today's data already satisfies it: a failed CREATE would abort the whole
-- migration on a Friday night because one forgotten session never closed.
--
-- It covers sessions a guest opened (guest_start_table_session always records
-- the host's device), not every row: reporting and test fixtures create
-- active sessions by hand without one, and those are not what the race made.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.table_sessions
     WHERE is_active AND host_client_id IS NOT NULL
     GROUP BY table_id HAVING count(*) > 1
  ) THEN
    RAISE NOTICE 'Some tables have more than one active guest session; skipping table_sessions_one_active_per_table. Close the extras and create it by hand.';
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS table_sessions_one_active_per_table
      ON public.table_sessions(table_id) WHERE is_active AND host_client_id IS NOT NULL;
  END IF;
END $$;

-- 5e. guest_auto_approve_join_request: only when nobody is minding the table.
-- Thirty seconds of a host not looking at their phone was enough to hand a
-- stranger the session token. Every phone in a session heartbeats every 30 s
-- while the menu is open, so two quiet minutes means nobody at the table has
-- it open — the case auto-approval exists for. Otherwise the request waits
-- for the host. A session that let someone in this way is marked, and its
-- next order is held until staff have seen the table.
DO $$
DECLARE
  v_def text;
  v_before text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'guest_auto_approve_join_request';
  IF v_def IS NULL THEN RAISE EXCEPTION 'guest_auto_approve_join_request is missing'; END IF;
  v_def := replace(v_def, chr(13) || chr(10), chr(10));

  IF position('auto_admitted_at' in v_def) > 0 THEN
    RAISE NOTICE 'guest_auto_approve_join_request already checks the host';
    RETURN;
  END IF;

  v_before := v_def;
  v_def := replace(v_def,
    '     AND created_at <= now() - interval ''30 seconds''
   RETURNING * INTO v_request;',
    '     AND created_at <= now() - interval ''30 seconds''
     AND COALESCE(v_session.last_heartbeat_at, v_session.opened_at) <= now() - interval ''2 minutes''
     AND v_session.blocked_at IS NULL
   RETURNING * INTO v_request;');
  IF v_def = v_before THEN RAISE EXCEPTION 'guest_auto_approve_join_request rewrite: approval filter not found'; END IF;

  v_before := v_def;
  v_def := replace(v_def,
    '  RETURN jsonb_build_object(
    ''status'', ''approved'',',
    '  UPDATE public.table_sessions
     SET auto_admitted_at = COALESCE(auto_admitted_at, now())
   WHERE id = v_session.id;

  RETURN jsonb_build_object(
    ''status'', ''approved'',');
  IF v_def = v_before THEN RAISE EXCEPTION 'guest_auto_approve_join_request rewrite: result not found'; END IF;

  EXECUTE v_def;
END $$;

-- 5f. enforce_join_request_limits: a fresh client id per request got round
-- the one-pending-per-device rule, so a script could fill a host's screen.
DO $$
DECLARE
  v_def text;
  v_before text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'enforce_join_request_limits';
  IF v_def IS NULL THEN RAISE EXCEPTION 'enforce_join_request_limits is missing'; END IF;
  v_def := replace(v_def, chr(13) || chr(10), chr(10));

  IF position('v_open_requests' in v_def) > 0 THEN
    RAISE NOTICE 'enforce_join_request_limits already caps per session';
    RETURN;
  END IF;

  v_before := v_def;
  v_def := replace(v_def,
    '  v_pending int;
',
    '  v_pending int;
  v_open_requests int;
  v_hour_requests int;
');
  IF v_def = v_before THEN RAISE EXCEPTION 'enforce_join_request_limits rewrite: declarations not found'; END IF;

  v_before := v_def;
  v_def := replace(v_def,
    '  IF v_pending > 0 THEN
    RAISE EXCEPTION ''You already have a pending request'';
  END IF;
',
    '  IF v_pending > 0 THEN
    RAISE EXCEPTION ''You already have a pending request'';
  END IF;

  SELECT count(*) FILTER (WHERE status = ''pending''),
         count(*) FILTER (WHERE created_at > now() - interval ''1 hour'')
    INTO v_open_requests, v_hour_requests
    FROM public.session_join_requests
   WHERE table_session_id = NEW.table_session_id;
  IF v_open_requests >= 5 OR v_hour_requests >= 20 THEN
    RAISE EXCEPTION ''Too many requests to join this table — please ask a waiter'';
  END IF;
');
  IF v_def = v_before THEN RAISE EXCEPTION 'enforce_join_request_limits rewrite: duplicate check not found'; END IF;

  EXECUTE v_def;
END $$;

-- 5g. record_analytics_events: the per-visit cap is per a client-chosen id,
-- so a loop with a fresh visit id each time was unlimited. A venue-wide
-- ceiling stops that filling the table. Three thousand a minute is about
-- fifty phones browsing hard at once — well above a full terrace.
DO $$
DECLARE
  v_def text;
  v_before text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'record_analytics_events';
  IF v_def IS NULL THEN RAISE EXCEPTION 'record_analytics_events is missing'; END IF;
  v_def := replace(v_def, chr(13) || chr(10), chr(10));

  IF position('v_venue_recent' in v_def) > 0 THEN
    RAISE NOTICE 'record_analytics_events already has a venue cap';
    RETURN;
  END IF;

  v_before := v_def;
  v_def := replace(v_def,
    '  v_recent int;
',
    '  v_recent int;
  v_venue_recent int;
');
  IF v_def = v_before THEN RAISE EXCEPTION 'record_analytics_events rewrite: declarations not found'; END IF;

  v_before := v_def;
  v_def := replace(v_def,
    '  IF v_recent > 500 THEN
    RETURN 0;
  END IF;
',
    '  IF v_recent > 500 THEN
    RETURN 0;
  END IF;

  -- Bounded count: stop at the cap rather than counting a flood.
  SELECT count(*) INTO v_venue_recent
    FROM (SELECT 1 FROM public.analytics_events
           WHERE created_at > now() - interval ''1 minute''
           LIMIT 3000) recent;
  IF v_venue_recent >= 3000 THEN
    RETURN 0;
  END IF;
');
  IF v_def = v_before THEN RAISE EXCEPTION 'record_analytics_events rewrite: visit cap not found'; END IF;

  EXECUTE v_def;
END $$;

-- Internal: changes data, so not callable by guests or staff through the API;
-- the scheduler and the server role run it.
REVOKE ALL ON FUNCTION public.mark_session_seen(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_session_seen(uuid) TO service_role;
