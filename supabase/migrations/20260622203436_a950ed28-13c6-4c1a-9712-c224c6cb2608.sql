ALTER TABLE public.section_assignments DROP CONSTRAINT IF EXISTS section_assignments_section_id_shift_date_key;

ALTER TABLE public.section_assignments
  ADD CONSTRAINT section_assignments_section_waiter_date_key UNIQUE (section_id, waiter_id, shift_date);

CREATE OR REPLACE FUNCTION public.assign_session_waiter()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_section uuid; v_waiter uuid;
BEGIN
  IF NEW.assigned_waiter_id IS NULL THEN
    SELECT section_id INTO v_section FROM public.tables WHERE id = NEW.table_id;
    IF v_section IS NOT NULL THEN
      SELECT sa.waiter_id INTO v_waiter
        FROM public.section_assignments sa
        LEFT JOIN public.table_sessions ts
          ON ts.assigned_waiter_id = sa.waiter_id AND ts.is_active = true
       WHERE sa.section_id = v_section AND sa.shift_date = CURRENT_DATE
       GROUP BY sa.waiter_id
       ORDER BY COUNT(ts.id) ASC, random()
       LIMIT 1;
      NEW.assigned_waiter_id := v_waiter;
    END IF;
  END IF;
  RETURN NEW;
END; $$;