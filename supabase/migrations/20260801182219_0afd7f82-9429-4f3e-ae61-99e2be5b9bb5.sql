ALTER TABLE public.waiter_calls
  ADD COLUMN IF NOT EXISTS acknowledged_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS acknowledged_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolved_by uuid REFERENCES auth.users(id);

ALTER TABLE public.bill_requests
  ADD COLUMN IF NOT EXISTS acknowledged_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS acknowledged_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolved_by uuid REFERENCES auth.users(id);

DO $$
BEGIN
  ALTER TABLE public.bill_requests DROP CONSTRAINT IF EXISTS bill_requests_status_check;
  ALTER TABLE public.bill_requests
    ADD CONSTRAINT bill_requests_status_check
    CHECK (status IN ('pending', 'acknowledged', 'resolved', 'cancelled'));
END $$;

ALTER TABLE public.table_sessions
  ADD COLUMN IF NOT EXISTS covers int
    CHECK (covers IS NULL OR (covers > 0 AND covers <= 50));

COMMENT ON COLUMN public.table_sessions.covers IS
  'Staff-entered head count. NULL means unknown and must never be treated as zero.';

CREATE INDEX IF NOT EXISTS idx_waiter_calls_open
  ON public.waiter_calls(created_at) WHERE status <> 'resolved';
CREATE INDEX IF NOT EXISTS idx_bill_requests_open
  ON public.bill_requests(created_at) WHERE status <> 'resolved';

CREATE OR REPLACE FUNCTION public.staff_ack_waiter_call(_call_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_call public.waiter_calls;
  v_me uuid := auth.uid();
BEGIN
  IF NOT public.is_staff_member() THEN
    RAISE EXCEPTION 'Only staff can take a call' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_call FROM public.waiter_calls WHERE id = _call_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Call not found'; END IF;

  IF v_call.status = 'resolved' THEN
    RETURN jsonb_build_object('status', 'resolved', 'claimed_by', v_call.resolved_by, 'mine', false);
  END IF;

  IF v_call.acknowledged_by IS NOT NULL
     AND v_call.acknowledged_by <> v_me
     AND v_call.acknowledged_at > now() - interval '3 minutes'
  THEN
    RETURN jsonb_build_object('status', 'acknowledged', 'claimed_by', v_call.acknowledged_by, 'mine', false);
  END IF;

  UPDATE public.waiter_calls
     SET status = 'acknowledged', acknowledged_by = v_me, acknowledged_at = now()
   WHERE id = _call_id;

  RETURN jsonb_build_object('status', 'acknowledged', 'claimed_by', v_me, 'mine', true);
END;
$$;

REVOKE ALL ON FUNCTION public.staff_ack_waiter_call(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_ack_waiter_call(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.staff_resolve_waiter_call(_call_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me uuid := auth.uid();
  v_rows int := 0;
BEGIN
  IF NOT public.is_staff_member() THEN
    RAISE EXCEPTION 'Only staff can resolve a call' USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE public.waiter_calls
     SET status = 'resolved', resolved_at = now(), resolved_by = v_me
   WHERE id = _call_id AND status <> 'resolved';

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN jsonb_build_object('resolved', v_rows > 0);
END;
$$;

REVOKE ALL ON FUNCTION public.staff_resolve_waiter_call(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_resolve_waiter_call(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.staff_ack_bill_request(_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req public.bill_requests;
  v_me uuid := auth.uid();
BEGIN
  IF NOT public.is_staff_member() THEN
    RAISE EXCEPTION 'Only staff can take a bill request' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_req FROM public.bill_requests WHERE id = _request_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Bill request not found'; END IF;

  IF v_req.status = 'resolved' THEN
    RETURN jsonb_build_object('status', 'resolved', 'claimed_by', v_req.resolved_by, 'mine', false);
  END IF;

  IF v_req.acknowledged_by IS NOT NULL
     AND v_req.acknowledged_by <> v_me
     AND v_req.acknowledged_at > now() - interval '3 minutes'
  THEN
    RETURN jsonb_build_object('status', 'acknowledged', 'claimed_by', v_req.acknowledged_by, 'mine', false);
  END IF;

  UPDATE public.bill_requests
     SET status = 'acknowledged', acknowledged_by = v_me, acknowledged_at = now()
   WHERE id = _request_id;

  RETURN jsonb_build_object('status', 'acknowledged', 'claimed_by', v_me, 'mine', true);
END;
$$;

REVOKE ALL ON FUNCTION public.staff_ack_bill_request(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_ack_bill_request(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.staff_resolve_bill_request(
  _request_id uuid,
  _close_session boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req public.bill_requests;
  v_me uuid := auth.uid();
  v_outstanding numeric := 0;
  v_closed boolean := false;
BEGIN
  IF NOT public.is_staff_member() THEN
    RAISE EXCEPTION 'Only staff can resolve a bill request' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_req FROM public.bill_requests WHERE id = _request_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Bill request not found'; END IF;

  UPDATE public.bill_requests
     SET status = 'resolved', resolved_at = now(), resolved_by = v_me
   WHERE id = _request_id AND status <> 'resolved';

  IF _close_session THEN
    SELECT COALESCE(sum(o.total), 0) INTO v_outstanding
      FROM public.orders o
     WHERE o.table_session_id = v_req.table_session_id
       AND o.status NOT IN ('cancelled', 'awaiting_payment', 'payment_failed')
       AND o.payment_status <> 'paid';

    IF v_outstanding > 0 THEN
      RETURN jsonb_build_object('resolved', true, 'closed', false, 'outstanding', v_outstanding);
    END IF;

    UPDATE public.table_sessions
       SET is_active = false, closed_at = now()
     WHERE id = v_req.table_session_id AND is_active;
    v_closed := true;
  END IF;

  RETURN jsonb_build_object('resolved', true, 'closed', v_closed, 'outstanding', 0);
END;
$$;

REVOKE ALL ON FUNCTION public.staff_resolve_bill_request(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_resolve_bill_request(uuid, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.staff_set_covers(_session_id uuid, _covers int)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_staff_member() THEN
    RAISE EXCEPTION 'Only staff can set covers' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF _covers IS NOT NULL AND (_covers < 1 OR _covers > 50) THEN
    RAISE EXCEPTION 'Covers must be between 1 and 50' USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.table_sessions SET covers = _covers WHERE id = _session_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Session not found'; END IF;

  RETURN jsonb_build_object('covers', _covers);
END;
$$;

REVOKE ALL ON FUNCTION public.staff_set_covers(uuid, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_set_covers(uuid, int) TO authenticated;

CREATE OR REPLACE FUNCTION public.covers_summary(_day date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_day date := COALESCE(_day, (now() AT TIME ZONE 'Europe/Sarajevo')::date);
  v_result jsonb;
BEGIN
  IF NOT public.is_staff_member() THEN
    RAISE EXCEPTION 'Only staff can read covers' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT jsonb_build_object(
           'day', v_day,
           'sittings', count(*),
           'counted', count(*) FILTER (WHERE s.covers IS NOT NULL),
           'covers', COALESCE(sum(s.covers), 0),
           'coverage', CASE WHEN count(*) = 0 THEN 0
                            ELSE round(count(*) FILTER (WHERE s.covers IS NOT NULL)::numeric
                                       / count(*)::numeric, 3) END
         )
    INTO v_result
    FROM public.table_sessions s
   WHERE (s.opened_at AT TIME ZONE 'Europe/Sarajevo')::date = v_day;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.covers_summary(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.covers_summary(date) TO authenticated;