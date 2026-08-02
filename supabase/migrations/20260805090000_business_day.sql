-- =====================================================================
-- The business day is Sarajevo's, not UTC's
--
-- Found because the shift-close tests began failing at 01:35 local time and
-- passed again at 09:00. That is not a flaky test. That is the bug reporting
-- itself, once a day, for two hours.
--
-- THE DEFECT
--
-- `close_shift` decides which day it is closing in local time:
--
--     v_day := (now() AT TIME ZONE 'Europe/Sarajevo')::date
--
-- and then asks `day_reconciliation(v_day)` for the takings. That function
-- buckets by
--
--     created_at >= _day::timestamptz
--
-- and a bare date cast to timestamptz uses the SESSION time zone, which on
-- Supabase is UTC. So the day is chosen in Sarajevo and measured in UTC, and
-- the two disagree by the offset — two hours in summer, one in winter.
--
-- WHAT THAT COSTS
--
-- Sarajevo is UTC+2 in summer, so an order at 00:30 local is 22:30 UTC the
-- previous day. For a cafe that serves past midnight:
--
--   * A manager closing up at 01:15 gets an `expected_cash` that omits
--     everything sold since midnight. The drawer is over by exactly the
--     late-night trade, every night, and `shift_closes` records the surplus as
--     a discrepancy with an audit entry blaming nobody in particular.
--   * The previous day was already closed before that trade existed, so those
--     orders are never reconciled by ANY close. They are not lost — they are in
--     `orders` and in the revenue reports — but no drawer count ever accounts
--     for them.
--   * `sales_analytics` splits the same evening's service across two dates,
--     making every late night look like a weak night followed by a strange
--     early morning.
--   * `section_assignments` are looked up by `CURRENT_DATE`, so at midnight
--     UTC — 02:00 local, mid-service — every waiter silently loses their
--     section and new tables stop being auto-assigned.
--
-- THE FIX
--
-- One definition of "day", used on both sides of every comparison. Existing
-- `shift_closes` rows keep the snapshots they were written with; a closed day
-- is a historical record and is not rewritten here.
--
-- Deliberately NOT changed: `order_code_counters` still rolls on `CURRENT_DATE`.
-- Order numbering has fiscalisation implications and neither boundary is
-- obviously right for a service that runs past midnight. It should be decided
-- against the actual fiscal requirement, not quietly by this migration.
-- =====================================================================

/**
 * The trading day a moment belongs to.
 *
 * Every "today" in an operational query should come from here, so that the day
 * a report covers is the same day the restaurant worked.
 */
CREATE OR REPLACE FUNCTION public.business_day(_at timestamptz DEFAULT now())
RETURNS date
LANGUAGE sql
STABLE
AS $$ SELECT (_at AT TIME ZONE 'Europe/Sarajevo')::date $$;

/**
 * The half-open range of instants belonging to a trading day.
 *
 * Note the cast: `_day::timestamp AT TIME ZONE 'Europe/Sarajevo'` reads the
 * naive midnight AS Sarajevo local time and yields the correct instant. The
 * broken version was `_day::timestamptz`, which reads it as UTC. The two look
 * almost identical and differ by the whole bug.
 *
 * DST-safe: local midnight is never the ambiguous or skipped hour in European
 * zones, so the short and long days of the year come out at 23 and 25 hours
 * without special handling.
 */
CREATE OR REPLACE FUNCTION public.business_day_range(_day date)
RETURNS TABLE(starts_at timestamptz, ends_at timestamptz)
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT (_day::timestamp AT TIME ZONE 'Europe/Sarajevo'),
         ((_day + 1)::timestamp AT TIME ZONE 'Europe/Sarajevo');
$$;

GRANT EXECUTE ON FUNCTION public.business_day(timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.business_day_range(date) TO authenticated;

-- ---------------------------------------------------------------------
-- Reconciliation — the one that costs money
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.day_reconciliation(_day date DEFAULT public.business_day())
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
  v_from timestamptz;
  v_to timestamptz;
BEGIN
  IF NOT public.is_staff_member() THEN
    RAISE EXCEPTION 'Only staff can read reconciliation' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT starts_at, ends_at INTO v_from, v_to FROM public.business_day_range(_day);

  SELECT jsonb_build_object(
    'day', _day,
    'orders', count(*),
    'gross', COALESCE(sum(total), 0),
    'tips', COALESCE(sum(tip_amount), 0),
    'refunded', COALESCE(sum(refunded_amount), 0),
    'net', COALESCE(sum(total) - sum(refunded_amount), 0),
    'paid_online', COALESCE(sum(total) FILTER (WHERE payment_method = 'card_online' AND payment_status = 'paid'), 0),
    'paid_cash', COALESCE(sum(total) FILTER (WHERE payment_method = 'cash' AND payment_status = 'paid'), 0),
    'paid_pos_terminal', COALESCE(sum(total) FILTER (WHERE payment_method = 'pos_terminal' AND payment_status = 'paid'), 0),
    'outstanding', COALESCE(sum(total) FILTER (WHERE payment_status IN ('unpaid', 'pending')), 0),
    'outstanding_orders', count(*) FILTER (WHERE payment_status IN ('unpaid', 'pending')),
    'unfiscalized', COALESCE(sum(total) FILTER (WHERE fiscalization_status <> 'fiscalized'), 0),
    'unfiscalized_orders', count(*) FILTER (WHERE fiscalization_status <> 'fiscalized'),
    'average_order', COALESCE(round(avg(total), 2), 0)
  )
  INTO v_result
  FROM public.completed_orders
  WHERE created_at >= v_from AND created_at < v_to;

  -- Money that started but never landed: the queue staff must clear.
  SELECT v_result || jsonb_build_object(
    'stuck_payments', COALESCE(count(*), 0),
    'stuck_amount', COALESCE(round(sum(o.total), 2), 0),
    'cancelled_orders', (SELECT count(*) FROM public.orders c
                          WHERE c.status = 'cancelled'
                            AND c.created_at >= v_from AND c.created_at < v_to),
    'callback_problems', (SELECT count(*) FROM public.payment_callback_events e
                           WHERE e.outcome IN ('amount_mismatch', 'currency_mismatch', 'unknown_transaction')
                             AND e.created_at >= v_from AND e.created_at < v_to)
  )
  INTO v_result
  FROM public.orders o
  WHERE o.status IN ('awaiting_payment', 'payment_failed')
    AND o.created_at >= v_from AND o.created_at < v_to;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.day_reconciliation(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.day_reconciliation(date) TO authenticated;

-- ---------------------------------------------------------------------
-- Reporting — same boundary, so a night is one night
-- ---------------------------------------------------------------------

DO $$
DECLARE v_def text; v_before text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'sales_analytics';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'sales_analytics is missing — migrations are out of order';
  END IF;

  -- Line endings are not content; see .gitattributes.
  v_def := replace(v_def, chr(13) || chr(10), chr(10));

  v_before := v_def;
  v_def := replace(v_def,
    'v_from := _from::timestamptz;',
    'SELECT starts_at INTO v_from FROM public.business_day_range(_from);');
  IF v_def = v_before THEN RAISE EXCEPTION 'sales_analytics lower-bound rewrite did not match'; END IF;

  v_before := v_def;
  v_def := replace(v_def,
    'v_to := (_to + 1)::timestamptz;',
    'SELECT ends_at INTO v_to FROM public.business_day_range(_to);');
  IF v_def = v_before THEN RAISE EXCEPTION 'sales_analytics upper-bound rewrite did not match'; END IF;

  -- The defaults must move too, or "last 7 days" still means seven UTC days.
  v_def := replace(v_def, '_from date DEFAULT (CURRENT_DATE - 6)',
                          '_from date DEFAULT (public.business_day() - 6)');
  v_def := replace(v_def, '_to date DEFAULT CURRENT_DATE',
                          '_to date DEFAULT public.business_day()');

  EXECUTE v_def;
  RAISE NOTICE 'sales_analytics now reports on Sarajevo trading days';
END $$;

-- ---------------------------------------------------------------------
-- Section assignments — waiters keep their section past midnight
-- ---------------------------------------------------------------------

ALTER TABLE public.section_assignments
  ALTER COLUMN shift_date SET DEFAULT public.business_day();

DO $$
DECLARE r record; v_def text; v_new text;
BEGIN
  /*
   * Both auto-assignment paths look up today's rota. Under UTC they stopped
   * matching at 02:00 local — mid-service — and every table opened after that
   * arrived with no waiter attached.
   */
  FOR r IN
    SELECT p.oid, p.proname
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND pg_get_functiondef(p.oid) LIKE '%shift_date = CURRENT_DATE%'
  LOOP
    v_def := replace(pg_get_functiondef(r.oid), chr(13) || chr(10), chr(10));
    v_new := replace(v_def, 'shift_date = CURRENT_DATE', 'shift_date = public.business_day()');
    IF v_new = v_def THEN
      RAISE EXCEPTION 'rota rewrite did not match in %', r.proname;
    END IF;
    EXECUTE v_new;
    RAISE NOTICE 'rota lookup in % now uses the trading day', r.proname;
  END LOOP;
END $$;
