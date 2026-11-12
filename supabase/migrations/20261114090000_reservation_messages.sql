-- =====================================================================
-- WhatsApp messages about a reservation
-- =====================================================================
--
-- A guest who asked for a table is told so, and told the answer, in a
-- WhatsApp message from the restaurant's own business number; the restaurant
-- is told about a new request the same way. The messages themselves are sent
-- by the Edge Function `reservation-messages` (Meta's WhatsApp Cloud API);
-- this migration is the database's part:
--
--   * each restaurant's choices on restaurant_settings, off until its admin
--     turns them on: message guests about the answer to their request,
--     whether to tell them too when the request arrives, and the WhatsApp
--     number to tell about new requests;
--   * reservation_messages, one row per reservation and kind of message, so
--     each is sent once and the admin sees whether it went;
--   * two triggers that call the function when a guest asks and when a
--     request is confirmed, declined or cancelled, and only for a restaurant
--     that has messages on;
--   * guest_reservation_options also says whether the guest will be
--     messaged, so the booking page can say so before the request is sent.
--
-- Until the function's secrets are set and an admin switches messages on,
-- nothing is sent and nothing fails. No menu, order, payment, staff or
-- analytics data changes. Nothing here references the auth schema. Safe to
-- run again.

-- ---------------------------------------------------------------------
-- 1. Each restaurant's choices
-- ---------------------------------------------------------------------

ALTER TABLE public.restaurant_settings
  ADD COLUMN IF NOT EXISTS reservations_whatsapp_guest boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reservations_whatsapp_received boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS reservations_whatsapp_admin text;

COMMENT ON COLUMN public.restaurant_settings.reservations_whatsapp_guest IS
  'Message a guest on WhatsApp when their request for a table is confirmed, declined or cancelled.';
COMMENT ON COLUMN public.restaurant_settings.reservations_whatsapp_received IS
  'While guests are messaged: also when their request arrives, before it is answered.';
COMMENT ON COLUMN public.restaurant_settings.reservations_whatsapp_admin IS
  'The WhatsApp number told about new requests for a table, or NULL for none.';

-- A number, or nothing: eight to fifteen digits with the usual separators.
ALTER TABLE public.restaurant_settings DROP CONSTRAINT IF EXISTS restaurant_settings_whatsapp_admin_check;
ALTER TABLE public.restaurant_settings ADD CONSTRAINT restaurant_settings_whatsapp_admin_check
  CHECK (reservations_whatsapp_admin IS NULL
         OR (reservations_whatsapp_admin ~ '^[+0-9][0-9 ()./-]{6,24}$'
             AND length(regexp_replace(reservations_whatsapp_admin, '[^0-9]', '', 'g')) BETWEEN 8 AND 15));

-- ---------------------------------------------------------------------
-- 2. What was sent
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.reservation_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  reservation_id uuid NOT NULL REFERENCES public.reservations(id) ON DELETE CASCADE,
  kind text NOT NULL,
  status text NOT NULL DEFAULT 'sending',
  -- The message's id at WhatsApp once sent, or why it was not.
  detail text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reservation_messages_kind_check CHECK (kind IN
    ('guest_received', 'guest_confirmed', 'guest_declined', 'guest_cancelled', 'admin_new', 'admin_cancelled')),
  CONSTRAINT reservation_messages_status_check CHECK (status IN ('sending', 'sent', 'failed')),
  -- One message of each kind for a reservation: the second claim finds it taken.
  CONSTRAINT reservation_messages_once UNIQUE (reservation_id, kind)
);

CREATE INDEX IF NOT EXISTS reservation_messages_venue_idx ON public.reservation_messages(venue_id, created_at DESC);

REVOKE ALL ON public.reservation_messages FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.reservation_messages TO authenticated;
GRANT ALL ON public.reservation_messages TO service_role;

ALTER TABLE public.reservation_messages ENABLE ROW LEVEL SECURITY;

-- Only the restaurant's own admins (and the owner) see what was sent. Nobody
-- writes here but the function, with the service role.
DROP POLICY IF EXISTS reservation_messages_admin_read ON public.reservation_messages;
CREATE POLICY reservation_messages_admin_read ON public.reservation_messages
  FOR SELECT TO authenticated
  USING (public.can_admin(venue_id));

-- ---------------------------------------------------------------------
-- 3. Telling the function
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.reservation_messages_url()
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT 'https://jgxnvrrphxnmzongtmzs.supabase.co/functions/v1/reservation-messages'::text;
$$;

REVOKE ALL ON FUNCTION public.reservation_messages_url() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reservation_messages_url() TO service_role;

/*
 * Queues one call to reservation-messages naming the reservation; the
 * function reads it itself, so the call carries nothing to trust. Only for a
 * restaurant that has messages on: for any other, nothing is queued. It
 * never stops a request or an answer: without pg_net, or if queuing fails,
 * the row is written all the same. pg_net sends after the transaction
 * commits, and only if it commits.
 */
CREATE OR REPLACE FUNCTION public.reservation_messages_notify()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF to_regnamespace('net') IS NULL THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.restaurant_settings rs
     WHERE rs.venue_id = NEW.venue_id
       AND (rs.reservations_whatsapp_guest OR nullif(trim(rs.reservations_whatsapp_admin), '') IS NOT NULL)
  ) THEN
    RETURN NEW;
  END IF;
  BEGIN
    EXECUTE 'SELECT net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := $4)'
      USING public.reservation_messages_url(),
            jsonb_build_object('id', NEW.id),
            '{"Content-Type": "application/json"}'::jsonb,
            5000;
  EXCEPTION WHEN others THEN
    RAISE WARNING 'reservation message not queued for %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.reservation_messages_notify() FROM PUBLIC, anon, authenticated;

-- The moment a guest asks.
DROP TRIGGER IF EXISTS reservation_messages_on_request ON public.reservations;
CREATE TRIGGER reservation_messages_on_request
  AFTER INSERT ON public.reservations
  FOR EACH ROW EXECUTE FUNCTION public.reservation_messages_notify();

-- The moment a request is confirmed, declined or cancelled, by either side.
-- (A request nobody answered in time just lapses: nobody is messaged.)
DROP TRIGGER IF EXISTS reservation_messages_on_answer ON public.reservations;
CREATE TRIGGER reservation_messages_on_answer
  AFTER UPDATE OF status ON public.reservations
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status AND NEW.status IN ('confirmed', 'declined', 'cancelled'))
  EXECUTE FUNCTION public.reservation_messages_notify();

-- ---------------------------------------------------------------------
-- 4. The booking page is told a guest will be messaged
-- ---------------------------------------------------------------------
--
-- As in 20261113090000_reservations.sql, with one more line: `whatsapp`.

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
      'whatsapp', rs.reservations_whatsapp_guest,
      'today', to_char(now() AT TIME ZONE 'Europe/Sarajevo', 'YYYY-MM-DD'),
      'now', to_char(now() AT TIME ZONE 'Europe/Sarajevo', 'HH24:MI'))
      FROM public.venues v
      JOIN public.restaurant_settings rs ON rs.venue_id = v.id
     WHERE v.slug = _venue
  ), jsonb_build_object('enabled', false));
$$;

REVOKE ALL ON FUNCTION public.guest_reservation_options(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guest_reservation_options(text) TO anon, authenticated;
