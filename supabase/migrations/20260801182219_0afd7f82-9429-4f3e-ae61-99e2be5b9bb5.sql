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
-- Floor alerts, claimable and attributable
--
-- `waiter_calls.status` has allowed 'acknowledged' since the first migration
-- and nothing has ever written it. In practice that means:
--
--   - two waiters both walk to table 7, because neither can see the other is
--     already going;
--   - a call can be cleared from a 24px button by anyone, with no record of
--     who cleared it or whether the guest was ever served;
--   - the KITCHEN screen fields every front-of-house alert in the building,
--     because it is the only screen that shows them.
--
-- Claiming fixes the first two. It is deliberately not a lock: a waiter who
-- claims and then gets stuck at another table must not be able to strand the
-- guest, so anyone may take over an old claim — the record simply says who.
--
-- Also here: covers. Staff-entered and optional, never inferred. Anything
-- reported per-head has to state its coverage, because a revenue-per-guest
-- figure computed over the 60% of sittings someone remembered to count is
-- worse than no figure at all.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------

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

/**
 * How many people are actually at the table.
 *
 * NULL means "nobody said", and that is a first-class value: a zero would be
 * a lie and a guess would quietly corrupt every per-head metric. Approved
 * session members give a free lower bound where covers are unknown, and any
 * report using this must say what fraction of sittings it covers.
 */
ALTER TABLE public.table_sessions
  ADD COLUMN IF NOT EXISTS covers int
    CHECK (covers IS NULL OR (covers > 0 AND covers <= 50));

COMMENT ON COLUMN public.table_sessions.covers IS
  'Staff-entered head count. NULL means unknown and must never be treated as zero.';

CREATE INDEX IF NOT EXISTS idx_waiter_calls_open
  ON public.waiter_calls(created_at) WHERE status <> 'resolved';
CREATE INDEX IF NOT EXISTS idx_bill_requests_open
  ON public.bill_requests(created_at) WHERE status <> 'resolved';

-- ---------------------------------------------------------------------
-- 2. Claiming
-- ---------------------------------------------------------------------

/**
 * Take responsibility for a call.
 *
 * Returns who holds it, so the caller can say "Marko is going" rather than
 * silently doing nothing when someone else got there first.
 *
 * Not a lock. A waiter who claims a call and is then pinned at another table
 * must not be able to strand the guest, so a claim older than the takeover
 * window may be taken by anyone. The audit trail keeps both names.
 */
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

  -- Someone else has it and is still plausibly walking there.
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

/** Close a call, with an author. */
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

/** Same, for a table asking for the bill. */
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

/**
 * Close a bill request, and optionally free the table.
 *
 * Closing the session is separated from resolving the request because they are
 * genuinely different events: the guest can ask for the bill, pay, and then sit
 * with a coffee for twenty minutes. Closing the session at "bill resolved"
 * shortens every recorded sitting and quietly corrupts turnover reporting.
 *
 * Refuses to free a table that still owes money. That check lived in no UI, so
 * a tap on a 24px button could end a session with an unpaid order attached to
 * it — and once the session is closed nobody is looking at that table again.
 */
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

-- ---------------------------------------------------------------------
-- 3. Covers
-- ---------------------------------------------------------------------

/** Record how many people are at a table. NULL clears it back to unknown. */
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

/**
 * Covers for a day, with the honesty attached.
 *
 * `coverage` is the point of this function. A revenue-per-guest number
 * computed over the 60% of sittings someone remembered to count is worse than
 * no number at all, because it looks precise. Every consumer must show it.
 */
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
