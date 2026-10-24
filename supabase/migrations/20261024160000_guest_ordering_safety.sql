-- =====================================================================
-- Placing an order safely on restaurant Wi-Fi
--
-- Four changes to guest_place_order, all found by walking the guest flow on a
-- phone rather than by reading the function:
--
-- 1. A RETRY COULD COOK THE SAME FOOD TWICE. If the request committed but the
--    response was lost (a dropped 4G packet is enough), the guest saw "Failed
--    to fetch", tapped again, and the kitchen got two tickets. The client now
--    sends a key it generates once per checkout; a repeat with the same key
--    returns the order that already exists instead of creating another.
--
-- 2. SERVING WINDOWS WERE ONLY ENFORCED IN THE BROWSER. availability.ts says
--    the server re-checks; it did not. A breakfast item left in a cart reached
--    the kitchen at 22:00. The check now uses the item's window in Sarajevo
--    time, and windows may cross midnight (a 22:00–02:00 late menu).
--
-- 3. "Unavailable: Pesto Pasta" WAS THE WHOLE ERROR. The guest had no way to
--    tell which line to remove, and the message was English. The ids of the
--    offending items now travel in the error DETAIL so the cart can mark them.
--
-- 4. TEN ORDERS PER TABLE WAS TOO FEW. The cap counts the whole table, and a
--    group ordering rounds from four phones reaches ten before dessert. It is
--    a flood guard, not a business rule, so it moves to thirty.
--
-- The function is changed by rewriting its live definition, as the decision
-- ledger migration does, so its 150 lines are not restated and cannot drift.
-- Every rewrite asserts that it matched.
-- =====================================================================

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS client_order_id uuid;

-- Unique per table session: two different tables can never collide, and a key
-- is only ever meaningful inside the visit that generated it.
CREATE UNIQUE INDEX IF NOT EXISTS orders_client_order_id_key
  ON public.orders(table_session_id, client_order_id)
  WHERE client_order_id IS NOT NULL;

/**
 * Is this item orderable at `_at`?
 *
 * Redefined because the original was marked IMMUTABLE while reading the clock,
 * defaulted to the database's UTC time, and could not express a window that
 * crosses midnight. `_at` is a Sarajevo wall-clock time.
 */
CREATE OR REPLACE FUNCTION public.menu_item_orderable(_item public.menu_items, _at time DEFAULT NULL)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH t AS (SELECT COALESCE(_at, (now() AT TIME ZONE 'Europe/Sarajevo')::time) AS at)
  SELECT _item.is_available
     AND CASE
           WHEN _item.available_from IS NULL AND _item.available_to IS NULL THEN true
           WHEN _item.available_from IS NULL THEN t.at <= _item.available_to
           WHEN _item.available_to IS NULL THEN t.at >= _item.available_from
           WHEN _item.available_from <= _item.available_to
             THEN t.at BETWEEN _item.available_from AND _item.available_to
           -- Crosses midnight: 22:00–02:00 means after ten OR before two.
           ELSE t.at >= _item.available_from OR t.at <= _item.available_to
         END
    FROM t;
$$;

DO $$
DECLARE
  v_def text;
  v_before text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'guest_place_order';
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'guest_place_order is missing — migrations are out of order';
  END IF;
  -- Line endings are not content; see .gitattributes.
  v_def := replace(v_def, chr(13) || chr(10), chr(10));

  IF position('_client_order_id' in v_def) > 0 THEN
    RAISE NOTICE 'guest_place_order already idempotent; nothing to do';
    RETURN;
  END IF;

  -- 1a. The new parameter, last and defaulted so older clients keep working.
  v_before := v_def;
  v_def := regexp_replace(v_def,
    '_tip numeric DEFAULT 0(::numeric)?\)',
    '_tip numeric DEFAULT 0\1, _client_order_id uuid DEFAULT NULL::uuid)');
  IF v_def = v_before THEN RAISE EXCEPTION 'guest_place_order rewrite: signature not found'; END IF;

  -- 1b. A replay returns the order that exists. Checked after the session is
  -- proven, so a key alone can never read another table's order.
  v_before := v_def;
  v_def := replace(v_def,
    '  v_session := public.assert_guest_session(_session_id, _session_token);
',
    '  v_session := public.assert_guest_session(_session_id, _session_token);

  IF _client_order_id IS NOT NULL THEN
    SELECT * INTO v_order
      FROM public.orders o
     WHERE o.table_session_id = v_session.id AND o.client_order_id = _client_order_id;
    IF FOUND THEN
      RETURN jsonb_build_object(
        ''order_id'', v_order.id,
        ''order_code'', v_order.order_code,
        ''status'', v_order.status,
        ''total'', v_order.total,
        ''tip_amount'', v_order.tip_amount,
        ''payment_method'', v_order.payment_method,
        ''payment_status'', v_order.payment_status,
        ''awaiting_payment'', v_order.status = ''awaiting_payment'',
        ''ticket_id'', NULL,
        ''replayed'', true
      );
    END IF;
  END IF;
');
  IF v_def = v_before THEN RAISE EXCEPTION 'guest_place_order rewrite: session check not found'; END IF;

  -- 1c. Store the key with the order.
  v_before := v_def;
  v_def := replace(v_def,
    'payment_method, payment_status, order_code, released_to_kitchen_at
  )',
    'payment_method, payment_status, order_code, released_to_kitchen_at, client_order_id
  )');
  v_def := replace(v_def,
    '    CASE WHEN v_is_card THEN NULL ELSE now() END
  )
  RETURNING * INTO v_order;',
    '    CASE WHEN v_is_card THEN NULL ELSE now() END,
    _client_order_id
  )
  RETURNING * INTO v_order;');
  IF position('_client_order_id
  )' in v_def) = 0 OR position('released_to_kitchen_at, client_order_id' in v_def) = 0 THEN
    RAISE EXCEPTION 'guest_place_order rewrite: order insert not found';
  END IF;

  -- 2 + 3. Serving windows, in Sarajevo time, with the offending ids attached.
  v_before := v_def;
  v_def := replace(v_def,
    '  SELECT string_agg(COALESCE(mi.name, ''Unknown item''), '', '')
    INTO v_unavailable
    FROM requested r
    LEFT JOIN public.menu_items mi ON mi.id = r.menu_item_id
   WHERE mi.id IS NULL OR mi.is_available = false;

  IF v_unavailable IS NOT NULL THEN
    RAISE EXCEPTION ''Unavailable: %'', v_unavailable USING ERRCODE = ''no_data_found'';
  END IF;',
    '  SELECT string_agg(COALESCE(mi.name, ''Unknown item''), '', ''),
         jsonb_agg(r.menu_item_id)::text
    INTO v_unavailable, v_unavailable_ids
    FROM requested r
    LEFT JOIN public.menu_items mi ON mi.id = r.menu_item_id
   WHERE mi.id IS NULL OR NOT public.menu_item_orderable(mi);

  IF v_unavailable IS NOT NULL THEN
    RAISE EXCEPTION ''Unavailable: %'', v_unavailable
      USING ERRCODE = ''no_data_found'', DETAIL = v_unavailable_ids;
  END IF;');
  IF v_def = v_before THEN RAISE EXCEPTION 'guest_place_order rewrite: availability check not found'; END IF;

  v_before := v_def;
  v_def := replace(v_def,
    '  v_unavailable text;
',
    '  v_unavailable text;
  v_unavailable_ids text;
');
  IF v_def = v_before THEN RAISE EXCEPTION 'guest_place_order rewrite: declarations not found'; END IF;

  -- 4. The flood guard.
  v_before := v_def;
  v_def := replace(v_def, 'IF v_order_count >= 10 THEN', 'IF v_order_count >= 30 THEN');
  IF v_def = v_before THEN RAISE EXCEPTION 'guest_place_order rewrite: order cap not found'; END IF;

  -- The signature changed, so the old function has to go first; otherwise two
  -- overloads differing only by a trailing default make supabase.rpc() ambiguous.
  DROP FUNCTION public.guest_place_order(uuid, text, text, text, jsonb, numeric);
  EXECUTE v_def;
END $$;

REVOKE ALL ON FUNCTION public.guest_place_order(uuid, text, text, text, jsonb, numeric, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guest_place_order(uuid, text, text, text, jsonb, numeric, uuid) TO anon, authenticated;
