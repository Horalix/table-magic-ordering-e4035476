-- =====================================================================
-- Regulars, at the grain the data actually supports
--
-- A café lives on people who come back, and the app cannot currently tell a
-- first-timer from someone who is in every morning. `clientId` has been
-- persisted on the device since the join feature shipped and only ever used to
-- match a join request.
--
-- WHAT THIS DELIBERATELY IS NOT
--
-- It is not a person. It is a DEVICE that opened a table, and every piece of
-- wording that reaches a screen says so. Phones get shared, lent and replaced;
-- treating a client id as an identity would produce confident nonsense like
-- "this guest has visited 40 times" about a tablet behind the bar.
--
-- It is not order-level either. Attribution is per SESSION, keyed on
-- `table_sessions.host_client_id`, which already exists. Going finer would
-- mean threading a client id through `guest_place_order` — a signature change
-- to the most safety-critical function in the schema — to answer a question
-- nobody is asking. A guest who JOINS someone else's table is not counted as
-- a separate visit; their spend is still captured, because it lands in the
-- host's session. That is a real limitation and it is written down rather
-- than papered over.
--
-- Money is net of tips and refunds, for the same reason it is everywhere else:
-- a tip is not something the app earned.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.guest_profiles (
  /** Pseudonymous. No name, no email, no phone, no order contents. */
  client_id text PRIMARY KEY,
  first_seen timestamptz NOT NULL,
  last_seen timestamptz NOT NULL,
  visits int NOT NULL DEFAULT 0,
  orders int NOT NULL DEFAULT 0,
  net_spend numeric(12,2) NOT NULL DEFAULT 0,
  computed_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.guest_profiles IS
  'One row per DEVICE that has opened a table. Pseudonymous and derived — it '
  'can be rebuilt from table_sessions at any time, and guest_forget_me removes '
  'both the row and the link back to it.';

ALTER TABLE public.guest_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff read guest profiles" ON public.guest_profiles;
CREATE POLICY "Staff read guest profiles" ON public.guest_profiles
  FOR SELECT TO authenticated USING (public.is_staff_member());

CREATE INDEX IF NOT EXISTS idx_sessions_host_client
  ON public.table_sessions(host_client_id) WHERE host_client_id IS NOT NULL;

/**
 * Rebuild the profiles from sessions.
 *
 * Derived rather than incrementally maintained, so it cannot drift: a refund
 * three days later, a cancelled order, a corrected total all flow through on
 * the next run without any reconciliation logic. Run by daily maintenance.
 */
CREATE OR REPLACE FUNCTION public.refresh_guest_profiles()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_rows int := 0;
BEGIN
  IF NOT public.is_staff_member() THEN
    RAISE EXCEPTION 'Only staff can refresh guest profiles' USING ERRCODE = 'insufficient_privilege';
  END IF;

  DELETE FROM public.guest_profiles;

  INSERT INTO public.guest_profiles(client_id, first_seen, last_seen, visits, orders, net_spend, computed_at)
  SELECT s.host_client_id,
         min(s.opened_at),
         max(s.opened_at),
         count(DISTINCT s.id)::int,
         COALESCE(sum(so.orders), 0)::int,
         COALESCE(sum(so.net_sales), 0),
         now()
    FROM public.table_sessions s
    JOIN public.session_outcomes so ON so.session_id = s.id
   WHERE s.host_client_id IS NOT NULL
     -- A table that never ordered is not a visit worth counting.
     AND so.orders > 0
   GROUP BY s.host_client_id;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_guest_profiles() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refresh_guest_profiles() TO authenticated;

-- ---------------------------------------------------------------------
-- Deletion, which is what makes the rest defensible
-- ---------------------------------------------------------------------

/**
 * Forget this device.
 *
 * Removes the profile and unlinks every session from the client id, so nothing
 * can be re-derived on the next refresh. The SESSIONS and their orders remain,
 * because they are financial records and deleting them would put a hole in the
 * day's reconciliation — but they are no longer connected to anything.
 *
 * Callable by anyone holding the client id, which is the point: it is the
 * device's own identifier and the device must be able to sever it without
 * asking permission. There is nothing to authorise against, since no account
 * exists.
 */
CREATE OR REPLACE FUNCTION public.guest_forget_me(_client_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sessions int := 0;
  v_profile int := 0;
BEGIN
  IF _client_id IS NULL OR length(trim(_client_id)) = 0 THEN
    RETURN jsonb_build_object('forgotten', false, 'reason', 'no_client_id');
  END IF;

  UPDATE public.table_sessions SET host_client_id = NULL WHERE host_client_id = _client_id;
  GET DIAGNOSTICS v_sessions = ROW_COUNT;

  DELETE FROM public.session_join_requests WHERE client_id = _client_id;

  DELETE FROM public.guest_profiles WHERE client_id = _client_id;
  GET DIAGNOSTICS v_profile = ROW_COUNT;

  RETURN jsonb_build_object(
    'forgotten', true,
    'sessions_unlinked', v_sessions,
    'profile_removed', v_profile > 0);
END;
$$;

REVOKE ALL ON FUNCTION public.guest_forget_me(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guest_forget_me(text) TO anon, authenticated;

-- ---------------------------------------------------------------------
-- The business question
-- ---------------------------------------------------------------------

/**
 * How much of tonight is people coming back?
 *
 * The metric a café actually runs on, and one the app could not answer at all.
 * "Returning" means this device had opened a table before the one being
 * counted — decided per visit, so a guest's first visit counts as new and
 * their second counts as returning, which is what the words mean.
 *
 * `coverage` is stated because a session with no client id (an older visit, or
 * one where the device blocked storage) cannot be classified either way, and a
 * repeat rate computed over an unknown share of the room is not a rate.
 */
CREATE OR REPLACE FUNCTION public.returning_guest_stats(_days int DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_since timestamptz := now() - make_interval(days => GREATEST(COALESCE(_days, 30), 1));
  v jsonb;
BEGIN
  IF NOT public.is_staff_member() THEN
    RAISE EXCEPTION 'Only staff can read guest stats' USING ERRCODE = 'insufficient_privilege';
  END IF;

  WITH visits AS (
    SELECT s.id,
           s.host_client_id,
           so.net_sales,
           EXISTS (
             SELECT 1 FROM public.table_sessions prior
              WHERE prior.host_client_id = s.host_client_id
                AND prior.opened_at < s.opened_at
           ) AS is_returning
      FROM public.table_sessions s
      JOIN public.session_outcomes so ON so.session_id = s.id
     WHERE s.opened_at > v_since AND so.orders > 0
  )
  SELECT jsonb_build_object(
    'days', _days,
    'visits', count(*),
    'identified', count(*) FILTER (WHERE host_client_id IS NOT NULL),
    'coverage', CASE WHEN count(*) = 0 THEN 0
                     ELSE round(count(*) FILTER (WHERE host_client_id IS NOT NULL)::numeric
                                / count(*), 3) END,
    'returning', count(*) FILTER (WHERE is_returning),
    'returning_pct', CASE WHEN count(*) FILTER (WHERE host_client_id IS NOT NULL) = 0 THEN NULL
                          ELSE round(100.0 * count(*) FILTER (WHERE is_returning)
                               / count(*) FILTER (WHERE host_client_id IS NOT NULL), 1) END,
    'avg_spend_returning', COALESCE(round(avg(net_sales) FILTER (WHERE is_returning), 2), 0),
    'avg_spend_new', COALESCE(round(avg(net_sales)
                        FILTER (WHERE host_client_id IS NOT NULL AND NOT is_returning), 2), 0)
  ) INTO v
  FROM visits;

  RETURN v;
END;
$$;

REVOKE ALL ON FUNCTION public.returning_guest_stats(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.returning_guest_stats(int) TO authenticated;

-- Fold the profile rebuild into the daily job.
DO $$
DECLARE v_def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'run_daily_maintenance';
  -- Line endings are not content. Git rewrites .sql to CRLF on Windows
  -- checkouts, which would make every search literal below miss silently.
  v_def := replace(v_def, chr(13) || chr(10), chr(10));


  IF v_def IS NOT NULL AND position('refresh_guest_profiles' in v_def) = 0 THEN
    v_def := replace(v_def,
      'v_decisions := public.prune_recommendation_decisions();',
      'v_decisions := public.prune_recommendation_decisions();
    PERFORM public.refresh_guest_profiles();');
    EXECUTE v_def;
  END IF;
END $$;
