-- =====================================================================
-- Lock-screen alerts for waiters (Web Push)
-- =====================================================================
--
-- A waiter's phone in an apron, locked, runs no JavaScript: the waiter
-- screen chimes for a new order only once somebody looks at it. Here the
-- database itself tells the notify-staff Edge Function the moment a guest
-- orders, calls a waiter or asks for the bill, and the function pushes a
-- notification to the phones of the waiters it concerns: the table's
-- waiter, or the waiters on shift at that restaurant when the table has
-- nobody (supabase/functions/notify-staff; the choice is
-- supabase/functions/_shared/staff-push.ts).
--
--   1. staff_push_subscriptions — where each waiter's phone can be reached,
--      per restaurant. A waiter sees and manages only their own rows.
--   2. staff_push_subscribe() — the waiter screen's "Alerts on lock screen".
--   3. staff_push_claim(), staff_push_shift() — for the function only.
--   4. Triggers on orders, waiter_calls and bill_requests that queue the
--      call through pg_net, sent once the guest's transaction commits. They
--      are never in the way of an order: without pg_net, or on any error
--      queuing the call, the row goes in exactly as before, without an alert.
--
-- Nothing here reads or changes menu, order, payment or analytics data.
-- Safe to run again: every object is IF NOT EXISTS, OR REPLACE or dropped
-- and recreated.

-- ---------------------------------------------------------------------
-- 1. Where each waiter's phone can be reached
-- ---------------------------------------------------------------------

/**
 * The push services browsers actually use: Chrome and Android (FCM), Firefox,
 * Safari and iOS, Edge. The function posts to these addresses, so nothing
 * else may be stored as one. Same list as isPushService() in
 * supabase/functions/_shared/web-push.ts.
 */
CREATE OR REPLACE FUNCTION public.staff_push_endpoint_ok(_endpoint text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT coalesce(
    length(_endpoint) <= 2048
    AND _endpoint ~* '^https://([a-z0-9-]+\.)*(googleapis\.com|mozilla\.com|push\.apple\.com|notify\.windows\.com)(:443)?/',
    false);
$$;

REVOKE ALL ON FUNCTION public.staff_push_endpoint_ok(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_push_endpoint_ok(text) TO authenticated, service_role;

/*
 * One row per phone and restaurant. The endpoint is the secret address the
 * phone's push service gave it; keys are the phone's public key and secret
 * that a message is encrypted for. last_seen_at moves each time the waiter
 * screen opens on that phone: someone not on the rota who opened it today is
 * working today.
 *
 * user_id is the waiter's sign-in id, kept as a plain uuid the way
 * public.waiters keeps it: this project's tables do not reference the
 * sign-in table. So nothing removes a row by itself when its waiter is
 * removed; staff_push_claim() below does, at the next event. Until then the
 * row is only unused: notify-staff rings the phones of the restaurant's
 * working waiters (public.waiters, is_active) and nobody else's.
 */
CREATE TABLE IF NOT EXISTS public.staff_push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  venue_id uuid NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  endpoint text NOT NULL,
  keys jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_push_subscriptions_endpoint_venue_key UNIQUE (endpoint, venue_id),
  CONSTRAINT staff_push_subscriptions_endpoint_check CHECK (public.staff_push_endpoint_ok(endpoint)),
  CONSTRAINT staff_push_subscriptions_keys_check CHECK (
    jsonb_typeof(keys -> 'p256dh') = 'string' AND jsonb_typeof(keys -> 'auth') = 'string')
);

CREATE INDEX IF NOT EXISTS staff_push_subscriptions_venue_user_idx
  ON public.staff_push_subscriptions(venue_id, user_id);

REVOKE ALL ON public.staff_push_subscriptions FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_push_subscriptions TO authenticated;
GRANT ALL ON public.staff_push_subscriptions TO service_role;

ALTER TABLE public.staff_push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff see their own push subscriptions" ON public.staff_push_subscriptions;
CREATE POLICY "Staff see their own push subscriptions" ON public.staff_push_subscriptions
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Staff add their own push subscriptions" ON public.staff_push_subscriptions;
CREATE POLICY "Staff add their own push subscriptions" ON public.staff_push_subscriptions
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.can_staff(venue_id));

DROP POLICY IF EXISTS "Staff update their own push subscriptions" ON public.staff_push_subscriptions;
CREATE POLICY "Staff update their own push subscriptions" ON public.staff_push_subscriptions
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid() AND public.can_staff(venue_id));

DROP POLICY IF EXISTS "Staff remove their own push subscriptions" ON public.staff_push_subscriptions;
CREATE POLICY "Staff remove their own push subscriptions" ON public.staff_push_subscriptions
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

/*
 * Events already sent, so the function sends each one once however often it
 * is called — by pg_net, or by anyone who finds its address. Kept two days.
 * Only the function's SECURITY DEFINER claim touches it.
 */
CREATE TABLE IF NOT EXISTS public.staff_push_sent (
  source text NOT NULL CHECK (source IN ('orders', 'waiter_calls', 'bill_requests')),
  source_id uuid NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source, source_id)
);

REVOKE ALL ON public.staff_push_sent FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.staff_push_sent TO service_role;

ALTER TABLE public.staff_push_sent ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------
-- 2. "Alerts on lock screen" on the waiter screen
-- ---------------------------------------------------------------------

/**
 * This phone, for this waiter, at this restaurant. Again on every opening of
 * the waiter screen, which moves last_seen_at.
 *
 * Only a waiter of that restaurant: a waiter of La Soul cannot have Vera
 * Italia's orders sent to their phone. And a phone belongs to whoever turned
 * alerts on with it last: on a phone the floor shares, the waiter who signed
 * in before stops getting this phone's alerts. Only the phone itself knows its
 * endpoint, so nobody else can take it over.
 */
CREATE OR REPLACE FUNCTION public.staff_push_subscribe(_endpoint text, _keys jsonb, _venue uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Sign in to turn on lock-screen alerts' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.waiters w
                  WHERE w.user_id = v_user AND w.venue_id = _venue AND w.is_active) THEN
    RAISE EXCEPTION 'Lock-screen alerts are for this restaurant''s waiters' USING ERRCODE = '42501';
  END IF;
  IF NOT public.staff_push_endpoint_ok(_endpoint) THEN
    RAISE EXCEPTION 'Not a push service address' USING ERRCODE = '22023';
  END IF;
  -- A P-256 public key (65 bytes) and a 16-byte secret, base64url.
  IF coalesce(_keys ->> 'p256dh', '') !~ '^[A-Za-z0-9_-]{86,88}={0,2}$'
     OR coalesce(_keys ->> 'auth', '') !~ '^[A-Za-z0-9_-]{21,24}={0,2}$' THEN
    RAISE EXCEPTION 'Not a browser''s push keys' USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.staff_push_subscriptions WHERE endpoint = _endpoint AND user_id <> v_user;

  INSERT INTO public.staff_push_subscriptions(user_id, venue_id, endpoint, keys)
  VALUES (v_user, _venue, _endpoint,
          jsonb_build_object('p256dh', _keys ->> 'p256dh', 'auth', _keys ->> 'auth'))
  ON CONFLICT (endpoint, venue_id) DO UPDATE
    SET keys = EXCLUDED.keys, last_seen_at = now();

  RETURN jsonb_build_object('subscribed', true, 'venue_id', _venue);
END;
$$;

REVOKE ALL ON FUNCTION public.staff_push_subscribe(text, jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_push_subscribe(text, jsonb, uuid) TO authenticated;

-- ---------------------------------------------------------------------
-- 3. For notify-staff
-- ---------------------------------------------------------------------

/**
 * True the first time an event is claimed, false ever after.
 *
 * It tidies as it goes: events older than two days, and the phones of anyone
 * who is no longer a waiter of that restaurant (removed in Admin → Waiters).
 * A waiter who is only switched off keeps their row and their phones, and is
 * not rung.
 */
CREATE OR REPLACE FUNCTION public.staff_push_claim(_source text, _id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.staff_push_sent WHERE sent_at < now() - interval '2 days';
  DELETE FROM public.staff_push_subscriptions s
   WHERE NOT EXISTS (SELECT 1 FROM public.waiters w
                      WHERE w.user_id = s.user_id AND w.venue_id = s.venue_id);
  INSERT INTO public.staff_push_sent(source, source_id) VALUES (_source, _id)
  ON CONFLICT DO NOTHING;
  RETURN FOUND;
END;
$$;

/**
 * Who is on today's rota at this restaurant, and when today's trading day
 * began (05:00 in Sarajevo, business_day()).
 */
CREATE OR REPLACE FUNCTION public.staff_push_shift(_venue uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'day_start', (SELECT r.starts_at FROM public.business_day_range(public.business_day()) r),
    'rota', coalesce((SELECT jsonb_agg(DISTINCT sa.waiter_id)
                        FROM public.section_assignments sa
                       WHERE sa.venue_id = _venue AND sa.shift_date = public.business_day()), '[]'::jsonb));
$$;

REVOKE ALL ON FUNCTION public.staff_push_claim(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.staff_push_shift(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.staff_push_claim(text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.staff_push_shift(uuid) TO service_role;

-- ---------------------------------------------------------------------
-- 4. The moment it happens
-- ---------------------------------------------------------------------

/**
 * Where notify-staff answers. This project's; another project replaces this
 * one function.
 */
CREATE OR REPLACE FUNCTION public.staff_push_url()
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT 'https://jgxnvrrphxnmzongtmzs.supabase.co/functions/v1/notify-staff'::text;
$$;

REVOKE ALL ON FUNCTION public.staff_push_url() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.staff_push_url() TO service_role;

/*
 * Queues one call to notify-staff naming the row; the function reads the row
 * itself, so the call carries nothing to trust. A card order is news once it
 * is paid: its INSERT is skipped and the UPDATE trigger below calls then.
 * pg_net sends the request after the guest's transaction commits, and only if
 * it commits.
 */
CREATE OR REPLACE FUNCTION public.staff_push_notify()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_TABLE_NAME = 'orders' AND NEW.status::text IN ('awaiting_payment', 'payment_failed', 'cancelled') THEN
    RETURN NEW;
  END IF;
  IF to_regnamespace('net') IS NULL THEN
    RETURN NEW;
  END IF;
  BEGIN
    EXECUTE 'SELECT net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := $4)'
      USING public.staff_push_url(),
            jsonb_build_object('table', TG_TABLE_NAME, 'id', NEW.id),
            '{"Content-Type": "application/json"}'::jsonb,
            5000;
  EXCEPTION WHEN others THEN
    RAISE WARNING 'lock-screen alert not queued for % %: %', TG_TABLE_NAME, NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.staff_push_notify() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS staff_push_on_order ON public.orders;
CREATE TRIGGER staff_push_on_order
  AFTER INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.staff_push_notify();

DROP TRIGGER IF EXISTS staff_push_on_order_paid ON public.orders;
CREATE TRIGGER staff_push_on_order_paid
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW
  WHEN (OLD.status IN ('awaiting_payment', 'payment_failed')
        AND NEW.status NOT IN ('awaiting_payment', 'payment_failed', 'cancelled'))
  EXECUTE FUNCTION public.staff_push_notify();

DROP TRIGGER IF EXISTS staff_push_on_waiter_call ON public.waiter_calls;
CREATE TRIGGER staff_push_on_waiter_call
  AFTER INSERT ON public.waiter_calls
  FOR EACH ROW EXECUTE FUNCTION public.staff_push_notify();

DROP TRIGGER IF EXISTS staff_push_on_bill_request ON public.bill_requests;
CREATE TRIGGER staff_push_on_bill_request
  AFTER INSERT ON public.bill_requests
  FOR EACH ROW EXECUTE FUNCTION public.staff_push_notify();
