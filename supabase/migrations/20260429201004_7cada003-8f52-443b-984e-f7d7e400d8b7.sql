
-- ============ SECTIONS ============
CREATE TABLE public.sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  color text NOT NULL DEFAULT '#8FAE8B',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.sections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view sections" ON public.sections FOR SELECT USING (true);
CREATE POLICY "Admins manage sections" ON public.sections FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- ============ WAITERS ============
CREATE TABLE public.waiters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  display_name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.waiters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view waiters" ON public.waiters FOR SELECT USING (true);
CREATE POLICY "Admins manage waiters" ON public.waiters FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Helper: get waiter id for current user (security definer to avoid RLS recursion)
CREATE OR REPLACE FUNCTION public.get_waiter_id(_user_id uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT id FROM public.waiters WHERE user_id = _user_id LIMIT 1
$$;

-- ============ SECTION ASSIGNMENTS ============
CREATE TABLE public.section_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section_id uuid NOT NULL REFERENCES public.sections(id) ON DELETE CASCADE,
  waiter_id uuid NOT NULL REFERENCES public.waiters(id) ON DELETE CASCADE,
  shift_date date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (section_id, shift_date)
);
ALTER TABLE public.section_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view section assignments" ON public.section_assignments FOR SELECT USING (true);
CREATE POLICY "Admins manage assignments" ON public.section_assignments FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- ============ ALTER tables ============
ALTER TABLE public.tables ADD COLUMN IF NOT EXISTS section_id uuid REFERENCES public.sections(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_tables_section ON public.tables(section_id);

ALTER TABLE public.table_sessions
  ADD COLUMN IF NOT EXISTS assigned_waiter_id uuid REFERENCES public.waiters(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS first_order_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_served_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_sessions_waiter ON public.table_sessions(assigned_waiter_id);

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS preparing_at timestamptz,
  ADD COLUMN IF NOT EXISTS ready_at timestamptz,
  ADD COLUMN IF NOT EXISTS served_at timestamptz,
  ADD COLUMN IF NOT EXISTS assigned_waiter_id uuid REFERENCES public.waiters(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_orders_waiter ON public.orders(assigned_waiter_id);

-- Trigger: stamp order status timestamps
CREATE OR REPLACE FUNCTION public.stamp_order_status_times()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'confirmed' AND NEW.confirmed_at IS NULL THEN NEW.confirmed_at := now(); END IF;
    RETURN NEW;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'confirmed' AND NEW.confirmed_at IS NULL THEN NEW.confirmed_at := now(); END IF;
    IF NEW.status = 'preparing' AND NEW.preparing_at IS NULL THEN NEW.preparing_at := now(); END IF;
    IF NEW.status = 'ready' AND NEW.ready_at IS NULL THEN NEW.ready_at := now(); END IF;
    IF NEW.status = 'served' AND NEW.served_at IS NULL THEN NEW.served_at := now(); END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stamp_order_status ON public.orders;
CREATE TRIGGER trg_stamp_order_status
BEFORE INSERT OR UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.stamp_order_status_times();

-- Trigger: stamp first_order_at + last_served_at on table_sessions; auto-fill assigned_waiter on order
CREATE OR REPLACE FUNCTION public.handle_order_session_stamps()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public
AS $$
DECLARE
  v_waiter uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- copy assigned_waiter from session if not set
    IF NEW.assigned_waiter_id IS NULL THEN
      SELECT assigned_waiter_id INTO v_waiter FROM public.table_sessions WHERE id = NEW.table_session_id;
      NEW.assigned_waiter_id := v_waiter;
    END IF;
    -- session first_order_at
    UPDATE public.table_sessions
      SET first_order_at = COALESCE(first_order_at, now())
      WHERE id = NEW.table_session_id;
  ELSIF TG_OP = 'UPDATE' AND NEW.status = 'served' AND OLD.status IS DISTINCT FROM 'served' THEN
    UPDATE public.table_sessions
      SET last_served_at = now()
      WHERE id = NEW.table_session_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_order_session_stamps ON public.orders;
CREATE TRIGGER trg_order_session_stamps
BEFORE INSERT ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.handle_order_session_stamps();

DROP TRIGGER IF EXISTS trg_order_session_served ON public.orders;
CREATE TRIGGER trg_order_session_served
AFTER UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.handle_order_session_stamps();

-- Trigger: auto-fill assigned_waiter_id on new table_session from today's assignment
CREATE OR REPLACE FUNCTION public.assign_session_waiter()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public
AS $$
DECLARE
  v_section uuid;
  v_waiter uuid;
BEGIN
  IF NEW.assigned_waiter_id IS NULL THEN
    SELECT section_id INTO v_section FROM public.tables WHERE id = NEW.table_id;
    IF v_section IS NOT NULL THEN
      SELECT waiter_id INTO v_waiter
        FROM public.section_assignments
       WHERE section_id = v_section AND shift_date = CURRENT_DATE
       LIMIT 1;
      NEW.assigned_waiter_id := v_waiter;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assign_session_waiter ON public.table_sessions;
CREATE TRIGGER trg_assign_session_waiter
BEFORE INSERT ON public.table_sessions
FOR EACH ROW EXECUTE FUNCTION public.assign_session_waiter();

-- ============ SERVER RATINGS ============
CREATE TABLE public.server_ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_session_id uuid NOT NULL REFERENCES public.table_sessions(id) ON DELETE CASCADE,
  waiter_id uuid REFERENCES public.waiters(id) ON DELETE SET NULL,
  rating integer NOT NULL,
  comment text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.server_ratings ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.validate_server_rating()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public
AS $$
BEGIN
  IF NEW.rating < 1 OR NEW.rating > 5 THEN
    RAISE EXCEPTION 'Rating must be between 1 and 5';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_validate_server_rating ON public.server_ratings;
CREATE TRIGGER trg_validate_server_rating
BEFORE INSERT OR UPDATE ON public.server_ratings
FOR EACH ROW EXECUTE FUNCTION public.validate_server_rating();

CREATE POLICY "Anyone can submit server rating for active session" ON public.server_ratings
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.table_sessions WHERE id = server_ratings.table_session_id)
  );
CREATE POLICY "Admins/staff view server ratings" ON public.server_ratings
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'staff'::app_role));
