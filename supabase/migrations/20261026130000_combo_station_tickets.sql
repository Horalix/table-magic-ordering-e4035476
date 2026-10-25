-- =====================================================================
-- Combo parts reach their own station
--
-- A combo is ONE order line (order_items) whose station is the combo dish's
-- own — usually 'kitchen' — with what was chosen frozen in
-- `order_items.components` (20261026100000_promotions.sql):
--
--   [{ slot_label, item_id, name, name_bs, name_ar, station }, …]
--
-- The station ticket was built from `WHERE oi.station = v_station` alone,
-- so the drink of a burger combo never reached the bar: an order of one
-- combo produced a kitchen ticket and NO bar ticket at all. The drink was
-- on the kitchen ticket, marked [BAR], and depended on somebody walking it
-- over — which is exactly the step that gets skipped on a busy night.
--
-- This migration:
--
--   1. Restates enqueue_order_ticket in full (it is wholly defined by
--      20260801182128; no later migration touches it). A station ticket now
--      also carries each combo part made at that station under a combo line
--      made elsewhere, as its own line:
--        quantity  = the combo line's quantity
--        name      = the part's name, as frozen on the order
--        notes     = the combo line's notes (a guest writes one note for the
--                    whole combo; "lemonade without ice" must reach the bar)
--        allergens = the PART's own allergens, from menu_items by item_id
--        part_of   = the combo's name, printed as "(part of …)"
--      A station with neither a line nor a part still gets no ticket. The
--      combo line itself is unchanged on its own station's ticket, and now
--      carries `components` so the payload says what the paper says.
--
--   2. Leaves the callers alone, deliberately. Every release path reaches
--      this function through enqueue_station_tickets(), which asks for the
--      kitchen ticket AND the bar ticket unconditionally and lets this
--      function decide whether there is anything to print. Nothing decides
--      "does this order need a bar ticket" from order_items.station, so the
--      fix here is the whole fix.
--
--   3. Restates kds_all_day in full (20260801182038) so the "all day" count
--      of a station includes combo parts made there. A part has no status of
--      its own — it moves with its combo line — so it is counted at the
--      line's status and its id is NEVER in pending_ids / open_ids: "start
--      all" and "all up" act on real lines only and can never bump a whole
--      combo from the bar.
--
-- Cloud printers need nothing: cloud_print_candidates() reads
-- order_ticket_events, and a combo-only bar ticket is now an ordinary queued
-- row there.
--
-- Idempotent: CREATE OR REPLACE with unchanged signatures and grants.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Station tickets know about combo parts
-- ---------------------------------------------------------------------

/**
 * Build a ticket payload, optionally for one station only.
 *
 * The payload carries `order_code` (the only string on the ticket a human
 * can match against the board), each line's station and allergens, and the
 * station the ticket is for. A bar ticket contains only bar lines: a barman
 * scanning past six food lines to find one drink is how drinks get forgotten.
 *
 * A combo line made at another station brings each of its parts made HERE
 * as a line of its own, marked `part_of` the combo. The combo line itself
 * stays on its own station's ticket with every part listed under it.
 *
 * An order with nothing for a station produces no ticket for it, rather than
 * an empty one — a blank ticket sliding out of the bar printer teaches staff
 * to ignore the bar printer.
 */
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
  v_type text := COALESCE(nullif(_ticket_type, ''), 'kitchen');
  v_station text;
  v_payload jsonb;
  v_items jsonb;
  v_ticket_id uuid;
BEGIN
  -- 'kitchen' and 'bar' are station tickets; anything else (e.g. a future
  -- 'receipt') gets every line.
  v_station := CASE WHEN v_type IN ('kitchen', 'bar') THEN v_type ELSE NULL END;

  SELECT COALESCE(jsonb_agg(line.item ORDER BY line.created_at ASC, line.id, line.part_no), '[]'::jsonb)
    INTO v_items
    FROM (
      -- The order's own lines for this station, as before. A combo line also
      -- says what it contained.
      SELECT oi.created_at, oi.id, 0::bigint AS part_no,
             jsonb_build_object(
               'id', oi.id,
               'menu_item_id', oi.menu_item_id,
               'name', mi.name,
               'quantity', oi.quantity,
               'notes', oi.notes,
               'status', oi.status,
               'station', oi.station,
               'allergens', COALESCE(to_jsonb(mi.allergens), '[]'::jsonb)
             )
             || CASE WHEN jsonb_typeof(oi.components) = 'array'
                     THEN jsonb_build_object('components', oi.components)
                     ELSE '{}'::jsonb END AS item
        FROM public.order_items oi
        JOIN public.menu_items mi ON mi.id = oi.menu_item_id
       WHERE oi.order_id = _order_id
         AND (v_station IS NULL OR oi.station = v_station)

      UNION ALL

      -- Combo parts made at this station, under a combo line made elsewhere.
      -- The part keeps its line's id: it is that line, seen from here.
      SELECT oi.created_at, oi.id, part.ordinality AS part_no,
             jsonb_build_object(
               'id', oi.id,
               'menu_item_id', pmi.id,
               'name', COALESCE(nullif(part.value->>'name', ''), pmi.name, 'Item'),
               'quantity', oi.quantity,
               'notes', oi.notes,
               'status', oi.status,
               'station', part.value->>'station',
               'allergens', COALESCE(to_jsonb(pmi.allergens), '[]'::jsonb),
               'slot_label', part.value->>'slot_label',
               'part_of', mi.name,
               'combo_menu_item_id', oi.menu_item_id
             ) AS item
        FROM public.order_items oi
        JOIN public.menu_items mi ON mi.id = oi.menu_item_id
        CROSS JOIN LATERAL jsonb_array_elements(
               CASE WHEN jsonb_typeof(oi.components) = 'array' THEN oi.components ELSE '[]'::jsonb END
             ) WITH ORDINALITY AS part(value, ordinality)
        LEFT JOIN public.menu_items pmi ON pmi.id::text = part.value->>'item_id'
       WHERE oi.order_id = _order_id
         AND v_station IS NOT NULL
         AND oi.station IS DISTINCT FROM v_station
         AND part.value->>'station' = v_station
    ) line;

  IF jsonb_array_length(v_items) = 0 THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_build_object(
           'order_id', o.id,
           'order_code', o.order_code,
           'ticket_type', v_type,
           'station', v_station,
           'created_at', o.created_at,
           'status', o.status,
           'payment_method', o.payment_method,
           'payment_status', o.payment_status,
           'guest_name', o.guest_name,
           'notes', o.notes,
           'total', o.total,
           'table_number', t.table_number,
           'section_id', t.section_id,
           'items', v_items
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
  VALUES (_order_id, v_type, 'queued', 'json', v_payload)
  ON CONFLICT (order_id, ticket_type)
  DO UPDATE SET
    payload = EXCLUDED.payload,
    updated_at = now()
  RETURNING id INTO v_ticket_id;

  RETURN v_ticket_id;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_order_ticket(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enqueue_order_ticket(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------
-- 2. All day counts combo parts at their own station
-- ---------------------------------------------------------------------

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
 *
 * A combo part made at another station than its combo line (the lemonade of
 * a burger combo) is counted at ITS station, at the combo line's status —
 * the bar batching lemonades needs to know about it. Its line id is never
 * returned: bumping it would bump the whole combo, burger and all, from the
 * bar. The quantities can therefore be larger than what the ids cover, and a
 * row made only of parts has no ids at all.
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
  WITH open_lines AS (
    SELECT oi.id AS line_id, oi.menu_item_id AS line_item_id, oi.station AS line_station,
           oi.status AS line_status, oi.quantity AS line_qty, oi.components AS line_components,
           o.created_at AS order_at
      FROM public.order_items oi
      JOIN public.orders o ON o.id = oi.order_id
     WHERE o.status IN ('pending', 'confirmed', 'preparing', 'ready')
       AND o.released_to_kitchen_at IS NOT NULL
       AND oi.status <> 'served'
  ),
  work AS (
    -- A line at its own station: counted, and what the buttons act on.
    SELECT l.line_item_id AS w_item_id,
           COALESCE(mi.name, 'Unknown') AS w_name,
           l.line_station AS w_station,
           l.line_status AS w_status,
           l.line_qty AS w_qty,
           l.order_at AS w_at,
           l.line_id AS w_line_id
      FROM open_lines l
      LEFT JOIN public.menu_items mi ON mi.id = l.line_item_id
     WHERE _station IS NULL OR l.line_station = _station

    UNION ALL

    -- A combo part made at another station than its line: counted, never bumped.
    SELECT pmi.id,
           COALESCE(pmi.name, nullif(part.value->>'name', ''), 'Unknown'),
           part.value->>'station',
           l.line_status,
           l.line_qty,
           l.order_at,
           NULL::uuid
      FROM open_lines l
      CROSS JOIN LATERAL jsonb_array_elements(
             CASE WHEN jsonb_typeof(l.line_components) = 'array' THEN l.line_components ELSE '[]'::jsonb END
           ) AS part(value)
      LEFT JOIN public.menu_items pmi ON pmi.id::text = part.value->>'item_id'
     WHERE part.value->>'station' IS NOT NULL
       AND part.value->>'station' IS DISTINCT FROM l.line_station
       AND (_station IS NULL OR part.value->>'station' = _station)
  )
  SELECT w.w_item_id,
         w.w_name,
         w.w_station,
         COALESCE(sum(w.w_qty) FILTER (WHERE w.w_status = 'pending'), 0)::int,
         COALESCE(sum(w.w_qty) FILTER (WHERE w.w_status = 'preparing'), 0)::int,
         COALESCE(sum(w.w_qty) FILTER (WHERE w.w_status = 'ready'), 0)::int,
         min(w.w_at),
         COALESCE(array_agg(w.w_line_id ORDER BY w.w_at)
                    FILTER (WHERE w.w_status = 'pending' AND w.w_line_id IS NOT NULL), '{}'),
         COALESCE(array_agg(w.w_line_id ORDER BY w.w_at)
                    FILTER (WHERE w.w_status IN ('pending', 'preparing') AND w.w_line_id IS NOT NULL), '{}')
    FROM work w
   GROUP BY w.w_item_id, w.w_name, w.w_station
   ORDER BY min(w.w_at);
END;
$$;

REVOKE ALL ON FUNCTION public.kds_all_day(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.kds_all_day(text) TO authenticated;
