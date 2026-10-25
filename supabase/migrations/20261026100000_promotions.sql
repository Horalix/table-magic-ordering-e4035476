-- =====================================================================
-- Promotions: things on sale, combos, what is new, what is featured
--
-- Everything a guest is charged is still decided here, at order time, from
-- the menu row — never from the phone. This file adds the data and the
-- pricing; 20261026100100_promotions_ordering.sql wires it into
-- guest_place_order.
--
-- 1. SALES live on the dish: a percentage off or a fixed sale price, with an
--    optional window (timestamptz; the admin enters Sarajevo wall-clock time)
--    and an optional label from a fixed list. Free text is deliberately not
--    allowed, for the same reason the badge list is fixed: it becomes fake
--    urgency within a week, and it cannot be translated for the guest.
--
-- 2. COMBOS are dishes too (photo, names in three languages, a section, a
--    price — the combo price), plus slots. A slot is "choose one of" a list of
--    dishes; a slot with one dish is simply included. A choice may carry a
--    surcharge. The order line stores what was chosen in `components`, so the
--    kitchen sees "Burger: Classic · Side: Cheese fries · Drink: Lemonade"
--    and the record survives later menu edits.
--
-- 3. NEW is the existing `new` badge plus `new_until`, a trading day. The
--    badge stops on its own after that day; nobody has to remember.
--
-- 4. FEATURED: up to three dishes pinned to the top of the home screen, each
--    with an optional short line in the three guest languages.
--
-- Order lines also keep `regular_unit_price` next to `unit_price` (what was
-- charged), so every report built on unit_price stays the real takings and
-- the discount given is a subtraction, not a guess.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. The dish
-- ---------------------------------------------------------------------
ALTER TABLE public.menu_items
  ADD COLUMN IF NOT EXISTS sale_kind text,
  ADD COLUMN IF NOT EXISTS sale_value numeric(10,2),
  ADD COLUMN IF NOT EXISTS sale_starts_at timestamptz,
  ADD COLUMN IF NOT EXISTS sale_ends_at timestamptz,
  ADD COLUMN IF NOT EXISTS sale_label text,
  ADD COLUMN IF NOT EXISTS new_until date,
  ADD COLUMN IF NOT EXISTS featured_rank smallint,
  ADD COLUMN IF NOT EXISTS featured_note text,
  ADD COLUMN IF NOT EXISTS featured_note_bs text,
  ADD COLUMN IF NOT EXISTS featured_note_ar text;

DO $$
BEGIN
  -- Whole percentages only: the guest's phone computes the same price in
  -- integer cents, and a 12.5 % sale is not something anyone asked for.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'menu_items_sale_shape') THEN
    ALTER TABLE public.menu_items ADD CONSTRAINT menu_items_sale_shape CHECK (
      sale_kind IS NULL
      OR (sale_kind = 'percent' AND sale_value IS NOT NULL
          AND sale_value >= 1 AND sale_value <= 90 AND sale_value = trunc(sale_value))
      OR (sale_kind = 'price' AND sale_value IS NOT NULL AND sale_value > 0)
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'menu_items_sale_window') THEN
    ALTER TABLE public.menu_items ADD CONSTRAINT menu_items_sale_window CHECK (
      sale_starts_at IS NULL OR sale_ends_at IS NULL OR sale_ends_at > sale_starts_at
    );
  END IF;
  -- A key from the fixed list the guest app translates (happy_hour, …).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'menu_items_sale_label_key') THEN
    ALTER TABLE public.menu_items ADD CONSTRAINT menu_items_sale_label_key CHECK (
      sale_label IS NULL OR sale_label ~ '^[a-z][a-z_]{0,29}$'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'menu_items_featured_rank_range') THEN
    ALTER TABLE public.menu_items ADD CONSTRAINT menu_items_featured_rank_range CHECK (
      featured_rank IS NULL OR featured_rank BETWEEN 1 AND 3
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'menu_items_featured_note_length') THEN
    ALTER TABLE public.menu_items ADD CONSTRAINT menu_items_featured_note_length CHECK (
      COALESCE(char_length(featured_note), 0) <= 80
      AND COALESCE(char_length(featured_note_bs), 0) <= 80
      AND COALESCE(char_length(featured_note_ar), 0) <= 80
    );
  END IF;
END $$;

-- At most three featured dishes, one per slot on the home screen.
CREATE UNIQUE INDEX IF NOT EXISTS menu_items_featured_rank_key
  ON public.menu_items(featured_rank) WHERE featured_rank IS NOT NULL;

COMMENT ON COLUMN public.menu_items.sale_kind IS
  'percent | price. NULL = not on sale. Priced by menu_item_sale_price().';
COMMENT ON COLUMN public.menu_items.sale_label IS
  'Key from the guest app''s fixed list (happy_hour, weekend_offer, lunch_deal, ramadan_offer, intro_price). NULL shows "Sale".';
COMMENT ON COLUMN public.menu_items.new_until IS
  'Last trading day (business_day) the "new" badge shows. NULL with the badge = no end.';

-- Dishes already badged "new" get thirty days from today, the same default
-- the admin toggle uses, instead of being new forever.
UPDATE public.menu_items
   SET new_until = public.business_day(now()) + 30
 WHERE 'new' = ANY(merchandising_tags) AND new_until IS NULL;

/**
 * The sale price of a dish at `_at`, or NULL when it is not on sale then.
 *
 * NULL too when the "sale" would not be cheaper than the menu price: a
 * strikethrough of 18 → 18 is worse than no badge. Percentages round to the
 * cent, half away from zero — the guest app computes the same in integer
 * cents (src/lib/promotions.ts) so the two can never disagree by a cent.
 */
CREATE OR REPLACE FUNCTION public.menu_item_sale_price(_item public.menu_items, _at timestamptz DEFAULT now())
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT CASE
           WHEN _item.sale_kind IS NULL OR _item.sale_value IS NULL OR _item.price IS NULL THEN NULL
           WHEN _item.sale_starts_at IS NOT NULL AND _at < _item.sale_starts_at THEN NULL
           WHEN _item.sale_ends_at IS NOT NULL AND _at >= _item.sale_ends_at THEN NULL
           ELSE (SELECT CASE WHEN s.p < _item.price THEN s.p END
                   FROM (SELECT CASE _item.sale_kind
                                  WHEN 'percent' THEN round(_item.price * (100 - _item.sale_value) / 100, 2)
                                  ELSE round(_item.sale_value, 2)
                                END AS p) s)
         END;
$$;

/** What one unit of this dish costs at `_at`: the sale price, else the menu price. */
CREATE OR REPLACE FUNCTION public.menu_item_unit_price(_item public.menu_items, _at timestamptz DEFAULT now())
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(public.menu_item_sale_price(_item, _at), _item.price);
$$;

-- ---------------------------------------------------------------------
-- 2. The order line
-- ---------------------------------------------------------------------
ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS regular_unit_price numeric(10,2),
  ADD COLUMN IF NOT EXISTS components jsonb;

COMMENT ON COLUMN public.order_items.regular_unit_price IS
  'The unit price without a sale (for a combo: the combo price plus surcharges). unit_price is what was charged.';
COMMENT ON COLUMN public.order_items.components IS
  'For a combo line: [{slot_label, item_id, name, name_bs, name_ar, station}] in slot order. NULL otherwise.';

/**
 * What was ordered is history. unit_price is already frozen by
 * enforce_order_item_integrity; the list price and the chosen components
 * are frozen with it, so a receipt can always be explained.
 */
CREATE OR REPLACE FUNCTION public.guard_order_item_promotion()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.regular_unit_price IS DISTINCT FROM OLD.regular_unit_price
     OR NEW.components IS DISTINCT FROM OLD.components
  THEN
    RAISE EXCEPTION 'Order lines cannot be re-priced or re-pointed once placed'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_order_item_promotion ON public.order_items;
CREATE TRIGGER trg_guard_order_item_promotion
  BEFORE UPDATE ON public.order_items
  FOR EACH ROW EXECUTE FUNCTION public.guard_order_item_promotion();

-- ---------------------------------------------------------------------
-- 3. Combos
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.menu_combo_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  combo_item_id uuid NOT NULL REFERENCES public.menu_items(id) ON DELETE CASCADE,
  sort_order smallint NOT NULL DEFAULT 0,
  label text NOT NULL CHECK (char_length(btrim(label)) BETWEEN 1 AND 40),
  label_bs text CHECK (label_bs IS NULL OR char_length(label_bs) <= 40),
  label_ar text CHECK (label_ar IS NULL OR char_length(label_ar) <= 40),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS menu_combo_slots_combo_idx ON public.menu_combo_slots(combo_item_id, sort_order);

CREATE TABLE IF NOT EXISTS public.menu_combo_options (
  slot_id uuid NOT NULL REFERENCES public.menu_combo_slots(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.menu_items(id) ON DELETE CASCADE,
  surcharge numeric(10,2) NOT NULL DEFAULT 0 CHECK (surcharge >= 0 AND surcharge <= 100),
  sort_order smallint NOT NULL DEFAULT 0,
  PRIMARY KEY (slot_id, item_id)
);
CREATE INDEX IF NOT EXISTS menu_combo_options_item_idx ON public.menu_combo_options(item_id);

ALTER TABLE public.menu_combo_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menu_combo_options ENABLE ROW LEVEL SECURITY;

-- Menu data: guests read it exactly as they read menu_items. Only an admin
-- writes it (admin_save_combo below is the normal path; the policies make a
-- direct write by anyone else impossible too).
DROP POLICY IF EXISTS "Anyone can view combo slots" ON public.menu_combo_slots;
CREATE POLICY "Anyone can view combo slots" ON public.menu_combo_slots
  FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "Admins manage combo slots" ON public.menu_combo_slots;
CREATE POLICY "Admins manage combo slots" ON public.menu_combo_slots
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Anyone can view combo options" ON public.menu_combo_options;
CREATE POLICY "Anyone can view combo options" ON public.menu_combo_options
  FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "Admins manage combo options" ON public.menu_combo_options;
CREATE POLICY "Admins manage combo options" ON public.menu_combo_options
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

GRANT SELECT ON public.menu_combo_slots, public.menu_combo_options TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.menu_combo_slots, public.menu_combo_options TO authenticated;

/**
 * Every combo with its slots and each slot's choices, in one read.
 *
 * The choices carry what the dish sheet needs to show them (names, photo,
 * price, availability, any sale) because they usually live in another
 * category than the combo: the drinks of a burger combo are under Drinks.
 * Definer rights, like guest_search_menu: it returns public menu data only.
 */
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
       GROUP BY s.combo_item_id
    ) c;
$$;

REVOKE ALL ON FUNCTION public.guest_get_combos() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guest_get_combos() TO anon, authenticated;

/**
 * Replace a combo's slots in one transaction.
 *
 * `_slots` = [{label, label_bs?, label_ar?, options: [{item_id, surcharge?}]}]
 * in display order. An empty array turns the combo back into a plain dish.
 * A combo is never a choice inside another combo, and never a choice in itself.
 */
CREATE OR REPLACE FUNCTION public.admin_save_combo(_combo_item_id uuid, _slots jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_slot jsonb;
  v_idx bigint;
  v_opt jsonb;
  v_oidx bigint;
  v_slot_id uuid;
  v_item_id uuid;
  v_label text;
  v_surcharge numeric;
  v_name text;
  v_count int := 0;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Admin only' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT name INTO v_name FROM public.menu_items WHERE id = _combo_item_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That dish no longer exists' USING ERRCODE = 'no_data_found';
  END IF;

  IF _slots IS NULL OR jsonb_typeof(_slots) <> 'array' THEN
    RAISE EXCEPTION 'Combo parts must be a list';
  END IF;
  IF jsonb_array_length(_slots) > 6 THEN
    RAISE EXCEPTION 'A combo can have at most 6 parts';
  END IF;

  IF jsonb_array_length(_slots) > 0 AND EXISTS (
    SELECT 1 FROM public.menu_combo_options o
      JOIN public.menu_combo_slots s ON s.id = o.slot_id
     WHERE o.item_id = _combo_item_id AND s.combo_item_id <> _combo_item_id
  ) THEN
    RAISE EXCEPTION '% is a choice inside another combo, so it cannot be a combo itself', v_name;
  END IF;

  DELETE FROM public.menu_combo_slots WHERE combo_item_id = _combo_item_id;

  FOR v_slot, v_idx IN SELECT value, ordinality FROM jsonb_array_elements(_slots) WITH ORDINALITY LOOP
    v_label := nullif(btrim(COALESCE(v_slot->>'label', '')), '');
    IF v_label IS NULL THEN
      RAISE EXCEPTION 'Every part of a combo needs a name (part %)', v_idx;
    END IF;
    IF jsonb_typeof(v_slot->'options') IS DISTINCT FROM 'array'
       OR jsonb_array_length(v_slot->'options') = 0 THEN
      RAISE EXCEPTION '"%" needs at least one dish to choose from', v_label;
    END IF;
    IF jsonb_array_length(v_slot->'options') > 60 THEN
      RAISE EXCEPTION '"%" has too many choices (at most 60)', v_label;
    END IF;

    INSERT INTO public.menu_combo_slots(combo_item_id, sort_order, label, label_bs, label_ar)
    VALUES (_combo_item_id, v_idx::smallint, left(v_label, 40),
            nullif(left(btrim(COALESCE(v_slot->>'label_bs', '')), 40), ''),
            nullif(left(btrim(COALESCE(v_slot->>'label_ar', '')), 40), ''))
    RETURNING id INTO v_slot_id;

    FOR v_opt, v_oidx IN SELECT value, ordinality FROM jsonb_array_elements(v_slot->'options') WITH ORDINALITY LOOP
      v_item_id := (v_opt->>'item_id')::uuid;
      IF v_item_id = _combo_item_id THEN
        RAISE EXCEPTION 'A combo cannot be a choice inside itself';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.menu_items WHERE id = v_item_id) THEN
        RAISE EXCEPTION 'A dish chosen for "%" no longer exists', v_label USING ERRCODE = 'no_data_found';
      END IF;
      IF EXISTS (SELECT 1 FROM public.menu_combo_slots WHERE combo_item_id = v_item_id) THEN
        RAISE EXCEPTION 'A combo cannot be a choice inside another combo ("%")', v_label;
      END IF;
      v_surcharge := round(COALESCE(nullif(v_opt->>'surcharge', '')::numeric, 0), 2);
      IF v_surcharge < 0 OR v_surcharge > 100 THEN
        RAISE EXCEPTION 'An extra charge must be between 0 and 100 KM';
      END IF;
      INSERT INTO public.menu_combo_options(slot_id, item_id, surcharge, sort_order)
      VALUES (v_slot_id, v_item_id, v_surcharge, v_oidx::smallint)
      ON CONFLICT (slot_id, item_id) DO NOTHING;
    END LOOP;
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('combo_item_id', _combo_item_id, 'slots', v_count);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_save_combo(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_save_combo(uuid, jsonb) TO authenticated;

-- ---------------------------------------------------------------------
-- 4. Pricing an order
-- ---------------------------------------------------------------------

/**
 * Price every line of a guest order, at order time, from the menu.
 *
 * The one place a line's price is decided. Each element of `_items` is
 * {menu_item_id, quantity, notes?, choices?, unit_price_seen?}:
 *
 *   * a plain dish costs its sale price while a sale runs, else its price;
 *   * a combo costs its own (sale) price plus the surcharges of what was
 *     chosen. Every slot needs exactly one choice from that slot's list —
 *     a slot with a single dish fills itself — and each chosen dish must be
 *     orderable right now. Anything else is refused, with the combo's id in
 *     DETAIL so the guest's cart can mark the line;
 *   * `unit_price_seen` is the price the guest's screen showed. If it differs
 *     from what the server would charge (a sale ended while the cart was
 *     open, a price changed), nothing is placed: the error lists the new
 *     prices in DETAIL and the guest sees them before sending again. Older
 *     clients that send no price are priced exactly as before.
 *
 * Not callable by guests directly; guest_place_order calls it.
 */
CREATE OR REPLACE FUNCTION public.price_order_lines(_items jsonb, _at timestamptz DEFAULT now())
RETURNS TABLE (
  line_no int,
  menu_item_id uuid,
  quantity int,
  notes text,
  unit_price numeric,
  regular_unit_price numeric,
  components jsonb
)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_line jsonb;
  v_idx bigint;
  v_mi public.menu_items;
  v_ci public.menu_items;
  v_slot public.menu_combo_slots;
  v_choices jsonb;
  v_choice_item text;
  v_opt_item uuid;
  v_surcharge numeric;
  v_extra numeric;
  v_unit numeric;
  v_components jsonb;
  v_changed jsonb := '[]'::jsonb;
BEGIN
  IF _items IS NULL OR jsonb_typeof(_items) <> 'array' THEN
    RAISE EXCEPTION 'Order items must be an array';
  END IF;

  FOR v_line, v_idx IN SELECT value, ordinality FROM jsonb_array_elements(_items) WITH ORDINALITY LOOP
    SELECT * INTO v_mi FROM public.menu_items mi WHERE mi.id = (v_line->>'menu_item_id')::uuid;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Unavailable: %', 'Unknown item'
        USING ERRCODE = 'no_data_found', DETAIL = jsonb_build_array(v_line->>'menu_item_id')::text;
    END IF;

    v_choices := CASE WHEN jsonb_typeof(v_line->'choices') = 'array' THEN v_line->'choices' ELSE '[]'::jsonb END;
    v_extra := 0;
    v_components := NULL;

    IF EXISTS (SELECT 1 FROM public.menu_combo_slots s WHERE s.combo_item_id = v_mi.id) THEN
      -- Every choice names a slot of THIS combo, and no slot twice.
      IF EXISTS (
           SELECT 1 FROM jsonb_array_elements(v_choices) c
            WHERE NOT EXISTS (SELECT 1 FROM public.menu_combo_slots s
                               WHERE s.combo_item_id = v_mi.id AND s.id::text = lower(c->>'slot_id')))
         OR (SELECT count(*) FROM jsonb_array_elements(v_choices))
            <> (SELECT count(DISTINCT lower(c->>'slot_id')) FROM jsonb_array_elements(v_choices) c)
      THEN
        RAISE EXCEPTION 'Invalid combo choice: %', v_mi.name
          USING ERRCODE = 'no_data_found', DETAIL = jsonb_build_array(v_mi.id)::text;
      END IF;

      v_components := '[]'::jsonb;
      FOR v_slot IN SELECT * FROM public.menu_combo_slots s WHERE s.combo_item_id = v_mi.id ORDER BY s.sort_order, s.id LOOP
        v_choice_item := (SELECT lower(c->>'item_id') FROM jsonb_array_elements(v_choices) c
                           WHERE lower(c->>'slot_id') = v_slot.id::text LIMIT 1);
        v_opt_item := NULL;
        IF v_choice_item IS NOT NULL THEN
          SELECT o.item_id, o.surcharge INTO v_opt_item, v_surcharge
            FROM public.menu_combo_options o
           WHERE o.slot_id = v_slot.id AND o.item_id::text = v_choice_item;
        ELSIF (SELECT count(*) FROM public.menu_combo_options o WHERE o.slot_id = v_slot.id) = 1 THEN
          -- Included, not chosen.
          SELECT o.item_id, o.surcharge INTO v_opt_item, v_surcharge
            FROM public.menu_combo_options o WHERE o.slot_id = v_slot.id;
        END IF;
        IF v_opt_item IS NULL THEN
          RAISE EXCEPTION 'Invalid combo choice: % (%)', v_mi.name, v_slot.label
            USING ERRCODE = 'no_data_found', DETAIL = jsonb_build_array(v_mi.id)::text;
        END IF;

        SELECT * INTO v_ci FROM public.menu_items mi WHERE mi.id = v_opt_item;
        IF NOT public.menu_item_orderable(v_ci) THEN
          RAISE EXCEPTION 'Unavailable: % (%)', v_ci.name, v_mi.name
            USING ERRCODE = 'no_data_found', DETAIL = jsonb_build_array(v_mi.id)::text;
        END IF;

        v_extra := v_extra + COALESCE(v_surcharge, 0);
        v_components := v_components || jsonb_build_array(jsonb_build_object(
          'slot_label', v_slot.label,
          'item_id', v_ci.id,
          'name', v_ci.name,
          'name_bs', v_ci.name_bs,
          'name_ar', v_ci.name_ar,
          'station', v_ci.station
        ));
      END LOOP;
    ELSIF jsonb_array_length(v_choices) > 0 THEN
      -- Choices for something that is not (or no longer) a combo: the cart is
      -- stale, and silently dropping them would lose the guest's drink.
      RAISE EXCEPTION 'Invalid combo choice: %', v_mi.name
        USING ERRCODE = 'no_data_found', DETAIL = jsonb_build_array(v_mi.id)::text;
    END IF;

    v_unit := round(public.menu_item_unit_price(v_mi, _at) + v_extra, 2);

    IF jsonb_typeof(v_line->'unit_price_seen') = 'number'
       AND abs((v_line->>'unit_price_seen')::numeric - v_unit) > 0.005 THEN
      v_changed := v_changed || jsonb_build_array(jsonb_build_object(
        'line', v_idx - 1, 'menu_item_id', v_mi.id, 'unit_price', v_unit,
        'regular_unit_price', round(v_mi.price + v_extra, 2)));
    END IF;

    line_no := v_idx::int;
    menu_item_id := v_mi.id;
    quantity := LEAST(GREATEST(COALESCE((v_line->>'quantity')::int, 1), 1), 10);
    notes := nullif(left(btrim(COALESCE(v_line->>'notes', '')), 500), '');
    unit_price := v_unit;
    regular_unit_price := round(v_mi.price + v_extra, 2);
    components := v_components;
    RETURN NEXT;
  END LOOP;

  IF jsonb_array_length(v_changed) > 0 THEN
    RAISE EXCEPTION 'Prices changed'
      USING DETAIL = v_changed::text,
            HINT = 'Show the guest the new prices before they send again.';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.price_order_lines(jsonb, timestamptz) FROM PUBLIC, anon, authenticated;
