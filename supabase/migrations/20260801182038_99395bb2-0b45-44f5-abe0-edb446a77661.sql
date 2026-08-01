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
-- Item-level kitchen control, a bar station, an all-day prep view, and undo.
--
-- Three problems this solves, in order of how often they bite:
--
--  1. `order_items.status` has existed since the first migration, is fetched by
--     both staff screens, and is written by nothing. The kitchen can only
--     advance a whole order, so a table ordering a burger and a coffee has both
--     marked ready together.
--  2. Status is forward-only with no undo. A mis-tap on the full-width "Mark as
--     ready" button is permanently uncorrectable from any UI — the only escape
--     is cancel_order, which is manager-only once preparing.
--  3. Drinks wait behind food. La Soul has a separate bar; a coffee should fire
--     the moment it is ordered, not when the burger is plated.
--
-- DESIGN: item status is the truth, order status is a derived projection.
-- Two independent state machines over one board is a bug factory — a cook bumps
-- items, a waiter bumps the order, and the column disagrees with the card with
-- no tie-breaker. The derivation below can only ever move an order FORWARD, so
-- the existing forward-only `order_transition_allowed` table and the
-- `enforce_order_integrity` trigger are untouched on the normal path.
-- =====================================================================

-- =====================================================================
-- 1. Stations
-- =====================================================================

ALTER TABLE public.menu_items
  ADD COLUMN IF NOT EXISTS station text NOT NULL DEFAULT 'kitchen';

DO $$ BEGIN
  ALTER TABLE public.menu_items
    ADD CONSTRAINT menu_items_station_check CHECK (station IN ('kitchen', 'bar'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Best-effort first guess from the category name; management can correct any of
-- it in the menu editor afterwards.
UPDATE public.menu_items mi
   SET station = 'bar'
  FROM public.subcategories s
  JOIN public.categories c ON c.id = s.category_id
 WHERE s.id = mi.subcategory_id
   AND mi.station = 'kitchen'
   AND lower(c.name) IN ('drinks', 'drink', 'pića', 'pica', 'beverages', 'bar');

ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS station text NOT NULL DEFAULT 'kitchen',
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  ADD COLUMN IF NOT EXISTS ready_at timestamptz,
  ADD COLUMN IF NOT EXISTS served_at timestamptz,
  ADD COLUMN IF NOT EXISTS bumped_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

DO $$ BEGIN
  ALTER TABLE public.order_items
    ADD CONSTRAINT order_items_station_check CHECK (station IN ('kitchen', 'bar'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

UPDATE public.order_items oi
   SET station = mi.station
  FROM public.menu_items mi
 WHERE mi.id = oi.menu_item_id
   AND oi.station <> mi.station;

/**
 * Denormalise the station onto the line at insert time.
 *
 * Same reasoning as `unit_price`: re-categorising an item next month must not
 * retroactively move last week's tickets, and the all-day query then never has
 * to join menu_items. A trigger rather than a change to guest_place_order, so
 * every insert path is covered.
 */
CREATE OR REPLACE FUNCTION public.set_order_item_station()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  SELECT station INTO NEW.station FROM public.menu_items WHERE id = NEW.menu_item_id;
  NEW.station := COALESCE(NEW.station, 'kitchen');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_order_item_station ON public.order_items;
CREATE TRIGGER set_order_item_station
  BEFORE INSERT ON public.order_items
  FOR EACH ROW EXECUTE FUNCTION public.set_order_item_station();

-- =====================================================================
-- 2. Backfill item status from the parent order
--
-- The column is currently unread, so this is safe — and skipping it would make
-- the all-day view wrong on day one, counting every long-served line as open.
-- =====================================================================

UPDATE public.order_items oi
   SET status = CASE o.status
                  WHEN 'served'    THEN 'served'
                  WHEN 'ready'     THEN 'ready'
                  WHEN 'preparing' THEN 'preparing'
                  ELSE 'pending'
                END::public.order_item_status,
       ready_at  = CASE WHEN o.status IN ('ready', 'served') THEN COALESCE(oi.ready_at, o.ready_at) END,
       served_at = CASE WHEN o.status = 'served' THEN COALESCE(oi.served_at, o.served_at) END
  FROM public.orders o
 WHERE o.id = oi.order_id
   AND o.status <> 'cancelled';

-- =====================================================================
-- 3. Ranks and transition tables
-- =====================================================================

CREATE OR REPLACE FUNCTION public.order_status_rank(_s public.order_status)
RETURNS int LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE _s
    WHEN 'pending' THEN 10 WHEN 'confirmed' THEN 20 WHEN 'preparing' THEN 30
    WHEN 'ready' THEN 40 WHEN 'served' THEN 50 ELSE -1 END;
$$;

CREATE OR REPLACE FUNCTION public.order_item_status_rank(_s public.order_item_status)
RETURNS int LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE _s
    WHEN 'pending' THEN 10 WHEN 'preparing' THEN 20
    WHEN 'ready' THEN 30 WHEN 'served' THEN 40 ELSE -1 END;
$$;

/**
 * Which backwards moves an undo may make.
 *
 * Deliberately a SECOND table rather than new edges in
 * `order_transition_allowed`. That function is IMMUTABLE so it cannot express
 * "within 60 seconds", and `enforce_order_integrity` checks it unconditionally
 * — even under financial_ctx — so adding backwards edges there would make them
 * reachable from every direct staff UPDATE, not just from undo.
 */
CREATE OR REPLACE FUNCTION public.order_revert_allowed(
  _from public.order_status, _to public.order_status
)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE
    WHEN _from = 'ready'     AND _to IN ('preparing', 'confirmed') THEN true
    WHEN _from = 'preparing' AND _to IN ('confirmed', 'pending')   THEN true
    WHEN _from = 'confirmed' AND _to = 'pending'                   THEN true
    WHEN _from = 'served'    AND _to IN ('ready', 'preparing')     THEN true
    -- Never to or from the payment-gated states, and never out of cancelled.
    ELSE false
  END;
$$;

ALTER TABLE public.restaurant_settings
  ADD COLUMN IF NOT EXISTS kitchen_undo_seconds int NOT NULL DEFAULT 90
    CHECK (kitchen_undo_seconds BETWEEN 0 AND 300);

-- =====================================================================
-- 4. Guards on order_items
-- =====================================================================

/**
 * RLS grants staff `FOR ALL` on order_items, so the moment `status` becomes
 * meaningful any staff client could scribble on it. Same shape as
 * lasoul.financial_ctx: the RPC is the only door.
 */
CREATE OR REPLACE FUNCTION public.enforce_order_item_integrity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.order_id IS DISTINCT FROM OLD.order_id
     OR NEW.menu_item_id IS DISTINCT FROM OLD.menu_item_id
     OR NEW.unit_price IS DISTINCT FROM OLD.unit_price
     OR NEW.quantity IS DISTINCT FROM OLD.quantity
  THEN
    RAISE EXCEPTION 'Order lines cannot be re-priced or re-pointed once placed'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
     AND coalesce(current_setting('lasoul.item_ctx', true), '') <> 'on'
  THEN
    RAISE EXCEPTION 'Item status is changed by bumping it, not by writing to it'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_order_item_integrity ON public.order_items;
CREATE TRIGGER enforce_order_item_integrity
  BEFORE UPDATE ON public.order_items
  FOR EACH ROW EXECUTE FUNCTION public.enforce_order_item_integrity();

/**
 * Derive the order's status from its items.
 *
 *   all items ready          → ready
 *   any item preparing/ready → preparing
 *   otherwise                → unchanged
 *
 * `served` is never derived: a runner carries the whole tray, so per-item
 * served is bookkeeping nobody will do. `confirmed` is never derived either.
 * Both omissions halve the state space.
 *
 * RECURSION is prevented by statement order, not by a flag: the order-level
 * RPCs set orders.status FIRST and then cascade to items, so by the time this
 * fires the derived value equals the current one and the guarded UPDATE matches
 * zero rows. That is load-bearing — do not reorder those statements.
 */
CREATE OR REPLACE FUNCTION public.sync_order_status_from_items()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_order public.orders;
  v_total int;
  v_ready int;
  v_working int;
  v_derived public.order_status;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = NEW.order_id;
  IF NOT FOUND OR v_order.status IN ('awaiting_payment', 'payment_failed', 'cancelled', 'served') THEN
    RETURN NULL;
  END IF;

  SELECT count(*),
         count(*) FILTER (WHERE status IN ('ready', 'served')),
         count(*) FILTER (WHERE status IN ('preparing', 'ready', 'served'))
    INTO v_total, v_ready, v_working
    FROM public.order_items WHERE order_id = NEW.order_id;

  IF v_total = 0 THEN RETURN NULL; END IF;

  v_derived := CASE
    WHEN v_ready = v_total THEN 'ready'::public.order_status
    WHEN v_working > 0 THEN 'preparing'::public.order_status
    ELSE v_order.status
  END;

  -- Forward only. Runs unelevated, so enforce_order_integrity still validates
  -- the move — defence in depth at no cost.
  IF public.order_status_rank(v_derived) > public.order_status_rank(v_order.status) THEN
    UPDATE public.orders SET status = v_derived WHERE id = NEW.order_id;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS sync_order_status_from_items ON public.order_items;
CREATE TRIGGER sync_order_status_from_items
  AFTER UPDATE OF status ON public.order_items
  FOR EACH ROW EXECUTE FUNCTION public.sync_order_status_from_items();

-- =====================================================================
-- 5. Bumping
-- =====================================================================

/**
 * Move one line forward (or back, inside the undo window).
 *
 * The client states the TARGET state, never "next", so a double-tap on a laggy
 * tablet is a no-op rather than a two-state jump.
 */
CREATE OR REPLACE FUNCTION public.staff_bump_order_item(
  _item_id uuid,
  _status public.order_item_status
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item public.order_items;
  v_order public.orders;
  v_window int := COALESCE((SELECT kitchen_undo_seconds FROM public.restaurant_settings WHERE id = 1), 90);
  v_backwards boolean;
  v_left_at timestamptz;
BEGIN
  IF NOT public.is_staff_member() THEN
    RAISE EXCEPTION 'Only staff can bump items' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_item FROM public.order_items WHERE id = _item_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order line not found'; END IF;

  IF v_item.status = _status THEN
    RETURN jsonb_build_object('item_id', _item_id, 'item_status', _status, 'changed', false);
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = v_item.order_id;
  IF v_order.status IN ('awaiting_payment', 'payment_failed') THEN
    RAISE EXCEPTION 'This order has not been paid for yet — it is not in the kitchen';
  END IF;
  IF v_order.status = 'cancelled' THEN
    RAISE EXCEPTION 'This order was cancelled';
  END IF;

  v_backwards := public.order_item_status_rank(_status) < public.order_item_status_rank(v_item.status);

  IF v_backwards THEN
    -- Undo is time-boxed against the stamp of the state being left, so a
    -- mis-tap is recoverable and a half-hour-old mistake is not quietly rewritten.
    v_left_at := CASE v_item.status
      WHEN 'preparing' THEN v_item.started_at
      WHEN 'ready' THEN v_item.ready_at
      WHEN 'served' THEN v_item.served_at
      ELSE NULL END;

    IF v_left_at IS NULL OR v_left_at < now() - make_interval(secs => v_window) THEN
      RAISE EXCEPTION 'The undo window for this line has passed'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  PERFORM set_config('lasoul.item_ctx', 'on', true);

  UPDATE public.order_items
     SET status = _status,
         bumped_by = auth.uid(),
         started_at = CASE WHEN _status = 'preparing' THEN COALESCE(started_at, now())
                           WHEN v_backwards AND _status = 'pending' THEN NULL ELSE started_at END,
         ready_at   = CASE WHEN _status = 'ready' THEN COALESCE(ready_at, now())
                           WHEN v_backwards AND _status IN ('pending', 'preparing') THEN NULL ELSE ready_at END,
         served_at  = CASE WHEN _status = 'served' THEN COALESCE(served_at, now())
                           WHEN v_backwards THEN NULL ELSE served_at END
   WHERE id = _item_id;

  PERFORM public.write_audit(
    CASE WHEN v_backwards THEN 'order_item.reverted' ELSE 'order_item.bumped' END,
    'order_item', _item_id,
    jsonb_build_object('status', v_item.status),
    jsonb_build_object('status', _status));

  SELECT * INTO v_order FROM public.orders WHERE id = v_item.order_id;

  RETURN jsonb_build_object(
    'item_id', _item_id,
    'item_status', _status,
    'changed', true,
    'order_id', v_order.id,
    'order_status', v_order.status,
    'undo_seconds', v_window
  );
END;
$$;

REVOKE ALL ON FUNCTION public.staff_bump_order_item(uuid, public.order_item_status) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_bump_order_item(uuid, public.order_item_status) TO authenticated;

/** Bump several lines at once — "all seven portions of fries are up". */
CREATE OR REPLACE FUNCTION public.staff_bump_order_items(
  _item_ids uuid[],
  _status public.order_item_status
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_updated int := 0;
BEGIN
  IF NOT public.is_staff_member() THEN
    RAISE EXCEPTION 'Only staff can bump items' USING ERRCODE = 'insufficient_privilege';
  END IF;

  FOREACH v_id IN ARRAY COALESCE(_item_ids, '{}') LOOP
    -- Per-item so one ineligible line (cancelled order, closed undo window)
    -- does not silently abort the rest of the tray.
    BEGIN
      PERFORM public.staff_bump_order_item(v_id, _status);
      v_updated := v_updated + 1;
    EXCEPTION WHEN others THEN NULL;
    END;
  END LOOP;

  RETURN jsonb_build_object('updated', v_updated, 'requested', COALESCE(array_length(_item_ids, 1), 0));
END;
$$;

REVOKE ALL ON FUNCTION public.staff_bump_order_items(uuid[], public.order_item_status) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_bump_order_items(uuid[], public.order_item_status) TO authenticated;

-- =====================================================================
-- 6. Order-level undo
-- =====================================================================

/**
 * Let the integrity trigger accept a backwards move, but only from
 * staff_revert_order_status, and only for the edges in order_revert_allowed.
 */
CREATE OR REPLACE FUNCTION public.enforce_order_integrity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_privileged boolean := coalesce(current_setting('lasoul.financial_ctx', true), '') = 'on';
  v_reverting boolean := coalesce(current_setting('lasoul.revert_ctx', true), '') = 'on';
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
     AND NOT (v_reverting AND public.order_revert_allowed(OLD.status, NEW.status))
  THEN
    RAISE EXCEPTION 'Illegal order transition % -> %', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

/**
 * Undo an order-level bump.
 *
 * Time-boxed off the stamps the schema already keeps, so no audit-log lookup is
 * needed. Never re-fires a print. Never touches cancelled — that is the audited
 * money path, and cancel_order has already cancelled the tickets.
 */
CREATE OR REPLACE FUNCTION public.staff_revert_order_status(
  _order_id uuid,
  _to public.order_status,
  _reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders;
  v_window int := COALESCE((SELECT kitchen_undo_seconds FROM public.restaurant_settings WHERE id = 1), 90);
  v_left_at timestamptz;
  v_is_admin boolean := public.has_role(auth.uid(), 'admin'::public.app_role);
BEGIN
  IF NOT public.is_staff_member() THEN
    RAISE EXCEPTION 'Only staff can undo' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = _order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;

  IF NOT public.order_revert_allowed(v_order.status, _to) THEN
    RAISE EXCEPTION 'Cannot undo % back to %', v_order.status, _to
      USING ERRCODE = 'check_violation';
  END IF;

  v_left_at := CASE v_order.status
    WHEN 'confirmed' THEN v_order.confirmed_at
    WHEN 'preparing' THEN v_order.preparing_at
    WHEN 'ready' THEN v_order.ready_at
    WHEN 'served' THEN v_order.served_at
    ELSE NULL END;

  IF v_left_at IS NULL OR v_left_at < now() - make_interval(secs => v_window) THEN
    RAISE EXCEPTION 'The undo window has passed — ask a manager'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Money already moved: a manager decision, not a line-cook one.
  IF v_order.status = 'served' AND v_order.payment_status = 'paid' AND NOT v_is_admin THEN
    RAISE EXCEPTION 'A manager must undo a served order that has been paid for'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  PERFORM set_config('lasoul.revert_ctx', 'on', true);

  UPDATE public.orders
     SET status = _to,
         -- Clear only the stamp of the state being left. The earlier stamps
         -- stand: the order genuinely was in prep for that whole time.
         served_at    = CASE WHEN public.order_status_rank(_to) < 50 THEN NULL ELSE served_at END,
         ready_at     = CASE WHEN public.order_status_rank(_to) < 40 THEN NULL ELSE ready_at END,
         preparing_at = CASE WHEN public.order_status_rank(_to) < 30 THEN NULL ELSE preparing_at END,
         confirmed_at = CASE WHEN public.order_status_rank(_to) < 20 THEN NULL ELSE confirmed_at END
   WHERE id = _order_id;

  PERFORM set_config('lasoul.item_ctx', 'on', true);
  UPDATE public.order_items
     SET status = CASE
           WHEN _to = 'ready' THEN 'ready'
           WHEN _to IN ('preparing', 'confirmed') THEN 'preparing'
           ELSE 'pending' END::public.order_item_status,
         served_at = CASE WHEN public.order_status_rank(_to) < 50 THEN NULL ELSE served_at END,
         ready_at  = CASE WHEN public.order_status_rank(_to) < 40 THEN NULL ELSE ready_at END
   WHERE order_id = _order_id
     AND public.order_item_status_rank(status) > CASE
           WHEN _to = 'ready' THEN 30 WHEN _to IN ('preparing', 'confirmed') THEN 20 ELSE 10 END;

  PERFORM public.write_audit('order.status_reverted', 'order', _order_id,
    jsonb_build_object('status', v_order.status, 'age_seconds', round(EXTRACT(EPOCH FROM (now() - v_left_at)))),
    jsonb_build_object('status', _to), _reason);

  RETURN jsonb_build_object('status', _to, 'reverted_from', v_order.status);
END;
$$;

REVOKE ALL ON FUNCTION public.staff_revert_order_status(uuid, public.order_status, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_revert_order_status(uuid, public.order_status, text) TO authenticated;

-- =====================================================================
-- 7. Order-level status cascades to items
-- =====================================================================

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
  v_item_status public.order_item_status;
BEGIN
  IF NOT public.is_staff_member() THEN
    RAISE EXCEPTION 'Only staff can change an order status' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = _order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;

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

REVOKE ALL ON FUNCTION public.staff_update_order_status(uuid, public.order_status) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_update_order_status(uuid, public.order_status) TO authenticated;

-- =====================================================================
-- 8. All day
-- =====================================================================

/**
 * How much of each dish is outstanding, across every open order.
 *
 * In SQL rather than rolled up on the client because the board is paginated —
 * a client rollup is provably wrong past the row cap, and the failure is
 * SILENT. A missing order card is visible; an undercounted "8x Fries" is not,
 * and that is the number the cook batches against.
 *
 * The ids come back so "bump all fries" is one round trip against exactly what
 * was on screen, with no client-side re-derivation. They are returned SPLIT BY
 * STATUS, not as one list: "start all" applied to a line that is already up
 * would walk it BACKWARDS through the undo window, silently un-cooking a dish
 * the pass is waiting on. The caller must not have to filter to be safe.
 */
CREATE OR REPLACE FUNCTION public.kds_all_day(_station text DEFAULT NULL)
RETURNS TABLE(
  menu_item_id uuid,
  name text,
  station text,
  qty_pending int,
  qty_preparing int,
  qty_ready int,
  oldest_at timestamptz,
  pending_ids uuid[],
  open_ids uuid[]
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_staff_member() THEN
    RAISE EXCEPTION 'Only staff can read the kitchen view' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  SELECT oi.menu_item_id,
         COALESCE(mi.name, 'Unknown'),
         oi.station,
         COALESCE(sum(oi.quantity) FILTER (WHERE oi.status = 'pending'), 0)::int,
         COALESCE(sum(oi.quantity) FILTER (WHERE oi.status = 'preparing'), 0)::int,
         COALESCE(sum(oi.quantity) FILTER (WHERE oi.status = 'ready'), 0)::int,
         min(o.created_at),
         COALESCE(array_agg(oi.id ORDER BY o.created_at) FILTER (WHERE oi.status = 'pending'), '{}'),
         COALESCE(array_agg(oi.id ORDER BY o.created_at) FILTER (WHERE oi.status IN ('pending', 'preparing')), '{}')
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    LEFT JOIN public.menu_items mi ON mi.id = oi.menu_item_id
   WHERE o.status IN ('pending', 'confirmed', 'preparing', 'ready')
     AND o.released_to_kitchen_at IS NOT NULL
     AND oi.status <> 'served'
     AND (_station IS NULL OR oi.station = _station)
   GROUP BY oi.menu_item_id, mi.name, oi.station
   ORDER BY min(o.created_at);
END;
$$;

REVOKE ALL ON FUNCTION public.kds_all_day(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.kds_all_day(text) TO authenticated;

CREATE INDEX IF NOT EXISTS idx_order_items_open
  ON public.order_items(order_id) WHERE status <> 'served';
CREATE INDEX IF NOT EXISTS idx_order_items_station_status
  ON public.order_items(station, status);
