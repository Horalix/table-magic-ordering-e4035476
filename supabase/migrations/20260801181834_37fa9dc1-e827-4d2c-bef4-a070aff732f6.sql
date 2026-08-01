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
-- Protect the settings singleton from wide writes.
--
-- `restaurant_settings` is one row holding unrelated concerns: the printer
-- configuration, the ordering kill switches, the recommendation weights, the
-- session timeout, and the venue QR token. Any admin screen that loaded the
-- whole row into state and spread it back on save silently rewrote all of it
-- with whatever happened to be true when the page was opened.
--
-- The concrete failure that prompted this: open Admin → Printing, have someone
-- else rotate the venue QR, press Save on Printing — and every QR code printed
-- since is dead, because the stale token was written back. Same mechanism could
-- un-pause ordering or reset every learned weight.
--
-- The UI is fixed to write narrowly, but "remember to write narrowly" is not a
-- guarantee. This makes the dangerous columns structurally unwritable except
-- through the function that is supposed to change them.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.enforce_settings_integrity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- The venue QR token may only change through rotate_venue_qr_token(), which
  -- sets this transaction-local GUC. Same pattern as lasoul.financial_ctx.
  IF NEW.venue_qr_token IS DISTINCT FROM OLD.venue_qr_token
     AND coalesce(current_setting('lasoul.qr_ctx', true), '') <> 'on'
  THEN
    RAISE EXCEPTION 'The venue QR token can only be changed by rotating it'
      USING ERRCODE = 'insufficient_privilege',
            HINT = 'Use Admin → QR Codes → New code, which calls rotate_venue_qr_token().';
  END IF;

  -- Keep the singleton a singleton.
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

-- Teach the rotation function to announce itself.
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
