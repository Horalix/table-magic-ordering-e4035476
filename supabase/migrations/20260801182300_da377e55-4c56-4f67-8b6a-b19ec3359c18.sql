CREATE TABLE IF NOT EXISTS public.shift_closes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  day date NOT NULL UNIQUE,
  closed_by uuid REFERENCES auth.users(id),
  closed_at timestamptz NOT NULL DEFAULT now(),

  expected_cash numeric(10,2) NOT NULL DEFAULT 0,
  expected_terminal numeric(10,2) NOT NULL DEFAULT 0,
  expected_online numeric(10,2) NOT NULL DEFAULT 0,

  counted_cash numeric(10,2),
  counted_terminal numeric(10,2),
  terminal_batch_reference text,

  notes text,
  acknowledged_issues boolean NOT NULL DEFAULT false,

  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.shift_closes TO authenticated;
GRANT ALL ON public.shift_closes TO service_role;

ALTER TABLE public.shift_closes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff read shift closes" ON public.shift_closes;
CREATE POLICY "Staff read shift closes"
  ON public.shift_closes FOR SELECT TO authenticated
  USING (public.is_staff_member());

CREATE INDEX IF NOT EXISTS idx_shift_closes_day ON public.shift_closes(day DESC);

CREATE OR REPLACE FUNCTION public.close_shift(
  _day date DEFAULT NULL,
  _counted_cash numeric DEFAULT NULL,
  _counted_terminal numeric DEFAULT NULL,
  _terminal_batch_reference text DEFAULT NULL,
  _notes text DEFAULT NULL,
  _acknowledge_issues boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_day date := COALESCE(_day, (now() AT TIME ZONE 'Europe/Sarajevo')::date);
  v_snapshot jsonb;
  v_id uuid;
  v_cash numeric;
  v_terminal numeric;
  v_online numeric;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only a manager can close the day' USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_snapshot := public.day_reconciliation(v_day);

  v_cash := COALESCE((v_snapshot ->> 'paid_cash')::numeric, 0);
  v_terminal := COALESCE((v_snapshot ->> 'paid_pos_terminal')::numeric, 0);
  v_online := COALESCE((v_snapshot ->> 'paid_online')::numeric, 0);

  INSERT INTO public.shift_closes(
    day, closed_by, expected_cash, expected_terminal, expected_online,
    counted_cash, counted_terminal, terminal_batch_reference, notes,
    acknowledged_issues, snapshot
  )
  VALUES (
    v_day, auth.uid(), v_cash, v_terminal, v_online,
    _counted_cash, _counted_terminal, nullif(btrim(coalesce(_terminal_batch_reference, '')), ''),
    nullif(btrim(coalesce(_notes, '')), ''), COALESCE(_acknowledge_issues, false), v_snapshot
  )
  ON CONFLICT (day) DO UPDATE SET
    closed_by = EXCLUDED.closed_by,
    closed_at = now(),
    expected_cash = EXCLUDED.expected_cash,
    expected_terminal = EXCLUDED.expected_terminal,
    expected_online = EXCLUDED.expected_online,
    counted_cash = EXCLUDED.counted_cash,
    counted_terminal = EXCLUDED.counted_terminal,
    terminal_batch_reference = EXCLUDED.terminal_batch_reference,
    notes = EXCLUDED.notes,
    acknowledged_issues = EXCLUDED.acknowledged_issues,
    snapshot = EXCLUDED.snapshot
  RETURNING id INTO v_id;

  PERFORM public.write_audit('shift.closed', 'shift', v_id, NULL,
    jsonb_build_object(
      'day', v_day,
      'expected_cash', v_cash,
      'counted_cash', _counted_cash,
      'cash_difference', COALESCE(_counted_cash, 0) - v_cash,
      'expected_terminal', v_terminal,
      'counted_terminal', _counted_terminal,
      'acknowledged_issues', COALESCE(_acknowledge_issues, false)
    ), _notes);

  RETURN jsonb_build_object(
    'id', v_id,
    'day', v_day,
    'expected_cash', v_cash,
    'expected_terminal', v_terminal,
    'expected_online', v_online,
    'cash_difference', CASE WHEN _counted_cash IS NULL THEN NULL ELSE _counted_cash - v_cash END,
    'terminal_difference', CASE WHEN _counted_terminal IS NULL THEN NULL ELSE _counted_terminal - v_terminal END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.close_shift(date, numeric, numeric, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_shift(date, numeric, numeric, text, text, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.shift_close_for(_day date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_day date := COALESCE(_day, (now() AT TIME ZONE 'Europe/Sarajevo')::date);
  v_row public.shift_closes;
BEGIN
  IF NOT public.is_staff_member() THEN
    RAISE EXCEPTION 'Only staff can read a shift close' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_row FROM public.shift_closes WHERE day = v_day;
  IF NOT FOUND THEN RETURN NULL; END IF;

  RETURN jsonb_build_object(
    'id', v_row.id,
    'day', v_row.day,
    'closed_at', v_row.closed_at,
    'closed_by', v_row.closed_by,
    'expected_cash', v_row.expected_cash,
    'counted_cash', v_row.counted_cash,
    'expected_terminal', v_row.expected_terminal,
    'counted_terminal', v_row.counted_terminal,
    'terminal_batch_reference', v_row.terminal_batch_reference,
    'notes', v_row.notes,
    'acknowledged_issues', v_row.acknowledged_issues
  );
END;
$$;

REVOKE ALL ON FUNCTION public.shift_close_for(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shift_close_for(date) TO authenticated;