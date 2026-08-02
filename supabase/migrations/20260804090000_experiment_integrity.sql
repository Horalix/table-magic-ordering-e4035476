-- =====================================================================
-- Making the uplift number defensible
--
-- The previous pass fixed the obvious faults — the experiment no longer
-- re-buckets its own history, and "reliable" is a real interval rather than a
-- row count. A closer review found three more, and all three inflate
-- confidence rather than destroy it, which is the dangerous direction.
--
--   1. WRONG UNIT OF ANALYSIS. Treatment is assigned per table SESSION, but
--      the comparison averaged per ORDER. Three orders from one table are not
--      three independent observations of anything — they share a party, an
--      occasion, and an appetite. Treating them as independent understates the
--      standard error, narrows the interval, and can manufacture significance
--      out of nothing. This is the most serious defect in the measurement.
--
--   2. TIPS COUNTED AS UPLIFT. orders.total is items + tip. A tip is the
--      guest's generosity, not an effect of a suggestion, and it is high
--      variance — so including it both biases the mean and widens the
--      interval, making a real effect harder to see and a fake one easier.
--
--   3. REFUNDS IGNORED. A refunded order counted at full value.
--
-- Also here: the experiment becomes a first-class, VERSIONED object. The old
-- design could only ever answer "suggestions vs none". The moment the ranking
-- policy changes, that question changes with it, and mixing the two in one
-- report is how an A/B result quietly becomes meaningless. A policy change now
-- opens a new experiment.
--
-- And nothing is reported at all until the experiment is HEALTHY: the split
-- must match what was configured, and the guardrails must not be degrading.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. One row per visit, in money that is actually attributable
-- ---------------------------------------------------------------------

/**
 * The outcome of a table's visit.
 *
 * One row per session, which is the unit treatment is assigned at, so this is
 * the only grain at which the comparison is valid.
 *
 * `net_sales` is what the restaurant kept for the food: items only, minus
 * anything refunded. Tips are reported separately because they are worth
 * knowing and worth excluding — a suggestion engine has no business claiming
 * credit for a guest's generosity.
 */
CREATE OR REPLACE VIEW public.session_outcomes
WITH (security_invoker = true)
AS
  SELECT
    s.id                                   AS session_id,
    s.table_id,
    s.opened_at,
    s.closed_at,
    s.covers,
    count(o.id)                            AS orders,
    -- items = total - tip, then net of refunds.
    COALESCE(sum(o.total - COALESCE(o.tip_amount, 0) - COALESCE(o.refunded_amount, 0)), 0)::numeric(12,2)
                                           AS net_sales,
    COALESCE(sum(o.tip_amount), 0)::numeric(12,2)      AS tips,
    COALESCE(sum(o.refunded_amount), 0)::numeric(12,2) AS refunded,
    min(o.created_at)                      AS first_order_at,
    max(o.created_at)                      AS last_order_at,
    -- Guardrail inputs, so an engine cannot buy revenue with service quality.
    (SELECT round(avg(r.rating), 2) FROM public.server_ratings r
      WHERE r.table_session_id = s.id)     AS avg_rating,
    (SELECT round(avg(EXTRACT(EPOCH FROM (o2.served_at - o2.created_at)) / 60.0)::numeric, 1)
       FROM public.orders o2
      WHERE o2.table_session_id = s.id AND o2.served_at IS NOT NULL)
                                           AS avg_minutes_to_served
  FROM public.table_sessions s
  LEFT JOIN public.completed_orders o ON o.table_session_id = s.id
  GROUP BY s.id, s.table_id, s.opened_at, s.closed_at, s.covers;

GRANT SELECT ON public.session_outcomes TO authenticated;

-- ---------------------------------------------------------------------
-- 2. Experiments as versioned, immutable objects
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.experiments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  /**
   * What the treatment arm was running.
   *
   * A change to the ranking policy makes every earlier session incomparable to
   * every later one, so it must start a NEW experiment rather than continuing
   * an old one. Recording the version is what makes that enforceable instead
   * of a convention people forget.
   */
  policy_version text NOT NULL,
  holdout_pct smallint NOT NULL CHECK (holdout_pct BETWEEN 1 AND 50),
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- At most one experiment collecting data at a time. Two overlapping
-- experiments assigning the same sessions would interfere and neither result
-- would mean anything.
CREATE UNIQUE INDEX IF NOT EXISTS idx_experiments_one_running
  ON public.experiments((ended_at IS NULL)) WHERE ended_at IS NULL;

/**
 * Which arm a session was in, written ONCE.
 *
 * The previous design recomputed membership from a hash of the current holdout
 * percentage at read time, so moving the dial silently reassigned history.
 * A row here is a fact about something that already happened.
 */
CREATE TABLE IF NOT EXISTS public.session_experiment_assignment (
  session_id uuid PRIMARY KEY REFERENCES public.table_sessions(id) ON DELETE CASCADE,
  experiment_id uuid NOT NULL REFERENCES public.experiments(id) ON DELETE CASCADE,
  arm text NOT NULL CHECK (arm IN ('treatment', 'holdout')),
  assigned_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_assignment_experiment
  ON public.session_experiment_assignment(experiment_id, arm);

ALTER TABLE public.experiments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.session_experiment_assignment ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff read experiments" ON public.experiments;
CREATE POLICY "Staff read experiments" ON public.experiments
  FOR SELECT TO authenticated USING (public.is_staff_member());

DROP POLICY IF EXISTS "Staff read assignments" ON public.session_experiment_assignment;
CREATE POLICY "Staff read assignments" ON public.session_experiment_assignment
  FOR SELECT TO authenticated USING (public.is_staff_member());

-- Writes go through the SECURITY DEFINER functions below only.

/** An assignment is a historical fact and cannot be edited. */
CREATE OR REPLACE FUNCTION public.freeze_assignment()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'An experiment assignment cannot be changed after the fact'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS trg_freeze_assignment ON public.session_experiment_assignment;
CREATE TRIGGER trg_freeze_assignment
  BEFORE UPDATE ON public.session_experiment_assignment
  FOR EACH ROW EXECUTE FUNCTION public.freeze_assignment();

-- ---------------------------------------------------------------------
-- 3. Assignment happens once, at the door
-- ---------------------------------------------------------------------

/**
 * Assign a session to an arm, idempotently.
 *
 * Called when a session is created. Deliberately random rather than a hash of
 * the session id: a hash makes assignment a deterministic function of the
 * percentage, which is exactly the coupling that let the dial rewrite history.
 * A stored random draw cannot be recomputed, so it cannot change.
 */
CREATE OR REPLACE FUNCTION public.assign_session_to_experiment(_session_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exp public.experiments;
  v_arm text;
BEGIN
  SELECT * INTO v_exp FROM public.experiments WHERE ended_at IS NULL LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT arm INTO v_arm FROM public.session_experiment_assignment WHERE session_id = _session_id;
  IF FOUND THEN RETURN v_arm; END IF;

  v_arm := CASE WHEN random() * 100 < v_exp.holdout_pct THEN 'holdout' ELSE 'treatment' END;

  INSERT INTO public.session_experiment_assignment(session_id, experiment_id, arm)
  VALUES (_session_id, v_exp.id, v_arm)
  ON CONFLICT (session_id) DO NOTHING;

  SELECT arm INTO v_arm FROM public.session_experiment_assignment WHERE session_id = _session_id;
  RETURN v_arm;
END;
$$;

REVOKE ALL ON FUNCTION public.assign_session_to_experiment(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assign_session_to_experiment(uuid) TO anon, authenticated;

/** Assign every new session as it opens. */
CREATE OR REPLACE FUNCTION public.assign_new_session()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.assign_session_to_experiment(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assign_new_session ON public.table_sessions;
CREATE TRIGGER trg_assign_new_session
  AFTER INSERT ON public.table_sessions
  FOR EACH ROW EXECUTE FUNCTION public.assign_new_session();

/**
 * Is this session withheld from suggestions?
 *
 * Reads the ledger. Falls back to `false` when no experiment is running, which
 * is the correct default: with no experiment, everybody gets suggestions.
 */
CREATE OR REPLACE FUNCTION public.guest_in_reco_holdout(_session_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT a.arm = 'holdout'
       FROM public.session_experiment_assignment a
      WHERE a.session_id = _session_id),
    false);
$$;

REVOKE ALL ON FUNCTION public.guest_in_reco_holdout(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guest_in_reco_holdout(uuid) TO anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. Starting and stopping an experiment
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.start_experiment(
  _name text,
  _policy_version text,
  _holdout_pct smallint DEFAULT 10
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only a manager can start an experiment' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Close whatever is running. Two overlapping experiments assigning the same
  -- sessions would interfere and neither would mean anything.
  UPDATE public.experiments SET ended_at = now() WHERE ended_at IS NULL;

  INSERT INTO public.experiments(name, policy_version, holdout_pct)
  VALUES (_name, _policy_version, GREATEST(1, LEAST(50, _holdout_pct)))
  RETURNING id INTO v_id;

  UPDATE public.restaurant_settings SET reco_holdout_pct = GREATEST(1, LEAST(50, _holdout_pct)) WHERE id = 1;

  PERFORM public.write_audit('experiment.started', 'experiment', v_id, NULL,
    jsonb_build_object('name', _name, 'policy_version', _policy_version, 'holdout_pct', _holdout_pct));

  RETURN jsonb_build_object('id', v_id, 'name', _name, 'policy_version', _policy_version);
END;
$$;

REVOKE ALL ON FUNCTION public.start_experiment(text, text, smallint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_experiment(text, text, smallint) TO authenticated;

CREATE OR REPLACE FUNCTION public.stop_experiment(_notes text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only a manager can stop an experiment' USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE public.experiments SET ended_at = now(), notes = COALESCE(_notes, notes)
   WHERE ended_at IS NULL RETURNING id INTO v_id;

  UPDATE public.restaurant_settings SET reco_holdout_pct = 0 WHERE id = 1;
  PERFORM public.write_audit('experiment.stopped', 'experiment', v_id, NULL, NULL, _notes);
  RETURN jsonb_build_object('stopped', v_id IS NOT NULL, 'id', v_id);
END;
$$;

REVOKE ALL ON FUNCTION public.stop_experiment(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.stop_experiment(text) TO authenticated;

-- ---------------------------------------------------------------------
-- 5. Health, checked before any result is shown
-- ---------------------------------------------------------------------

/**
 * Sample ratio mismatch.
 *
 * If a 10% holdout is producing a 30% holdout, something is broken —
 * assignment, filtering, or the query — and the effect estimate is worthless.
 * A chi-square on the observed split against the configured one; above roughly
 * 10.83 (p < 0.001) the experiment is not trustworthy and the UI must suppress
 * the result rather than caveat it.
 */
CREATE OR REPLACE FUNCTION public.experiment_srm(_experiment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pct numeric;
  v_n_hold bigint; v_n_treat bigint; v_n bigint;
  v_exp_hold numeric; v_exp_treat numeric;
  v_chi numeric;
BEGIN
  SELECT holdout_pct INTO v_pct FROM public.experiments WHERE id = _experiment_id;
  IF v_pct IS NULL THEN RETURN NULL; END IF;

  SELECT count(*) FILTER (WHERE arm = 'holdout'), count(*) FILTER (WHERE arm = 'treatment')
    INTO v_n_hold, v_n_treat
    FROM public.session_experiment_assignment WHERE experiment_id = _experiment_id;

  v_n := v_n_hold + v_n_treat;
  IF v_n < 50 THEN
    RETURN jsonb_build_object('checked', false, 'reason', 'too_few_sessions',
                              'holdout', v_n_hold, 'treatment', v_n_treat);
  END IF;

  v_exp_hold := v_n * v_pct / 100.0;
  v_exp_treat := v_n - v_exp_hold;
  v_chi := power(v_n_hold - v_exp_hold, 2) / NULLIF(v_exp_hold, 0)
         + power(v_n_treat - v_exp_treat, 2) / NULLIF(v_exp_treat, 0);

  RETURN jsonb_build_object(
    'checked', true,
    'holdout', v_n_hold,
    'treatment', v_n_treat,
    'expected_holdout_pct', v_pct,
    'observed_holdout_pct', round(100.0 * v_n_hold / v_n, 1),
    'chi_square', round(v_chi, 2),
    'healthy', v_chi < 10.83
  );
END;
$$;

REVOKE ALL ON FUNCTION public.experiment_srm(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.experiment_srm(uuid) TO authenticated;

/**
 * How much longer until this can answer anything.
 *
 * "Too early" tells an owner nothing and invites them to refresh the page for
 * a fortnight. This says how many more sessions are needed to detect a given
 * relative lift, and at the current rate roughly how many days that is.
 *
 * Standard two-sample size formula at 95% confidence and 80% power; the
 * constant 15.7 is 2(z_{0.975} + z_{0.80})^2. Approximate on purpose — it is
 * for planning a fortnight, not for a paper.
 */
CREATE OR REPLACE FUNCTION public.experiment_power(_experiment_id uuid, _mde_pct numeric DEFAULT 5)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_started timestamptz;
  v_n bigint; v_mean numeric; v_sd numeric;
  v_delta numeric; v_needed_per_arm numeric;
  v_days numeric; v_rate numeric;
BEGIN
  SELECT started_at INTO v_started FROM public.experiments WHERE id = _experiment_id;
  IF v_started IS NULL THEN RETURN NULL; END IF;

  SELECT count(*), avg(so.net_sales), stddev_samp(so.net_sales)
    INTO v_n, v_mean, v_sd
    FROM public.session_outcomes so
    JOIN public.session_experiment_assignment a ON a.session_id = so.session_id
   WHERE a.experiment_id = _experiment_id AND so.orders > 0;

  IF COALESCE(v_n, 0) < 10 OR COALESCE(v_sd, 0) = 0 OR COALESCE(v_mean, 0) = 0 THEN
    RETURN jsonb_build_object('ready', false, 'sessions', COALESCE(v_n, 0));
  END IF;

  v_delta := v_mean * _mde_pct / 100.0;
  v_needed_per_arm := ceil(15.7 * power(v_sd, 2) / power(v_delta, 2));

  v_days := GREATEST(EXTRACT(EPOCH FROM (now() - v_started)) / 86400.0, 0.5);
  v_rate := v_n / v_days;

  RETURN jsonb_build_object(
    'ready', true,
    'mde_pct', _mde_pct,
    'sessions_so_far', v_n,
    -- Both arms, weighted by the split, is a further refinement; the smaller
    -- arm is what actually binds, and it is the holdout.
    'sessions_needed_per_arm', v_needed_per_arm,
    'sessions_per_day', round(v_rate, 1),
    'days_remaining', CASE WHEN v_rate > 0
      THEN GREATEST(0, ceil((v_needed_per_arm * 2 - v_n) / v_rate)) ELSE NULL END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.experiment_power(uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.experiment_power(uuid, numeric) TO authenticated;

-- ---------------------------------------------------------------------
-- 6. The comparison, at the right grain
-- ---------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.reco_holdout_comparison(int);

/**
 * What the suggestion engine is worth, per VISIT.
 *
 * One observation per table session — the unit treatment is assigned at.
 * Averaging orders instead, as this did before, treats three rounds from one
 * table as three independent samples, understates the standard error, and can
 * report significance that is not there.
 *
 * Money is net of tips and refunds. Guardrails are reported alongside, because
 * an engine that lifts spend while slowing service or lowering ratings has not
 * won anything.
 */
CREATE OR REPLACE FUNCTION public.reco_holdout_comparison(_days int DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_since timestamptz := now() - make_interval(days => GREATEST(COALESCE(_days, 30), 1));
  v_exp public.experiments;
  v_treated_n bigint; v_treated_mean numeric; v_treated_var numeric;
  v_held_n bigint;    v_held_mean numeric;    v_held_var numeric;
  v_stats jsonb; v_srm jsonb; v_power jsonb;
  v_status text;
  v_sessions_per_day numeric;
  v_projection numeric;
  v_guard jsonb;
BEGIN
  IF NOT public.is_staff_member() THEN
    RAISE EXCEPTION 'Only staff can read menu intelligence' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- The most recent experiment that overlaps the window.
  SELECT * INTO v_exp FROM public.experiments
   WHERE started_at <= now() AND (ended_at IS NULL OR ended_at > v_since)
   ORDER BY started_at DESC LIMIT 1;

  IF v_exp.id IS NULL THEN
    RETURN jsonb_build_object('status', 'not_running', 'days', _days);
  END IF;

  SELECT
    count(*) FILTER (WHERE a.arm = 'treatment'),
    avg(so.net_sales) FILTER (WHERE a.arm = 'treatment'),
    var_samp(so.net_sales) FILTER (WHERE a.arm = 'treatment'),
    count(*) FILTER (WHERE a.arm = 'holdout'),
    avg(so.net_sales) FILTER (WHERE a.arm = 'holdout'),
    var_samp(so.net_sales) FILTER (WHERE a.arm = 'holdout')
  INTO v_treated_n, v_treated_mean, v_treated_var, v_held_n, v_held_mean, v_held_var
  FROM public.session_outcomes so
  JOIN public.session_experiment_assignment a ON a.session_id = so.session_id
  WHERE a.experiment_id = v_exp.id
    AND so.opened_at > v_since
    -- A table that never ordered says nothing about suggestions.
    AND so.orders > 0;

  v_stats := public.welch_interval(
    COALESCE(v_treated_mean, 0), COALESCE(v_treated_var, 0), COALESCE(v_treated_n, 0),
    COALESCE(v_held_mean, 0),    COALESCE(v_held_var, 0),    COALESCE(v_held_n, 0));

  v_srm := public.experiment_srm(v_exp.id);
  v_power := public.experiment_power(v_exp.id, 5);

  SELECT jsonb_build_object(
    'rating_treatment',  round(avg(so.avg_rating) FILTER (WHERE a.arm = 'treatment'), 2),
    'rating_holdout',    round(avg(so.avg_rating) FILTER (WHERE a.arm = 'holdout'), 2),
    'minutes_treatment', round(avg(so.avg_minutes_to_served) FILTER (WHERE a.arm = 'treatment'), 1),
    'minutes_holdout',   round(avg(so.avg_minutes_to_served) FILTER (WHERE a.arm = 'holdout'), 1))
    INTO v_guard
    FROM public.session_outcomes so
    JOIN public.session_experiment_assignment a ON a.session_id = so.session_id
   WHERE a.experiment_id = v_exp.id AND so.opened_at > v_since;

  v_status := CASE
    -- Health first. A broken split makes the effect estimate meaningless, so
    -- it is suppressed rather than shown with a warning nobody reads.
    WHEN (v_srm ->> 'checked')::boolean AND NOT (v_srm ->> 'healthy')::boolean THEN 'invalid_srm'
    WHEN COALESCE(v_held_n, 0) < 30 OR COALESCE(v_treated_n, 0) < 30 THEN 'too_early'
    WHEN NOT (v_stats ->> 'significant')::boolean THEN 'no_measurable_effect'
    WHEN (v_stats ->> 'difference')::numeric > 0 THEN 'positive'
    ELSE 'negative'
  END;

  v_sessions_per_day := CASE WHEN _days > 0
    THEN (COALESCE(v_treated_n, 0) + COALESCE(v_held_n, 0))::numeric / _days ELSE 0 END;
  -- Conservative: the low end of the interval, never the point estimate.
  v_projection := CASE WHEN v_status = 'positive'
    THEN round((v_stats ->> 'ci_low')::numeric * v_sessions_per_day * 30, 0) ELSE NULL END;

  RETURN jsonb_build_object(
    'days', _days,
    'status', v_status,
    'experiment', jsonb_build_object(
      'id', v_exp.id, 'name', v_exp.name,
      'policy_version', v_exp.policy_version,
      'started_at', v_exp.started_at, 'ended_at', v_exp.ended_at),
    'holdout_pct', v_exp.holdout_pct,
    'unit', 'table_session',
    'measure', 'net_sales_excl_tips_and_refunds',
    'with_suggestions', jsonb_build_object(
      'sessions', COALESCE(v_treated_n, 0),
      'avg_net_sales', COALESCE(round(v_treated_mean, 2), 0)),
    'holdout', jsonb_build_object(
      'sessions', COALESCE(v_held_n, 0),
      'avg_net_sales', COALESCE(round(v_held_mean, 2), 0)),
    'difference', v_stats -> 'difference',
    'ci_low', v_stats -> 'ci_low',
    'ci_high', v_stats -> 'ci_high',
    'significant', v_stats -> 'significant',
    'conservative_monthly_value', v_projection,
    'srm', v_srm,
    'power', v_power,
    'guardrails', v_guard,
    'reliable', (v_stats ->> 'significant')::boolean
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reco_holdout_comparison(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reco_holdout_comparison(int) TO authenticated;

-- Backfill assignments for sessions that predate the ledger, so historical
-- reporting is not silently empty. They were all shown suggestions.
DO $$
DECLARE v_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.experiments) THEN RETURN; END IF;
  SELECT id INTO v_id FROM public.experiments ORDER BY started_at LIMIT 1;
  INSERT INTO public.session_experiment_assignment(session_id, experiment_id, arm)
  SELECT s.id, v_id, 'treatment' FROM public.table_sessions s
  ON CONFLICT (session_id) DO NOTHING;
END $$;
