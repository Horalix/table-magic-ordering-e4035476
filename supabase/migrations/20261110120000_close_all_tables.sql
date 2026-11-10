-- =====================================================================
-- Tables left open after the work day
--
-- Waiters do not always free their tables when the guests leave, and nothing
-- else ever did. A table left open at closing time is still "seated" the next
-- morning: the floor shows guests who went home, the sitting time of that
-- visit runs all night, and the day's numbers of seated tables are wrong.
--
-- Three things, all by the rule the single-table Free already follows
-- (staff_close_session): a table that owes nothing is freed; a table that
-- still owes money is never freed, and is named with what it owes.
--
--   1. staff_close_all_tables()  the "Close all tables" button, for the
--      restaurant the screen shows.
--   2. staff_open_tables()       what the end-of-day notice reads: the tables
--      still open, what each owes, which were left from an earlier day, the
--      restaurant's clock and when its work day ends.
--   3. close_tables_overnight()  the scheduler's: before the new trading day
--      (business_day() turns at 05:00), every table that owes nothing and
--      whose guests have been gone for the idle timeout is freed. Only where
--      pg_cron exists; without it the notice and the button do the job.
--
-- restaurant_settings.day_ends_at is when the notice starts (Admin → Service).
-- Empty means "not set": the app then uses the restaurant's opening hours.
--
-- Nothing is deleted: a freed table keeps its orders, as with Free. Safe to
-- run twice.
-- =====================================================================

ALTER TABLE public.restaurant_settings
  ADD COLUMN IF NOT EXISTS day_ends_at time;

COMMENT ON COLUMN public.restaurant_settings.day_ends_at IS
  'When the work day ends, local time. From then on staff screens say which '
  'tables are still open and offer to close them all. NULL: not set.';

/**
 * Free every open table of one restaurant that owes nothing.
 *
 * `_idle_only`: leave a table whose guests were active within the idle
 * timeout (a heartbeat from a guest's phone, an order, a dish served) — what
 * the scheduler passes, so a table still sitting at 04:00 is not touched.
 *
 * Returns { closed, kept: [{ session_id, table_number, outstanding,
 * unpaid_orders }] }: the tables that owe money, which stay open.
 * Not callable from outside: the two functions below decide who may.
 */
CREATE OR REPLACE FUNCTION public.close_settled_sessions(_venue uuid, _idle_only boolean, _reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s record;
  v_outstanding numeric;
  v_unpaid int;
  v_last timestamptz;
  v_timeout int;
  v_closed int := 0;
  v_kept jsonb := '[]'::jsonb;
  v_me uuid := auth.uid();
BEGIN
  PERFORM public.use_venue(_venue);
  v_timeout := public.session_idle_timeout();

  FOR s IN
    SELECT ts.id, ts.table_id, t.table_number, ts.opened_at, ts.last_heartbeat_at, ts.last_served_at
      FROM public.table_sessions ts
      JOIN public.tables t ON t.id = ts.table_id
     WHERE ts.venue_id = _venue AND ts.is_active
     ORDER BY t.table_number
       -- A table being paid or freed right now is left to whoever has it.
       FOR UPDATE OF ts SKIP LOCKED
  LOOP
    SELECT o.outstanding, o.unpaid_orders INTO v_outstanding, v_unpaid
      FROM public.session_outstanding(s.id) o;

    IF v_unpaid > 0 THEN
      v_kept := v_kept || jsonb_build_object(
        'session_id', s.id, 'table_number', s.table_number,
        'outstanding', v_outstanding, 'unpaid_orders', v_unpaid);
      CONTINUE;
    END IF;

    IF _idle_only THEN
      SELECT GREATEST(
               s.opened_at,
               COALESCE(s.last_heartbeat_at, s.opened_at),
               COALESCE(s.last_served_at, s.opened_at),
               COALESCE((SELECT max(o.created_at) FROM public.orders o WHERE o.table_session_id = s.id), s.opened_at))
        INTO v_last;
      IF v_last > now() - make_interval(mins => v_timeout) THEN
        CONTINUE;
      END IF;
    END IF;

    UPDATE public.table_sessions
       SET is_active = false, closed_at = now()
     WHERE id = s.id;

    UPDATE public.waiter_calls
       SET status = 'resolved', resolved_at = now(), resolved_by = v_me
     WHERE table_session_id = s.id AND status <> 'resolved';

    UPDATE public.bill_requests
       SET status = 'resolved', resolved_at = now(), resolved_by = v_me
     WHERE table_session_id = s.id AND status <> 'resolved';

    PERFORM public.write_audit('table.freed', 'table_session', s.id,
      jsonb_build_object('is_active', true, 'table_id', s.table_id),
      jsonb_build_object('is_active', false), _reason);

    v_closed := v_closed + 1;
  END LOOP;

  RETURN jsonb_build_object('closed', v_closed, 'kept', v_kept);
END;
$$;
REVOKE ALL ON FUNCTION public.close_settled_sessions(uuid, boolean, text) FROM PUBLIC, anon, authenticated;

/**
 * "Close all tables": every open table of the restaurant this screen shows
 * that owes nothing is freed, at once. Tables that owe money stay open and
 * come back in `kept`, so the screen can say "Table 7 still owes 24.00 KM".
 */
CREATE OR REPLACE FUNCTION public.staff_close_all_tables()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_venue uuid := public.current_venue();
BEGIN
  IF NOT public.is_staff_member() OR NOT public.can_staff(v_venue) THEN
    RAISE EXCEPTION 'Only staff can close the tables' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN public.close_settled_sessions(v_venue, false, 'Close all tables');
END;
$$;
REVOKE ALL ON FUNCTION public.staff_close_all_tables() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_close_all_tables() TO authenticated;

/**
 * The tables still open at the restaurant this screen shows, for the
 * end-of-day notice: what each owes, and whether it was opened on an earlier
 * trading day (left open overnight). With the restaurant's own clock, so a
 * phone with a wrong clock does not decide when the day is over.
 */
CREATE OR REPLACE FUNCTION public.staff_open_tables()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_venue uuid := public.current_venue();
  v_tables jsonb;
  v_auto boolean := false;
BEGIN
  IF NOT public.is_staff_member() OR NOT public.can_staff(v_venue) THEN
    RAISE EXCEPTION 'Only staff can see the open tables' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'session_id', ts.id,
           'table_number', t.table_number,
           'opened_at', ts.opened_at,
           'outstanding', o.outstanding,
           'unpaid_orders', o.unpaid_orders,
           'overnight', public.business_day(ts.opened_at) < public.business_day(now()))
           ORDER BY t.table_number), '[]'::jsonb)
    INTO v_tables
    FROM public.table_sessions ts
    JOIN public.tables t ON t.id = ts.table_id
    CROSS JOIN LATERAL public.session_outstanding(ts.id) o
   WHERE ts.venue_id = v_venue AND ts.is_active;

  -- Whether the overnight close below is scheduled here, so the notice only
  -- promises it where it will happen.
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      EXECUTE $q$SELECT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'lasoul-close-tables' AND active)$q$ INTO v_auto;
    EXCEPTION WHEN OTHERS THEN
      v_auto := false;
    END;
  END IF;

  RETURN jsonb_build_object(
    'local_time', to_char(now() AT TIME ZONE 'Europe/Sarajevo', 'HH24:MI'),
    -- Of the trading day: half past midnight on Saturday is still Friday's service.
    'weekday', extract(isodow FROM public.business_day(now()))::int,
    'closes_overnight', v_auto,
    'day_ends_at', (SELECT to_char(rs.day_ends_at, 'HH24:MI') FROM public.restaurant_settings rs WHERE rs.venue_id = v_venue),
    'tables', v_tables);
END;
$$;
REVOKE ALL ON FUNCTION public.staff_open_tables() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_open_tables() TO authenticated;

/**
 * The scheduler's: at the end of the night, at every restaurant, free the
 * tables that owe nothing and whose guests have been gone for the idle
 * timeout. A table that owes money is left for a person (it shows on the
 * end-of-day notice, and under "needs attention").
 */
CREATE OR REPLACE FUNCTION public.close_tables_overnight()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v record;
  v_one jsonb;
  v_result jsonb := '{}'::jsonb;
BEGIN
  IF auth.uid() IS NOT NULL OR NOT public.is_trusted_caller() THEN
    RAISE EXCEPTION 'The overnight close is the scheduler''s' USING ERRCODE = 'insufficient_privilege';
  END IF;

  FOR v IN SELECT id, slug FROM public.venues ORDER BY created_at, id LOOP
    v_one := public.close_settled_sessions(v.id, true, 'Closed overnight: left open after the work day');
    v_result := v_result || jsonb_build_object(v.slug, jsonb_build_object(
      'closed', v_one -> 'closed', 'kept', jsonb_array_length(v_one -> 'kept')));
  END LOOP;

  INSERT INTO public.maintenance_runs(job, last_run_at, last_result)
  VALUES ('close_tables', now(), v_result)
  ON CONFLICT (job) DO UPDATE SET last_run_at = now(), last_result = EXCLUDED.last_result;

  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.close_tables_overnight() FROM PUBLIC, anon, authenticated;

/** What pg_cron runs: the same mark the other scheduled jobs set. */
CREATE OR REPLACE FUNCTION public.run_scheduled_table_close()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  PERFORM set_config('lasoul.scheduled_job', 'on', true);
  v_result := public.close_tables_overnight();
  PERFORM set_config('lasoul.scheduled_job', '', true);
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.run_scheduled_table_close() FROM PUBLIC, anon, authenticated;

/*
 * 03:10 UTC is 04:10 in Sarajevo in winter and 05:10 in summer: after any
 * service, around the turn of the trading day. pg_cron has no time zones, and
 * the idle rule makes the exact minute unimportant. cron.schedule with a job
 * name replaces a job of that name, so re-running is safe.
 */
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      EXECUTE $q$SELECT cron.schedule('lasoul-close-tables', '10 3 * * *',
                                       'SELECT public.run_scheduled_table_close()')$q$;
      RAISE NOTICE 'overnight table close scheduled with pg_cron at 03:10 UTC';
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'pg_cron is installed but the overnight table close could not be scheduled (%)', SQLERRM;
    END;
  ELSE
    RAISE NOTICE 'pg_cron is not available: tables left open are closed from the end-of-day notice';
  END IF;
END $cron$;
