
-- Bill requests table
CREATE TABLE public.bill_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_session_id uuid NOT NULL REFERENCES public.table_sessions(id),
  status text NOT NULL DEFAULT 'pending',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  resolved_at timestamp with time zone
);

ALTER TABLE public.bill_requests ENABLE ROW LEVEL SECURITY;

-- Anyone can view bill requests
CREATE POLICY "Anyone can view bill requests"
  ON public.bill_requests FOR SELECT
  USING (true);

-- Anyone can create bill requests for active sessions
CREATE POLICY "Anyone can create bill requests for active sessions"
  ON public.bill_requests FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM table_sessions
      WHERE table_sessions.id = bill_requests.table_session_id
        AND table_sessions.is_active = true
    )
  );

-- Admin/staff can update bill requests
CREATE POLICY "Admin/staff can update bill requests"
  ON public.bill_requests FOR UPDATE
  USING (
    has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'staff'::app_role)
  );

-- Enable realtime for bill_requests
ALTER PUBLICATION supabase_realtime ADD TABLE public.bill_requests;
