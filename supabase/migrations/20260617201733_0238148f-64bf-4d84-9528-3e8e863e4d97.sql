ALTER TABLE public.table_sessions
  ADD COLUMN IF NOT EXISTS host_client_id text;

CREATE TABLE IF NOT EXISTS public.session_join_requests (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  table_session_id uuid NOT NULL REFERENCES public.table_sessions(id) ON DELETE CASCADE,
  guest_name text NOT NULL,
  client_id text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'declined')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by_name text
);

GRANT SELECT, INSERT, UPDATE ON public.session_join_requests TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.session_join_requests TO authenticated;
GRANT ALL ON public.session_join_requests TO service_role;

CREATE INDEX IF NOT EXISTS idx_sjr_session_status
  ON public.session_join_requests (table_session_id, status);

ALTER TABLE public.session_join_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view join requests" ON public.session_join_requests;
CREATE POLICY "Anyone can view join requests"
  ON public.session_join_requests FOR SELECT USING (true);

DROP POLICY IF EXISTS "Anyone can create join requests for active sessions" ON public.session_join_requests;
CREATE POLICY "Anyone can create join requests for active sessions"
  ON public.session_join_requests FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.table_sessions s
     WHERE s.id = table_session_id AND s.is_active = true
  ));

DROP POLICY IF EXISTS "Anyone can resolve join requests for active sessions" ON public.session_join_requests;
CREATE POLICY "Anyone can resolve join requests for active sessions"
  ON public.session_join_requests FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM public.table_sessions s
     WHERE s.id = table_session_id AND s.is_active = true
  ));

DROP POLICY IF EXISTS "Staff manage join requests" ON public.session_join_requests;
CREATE POLICY "Staff manage join requests"
  ON public.session_join_requests FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'staff'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'staff'::app_role));

CREATE OR REPLACE FUNCTION public.enforce_join_request_limits()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_active boolean;
  v_pending int;
BEGIN
  SELECT is_active INTO v_active
    FROM public.table_sessions WHERE id = NEW.table_session_id;
  IF NOT FOUND OR NOT v_active THEN
    RAISE EXCEPTION 'Table is no longer active';
  END IF;

  SELECT count(*) INTO v_pending
    FROM public.session_join_requests
   WHERE table_session_id = NEW.table_session_id
     AND client_id = NEW.client_id
     AND status = 'pending';
  IF v_pending > 0 THEN
    RAISE EXCEPTION 'You already have a pending request';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_join_request_limits ON public.session_join_requests;
CREATE TRIGGER trg_enforce_join_request_limits
  BEFORE INSERT ON public.session_join_requests
  FOR EACH ROW EXECUTE FUNCTION public.enforce_join_request_limits();

CREATE OR REPLACE FUNCTION public.stamp_join_request_resolved()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status <> 'pending' AND NEW.resolved_at IS NULL THEN
    NEW.resolved_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stamp_join_request_resolved ON public.session_join_requests;
CREATE TRIGGER trg_stamp_join_request_resolved
  BEFORE UPDATE ON public.session_join_requests
  FOR EACH ROW EXECUTE FUNCTION public.stamp_join_request_resolved();

DO $$ BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.session_join_requests;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;