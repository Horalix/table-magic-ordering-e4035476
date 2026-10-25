-- =====================================================================
-- A waiter can take a table nobody has; opening rushes stop holding orders
-- =====================================================================
--
-- 1. Tables are given to a waiter from the day's section rota
--    (assign_session_waiter). A table in no section, or in a section nobody is
--    rostered on, opens with no waiter — and nothing on any waiter's phone
--    mentioned its calls, bill requests or ready plates; only the floor
--    monitor did. The waiter phone now shows unassigned tables' alerts to every
--    waiter, and staff_take_table is the one tap that makes the table theirs.
--
-- 2. "Several tables opening at once" held every first order once more than
--    three tables sat down within five minutes of each other. That is an
--    ordinary busy evening, not a script or a QR photo in a group chat, and it
--    meant real guests' food waited for a waiter's tap. Eight is still far
--    below what an attack looks like. Only a value nobody has changed moves.
--
-- Data-only apart from one new function; no table is created.

/**
 * Take an unassigned table: the calling waiter becomes its waiter.
 *
 * Never takes a table from a colleague — if someone got there first, it says
 * who. Taking a table is staff having seen it, so nothing more from it is held
 * (order_hold_reason checks staff_seen_at first).
 */
CREATE OR REPLACE FUNCTION public.staff_take_table(_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_waiter uuid;
  v_session public.table_sessions;
BEGIN
  IF NOT public.is_staff_member() THEN
    RAISE EXCEPTION 'Only staff can take a table' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT w.id INTO v_waiter FROM public.waiters w WHERE w.user_id = auth.uid() LIMIT 1;
  IF v_waiter IS NULL THEN
    RAISE EXCEPTION 'No waiter profile is linked to this account';
  END IF;

  -- Locked, so two waiters tapping the same table at once serialise.
  SELECT * INTO v_session FROM public.table_sessions WHERE id = _session_id FOR UPDATE;
  IF NOT FOUND OR NOT v_session.is_active THEN
    RETURN jsonb_build_object('taken', false, 'reason', 'not_open');
  END IF;

  IF v_session.assigned_waiter_id IS NOT NULL AND v_session.assigned_waiter_id <> v_waiter THEN
    RETURN jsonb_build_object(
      'taken', false, 'reason', 'already_taken',
      'waiter', (SELECT w.display_name FROM public.waiters w WHERE w.id = v_session.assigned_waiter_id));
  END IF;

  UPDATE public.table_sessions
     SET assigned_waiter_id = v_waiter,
         staff_seen_at = COALESCE(staff_seen_at, now())
   WHERE id = _session_id;

  RETURN jsonb_build_object('taken', true);
END;
$$;

REVOKE ALL ON FUNCTION public.staff_take_table(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_take_table(uuid) TO authenticated, service_role;

ALTER TABLE public.restaurant_settings ALTER COLUMN hold_burst_sessions SET DEFAULT 8;
UPDATE public.restaurant_settings SET hold_burst_sessions = 8 WHERE id = 1 AND hold_burst_sessions = 3;
