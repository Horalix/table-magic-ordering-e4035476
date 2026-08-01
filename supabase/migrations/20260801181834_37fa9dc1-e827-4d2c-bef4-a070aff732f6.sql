CREATE OR REPLACE FUNCTION public.enforce_settings_integrity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.venue_qr_token IS DISTINCT FROM OLD.venue_qr_token
     AND coalesce(current_setting('lasoul.qr_ctx', true), '') <> 'on'
  THEN
    RAISE EXCEPTION 'The venue QR token can only be changed by rotating it'
      USING ERRCODE = 'insufficient_privilege',
            HINT = 'Use Admin → QR Codes → New code, which calls rotate_venue_qr_token().';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'restaurant_settings is a single row';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_settings_integrity ON public.restaurant_settings;
CREATE TRIGGER enforce_settings_integrity
  BEFORE UPDATE ON public.restaurant_settings
  FOR EACH ROW EXECUTE FUNCTION public.enforce_settings_integrity();

CREATE OR REPLACE FUNCTION public.rotate_venue_qr_token()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token text := encode(gen_random_bytes(32), 'hex');
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only a manager can rotate the venue QR' USING ERRCODE = 'insufficient_privilege';
  END IF;

  PERFORM set_config('lasoul.qr_ctx', 'on', true);

  UPDATE public.restaurant_settings
     SET venue_qr_token = v_token, venue_qr_rotated_at = now()
   WHERE id = 1;

  PERFORM public.write_audit('qr.venue_rotated', 'restaurant_settings', NULL, NULL, NULL,
                             'Venue QR rotated — reprint required');
  RETURN v_token;
END;
$$;

REVOKE ALL ON FUNCTION public.rotate_venue_qr_token() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rotate_venue_qr_token() TO authenticated;