
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

ALTER TABLE public.waiters
  ADD COLUMN IF NOT EXISTS pin_hash text,
  ADD COLUMN IF NOT EXISTS pin_set_at timestamptz;

-- Verify a waiter PIN (returns true/false). Safe to call from anon.
CREATE OR REPLACE FUNCTION public.verify_waiter_pin(_waiter_id uuid, _pin text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_hash text;
BEGIN
  IF _pin !~ '^[0-9]{4}$' THEN
    RETURN false;
  END IF;
  SELECT pin_hash INTO v_hash FROM public.waiters WHERE id = _waiter_id AND is_active = true;
  IF v_hash IS NULL THEN
    RETURN false;
  END IF;
  RETURN v_hash = extensions.crypt(_pin, v_hash);
END;
$$;

-- Admin-only PIN setter
CREATE OR REPLACE FUNCTION public.admin_set_waiter_pin(_waiter_id uuid, _pin text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Admin only';
  END IF;
  IF _pin !~ '^[0-9]{4}$' THEN
    RAISE EXCEPTION 'PIN must be exactly 4 digits';
  END IF;
  UPDATE public.waiters
     SET pin_hash = extensions.crypt(_pin, extensions.gen_salt('bf')),
         pin_set_at = now()
   WHERE id = _waiter_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_waiter_pin(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_waiter_pin(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_waiter_pin(uuid, text) TO anon, authenticated;
