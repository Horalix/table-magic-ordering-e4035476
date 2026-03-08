
-- Create waiter_calls table for Call Waiter feature
CREATE TABLE public.waiter_calls (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  table_session_id UUID REFERENCES public.table_sessions(id) ON DELETE CASCADE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'acknowledged', 'resolved')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  resolved_at TIMESTAMP WITH TIME ZONE
);

-- Enable RLS
ALTER TABLE public.waiter_calls ENABLE ROW LEVEL SECURITY;

-- Anyone can insert waiter calls (guests don't have auth)
CREATE POLICY "Anyone can create waiter calls for active sessions"
  ON public.waiter_calls
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.table_sessions
      WHERE table_sessions.id = waiter_calls.table_session_id
      AND table_sessions.is_active = true
    )
  );

-- Anyone can view waiter calls
CREATE POLICY "Anyone can view waiter calls"
  ON public.waiter_calls
  FOR SELECT
  USING (true);

-- Admin/staff can update waiter calls
CREATE POLICY "Admin/staff can update waiter calls"
  ON public.waiter_calls
  FOR UPDATE
  USING (
    has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'staff'::app_role)
  );

-- Enable realtime for waiter_calls
ALTER PUBLICATION supabase_realtime ADD TABLE public.waiter_calls;
