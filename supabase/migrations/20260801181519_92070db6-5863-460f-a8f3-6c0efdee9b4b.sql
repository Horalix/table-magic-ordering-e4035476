ALTER TABLE public.restaurant_settings
  ADD COLUMN IF NOT EXISTS venue_qr_token text NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  ADD COLUMN IF NOT EXISTS venue_qr_rotated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS session_idle_timeout_minutes int NOT NULL DEFAULT 180
    CHECK (session_idle_timeout_minutes BETWEEN 15 AND 1440);

CREATE OR REPLACE FUNCTION public.session_idle_timeout()
RETURNS int
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT session_idle_timeout_minutes FROM public.restaurant_settings WHERE id = 1), 180);
$$;

REVOKE ALL ON FUNCTION public.session_idle_timeout() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.resolve_table_for_token(_table_number int, _token text)
RETURNS public.tables
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_table public.tables;
  v_venue text;
BEGIN
  IF _token IS NULL OR btrim(_token) = '' THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_table FROM public.tables WHERE table_number = _table_number;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_table.qr_token = _token THEN
    RETURN v_table;
  END IF;

  SELECT venue_qr_token INTO v_venue FROM public.restaurant_settings WHERE id = 1;
  IF v_venue IS NOT NULL AND v_venue = _token THEN
    RETURN v_table;
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_table_for_token(int, text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.guest_check_venue_token(_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_settings public.restaurant_settings;
BEGIN
  SELECT * INTO v_settings FROM public.restaurant_settings WHERE id = 1;

  RETURN jsonb_build_object(
    'valid', v_settings.venue_qr_token IS NOT NULL AND v_settings.venue_qr_token = _token,
    'ordering_enabled', COALESCE(v_settings.ordering_enabled, true),
    'paused_message', v_settings.ordering_paused_message,
    'max_table_number', (SELECT max(table_number) FROM public.tables)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.guest_check_venue_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guest_check_venue_token(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.rotate_venue_qr_token()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token text := encode(gen_random_bytes(32), 'hex');
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only a manager can rotate the venue QR' USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE public.restaurant_settings
     SET venue_qr_token = v_token, venue_qr_rotated_at = now()
   WHERE id = 1;

  PERFORM public.write_audit('qr.venue_rotated', 'restaurant_settings', NULL, NULL, NULL,
                             'Venue QR rotated — reprint required');
  RETURN v_token;
END;
$$;

REVOKE ALL ON FUNCTION public.rotate_venue_qr_token() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rotate_venue_qr_token() TO authenticated;

CREATE OR REPLACE FUNCTION public.rotate_table_qr_token(_table_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token text := encode(gen_random_bytes(32), 'hex');
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only a manager can rotate a table QR' USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE public.tables SET qr_token = v_token WHERE id = _table_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Table not found'; END IF;

  PERFORM public.write_audit('qr.table_rotated', 'table', _table_id);
  RETURN v_token;
END;
$$;

REVOKE ALL ON FUNCTION public.rotate_table_qr_token(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rotate_table_qr_token(uuid) TO authenticated;

-- =====================================================================
-- Session expiry
-- =====================================================================

CREATE OR REPLACE FUNCTION public.assert_guest_session(_session_id uuid, _session_token text)
RETURNS public.table_sessions
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session public.table_sessions;
  v_timeout int := public.session_idle_timeout();
BEGIN
  SELECT *
    INTO v_session
    FROM public.table_sessions
   WHERE id = _session_id
     AND token = _session_token
     AND is_active = true
     AND COALESCE(last_heartbeat_at, opened_at) > now() - make_interval(mins => v_timeout);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid or expired table session';
  END IF;

  RETURN v_session;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_guest_session(uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.touch_session(_id uuid, _token text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_timeout int := public.session_idle_timeout();
BEGIN
  UPDATE public.table_sessions
     SET last_heartbeat_at = now()
   WHERE id = _id
     AND token = _token
     AND is_active = true
     AND COALESCE(last_heartbeat_at, opened_at) > now() - make_interval(mins => v_timeout);

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.touch_session(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.touch_session(uuid, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.guest_resume_session(_session_id uuid, _session_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session public.table_sessions;
  v_timeout int := public.session_idle_timeout();
  v_table_number int;
BEGIN
  SELECT * INTO v_session
    FROM public.table_sessions
   WHERE id = _session_id AND token = _session_token;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'unknown');
  END IF;

  IF NOT v_session.is_active THEN
    RETURN jsonb_build_object('status', 'closed');
  END IF;

  IF COALESCE(v_session.last_heartbeat_at, v_session.opened_at) <= now() - make_interval(mins => v_timeout) THEN
    RETURN jsonb_build_object('status', 'expired');
  END IF;

  SELECT table_number INTO v_table_number FROM public.tables WHERE id = v_session.table_id;

  RETURN jsonb_build_object(
    'status', 'active',
    'session_id', v_session.id,
    'table_number', v_table_number,
    'guest_name', v_session.guest_name,
    'opened_at', v_session.opened_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.guest_resume_session(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guest_resume_session(uuid, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.guest_leave_session(_session_id uuid, _session_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM 1 FROM public.table_sessions WHERE id = _session_id AND token = _session_token;
  RETURN jsonb_build_object('status', 'left');
END;
$$;

REVOKE ALL ON FUNCTION public.guest_leave_session(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guest_leave_session(uuid, text) TO anon, authenticated;

-- =====================================================================
-- Table lookups accept the venue token
-- =====================================================================

CREATE OR REPLACE FUNCTION public.guest_inspect_table(
  _table_number int,
  _qr_token text,
  _client_id text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_table public.tables;
  v_session public.table_sessions;
  v_join public.session_join_requests;
  v_timeout int := public.session_idle_timeout();
BEGIN
  v_table := public.resolve_table_for_token(_table_number, _qr_token);
  IF v_table.id IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;

  SELECT *
    INTO v_session
    FROM public.table_sessions
   WHERE table_id = v_table.id
     AND is_active = true
     AND COALESCE(last_heartbeat_at, opened_at) > now() - make_interval(mins => v_timeout)
   ORDER BY opened_at DESC
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'empty');
  END IF;

  IF v_session.host_client_id = _client_id THEN
    RETURN jsonb_build_object(
      'status', 'returning', 'role', 'host',
      'session_id', v_session.id, 'session_token', v_session.token,
      'guest_name', v_session.guest_name
    );
  END IF;

  SELECT *
    INTO v_join
    FROM public.session_join_requests
   WHERE table_session_id = v_session.id
     AND client_id = _client_id
     AND status = 'approved'
   ORDER BY resolved_at DESC NULLS LAST, created_at DESC
   LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'status', 'returning', 'role', 'joiner',
      'session_id', v_session.id, 'session_token', v_session.token,
      'guest_name', v_join.guest_name
    );
  END IF;

  RETURN jsonb_build_object('status', 'join_required', 'session_id', v_session.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.guest_start_table_session(
  _table_number int,
  _qr_token text,
  _client_id text,
  _guest_name text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_table public.tables;
  v_session public.table_sessions;
  v_join public.session_join_requests;
  v_timeout int := public.session_idle_timeout();
  v_name text := nullif(left(trim(coalesce(_guest_name, '')), 80), '');
BEGIN
  v_table := public.resolve_table_for_token(_table_number, _qr_token);
  IF v_table.id IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;

  SELECT *
    INTO v_session
    FROM public.table_sessions
   WHERE table_id = v_table.id
     AND is_active = true
     AND COALESCE(last_heartbeat_at, opened_at) > now() - make_interval(mins => v_timeout)
   ORDER BY opened_at DESC
   LIMIT 1;

  IF NOT FOUND THEN
    UPDATE public.table_sessions
       SET is_active = false, closed_at = COALESCE(closed_at, now())
     WHERE table_id = v_table.id AND is_active = true;

    INSERT INTO public.table_sessions(table_id, host_client_id, guest_name)
    VALUES (v_table.id, nullif(_client_id, ''), COALESCE(v_name, 'Guest'))
    RETURNING * INTO v_session;

    RETURN jsonb_build_object(
      'status', 'created', 'role', 'host',
      'session_id', v_session.id, 'session_token', v_session.token,
      'guest_name', v_session.guest_name
    );
  END IF;

  IF v_session.host_client_id = _client_id THEN
    IF v_name IS NOT NULL AND v_session.guest_name IS DISTINCT FROM v_name THEN
      UPDATE public.table_sessions SET guest_name = v_name WHERE id = v_session.id
      RETURNING * INTO v_session;
    END IF;

    RETURN jsonb_build_object(
      'status', 'returning', 'role', 'host',
      'session_id', v_session.id, 'session_token', v_session.token,
      'guest_name', COALESCE(v_session.guest_name, v_name)
    );
  END IF;

  SELECT *
    INTO v_join
    FROM public.session_join_requests
   WHERE table_session_id = v_session.id
     AND client_id = _client_id
     AND status = 'approved'
   ORDER BY resolved_at DESC NULLS LAST, created_at DESC
   LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'status', 'returning', 'role', 'joiner',
      'session_id', v_session.id, 'session_token', v_session.token,
      'guest_name', COALESCE(v_join.guest_name, v_name)
    );
  END IF;

  RETURN jsonb_build_object('status', 'join_required', 'session_id', v_session.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.guest_request_join(
  _table_number int,
  _qr_token text,
  _client_id text,
  _guest_name text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_table public.tables;
  v_session public.table_sessions;
  v_request public.session_join_requests;
  v_timeout int := public.session_idle_timeout();
  v_name text := COALESCE(nullif(left(trim(coalesce(_guest_name, '')), 80), ''), 'Guest');
BEGIN
  v_table := public.resolve_table_for_token(_table_number, _qr_token);
  IF v_table.id IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;

  SELECT *
    INTO v_session
    FROM public.table_sessions
   WHERE table_id = v_table.id
     AND is_active = true
     AND COALESCE(last_heartbeat_at, opened_at) > now() - make_interval(mins => v_timeout)
   ORDER BY opened_at DESC
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_active');
  END IF;

  SELECT *
    INTO v_request
    FROM public.session_join_requests
   WHERE table_session_id = v_session.id
     AND client_id = _client_id
     AND status IN ('pending', 'approved')
   ORDER BY created_at DESC
   LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'status', v_request.status,
      'request_id', v_request.id,
      'session_id', v_session.id,
      'session_token', CASE WHEN v_request.status = 'approved' THEN v_session.token ELSE NULL END
    );
  END IF;

  INSERT INTO public.session_join_requests(table_session_id, guest_name, client_id, status)
  VALUES (v_session.id, v_name, _client_id, 'pending')
  RETURNING * INTO v_request;

  RETURN jsonb_build_object('status', 'pending', 'request_id', v_request.id, 'session_id', v_session.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.guest_auto_approve_join_request(
  _table_number int,
  _qr_token text,
  _session_id uuid,
  _request_id uuid,
  _client_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_table public.tables;
  v_session public.table_sessions;
  v_request public.session_join_requests;
BEGIN
  v_table := public.resolve_table_for_token(_table_number, _qr_token);
  IF v_table.id IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;

  SELECT * INTO v_session
    FROM public.table_sessions
   WHERE id = _session_id AND table_id = v_table.id AND is_active = true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'expired');
  END IF;

  UPDATE public.session_join_requests
     SET status = 'approved', resolved_by_name = 'auto'
   WHERE id = _request_id
     AND table_session_id = _session_id
     AND client_id = _client_id
     AND status = 'pending'
     AND created_at <= now() - interval '30 seconds'
   RETURNING * INTO v_request;

  IF NOT FOUND THEN
    RETURN public.guest_get_join_request(_session_id, _request_id, _client_id);
  END IF;

  RETURN jsonb_build_object(
    'status', 'approved',
    'session_id', v_session.id,
    'session_token', v_session.token,
    'guest_name', v_request.guest_name
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.guest_inspect_table(int, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guest_start_table_session(int, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guest_request_join(int, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guest_auto_approve_join_request(int, text, uuid, uuid, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.close_stale_sessions()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows int := 0;
  v_timeout int := public.session_idle_timeout();
BEGIN
  UPDATE public.table_sessions
     SET is_active = false, closed_at = now()
   WHERE is_active = true
     AND COALESCE(last_heartbeat_at, opened_at) <= now() - make_interval(mins => v_timeout);

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$;

REVOKE ALL ON FUNCTION public.close_stale_sessions() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_stale_sessions() TO authenticated;

CREATE INDEX IF NOT EXISTS idx_table_sessions_active_heartbeat
  ON public.table_sessions(table_id, is_active, last_heartbeat_at DESC);