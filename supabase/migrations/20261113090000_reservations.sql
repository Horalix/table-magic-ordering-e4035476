-- =====================================================================
-- Table reservations
-- =====================================================================
--
-- A guest asks for a table on the restaurant's website; the restaurant's
-- admin confirms or declines; the guest sees the answer on their own page
-- the moment it is given. Nothing is promised by a machine: a request is a
-- request until a person at the restaurant answers it.
--
--   1. restaurant_settings.reservations_*  whether the restaurant takes
--      requests at all (off until its admin switches it on), between which
--      hours, for how many people, how far ahead, and the phone number a
--      guest in a hurry is shown.
--   2. reservations  one row per request. Guests never read the table: they
--      reach their own request through guest_reservation() with the secret
--      token they were given. The restaurant's admins read their own
--      restaurant's rows and decide through staff_decide_reservation().
--   3. reservation_alert_phones  the phones of admins who asked to be
--      alerted (Web Push, as the waiters' lock-screen alerts are). A trigger
--      tells notify-staff about each new request, and about a confirmed
--      table its guest cancels; reservations_sweep() reminds once if nobody
--      has answered after five minutes, and marks a request nobody answered
--      as expired once its time has passed.
--
-- No table here references the sign-in table: user ids are plain uuids.
-- Nothing reads or changes menu, order, payment or analytics data. Safe to
-- run again: every object is IF NOT EXISTS, OR REPLACE or dropped and
-- recreated.

-- ---------------------------------------------------------------------
-- 1. The restaurant's rules
-- ---------------------------------------------------------------------

ALTER TABLE public.restaurant_settings
  ADD COLUMN IF NOT EXISTS reservations_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reservations_open time NOT NULL DEFAULT '11:00',
  ADD COLUMN IF NOT EXISTS reservations_close time NOT NULL DEFAULT '21:00',
  ADD COLUMN IF NOT EXISTS reservations_max_party integer NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS reservations_days_ahead integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS reservations_lead_minutes integer NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS reservations_phone text,
  ADD COLUMN IF NOT EXISTS reservations_note text;

COMMENT ON COLUMN public.restaurant_settings.reservations_enabled IS
  'Guests may ask for a table on the website. Off until the admin switches it on.';
COMMENT ON COLUMN public.restaurant_settings.reservations_open IS
  'The earliest time of day a table can be asked for, local time.';
COMMENT ON COLUMN public.restaurant_settings.reservations_close IS
  'The latest time of day a table can be asked for, local time.';
COMMENT ON COLUMN public.restaurant_settings.reservations_lead_minutes IS
  'How long before the time itself a request must be made.';
COMMENT ON COLUMN public.restaurant_settings.reservations_phone IS
  'Shown to a guest who is waiting for an answer or was declined. NULL: none shown.';
COMMENT ON COLUMN public.restaurant_settings.reservations_note IS
  'One line guests read before they ask, e.g. "We hold a table for 15 minutes."';

ALTER TABLE public.restaurant_settings DROP CONSTRAINT IF EXISTS restaurant_settings_reservations_check;
ALTER TABLE public.restaurant_settings ADD CONSTRAINT restaurant_settings_reservations_check CHECK (
  reservations_open < reservations_close
  AND reservations_max_party BETWEEN 1 AND 50
  AND reservations_days_ahead BETWEEN 1 AND 365
  AND reservations_lead_minutes BETWEEN 0 AND 1440);

-- ---------------------------------------------------------------------
-- 2. The requests
-- ---------------------------------------------------------------------

/*
 * code is what the guest and the restaurant say to each other ("R48213");
 * token is the guest's key to their own request and is never shown to
 * anyone else. decided_by is the admin's sign-in id, a plain uuid. reply is
 * what the restaurant tells the guest with its answer.
 */
CREATE TABLE IF NOT EXISTS public.reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  code text NOT NULL,
  token text NOT NULL,
  guest_name text NOT NULL,
  guest_phone text NOT NULL,
  party_size integer NOT NULL,
  reserved_for timestamptz NOT NULL,
  note text,
  locale text NOT NULL DEFAULT 'en',
  status text NOT NULL DEFAULT 'pending',
  reply text,
  decided_at timestamptz,
  decided_by uuid,
  cancelled_by text,
  reminded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reservations_party_check CHECK (party_size BETWEEN 1 AND 50),
  CONSTRAINT reservations_locale_check CHECK (locale IN ('en', 'bs', 'ar')),
  CONSTRAINT reservations_status_check CHECK (status IN ('pending', 'confirmed', 'declined', 'cancelled', 'expired')),
  CONSTRAINT reservations_cancelled_by_check CHECK (cancelled_by IS NULL OR cancelled_by IN ('guest', 'restaurant'))
);

CREATE INDEX IF NOT EXISTS reservations_venue_status_idx ON public.reservations(venue_id, status, reserved_for);
CREATE INDEX IF NOT EXISTS reservations_venue_phone_idx ON public.reservations(venue_id, guest_phone, created_at);

REVOKE ALL ON public.reservations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.reservations TO authenticated;
GRANT ALL ON public.reservations TO service_role;

ALTER TABLE public.reservations ENABLE ROW LEVEL SECURITY;

-- A guest's name and phone number are for the people who answer the request:
-- the restaurant's admins, not every waiter's or kitchen tablet's account.
DROP POLICY IF EXISTS "Admins see their restaurant's reservations" ON public.reservations;
CREATE POLICY "Admins see their restaurant's reservations" ON public.reservations
  FOR SELECT TO authenticated
  USING (public.can_admin(venue_id));

/** "+387 61 123-456" → "+38761123456"; NULL when it is not a phone number. */
CREATE OR REPLACE FUNCTION public.reservation_phone(_raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN _raw IS NULL OR _raw !~ '^[0-9+() ./-]{6,30}$' THEN NULL
    WHEN length(regexp_replace(_raw, '[^0-9]', '', 'g')) NOT BETWEEN 8 AND 15 THEN NULL
    ELSE (CASE WHEN trim(_raw) LIKE '+%' THEN '+' ELSE '' END) || regexp_replace(_raw, '[^0-9]', '', 'g')
  END;
$$;

/**
 * What the booking page needs before a guest types anything: whether this
 * restaurant takes requests, its hours and limits, its phone, and the
 * restaurant's own date and time (a guest's phone may be in another zone).
 */
CREATE OR REPLACE FUNCTION public.guest_reservation_options(_venue text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT jsonb_build_object(
      'enabled', rs.reservations_enabled,
      'venue', v.slug,
      'open', to_char(rs.reservations_open, 'HH24:MI'),
      'close', to_char(rs.reservations_close, 'HH24:MI'),
      'max_party', rs.reservations_max_party,
      'days_ahead', rs.reservations_days_ahead,
      'lead_minutes', rs.reservations_lead_minutes,
      'phone', nullif(trim(rs.reservations_phone), ''),
      'note', nullif(trim(rs.reservations_note), ''),
      'today', to_char(now() AT TIME ZONE 'Europe/Sarajevo', 'YYYY-MM-DD'),
      'now', to_char(now() AT TIME ZONE 'Europe/Sarajevo', 'HH24:MI'))
      FROM public.venues v
      JOIN public.restaurant_settings rs ON rs.venue_id = v.id
     WHERE v.slug = _venue
  ), jsonb_build_object('enabled', false));
$$;

REVOKE ALL ON FUNCTION public.guest_reservation_options(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guest_reservation_options(text) TO anon, authenticated;

/**
 * A guest asks for a table. Returns { id, token, code, status }: the id and
 * token are the address of the guest's own page.
 *
 * Refusals are short words the page turns into the guest's language:
 * RESERVATION:disabled, :name, :phone, :party, :time, :hours, :soon, :far,
 * :repeat (this phone has asked too often), :busy (too many requests at once).
 *
 * _trap is a field no person fills in (it is hidden on the page). A robot
 * that fills it is told "sent" and nothing is kept.
 */
CREATE OR REPLACE FUNCTION public.guest_request_reservation(
  _venue text, _name text, _phone text, _party integer, _day date, _time time,
  _note text DEFAULT NULL, _locale text DEFAULT 'en', _trap text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_venue uuid;
  rs public.restaurant_settings%ROWTYPE;
  v_name text := regexp_replace(trim(coalesce(_name, '')), '\s+', ' ', 'g');
  v_phone text := public.reservation_phone(_phone);
  v_note text := nullif(left(regexp_replace(trim(coalesce(_note, '')), '\s+', ' ', 'g'), 300), '');
  v_locale text := CASE WHEN _locale IN ('en', 'bs', 'ar') THEN _locale ELSE 'en' END;
  v_for timestamptz;
  v_today date := (now() AT TIME ZONE 'Europe/Sarajevo')::date;
  v_row public.reservations%ROWTYPE;
BEGIN
  IF nullif(trim(coalesce(_trap, '')), '') IS NOT NULL THEN
    RETURN jsonb_build_object('id', gen_random_uuid(), 'token', replace(gen_random_uuid()::text, '-', ''),
                              'code', 'R' || lpad((floor(random() * 100000))::int::text, 5, '0'), 'status', 'pending');
  END IF;

  SELECT id INTO v_venue FROM public.venues WHERE slug = _venue;
  IF v_venue IS NULL THEN
    RAISE EXCEPTION 'RESERVATION:disabled' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO rs FROM public.restaurant_settings WHERE venue_id = v_venue;
  IF NOT FOUND OR NOT rs.reservations_enabled THEN
    RAISE EXCEPTION 'RESERVATION:disabled' USING ERRCODE = '22023';
  END IF;

  IF length(v_name) NOT BETWEEN 2 AND 80 THEN
    RAISE EXCEPTION 'RESERVATION:name' USING ERRCODE = '22023';
  END IF;
  IF v_phone IS NULL THEN
    RAISE EXCEPTION 'RESERVATION:phone' USING ERRCODE = '22023';
  END IF;
  IF _party IS NULL OR _party < 1 OR _party > rs.reservations_max_party THEN
    RAISE EXCEPTION 'RESERVATION:party' USING ERRCODE = '22023';
  END IF;
  -- On the quarter hour, as the page offers them.
  IF _day IS NULL OR _time IS NULL OR extract(minute FROM _time)::int % 15 <> 0 OR extract(second FROM _time) <> 0 THEN
    RAISE EXCEPTION 'RESERVATION:time' USING ERRCODE = '22023';
  END IF;
  IF _time < rs.reservations_open OR _time > rs.reservations_close THEN
    RAISE EXCEPTION 'RESERVATION:hours' USING ERRCODE = '22023';
  END IF;
  -- The restaurant's own clock: the naive day and time, read as Sarajevo's.
  v_for := (_day + _time) AT TIME ZONE 'Europe/Sarajevo';
  IF v_for < now() + make_interval(mins => rs.reservations_lead_minutes) THEN
    RAISE EXCEPTION 'RESERVATION:soon' USING ERRCODE = '22023';
  END IF;
  IF _day > v_today + rs.reservations_days_ahead THEN
    RAISE EXCEPTION 'RESERVATION:far' USING ERRCODE = '22023';
  END IF;

  -- One request at a time per restaurant, so two cannot both pass the counts below.
  PERFORM pg_advisory_xact_lock(hashtext('reservations:' || v_venue::text));

  -- The same request sent twice (a double tap, a reload): the first one is the answer.
  SELECT * INTO v_row FROM public.reservations
   WHERE venue_id = v_venue AND guest_phone = v_phone AND reserved_for = v_for
     AND party_size = _party AND status IN ('pending', 'confirmed')
   ORDER BY created_at DESC LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('id', v_row.id, 'token', v_row.token, 'code', v_row.code, 'status', v_row.status);
  END IF;

  IF (SELECT count(*) FROM public.reservations
       WHERE venue_id = v_venue AND guest_phone = v_phone
         AND status IN ('pending', 'confirmed') AND reserved_for > now()) >= 3
     OR (SELECT count(*) FROM public.reservations
          WHERE venue_id = v_venue AND guest_phone = v_phone
            AND created_at > now() - interval '24 hours') >= 6 THEN
    RAISE EXCEPTION 'RESERVATION:repeat' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) FROM public.reservations
       WHERE venue_id = v_venue AND created_at > now() - interval '1 hour') >= 40 THEN
    RAISE EXCEPTION 'RESERVATION:busy' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.reservations(venue_id, code, token, guest_name, guest_phone, party_size, reserved_for, note, locale)
  VALUES (v_venue,
          'R' || lpad((floor(random() * 90000) + 10000)::int::text, 5, '0'),
          replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
          v_name, v_phone, _party, v_for, v_note, v_locale)
  RETURNING * INTO v_row;

  RETURN jsonb_build_object('id', v_row.id, 'token', v_row.token, 'code', v_row.code, 'status', v_row.status);
END;
$$;

REVOKE ALL ON FUNCTION public.guest_request_reservation(text, text, text, integer, date, time, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guest_request_reservation(text, text, text, integer, date, time, text, text, text) TO anon, authenticated;

/**
 * The guest's own request, by its id and the token only they have: what was
 * asked, the restaurant's answer, and the restaurant's phone. A request
 * nobody answered reads as expired from its time on, whether or not the
 * sweep below has marked it yet. NULL for a wrong id or token.
 */
CREATE OR REPLACE FUNCTION public.guest_reservation(_id uuid, _token text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'id', r.id,
    'code', r.code,
    'venue', v.slug,
    'status', CASE WHEN r.status = 'pending' AND r.reserved_for < now() THEN 'expired' ELSE r.status END,
    'name', r.guest_name,
    'party_size', r.party_size,
    'day', to_char(r.reserved_for AT TIME ZONE 'Europe/Sarajevo', 'YYYY-MM-DD'),
    'time', to_char(r.reserved_for AT TIME ZONE 'Europe/Sarajevo', 'HH24:MI'),
    'reserved_for', r.reserved_for,
    'note', r.note,
    'reply', r.reply,
    'cancelled_by', r.cancelled_by,
    'asked_at', r.created_at,
    'waited_seconds', floor(extract(epoch FROM (COALESCE(r.decided_at, now()) - r.created_at)))::int,
    'phone', nullif(trim(rs.reservations_phone), ''))
    FROM public.reservations r
    JOIN public.venues v ON v.id = r.venue_id
    LEFT JOIN public.restaurant_settings rs ON rs.venue_id = r.venue_id
   WHERE r.id = _id AND r.token = _token;
$$;

REVOKE ALL ON FUNCTION public.guest_reservation(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guest_reservation(uuid, text) TO anon, authenticated;

/** The guest takes their own request back, before its time. Returns it as guest_reservation() does. */
CREATE OR REPLACE FUNCTION public.guest_cancel_reservation(_id uuid, _token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.reservations
     SET status = 'cancelled', cancelled_by = 'guest', updated_at = now()
   WHERE id = _id AND token = _token
     AND status IN ('pending', 'confirmed') AND reserved_for > now();
  RETURN public.guest_reservation(_id, _token);
END;
$$;

REVOKE ALL ON FUNCTION public.guest_cancel_reservation(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guest_cancel_reservation(uuid, text) TO anon, authenticated;

/**
 * The restaurant's answer. Only an admin of the request's own restaurant
 * (or the owner):
 *
 *   confirm  a request waiting for an answer, or one declined by mistake
 *   decline  a request waiting for an answer
 *   cancel   a confirmed one the restaurant can no longer honour
 *
 * _reply is what the guest reads with the answer ("By the window", "We are
 * full at 20:00, 21:15 is free"). A request whose time has passed cannot be
 * answered. Returns { id, status }.
 */
CREATE OR REPLACE FUNCTION public.staff_decide_reservation(_id uuid, _decision text, _reply text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.reservations%ROWTYPE;
  v_next text;
  v_reply text := nullif(left(regexp_replace(trim(coalesce(_reply, '')), '\s+', ' ', 'g'), 300), '');
BEGIN
  SELECT * INTO r FROM public.reservations WHERE id = _id FOR UPDATE;
  IF NOT FOUND OR auth.uid() IS NULL OR NOT public.can_admin(r.venue_id) THEN
    RAISE EXCEPTION 'Only the restaurant''s admin can answer a reservation' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF r.reserved_for < now() THEN
    RAISE EXCEPTION 'The time of this reservation has passed' USING ERRCODE = '22023';
  END IF;

  v_next := CASE
    WHEN _decision = 'confirm' AND r.status IN ('pending', 'declined') THEN 'confirmed'
    WHEN _decision = 'decline' AND r.status = 'pending' THEN 'declined'
    WHEN _decision = 'cancel' AND r.status = 'confirmed' THEN 'cancelled'
  END;
  IF v_next IS NULL THEN
    RAISE EXCEPTION 'This reservation is % and cannot be %', r.status,
      CASE _decision WHEN 'confirm' THEN 'confirmed' WHEN 'decline' THEN 'declined' WHEN 'cancel' THEN 'cancelled' ELSE 'changed' END
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.reservations
     SET status = v_next,
         reply = v_reply,
         decided_at = now(),
         decided_by = auth.uid(),
         cancelled_by = CASE WHEN v_next = 'cancelled' THEN 'restaurant' END,
         updated_at = now()
   WHERE id = _id;

  PERFORM public.use_venue(r.venue_id);
  PERFORM public.write_audit('reservation.' || v_next, 'reservation', r.id,
    jsonb_build_object('status', r.status),
    jsonb_build_object('status', v_next, 'reserved_for', r.reserved_for, 'party_size', r.party_size),
    v_reply);

  RETURN jsonb_build_object('id', r.id, 'status', v_next);
END;
$$;

REVOKE ALL ON FUNCTION public.staff_decide_reservation(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_decide_reservation(uuid, text, text) TO authenticated;

-- ---------------------------------------------------------------------
-- 3. Telling the restaurant at once
-- ---------------------------------------------------------------------

/*
 * The phones of admins who turned on "Alert this phone" on Admin →
 * Reservations. Apart from the waiters' phones (staff_push_subscriptions):
 * an admin is not a waiter, and staff_push_claim() forgets the phones of
 * anyone who is not one. user_id is a plain uuid.
 */
CREATE TABLE IF NOT EXISTS public.reservation_alert_phones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  venue_id uuid NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  endpoint text NOT NULL,
  keys jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reservation_alert_phones_endpoint_venue_key UNIQUE (endpoint, venue_id),
  CONSTRAINT reservation_alert_phones_endpoint_check CHECK (public.staff_push_endpoint_ok(endpoint)),
  CONSTRAINT reservation_alert_phones_keys_check CHECK (
    jsonb_typeof(keys -> 'p256dh') = 'string' AND jsonb_typeof(keys -> 'auth') = 'string')
);

CREATE INDEX IF NOT EXISTS reservation_alert_phones_venue_user_idx
  ON public.reservation_alert_phones(venue_id, user_id);

REVOKE ALL ON public.reservation_alert_phones FROM PUBLIC, anon;
GRANT SELECT, DELETE ON public.reservation_alert_phones TO authenticated;
GRANT ALL ON public.reservation_alert_phones TO service_role;

ALTER TABLE public.reservation_alert_phones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins see their own alert phones" ON public.reservation_alert_phones;
CREATE POLICY "Admins see their own alert phones" ON public.reservation_alert_phones
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Admins remove their own alert phones" ON public.reservation_alert_phones;
CREATE POLICY "Admins remove their own alert phones" ON public.reservation_alert_phones
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

/**
 * "Alert this phone" on Admin → Reservations: this phone, for this admin, at
 * this restaurant. Only an admin of that restaurant; a phone belongs to
 * whoever turned alerts on with it last.
 */
CREATE OR REPLACE FUNCTION public.reservation_alerts_subscribe(_endpoint text, _keys jsonb, _venue uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
BEGIN
  IF v_user IS NULL OR NOT public.can_admin(_venue) THEN
    RAISE EXCEPTION 'Reservation alerts are for this restaurant''s admins' USING ERRCODE = '42501';
  END IF;
  IF NOT public.staff_push_endpoint_ok(_endpoint) THEN
    RAISE EXCEPTION 'Not a push service address' USING ERRCODE = '22023';
  END IF;
  IF coalesce(_keys ->> 'p256dh', '') !~ '^[A-Za-z0-9_-]{86,88}={0,2}$'
     OR coalesce(_keys ->> 'auth', '') !~ '^[A-Za-z0-9_-]{21,24}={0,2}$' THEN
    RAISE EXCEPTION 'Not a browser''s push keys' USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.reservation_alert_phones WHERE endpoint = _endpoint AND user_id <> v_user;

  INSERT INTO public.reservation_alert_phones(user_id, venue_id, endpoint, keys)
  VALUES (v_user, _venue, _endpoint,
          jsonb_build_object('p256dh', _keys ->> 'p256dh', 'auth', _keys ->> 'auth'))
  ON CONFLICT (endpoint, venue_id) DO UPDATE
    SET keys = EXCLUDED.keys, last_seen_at = now();

  RETURN jsonb_build_object('subscribed', true, 'venue_id', _venue);
END;
$$;

REVOKE ALL ON FUNCTION public.reservation_alerts_subscribe(text, jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reservation_alerts_subscribe(text, jsonb, uuid) TO authenticated;

-- notify-staff claims a reservation's alert, its one reminder and its guest's
-- cancellation as it claims an order's.
ALTER TABLE public.staff_push_sent DROP CONSTRAINT IF EXISTS staff_push_sent_source_check;
ALTER TABLE public.staff_push_sent ADD CONSTRAINT staff_push_sent_source_check
  CHECK (source IN ('orders', 'waiter_calls', 'bill_requests',
                    'reservations', 'reservation_reminders', 'reservation_cancellations'));

-- The moment a guest asks: the same call an order makes (staff_push_notify
-- names the table and the row; the function reads the row itself). It never
-- stops a request: without pg_net, or if queuing fails, the request goes in.
DROP TRIGGER IF EXISTS staff_push_on_reservation ON public.reservations;
CREATE TRIGGER staff_push_on_reservation
  AFTER INSERT ON public.reservations
  FOR EACH ROW EXECUTE FUNCTION public.staff_push_notify();

-- A table that was promised and is given back by the guest is a table the
-- restaurant can give to someone else: it is told, the same way. (A request
-- taken back before it was answered just leaves the waiting list; a table the
-- restaurant cancels itself is no news to the restaurant.)
DROP TRIGGER IF EXISTS staff_push_on_reservation_cancelled ON public.reservations;
CREATE TRIGGER staff_push_on_reservation_cancelled
  AFTER UPDATE OF status ON public.reservations
  FOR EACH ROW
  WHEN (OLD.status = 'confirmed' AND NEW.status = 'cancelled' AND NEW.cancelled_by = 'guest')
  EXECUTE FUNCTION public.staff_push_notify();

/**
 * The scheduler's, every minute:
 *
 *   - a request nobody answered whose time has passed becomes expired;
 *   - a request still waiting five minutes after it was made is announced
 *     once more (reminded_at), and never again.
 *
 * Returns { expired, reminded }.
 */
CREATE OR REPLACE FUNCTION public.reservations_sweep()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expired int;
  v_reminded int := 0;
  r record;
BEGIN
  IF auth.uid() IS NOT NULL OR NOT public.is_trusted_caller() THEN
    RAISE EXCEPTION 'The reservations sweep is the scheduler''s' USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE public.reservations
     SET status = 'expired', updated_at = now()
   WHERE status = 'pending' AND reserved_for < now();
  GET DIAGNOSTICS v_expired = ROW_COUNT;

  FOR r IN
    UPDATE public.reservations
       SET reminded_at = now()
     WHERE status = 'pending' AND reminded_at IS NULL AND reserved_for > now()
       AND created_at < now() - interval '5 minutes'
       AND created_at > now() - interval '60 minutes'
    RETURNING id
  LOOP
    v_reminded := v_reminded + 1;
    IF to_regnamespace('net') IS NOT NULL THEN
      BEGIN
        EXECUTE 'SELECT net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := $4)'
          USING public.staff_push_url(),
                jsonb_build_object('table', 'reservations', 'id', r.id, 'reminder', true),
                '{"Content-Type": "application/json"}'::jsonb,
                5000;
      EXCEPTION WHEN others THEN
        RAISE WARNING 'reservation reminder not queued for %: %', r.id, SQLERRM;
      END;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('expired', v_expired, 'reminded', v_reminded);
END;
$$;
REVOKE ALL ON FUNCTION public.reservations_sweep() FROM PUBLIC, anon, authenticated;

/** What pg_cron runs: the same mark the other scheduled jobs set. */
CREATE OR REPLACE FUNCTION public.run_scheduled_reservation_sweep()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  PERFORM set_config('lasoul.scheduled_job', 'on', true);
  v_result := public.reservations_sweep();
  PERFORM set_config('lasoul.scheduled_job', '', true);

  -- A job that runs every minute writes 1,440 lines a day to pg_cron's own
  -- log. Keep a day of them.
  BEGIN
    EXECUTE $q$DELETE FROM cron.job_run_details d USING cron.job j
                WHERE j.jobid = d.jobid AND j.jobname = 'lasoul-reservations'
                  AND d.end_time < now() - interval '1 day'$q$;
  EXCEPTION WHEN others THEN
    NULL; -- no pg_cron here, or its log is not ours to trim
  END;

  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.run_scheduled_reservation_sweep() FROM PUBLIC, anon, authenticated;

-- Every minute. cron.schedule with a job name replaces a job of that name,
-- so running this again is safe. Without pg_cron nothing is scheduled: a
-- request is still alerted once, and reads as expired once its time passes.
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      EXECUTE $q$SELECT cron.schedule('lasoul-reservations', '* * * * *',
                                       'SELECT public.run_scheduled_reservation_sweep()')$q$;
      RAISE NOTICE 'reservations sweep scheduled with pg_cron, every minute';
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'pg_cron is installed but the reservations sweep could not be scheduled (%)', SQLERRM;
    END;
  ELSE
    RAISE NOTICE 'pg_cron is not available: reservations are alerted once and not reminded';
  END IF;
END $cron$;
