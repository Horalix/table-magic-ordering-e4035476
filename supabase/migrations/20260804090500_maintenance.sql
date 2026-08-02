-- =====================================================================
-- Retention, and a place for scheduled work to live
--
-- `analytics_events` has no retention. `item_viewed` fires per card
-- impression, so the table only ever grows, and five separate functions scan
-- it — menu_item_performance, sold_out_impact, suggestion_impact,
-- suggestion_impact_by_placement and refresh_suggestion_stats.
--
-- The plan for this phase called for a daily rollup table those five would
-- read instead. I am deliberately NOT building that, and the reason belongs
-- here rather than in a commit message nobody will find:
--
--   A busy café is on the order of 100 sessions a day and perhaps 40 events
--   each — call it 1.5M rows a year. With an index on occurred_at that is a
--   non-event for Postgres. A rollup would mean rewriting all five consumers
--   to read a different shape, and getting every dimension right (placement,
--   source_item_id, daypart, recommendation_type) or the numbers silently
--   stop matching. That is a lot of risk to solve a problem this data does
--   not have.
--
--   The threshold where it WOULD be worth it is roughly two orders of
--   magnitude higher — tens of millions of rows, or a reporting query that
--   has actually become slow. At that point build the rollup and migrate the
--   consumers one at a time, verifying each against the raw numbers.
--
-- So: bounded growth, an index, and somewhere for scheduled work to run that
-- is not a browser tab.
-- =====================================================================

CREATE INDEX IF NOT EXISTS idx_analytics_occurred ON public.analytics_events(occurred_at);

-- ---------------------------------------------------------------------
-- 1. A record of when scheduled work last ran
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.maintenance_runs (
  job text PRIMARY KEY,
  last_run_at timestamptz NOT NULL DEFAULT now(),
  last_result jsonb NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE public.maintenance_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff read maintenance" ON public.maintenance_runs;
CREATE POLICY "Staff read maintenance" ON public.maintenance_runs
  FOR SELECT TO authenticated USING (public.is_staff_member());

-- ---------------------------------------------------------------------
-- 2. Pruning, with a floor it will not cross
-- ---------------------------------------------------------------------

/**
 * Delete analytics events older than the retention window.
 *
 * The floor is the important part. Every reporting function takes a `_days`
 * argument, and a manager looking at a year of history has no way to know the
 * underlying rows were deleted — the charts would simply flatten, silently and
 * irreversibly. So this refuses to prune anything younger than 120 days
 * regardless of what it is asked, and the default is well beyond any window
 * the app offers.
 *
 * Deleting analytics is not like pruning a cache; the events are the only
 * record that a guest ever looked at a dish and did not order it.
 */
CREATE OR REPLACE FUNCTION public.prune_analytics_events(_days int DEFAULT 400)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_days int := GREATEST(120, COALESCE(_days, 400));
  v_rows int := 0;
BEGIN
  IF NOT public.is_staff_member() THEN
    RAISE EXCEPTION 'Only staff can prune analytics' USING ERRCODE = 'insufficient_privilege';
  END IF;

  DELETE FROM public.analytics_events
   WHERE occurred_at < now() - make_interval(days => v_days);

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$;

REVOKE ALL ON FUNCTION public.prune_analytics_events(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prune_analytics_events(int) TO authenticated;

/** Decision rows outlive the events; they are small and they are the ledger. */
CREATE OR REPLACE FUNCTION public.prune_recommendation_decisions(_days int DEFAULT 400)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_days int := GREATEST(120, COALESCE(_days, 400));
  v_rows int := 0;
BEGIN
  IF NOT public.is_staff_member() THEN
    RAISE EXCEPTION 'Only staff can prune decisions' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Never remove a decision that a completed sale points at; the join from
  -- revenue back to the decision is the whole value of the ledger.
  DELETE FROM public.recommendation_decisions d
   WHERE d.created_at < now() - make_interval(days => v_days)
     AND NOT EXISTS (SELECT 1 FROM public.suggestion_conversions sc WHERE sc.decision_id = d.id);

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$;

REVOKE ALL ON FUNCTION public.prune_recommendation_decisions(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prune_recommendation_decisions(int) TO authenticated;

-- ---------------------------------------------------------------------
-- 3. Once a day, whoever asks first
-- ---------------------------------------------------------------------

/**
 * Daily housekeeping.
 *
 * Safe to call from anywhere, as often as anyone likes. Two guards:
 *
 *   * an advisory lock, so two devices calling at the same moment do not both
 *     run it — `pg_try_advisory_lock` returns rather than waits, because the
 *     second caller has nothing useful to do;
 *   * a once-per-day check, so calling it every minute costs one cheap query.
 *
 * Deliberately NOT the same mechanism as `requeue_stale_ticket_prints`, which
 * the kitchen screen runs every 60 seconds. That one is a service-time
 * concern — a stuck ticket has to be caught within a minute or food is late —
 * and a browser tab is the right owner precisely because it is only needed
 * while someone is cooking. Retention is not like that: it must happen whether
 * or not anyone has a screen open, and running it from a tab means it silently
 * stops on a quiet Monday.
 *
 * This is the seam. Point a real scheduler at it — pg_cron, a Supabase
 * scheduled function, or an external cron hitting the RPC — and the guards
 * make that safe without any further change.
 */
CREATE OR REPLACE FUNCTION public.run_daily_maintenance()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_last timestamptz;
  v_events int := 0;
  v_decisions int := 0;
  v_result jsonb;
BEGIN
  IF NOT public.is_staff_member() THEN
    RAISE EXCEPTION 'Only staff can run maintenance' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- A second caller returns immediately rather than queueing behind the first.
  IF NOT pg_try_advisory_lock(hashtext('lasoul.daily_maintenance')) THEN
    RETURN jsonb_build_object('ran', false, 'reason', 'already_running');
  END IF;

  BEGIN
    SELECT last_run_at INTO v_last FROM public.maintenance_runs WHERE job = 'daily';

    IF v_last IS NOT NULL AND v_last > now() - interval '20 hours' THEN
      PERFORM pg_advisory_unlock(hashtext('lasoul.daily_maintenance'));
      RETURN jsonb_build_object('ran', false, 'reason', 'already_ran_today', 'last_run_at', v_last);
    END IF;

    v_events := public.prune_analytics_events();
    v_decisions := public.prune_recommendation_decisions();

    v_result := jsonb_build_object(
      'ran', true,
      'analytics_events_pruned', v_events,
      'decisions_pruned', v_decisions,
      'at', now());

    INSERT INTO public.maintenance_runs(job, last_run_at, last_result)
    VALUES ('daily', now(), v_result)
    ON CONFLICT (job) DO UPDATE SET last_run_at = now(), last_result = v_result;

    PERFORM pg_advisory_unlock(hashtext('lasoul.daily_maintenance'));
    RETURN v_result;
  EXCEPTION WHEN OTHERS THEN
    -- Never strand the lock; the next caller must be able to try again.
    PERFORM pg_advisory_unlock(hashtext('lasoul.daily_maintenance'));
    RAISE;
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.run_daily_maintenance() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.run_daily_maintenance() TO authenticated;
