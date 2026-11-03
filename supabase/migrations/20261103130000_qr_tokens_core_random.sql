-- "Generate a new code" for the room's QR (Admin → QR codes) answered
-- "function gen_random_bytes(integer) does not exist".
--
-- Both QR rotations made their token with pgcrypto's gen_random_bytes inside a
-- function whose search_path is public only. Supabase installs pgcrypto in
-- the `extensions` schema, so the function could never find it there; the
-- test database installs it in public, which is why no test caught it. A
-- table's rotation (rotate_table_qr_token) had the same fault.
--
-- The token is now made from gen_random_uuid(), which is part of Postgres
-- itself (13+) and found from any search_path: two random UUIDs, dashes
-- removed, 64 hex characters as before, 244 random bits from the same strong
-- source pgcrypto uses. Nothing else in either function changes, and their
-- grants stay as they are (CREATE OR REPLACE keeps them). Running this again
-- changes nothing.

-- Latest before this: 20261028100000_two_restaurants_context.sql.
CREATE OR REPLACE FUNCTION public.rotate_venue_qr_token()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_token text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  v_venue uuid := public.current_venue();
BEGIN
  IF NOT public.can_admin(v_venue) THEN
    RAISE EXCEPTION 'Only a manager can rotate the venue QR' USING ERRCODE = 'insufficient_privilege';
  END IF;

  PERFORM set_config('lasoul.qr_ctx', 'on', true);

  UPDATE public.restaurant_settings
     SET venue_qr_token = v_token, venue_qr_rotated_at = now()
   WHERE venue_id = v_venue;

  PERFORM public.write_audit('qr.venue_rotated', 'restaurant_settings', NULL, NULL, NULL,
                             'Venue QR rotated — reprint required');
  RETURN v_token;
END;
$function$;

-- Latest before this: 20261031100000_admin_separation.sql. The table's restaurant's admin.
CREATE OR REPLACE FUNCTION public.rotate_table_qr_token(_table_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  v_venue uuid;
BEGIN
  SELECT venue_id INTO v_venue FROM public.tables WHERE id = _table_id;
  IF FOUND AND NOT public.can_admin(v_venue) THEN
    RAISE EXCEPTION 'Only a manager can rotate a table QR' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT FOUND THEN
    IF NOT EXISTS (SELECT 1 FROM public.user_roles
                    WHERE user_id = auth.uid() AND role = 'admin'::public.app_role) THEN
      RAISE EXCEPTION 'Only a manager can rotate a table QR' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RAISE EXCEPTION 'Table not found';
  END IF;

  -- The audit entry is the table's restaurant's, whatever the app is showing.
  PERFORM public.use_venue(v_venue);

  UPDATE public.tables SET qr_token = v_token WHERE id = _table_id;

  PERFORM public.write_audit('qr.table_rotated', 'table', _table_id);
  RETURN v_token;
END;
$$;
