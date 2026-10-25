-- =====================================================================
-- Promotions, at the till: guest_place_order prices from price_order_lines
--
-- Two statements in guest_place_order priced the order from
-- `menu_items.price` directly: the total, and the order lines. Both now read
-- public.price_order_lines() (20261026100000_promotions.sql), which applies a
-- running sale, prices a combo with its surcharges, refuses a combo choice
-- that is not on offer, stores what was chosen, and refuses the order when
-- the guest's screen showed a different price than the one they would pay.
--
-- The function is changed by rewriting its live definition, as the earlier
-- ordering migrations do, so its 150 lines are not restated and cannot drift.
-- The live copy was created by a runner that drops SQL comments and may lay
-- out whitespace differently, so every search below matches the code alone,
-- with any run of whitespace between tokens. Every required rewrite asserts
-- that it matched exactly once and raises otherwise; nothing is half-applied.
--
-- Also: the attribution row for a line that came from a suggestion records
-- the price actually charged (a suggested dish on sale earned the sale
-- price), and the guest's running tab returns the combo components. Those two
-- are conveniences — if their text is not found they are skipped with a
-- NOTICE rather than failing the batch.
-- =====================================================================

DO $$
DECLARE
  v_def text;
  v_before text;
  v_pattern text;
  v_matches int;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'guest_place_order';
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'guest_place_order is missing — migrations are out of order';
  END IF;
  -- Line endings are not content; see .gitattributes.
  v_def := replace(v_def, chr(13) || chr(10), chr(10));

  IF position('price_order_lines' in v_def) > 0 THEN
    RAISE NOTICE 'guest_place_order already prices through price_order_lines; nothing to do';
    RETURN;
  END IF;

  -- (a) The order total.
  v_pattern := 'SELECT[[:space:]]+round\(sum\(mi\.price[[:space:]]*\*[[:space:]]*r\.quantity\)::numeric,[[:space:]]*2\)[[:space:]]+INTO[[:space:]]+v_items_total[[:space:]]+FROM[[:space:]]+requested[[:space:]]+r[[:space:]]+JOIN[[:space:]]+public\.menu_items[[:space:]]+mi[[:space:]]+ON[[:space:]]+mi\.id[[:space:]]*=[[:space:]]*r\.menu_item_id[[:space:]]+AND[[:space:]]+mi\.is_available[[:space:]]*=[[:space:]]*true[[:space:]]*;';
  SELECT count(*) INTO v_matches FROM regexp_matches(v_def, v_pattern, 'g');
  IF v_matches <> 1 THEN
    RAISE EXCEPTION 'guest_place_order rewrite (a): order total found % times, expected once', v_matches;
  END IF;
  v_def := regexp_replace(v_def, v_pattern,
    'SELECT round(sum(pl.unit_price * pl.quantity)::numeric, 2)
    INTO v_items_total
    FROM public.price_order_lines(_items) pl;');

  -- (b) The order lines: charged price, list price, and what a combo contained.
  v_pattern := 'INSERT[[:space:]]+INTO[[:space:]]+public\.order_items[[:space:]]*\([[:space:]]*order_id,[[:space:]]*menu_item_id,[[:space:]]*quantity,[[:space:]]*unit_price,[[:space:]]*notes,[[:space:]]*status[[:space:]]*\)[[:space:]]+SELECT[[:space:]]+v_order\.id,[[:space:]]*r\.menu_item_id,[[:space:]]*r\.quantity,[[:space:]]*mi\.price,[[:space:]]*r\.notes,[[:space:]]*''pending''[[:space:]]+FROM[[:space:]]+requested[[:space:]]+r[[:space:]]+JOIN[[:space:]]+public\.menu_items[[:space:]]+mi[[:space:]]+ON[[:space:]]+mi\.id[[:space:]]*=[[:space:]]*r\.menu_item_id[[:space:]]+AND[[:space:]]+mi\.is_available[[:space:]]*=[[:space:]]*true[[:space:]]*;';
  SELECT count(*) INTO v_matches FROM regexp_matches(v_def, v_pattern, 'g');
  IF v_matches <> 1 THEN
    RAISE EXCEPTION 'guest_place_order rewrite (b): order lines insert found % times, expected once', v_matches;
  END IF;
  v_def := regexp_replace(v_def, v_pattern,
    'INSERT INTO public.order_items(order_id, menu_item_id, quantity, unit_price, notes, status, regular_unit_price, components)
  SELECT v_order.id, pl.menu_item_id, pl.quantity, pl.unit_price, pl.notes, ''pending'', pl.regular_unit_price, pl.components
    FROM public.price_order_lines(_items) pl
   ORDER BY pl.line_no;');

  -- (c) Suggestion attribution at the charged price. Optional.
  v_before := v_def;
  v_def := regexp_replace(v_def,
    'round\(mi\.price[[:space:]]*\*[[:space:]]*LEAST\(GREATEST\(COALESCE\(\(item->>''quantity''\)::int,[[:space:]]*1\),[[:space:]]*1\),[[:space:]]*10\),[[:space:]]*2\)',
    'round(public.menu_item_unit_price(mi) * LEAST(GREATEST(COALESCE((item->>''quantity'')::int, 1), 1), 10), 2)');
  IF v_def = v_before THEN
    RAISE NOTICE 'guest_place_order rewrite (c): suggestion line_total not found; attribution keeps the menu price';
  END IF;

  EXECUTE v_def;
  RAISE NOTICE 'guest_place_order now prices sales and combos through price_order_lines';
END $$;

REVOKE ALL ON FUNCTION public.guest_place_order(uuid, text, text, text, jsonb, numeric, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guest_place_order(uuid, text, text, text, jsonb, numeric, uuid) TO anon, authenticated;

-- The running tab lists what each combo contained. Optional.
DO $$
DECLARE
  v_def text;
  v_pattern text := '''notes'',[[:space:]]*oi\.notes,';
  v_matches int;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'guest_get_tab';
  IF v_def IS NULL THEN
    RAISE NOTICE 'guest_get_tab is missing; the tab will not list combo components';
    RETURN;
  END IF;
  v_def := replace(v_def, chr(13) || chr(10), chr(10));
  IF position('oi.components' in v_def) > 0 THEN
    RAISE NOTICE 'guest_get_tab already returns components';
    RETURN;
  END IF;
  SELECT count(*) INTO v_matches FROM regexp_matches(v_def, v_pattern, 'g');
  IF v_matches <> 1 THEN
    RAISE NOTICE 'guest_get_tab: order line notes found % times; the tab will not list combo components', v_matches;
    RETURN;
  END IF;
  EXECUTE regexp_replace(v_def, v_pattern, '''notes'', oi.notes,
                          ''components'', oi.components,');
END $$;
