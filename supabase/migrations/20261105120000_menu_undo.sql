-- Deleting from the menu can be undone, and always works (5 November 2026).
--
-- A manager deleted dishes by accident and could not get them back: Delete
-- erased the row, photo link, translations and pairings for good. The same
-- manager could not delete other dishes at all, because a dish that has ever
-- been on an order is held by order_items, and the database refused.
--
-- Delete now puts a course, a section or a dish in the restaurant's bin:
--
--   1. deleted_at and deleted_by on categories, subcategories and menu_items.
--      A dish also keeps available_before_delete, so restoring it brings back
--      "sold out" if it was sold out. A deleted dish is marked unavailable as
--      well, so every suggestion, combo and order check that already skips
--      sold-out dishes skips it without being rewritten.
--   2. The public menu policies hide deleted rows from everyone. A second
--      policy shows them to the restaurant's own staff, and only on requests
--      that ask with the header `x-menu-deleted: show`: the admin's bin, and
--      the order screens, which still need a deleted dish's name. A signed-in
--      admin looking at the guest menu sees what guests see.
--   3. admin_delete_menu_entry / admin_restore_menu_entry, for the
--      restaurant's admin (or the owner). Deleting a course or section takes
--      its sections and dishes with it, stamped with the same moment;
--      restoring it brings back exactly those, not dishes deleted on their own
--      before. Restoring a dish brings back its section and course if they
--      were deleted, but not their other dishes. Both write the audit log.
--   4. guest_search_menu and guest_get_combos skip deleted dishes (they list
--      sold-out ones, so the flag alone is not enough there).
--
-- Order history is untouched: nothing is erased, so receipts, reports and
-- reconciliation keep every line. Hard DELETE stays allowed for admins, as
-- before; the app no longer uses it. Running this again changes nothing.

ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid;
ALTER TABLE public.subcategories
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid;
ALTER TABLE public.menu_items
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid,
  ADD COLUMN IF NOT EXISTS available_before_delete boolean;

COMMENT ON COLUMN public.menu_items.deleted_at IS
  'In the bin since then (admin_delete_menu_entry): hidden from the menu, kept for order history, restorable.';
COMMENT ON COLUMN public.menu_items.available_before_delete IS
  'is_available when the dish was deleted; admin_restore_menu_entry puts it back.';

/** Did this request ask to see deleted menu rows? Only staff are ever shown them. */
CREATE OR REPLACE FUNCTION public.menu_deleted_asked()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
BEGIN
  RETURN COALESCE(nullif(current_setting('request.headers', true), '')::json ->> 'x-menu-deleted', '') = 'show';
EXCEPTION WHEN others THEN
  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.menu_deleted_asked() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.menu_deleted_asked() TO anon, authenticated, service_role;

DO $menus$
DECLARE
  p record;
BEGIN
  FOR p IN
    SELECT * FROM (VALUES
      ('categories', 'Anyone can view categories', 'Staff see deleted categories'),
      ('subcategories', 'Anyone can view subcategories', 'Staff see deleted subcategories'),
      ('menu_items', 'Anyone can view available menu items', 'Staff see deleted menu items')
    ) AS t(tbl, name, staff_name)
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p.name, p.tbl);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO public
         USING (venue_id = (SELECT public.menu_venue()) AND deleted_at IS NULL)',
      p.name, p.tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p.staff_name, p.tbl);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated
         USING (deleted_at IS NOT NULL
                AND venue_id = (SELECT public.menu_venue())
                AND (SELECT public.menu_deleted_asked())
                AND public.can_staff(venue_id))',
      p.staff_name, p.tbl);
  END LOOP;
END
$menus$;

CREATE OR REPLACE FUNCTION public.admin_delete_menu_entry(_kind text, _id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_venue uuid;
  v_name text;
  v_was timestamptz;
  v_at timestamptz := now();
  v_subs int := 0;
  v_items int := 0;
BEGIN
  IF _kind = 'category' THEN
    SELECT venue_id, name, deleted_at INTO v_venue, v_name, v_was FROM public.categories WHERE id = _id FOR UPDATE;
  ELSIF _kind = 'subcategory' THEN
    SELECT venue_id, name, deleted_at INTO v_venue, v_name, v_was FROM public.subcategories WHERE id = _id FOR UPDATE;
  ELSIF _kind = 'item' THEN
    SELECT venue_id, name, deleted_at INTO v_venue, v_name, v_was FROM public.menu_items WHERE id = _id FOR UPDATE;
  ELSE
    RAISE EXCEPTION 'Unknown kind of menu entry: %', _kind USING ERRCODE = '22023';
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That menu entry no longer exists' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.can_admin(v_venue) THEN
    RAISE EXCEPTION 'Only this restaurant''s admin can delete from its menu' USING ERRCODE = '42501';
  END IF;
  IF v_was IS NOT NULL THEN
    RETURN jsonb_build_object('kind', _kind, 'id', _id, 'name', v_name, 'deleted_at', v_was, 'already', true);
  END IF;
  PERFORM public.use_venue(v_venue);

  IF _kind = 'category' THEN
    UPDATE public.categories SET deleted_at = v_at, deleted_by = auth.uid() WHERE id = _id;
    UPDATE public.subcategories SET deleted_at = v_at, deleted_by = auth.uid()
     WHERE category_id = _id AND deleted_at IS NULL;
    GET DIAGNOSTICS v_subs = ROW_COUNT;
    UPDATE public.menu_items mi
       SET deleted_at = v_at, deleted_by = auth.uid(),
           available_before_delete = mi.is_available, is_available = false
      FROM public.subcategories s
     WHERE s.id = mi.subcategory_id AND s.category_id = _id AND mi.deleted_at IS NULL;
    GET DIAGNOSTICS v_items = ROW_COUNT;
  ELSIF _kind = 'subcategory' THEN
    UPDATE public.subcategories SET deleted_at = v_at, deleted_by = auth.uid() WHERE id = _id;
    UPDATE public.menu_items
       SET deleted_at = v_at, deleted_by = auth.uid(),
           available_before_delete = is_available, is_available = false
     WHERE subcategory_id = _id AND deleted_at IS NULL;
    GET DIAGNOSTICS v_items = ROW_COUNT;
  ELSE
    UPDATE public.menu_items
       SET deleted_at = v_at, deleted_by = auth.uid(),
           available_before_delete = is_available, is_available = false
     WHERE id = _id;
    v_items := 1;
  END IF;

  PERFORM public.write_audit(
    'menu.' || _kind || '.deleted', 'menu_' || _kind, _id,
    jsonb_build_object('name', v_name),
    jsonb_build_object('deleted_at', v_at, 'subcategories', v_subs, 'items', v_items));

  RETURN jsonb_build_object('kind', _kind, 'id', _id, 'name', v_name, 'deleted_at', v_at,
                            'subcategories', v_subs, 'items', v_items, 'already', false);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_restore_menu_entry(_kind text, _id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_venue uuid;
  v_name text;
  v_was timestamptz;
  v_sub uuid;
  v_cat uuid;
  v_subs int := 0;
  v_items int := 0;
BEGIN
  IF _kind = 'category' THEN
    SELECT venue_id, name, deleted_at INTO v_venue, v_name, v_was FROM public.categories WHERE id = _id FOR UPDATE;
  ELSIF _kind = 'subcategory' THEN
    SELECT venue_id, name, deleted_at, category_id INTO v_venue, v_name, v_was, v_cat
      FROM public.subcategories WHERE id = _id FOR UPDATE;
  ELSIF _kind = 'item' THEN
    SELECT mi.venue_id, mi.name, mi.deleted_at, mi.subcategory_id, s.category_id
      INTO v_venue, v_name, v_was, v_sub, v_cat
      FROM public.menu_items mi JOIN public.subcategories s ON s.id = mi.subcategory_id
     WHERE mi.id = _id FOR UPDATE OF mi;
  ELSE
    RAISE EXCEPTION 'Unknown kind of menu entry: %', _kind USING ERRCODE = '22023';
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That menu entry no longer exists' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.can_admin(v_venue) THEN
    RAISE EXCEPTION 'Only this restaurant''s admin can restore its menu' USING ERRCODE = '42501';
  END IF;
  IF v_was IS NULL THEN
    RETURN jsonb_build_object('kind', _kind, 'id', _id, 'name', v_name, 'already', true);
  END IF;
  PERFORM public.use_venue(v_venue);

  IF _kind = 'category' THEN
    UPDATE public.categories SET deleted_at = NULL, deleted_by = NULL WHERE id = _id;
    -- Only what went with it; a section deleted on its own before stays in the bin.
    UPDATE public.subcategories SET deleted_at = NULL, deleted_by = NULL
     WHERE category_id = _id AND deleted_at = v_was;
    GET DIAGNOSTICS v_subs = ROW_COUNT;
    UPDATE public.menu_items mi
       SET deleted_at = NULL, deleted_by = NULL,
           is_available = COALESCE(mi.available_before_delete, true), available_before_delete = NULL
      FROM public.subcategories s
     WHERE s.id = mi.subcategory_id AND s.category_id = _id AND mi.deleted_at = v_was;
    GET DIAGNOSTICS v_items = ROW_COUNT;
  ELSIF _kind = 'subcategory' THEN
    UPDATE public.subcategories SET deleted_at = NULL, deleted_by = NULL WHERE id = _id;
    UPDATE public.menu_items
       SET deleted_at = NULL, deleted_by = NULL,
           is_available = COALESCE(available_before_delete, true), available_before_delete = NULL
     WHERE subcategory_id = _id AND deleted_at = v_was;
    GET DIAGNOSTICS v_items = ROW_COUNT;
    -- Its course comes back with it, without the course's other sections.
    UPDATE public.categories SET deleted_at = NULL, deleted_by = NULL WHERE id = v_cat AND deleted_at IS NOT NULL;
  ELSE
    UPDATE public.menu_items
       SET deleted_at = NULL, deleted_by = NULL,
           is_available = COALESCE(available_before_delete, true), available_before_delete = NULL
     WHERE id = _id;
    v_items := 1;
    -- Its section and course come back with it, without their other dishes.
    UPDATE public.subcategories SET deleted_at = NULL, deleted_by = NULL WHERE id = v_sub AND deleted_at IS NOT NULL;
    UPDATE public.categories SET deleted_at = NULL, deleted_by = NULL WHERE id = v_cat AND deleted_at IS NOT NULL;
  END IF;

  PERFORM public.write_audit(
    'menu.' || _kind || '.restored', 'menu_' || _kind, _id,
    jsonb_build_object('name', v_name, 'deleted_at', v_was),
    jsonb_build_object('subcategories', v_subs, 'items', v_items));

  RETURN jsonb_build_object('kind', _kind, 'id', _id, 'name', v_name,
                            'subcategories', v_subs, 'items', v_items, 'already', false);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_menu_entry(text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_restore_menu_entry(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_menu_entry(text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_restore_menu_entry(text, uuid) TO authenticated, service_role;

-- Latest before this: 20261031100500_service_separation.sql. Only the deleted_at filters are new.
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
     AND mi.deleted_at IS NULL AND s.deleted_at IS NULL AND c.deleted_at IS NULL
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

-- Latest before this: 20261031100500_service_separation.sql. Only the deleted_at filter is new.
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
                     JOIN public.menu_items mi ON mi.id = o.item_id AND mi.deleted_at IS NULL
                    WHERE o.slot_id = s.id
                 )
               ) ORDER BY s.sort_order, s.id)
             ) AS combo
        FROM public.menu_combo_slots s
       WHERE s.venue_id = public.menu_venue()
       GROUP BY s.combo_item_id
    ) c;
$$;
