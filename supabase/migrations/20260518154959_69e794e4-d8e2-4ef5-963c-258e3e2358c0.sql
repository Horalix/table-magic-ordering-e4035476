
CREATE OR REPLACE FUNCTION public.touch_session(_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.table_sessions
     SET last_heartbeat_at = now()
   WHERE id = _id AND is_active = true;
$$;

GRANT EXECUTE ON FUNCTION public.touch_session(uuid) TO anon, authenticated;

DROP FUNCTION IF EXISTS public.touch_session(uuid, text);
