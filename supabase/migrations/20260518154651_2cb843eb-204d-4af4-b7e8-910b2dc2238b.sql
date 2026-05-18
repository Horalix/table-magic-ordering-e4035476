
-- 1. Heartbeat column
ALTER TABLE public.table_sessions
  ADD COLUMN IF NOT EXISTS last_heartbeat_at timestamptz NOT NULL DEFAULT now();

-- 2. touch_session RPC (security definer, token-validated)
CREATE OR REPLACE FUNCTION public.touch_session(_id uuid, _token text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.table_sessions
     SET last_heartbeat_at = now()
   WHERE id = _id AND token = _token AND is_active = true;
$$;

GRANT EXECUTE ON FUNCTION public.touch_session(uuid, text) TO anon, authenticated;

-- 3. Order anti-spam trigger
CREATE OR REPLACE FUNCTION public.enforce_order_limits()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_active boolean;
  v_heartbeat timestamptz;
  v_recent int;
BEGIN
  SELECT is_active, last_heartbeat_at
    INTO v_active, v_heartbeat
    FROM public.table_sessions
   WHERE id = NEW.table_session_id;

  IF NOT FOUND OR NOT v_active THEN
    RAISE EXCEPTION 'Session is not active';
  END IF;

  IF v_heartbeat < now() - interval '2 minutes' THEN
    RAISE EXCEPTION 'Session inactive — please reopen the menu at the table';
  END IF;

  SELECT count(*) INTO v_recent
    FROM public.orders
   WHERE table_session_id = NEW.table_session_id
     AND created_at > now() - interval '60 seconds';

  IF v_recent >= 5 THEN
    RAISE EXCEPTION 'Too many orders — please wait a moment';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_order_limits ON public.orders;
CREATE TRIGGER trg_enforce_order_limits
  BEFORE INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.enforce_order_limits();

-- 4. Waiter call rate limit
CREATE OR REPLACE FUNCTION public.enforce_waiter_call_limits()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pending int;
  v_last timestamptz;
BEGIN
  SELECT count(*) INTO v_pending
    FROM public.waiter_calls
   WHERE table_session_id = NEW.table_session_id
     AND status = 'pending';

  IF v_pending > 0 THEN
    RAISE EXCEPTION 'A waiter has already been called';
  END IF;

  SELECT max(resolved_at) INTO v_last
    FROM public.waiter_calls
   WHERE table_session_id = NEW.table_session_id;

  IF v_last IS NOT NULL AND v_last > now() - interval '60 seconds' THEN
    RAISE EXCEPTION 'Please wait a minute before calling again';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_waiter_call_limits ON public.waiter_calls;
CREATE TRIGGER trg_enforce_waiter_call_limits
  BEFORE INSERT ON public.waiter_calls
  FOR EACH ROW EXECUTE FUNCTION public.enforce_waiter_call_limits();

-- 5. Bill request limit (one pending per session)
CREATE OR REPLACE FUNCTION public.enforce_bill_request_limits()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pending int;
BEGIN
  SELECT count(*) INTO v_pending
    FROM public.bill_requests
   WHERE table_session_id = NEW.table_session_id
     AND status = 'pending';

  IF v_pending > 0 THEN
    RAISE EXCEPTION 'A bill request is already pending';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_bill_request_limits ON public.bill_requests;
CREATE TRIGGER trg_enforce_bill_request_limits
  BEFORE INSERT ON public.bill_requests
  FOR EACH ROW EXECUTE FUNCTION public.enforce_bill_request_limits();

-- 6. Realtime publication
DO $$ BEGIN
  PERFORM 1;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.tables; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.table_sessions; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.orders; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.waiter_calls; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.bill_requests; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;
