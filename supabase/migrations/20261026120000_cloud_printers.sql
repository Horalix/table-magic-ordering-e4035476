-- =====================================================================
-- Cloud printers: a network thermal printer fetches its own tickets
--
-- Until now every ticket had to be printed BY a browser: a kitchen tablet
-- kept open, paired over Bluetooth or set as "the printer device". A tablet
-- that went to sleep, lost Bluetooth or was closed meant no tickets — and
-- the requeue sweeper could only turn that into a visible Reprint.
--
-- A network printer that polls the server removes the tablet from the
-- path. Star CloudPRNT (TSP143IV, mC-Print3) and Epson Server Direct Print
-- (TM-m30III, TM-T88VII) both work the same way: every few seconds the
-- printer asks "anything for me?", fetches a job, prints it and reports the
-- result. No local software, no open browser, nothing to pair.
--
-- This migration adds:
--   1. `printers` — one row per physical printer: which station it serves,
--      its secret poll URL token, and when it was last heard from.
--   2. The claim/report functions the `cloudprnt` Edge Function calls with
--      the service role. They use the same queue and the same `claimed`
--      state as the tablets (20260801182128), so a cloud printer and a
--      tablet can never both print the same ticket.
--   3. `printer_health()` so every staff screen can say "Kitchen printer:
--      online" or "not heard from for 4 min" — and so a tablet stops
--      printing a station that a working network printer already covers.
--   4. `order_ticket_events.original_printed_at`, so a ticket a network
--      printer reprints says REPRINT and when the original came out. Only
--      the database knows that time; without it a reprint looks like a new
--      order and gets cooked twice.
--
-- Additive and idempotent. Nothing existing changes behaviour except
-- requeue_ticket_print, which now also remembers the original print time.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Printers
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.printers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 60),
  -- 'all' is the one-printer restaurant: kitchen and bar tickets both.
  station text NOT NULL DEFAULT 'kitchen' CHECK (station IN ('kitchen', 'bar', 'all')),
  paper_width int NOT NULL DEFAULT 80 CHECK (paper_width IN (58, 80)),
  -- Send plain text instead of the printer's own command language. The
  -- escape hatch if a model prints the styled ticket garbled.
  plain_text boolean NOT NULL DEFAULT false,
  enabled boolean NOT NULL DEFAULT true,
  -- The secret in the printer's poll URL. Two UUIDs' worth of randomness.
  poll_token text NOT NULL UNIQUE
    DEFAULT (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''))
    CHECK (length(poll_token) >= 32),
  -- Learned from the first poll, not configured: whatever the printer speaks.
  protocol text CHECK (protocol IN ('star_cloudprnt', 'epson_sdp')),
  device_mac text,
  last_seen_at timestamptz,
  last_status text,
  last_error text,
  test_requested_at timestamptz,
  last_test_printed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.printers IS
  'Network ticket printers that poll the cloudprnt Edge Function (Star CloudPRNT / Epson Server Direct Print).';
COMMENT ON COLUMN public.printers.poll_token IS
  'Secret path segment of the poll URL: <project>/functions/v1/cloudprnt/<poll_token>. Rotate by writing a new value.';

ALTER TABLE public.printers ENABLE ROW LEVEL SECURITY;

-- Managers only: the row carries the poll secret. Staff see printer health
-- through printer_health(), which never returns the token.
DROP POLICY IF EXISTS "Admins manage printers" ON public.printers;
CREATE POLICY "Admins manage printers"
  ON public.printers FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

REVOKE ALL ON public.printers FROM anon;
REVOKE ALL ON public.printers FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.printers TO authenticated;
GRANT ALL ON public.printers TO service_role;

-- Deliberately NOT added to the realtime publication: a printer checks in
-- every few seconds, and broadcasting each check-in to every staff device
-- would be the busiest event in the app for the least information.

-- ---------------------------------------------------------------------
-- 2. Reprints remember the original
-- ---------------------------------------------------------------------

ALTER TABLE public.order_ticket_events
  ADD COLUMN IF NOT EXISTS original_printed_at timestamptz;

COMMENT ON COLUMN public.order_ticket_events.original_printed_at IS
  'When this ticket FIRST printed, kept across reprints so every printer can print "REPRINT — original 20:14".';

/**
 * Put a ticket back in the queue, and say what was there before.
 *
 * Unchanged from 20260801182128 except that the first print time is now kept
 * on the row: a network printer picking the reprint up has no other way to
 * know it is a reprint.
 */
CREATE OR REPLACE FUNCTION public.requeue_ticket_print(
  _order_id uuid,
  _ticket_type text DEFAULT 'kitchen'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_previous timestamptz;
  v_attempts int := 0;
  v_rows int := 0;
BEGIN
  IF NOT public.is_staff_member() THEN
    RAISE EXCEPTION 'Only staff can reprint' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT printed_at, attempts INTO v_previous, v_attempts
    FROM public.order_ticket_events
   WHERE order_id = _order_id
     AND ticket_type = COALESCE(nullif(_ticket_type, ''), 'kitchen');

  UPDATE public.order_ticket_events
     SET status = 'queued',
         original_printed_at = COALESCE(original_printed_at, printed_at),
         printed_at = NULL,
         print_verified = NULL,
         claimed_by_device = NULL,
         claimed_at = NULL,
         updated_at = now()
   WHERE order_id = _order_id
     AND ticket_type = COALESCE(nullif(_ticket_type, ''), 'kitchen');

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  PERFORM public.write_audit('ticket.reprint_requested', 'order', _order_id,
    jsonb_build_object('ticket_type', COALESCE(nullif(_ticket_type, ''), 'kitchen'),
                       'previous_printed_at', v_previous));

  RETURN jsonb_build_object(
    'requeued', v_rows > 0,
    'previous_printed_at', v_previous,
    'attempts', COALESCE(v_attempts, 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.requeue_ticket_print(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.requeue_ticket_print(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------
-- 3. What a printer may print
-- ---------------------------------------------------------------------

/**
 * Which ticket types a printer's station covers.
 */
CREATE OR REPLACE FUNCTION public.printer_ticket_types(_station text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE _station WHEN 'bar' THEN ARRAY['bar'] WHEN 'kitchen' THEN ARRAY['kitchen']
                       ELSE ARRAY['kitchen', 'bar'] END;
$$;

/**
 * The queue a cloud printer works from.
 *
 * Only QUEUED tickets — a claimed or printed one belongs to someone else —
 * and only ones that are still worth printing:
 *
 *   - touched in the last hour. Plugging a printer in for the first time must
 *     not print every ticket nobody ever printed since opening day. A Retry
 *     from the admin queue touches the row, so it comes back into range.
 *   - for an order that is still being made. A ticket for food that is
 *     already up, served or cancelled would only be cooked a second time.
 */
CREATE OR REPLACE FUNCTION public.cloud_print_candidates(_types text[])
RETURNS SETOF public.order_ticket_events
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.*
    FROM public.order_ticket_events t
    JOIN public.orders o ON o.id = t.order_id
   WHERE t.status = 'queued'
     AND t.ticket_type = ANY(_types)
     AND t.updated_at > now() - interval '60 minutes'
     AND o.status IN ('pending', 'confirmed', 'preparing')
   ORDER BY t.updated_at ASC, t.created_at ASC;
$$;

REVOKE ALL ON FUNCTION public.cloud_print_candidates(text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cloud_print_candidates(text[]) TO service_role;

/**
 * A printer checks in: who is it, and is there anything for it.
 *
 * Returns NULL for an unknown or disabled token — the Edge Function answers
 * that with 401, and the printer's own status page shows the failure.
 *
 * Also sweeps THIS printer's abandoned claims: a job it fetched and never
 * confirmed (power cut mid-ticket, paper out) becomes `failed`, which every
 * screen shows with a Reprint. Failed, not queued: the printer may well have
 * printed half of it, and an automatic second copy is how a dish gets made
 * twice. A person decides.
 */
CREATE OR REPLACE FUNCTION public.cloud_printer_checkin(
  _token text,
  _protocol text DEFAULT NULL,
  _mac text DEFAULT NULL,
  _status text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_printer public.printers;
  v_device text;
  v_next uuid;
BEGIN
  IF _token IS NULL OR length(_token) < 32 THEN
    RETURN NULL;
  END IF;

  UPDATE public.printers
     SET last_seen_at = now(),
         protocol = COALESCE(CASE WHEN _protocol IN ('star_cloudprnt', 'epson_sdp') THEN _protocol END, protocol),
         device_mac = COALESCE(nullif(left(btrim(coalesce(_mac, '')), 40), ''), device_mac),
         last_status = COALESCE(nullif(left(btrim(coalesce(_status, '')), 120), ''), last_status)
   WHERE poll_token = _token AND enabled
  RETURNING * INTO v_printer;

  IF v_printer.id IS NULL THEN
    RETURN NULL;
  END IF;

  v_device := left('cloud:' || v_printer.name, 80);

  UPDATE public.order_ticket_events
     SET status = 'failed',
         last_error = 'The printer fetched this ticket but never confirmed it printed',
         updated_at = now()
   WHERE status = 'claimed'
     AND claimed_by_device = v_device
     AND claimed_at < now() - interval '90 seconds';

  SELECT id INTO v_next
    FROM public.cloud_print_candidates(public.printer_ticket_types(v_printer.station))
   LIMIT 1;

  RETURN jsonb_build_object(
    'id', v_printer.id,
    'name', v_printer.name,
    'station', v_printer.station,
    'paper_width', v_printer.paper_width,
    'plain_text', v_printer.plain_text,
    'device', v_device,
    'next_ticket_id', v_next,
    'test_pending', v_printer.test_requested_at IS NOT NULL
      AND (v_printer.last_test_printed_at IS NULL OR v_printer.last_test_printed_at < v_printer.test_requested_at)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cloud_printer_checkin(text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cloud_printer_checkin(text, text, text, text) TO service_role;

/**
 * Claim one ticket for a cloud printer — the named one, or the next in line.
 *
 * The same atomic `queued → claimed` move the tablets make in
 * claim_ticket_print, so whichever device gets there first prints and the
 * other gets nothing. Returns NULL when there is nothing to claim.
 */
CREATE OR REPLACE FUNCTION public.cloud_print_claim(
  _token text,
  _ticket_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_printer public.printers;
  v_device text;
  v_ticket public.order_ticket_events;
BEGIN
  SELECT * INTO v_printer FROM public.printers WHERE poll_token = _token AND enabled;
  IF v_printer.id IS NULL THEN
    RETURN NULL;
  END IF;
  v_device := left('cloud:' || v_printer.name, 80);

  UPDATE public.order_ticket_events t
     SET status = 'claimed',
         claimed_by_device = v_device,
         claimed_at = now(),
         attempts = t.attempts + 1,
         last_error = NULL,
         updated_at = now()
   WHERE t.id = (
           SELECT c.id
             FROM public.cloud_print_candidates(public.printer_ticket_types(v_printer.station)) c
            WHERE _ticket_id IS NULL OR c.id = _ticket_id
            LIMIT 1
         )
     AND t.status = 'queued'
  RETURNING t.* INTO v_ticket;

  -- The printer asking again for the job it already has (a retried GET after
  -- a dropped connection) gets the same job back, not the next one — which
  -- would leave the first claimed by nobody who will ever print it.
  IF v_ticket.id IS NULL AND _ticket_id IS NOT NULL THEN
    SELECT * INTO v_ticket
      FROM public.order_ticket_events
     WHERE id = _ticket_id AND status = 'claimed' AND claimed_by_device = v_device;
  END IF;

  IF v_ticket.id IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'ticket_id', v_ticket.id,
    'order_id', v_ticket.order_id,
    'ticket_type', v_ticket.ticket_type,
    'original_printed_at', v_ticket.original_printed_at,
    'attempts', v_ticket.attempts,
    'paper_width', v_printer.paper_width,
    'plain_text', v_printer.plain_text
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cloud_print_claim(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cloud_print_claim(text, uuid) TO service_role;

/**
 * The printer's verdict on a job it claimed.
 *
 * `_ticket_id` NULL means "the job this printer has in flight" — Epson's
 * response does not reliably echo our id back, but a printer only ever has
 * one job out at a time. A confirmation from a cloud printer is the printer
 * itself saying the paper came out, so success is recorded as VERIFIED,
 * which no browser print can claim.
 */
CREATE OR REPLACE FUNCTION public.cloud_print_report(
  _token text,
  _ticket_id uuid,
  _ok boolean,
  _error text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_printer public.printers;
  v_device text;
  v_id uuid;
BEGIN
  SELECT * INTO v_printer FROM public.printers WHERE poll_token = _token;
  IF v_printer.id IS NULL THEN
    RETURN NULL;
  END IF;
  v_device := left('cloud:' || v_printer.name, 80);

  SELECT id INTO v_id
    FROM public.order_ticket_events
   WHERE claimed_by_device = v_device
     AND status = 'claimed'
     AND (_ticket_id IS NULL OR id = _ticket_id)
   ORDER BY claimed_at ASC
   LIMIT 1;

  IF v_id IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE public.order_ticket_events
     SET status = CASE WHEN _ok THEN 'printed' ELSE 'failed' END,
         printed_at = CASE WHEN _ok THEN now() ELSE NULL END,
         print_verified = CASE WHEN _ok THEN true ELSE NULL END,
         last_error = CASE WHEN _ok THEN NULL ELSE left(coalesce(nullif(btrim(_error), ''), 'The printer reported a problem'), 300) END,
         updated_at = now()
   WHERE id = v_id;

  UPDATE public.printers
     SET last_error = CASE WHEN _ok THEN NULL ELSE left(coalesce(_error, 'print failed'), 300) END,
         updated_at = now()
   WHERE id = v_printer.id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.cloud_print_report(text, uuid, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cloud_print_report(text, uuid, boolean, text) TO service_role;

/** The test page from Admin → Printing came out (or did not). */
CREATE OR REPLACE FUNCTION public.cloud_printer_test_done(_token text, _ok boolean, _error text DEFAULT NULL)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.printers
     SET last_test_printed_at = CASE WHEN _ok THEN now() ELSE last_test_printed_at END,
         -- A failed test is not retried forever: clear the request, keep the error.
         test_requested_at = CASE WHEN _ok THEN test_requested_at ELSE NULL END,
         last_error = CASE WHEN _ok THEN NULL ELSE left(coalesce(_error, 'test print failed'), 300) END,
         updated_at = now()
   WHERE poll_token = _token;
$$;

REVOKE ALL ON FUNCTION public.cloud_printer_test_done(text, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cloud_printer_test_done(text, boolean, text) TO service_role;

-- ---------------------------------------------------------------------
-- 4. Printer health, for every staff screen
-- ---------------------------------------------------------------------

/**
 * Is each printer alive, without the secret.
 *
 * `online` means it checked in during the last minute. Printers poll every
 * 5–10 seconds, so a minute of silence is a printer that is off, unplugged or
 * off the network — and a kitchen that should hear about it before the next
 * ticket goes missing, not after.
 */
CREATE OR REPLACE FUNCTION public.printer_health()
RETURNS TABLE (
  id uuid,
  name text,
  station text,
  protocol text,
  enabled boolean,
  online boolean,
  last_seen_at timestamptz,
  last_status text,
  last_error text,
  waiting int
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_staff_member() THEN
    RAISE EXCEPTION 'Only staff can see printer health' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  SELECT p.id, p.name, p.station, p.protocol, p.enabled,
         COALESCE(p.enabled AND p.last_seen_at > now() - interval '60 seconds', false) AS online,
         p.last_seen_at, p.last_status, p.last_error,
         (SELECT count(*)::int FROM public.cloud_print_candidates(public.printer_ticket_types(p.station))) AS waiting
    FROM public.printers p
   ORDER BY p.created_at;
END;
$$;

REVOKE ALL ON FUNCTION public.printer_health() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.printer_health() TO authenticated;
