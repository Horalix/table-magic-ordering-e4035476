-- =====================================================================
-- NOTE ON THIS FILENAME
--
-- Applied to the live database under this timestamp by the Lovable Supabase
-- integration, which copied the migration rather than running the original.
-- The filename is kept because it is what `supabase_migrations.schema_migrations`
-- records; renaming it would make a future `supabase db push` try to apply the
-- same schema a second time.
--
-- The body below is the original, restored — Lovable's copy dropped the
-- comments, and several of them document invariants that are not visible from
-- the SQL (statement ordering that prevents trigger recursion, why the all-day
-- ids come back split, why a print claim is not a print). Any GRANT or RLS
-- statement Lovable added is preserved at the end.
-- =====================================================================

-- =====================================================================
-- Print reliability
--
-- The ticket queue could not distinguish "printed" from "a tablet said it
-- would print and then its battery died". claim_ticket_print jumped straight
-- to `printed`, so the moment a device won the claim the ticket was, as far as
-- the database was concerned, on paper. Nothing ever noticed otherwise.
--
-- That is the worst possible failure for a kitchen queue, because it is
-- SILENT and it is TERMINAL: the order is on the board, no paper exists, and
-- no screen anywhere says so. The guest waits, the cook never knew.
--
-- Three changes fix it:
--
--   1. `claimed` becomes a real state. A claim is an intention to print, and
--      only the device that actually printed may say `printed`.
--   2. `requeue_stale_ticket_prints()` sweeps claims that were never reported,
--      turning a dead tablet into a visible Reprint. Called from the kitchen
--      screen on a timer rather than pg_cron, so it needs no extension and no
--      scheduler: any open kitchen device keeps the queue honest, and if none
--      is open there is nothing to print to anyway.
--   3. `print_verified` records whether the printer CONFIRMED the paper came
--      out, as opposed to the browser merely having written some bytes at it.
--      Most Bluetooth printers cannot be asked. Recording which kind of
--      "success" this was is the difference between a log that can be trusted
--      and one that cannot.
--
-- Also: a bar ticket is a separate ticket. The bar cannot work off a ticket
-- printed in the kitchen, and a barman reading past six food lines to find one
-- drink is how drinks get missed.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Ticket states
-- ---------------------------------------------------------------------

ALTER TABLE public.order_ticket_events
  ADD COLUMN IF NOT EXISTS print_verified boolean;

DO $$
BEGIN
  ALTER TABLE public.order_ticket_events DROP CONSTRAINT IF EXISTS order_ticket_events_status_check;
  ALTER TABLE public.order_ticket_events
    ADD CONSTRAINT order_ticket_events_status_check
    CHECK (status IN ('queued', 'claimed', 'exported', 'printed', 'failed', 'cancelled'));
END $$;

COMMENT ON COLUMN public.order_ticket_events.print_verified IS
  'True when the printer itself confirmed the ticket; false when we only know '
  'bytes were written to a device that cannot be queried. NULL for tickets '
  'that predate the distinction.';

CREATE INDEX IF NOT EXISTS idx_order_ticket_events_claimed
  ON public.order_ticket_events(claimed_at) WHERE status = 'claimed';

-- ---------------------------------------------------------------------
-- 2. Claim means claim
-- ---------------------------------------------------------------------

/**
 * Atomically claim a queued ticket.
 *
 * Returns true only for the caller that won, so two kitchen devices — or one
 * device reloaded inside the auto-print window — cannot both print the same
 * ticket.
 *
 * The claim no longer says `printed`. It says `claimed`, and the claiming
 * device must come back with report_ticket_print. A device that never comes
 * back is swept by requeue_stale_ticket_prints() and the ticket reappears as a
 * visible Reprint instead of being quietly counted as done.
 */
CREATE OR REPLACE FUNCTION public.claim_ticket_print(
  _order_id uuid,
  _device_id text,
  _ticket_type text DEFAULT 'kitchen'
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows int := 0;
BEGIN
  IF NOT public.is_staff_member() THEN
    RAISE EXCEPTION 'Only staff can print tickets' USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE public.order_ticket_events
     SET status = 'claimed',
         claimed_by_device = left(coalesce(_device_id, 'unknown'), 80),
         claimed_at = now(),
         attempts = attempts + 1,
         updated_at = now()
   WHERE order_id = _order_id
     AND ticket_type = COALESCE(nullif(_ticket_type, ''), 'kitchen')
     AND status IN ('queued', 'failed');

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_ticket_print(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_ticket_print(uuid, text, text) TO authenticated;

-- ---------------------------------------------------------------------
-- 3. Reporting an outcome, honestly
-- ---------------------------------------------------------------------

-- Dropped rather than overloaded: two functions differing only by a trailing
-- default argument make supabase.rpc() ambiguous at the PostgREST layer, and
-- the error it produces points nowhere near the cause.
DROP FUNCTION IF EXISTS public.report_ticket_print(uuid, boolean, text, text);

/**
 * Report what actually happened to a claimed ticket.
 *
 * `_verified` separates "the printer told us it printed" from "we wrote bytes
 * at something and it did not complain". Both are recorded as success because
 * both usually are — but only one of them is evidence, and a reconciliation
 * that cannot tell them apart is a reconciliation nobody should trust.
 */
CREATE OR REPLACE FUNCTION public.report_ticket_print(
  _order_id uuid,
  _ok boolean,
  _error text DEFAULT NULL,
  _ticket_type text DEFAULT 'kitchen',
  _verified boolean DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_staff_member() THEN
    RAISE EXCEPTION 'Only staff can report a print' USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE public.order_ticket_events
     SET status = CASE WHEN _ok THEN 'printed' ELSE 'failed' END,
         printed_at = CASE WHEN _ok THEN now() ELSE NULL END,
         print_verified = CASE WHEN _ok THEN COALESCE(_verified, false) ELSE NULL END,
         last_error = CASE WHEN _ok THEN NULL ELSE left(coalesce(_error, 'print failed'), 300) END,
         updated_at = now()
   WHERE order_id = _order_id
     AND ticket_type = COALESCE(nullif(_ticket_type, ''), 'kitchen');
END;
$$;

REVOKE ALL ON FUNCTION public.report_ticket_print(uuid, boolean, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_ticket_print(uuid, boolean, text, text, boolean) TO authenticated;

-- ---------------------------------------------------------------------
-- 4. Reprint knows what it is replacing
-- ---------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.requeue_ticket_print(uuid, text);

/**
 * Put a ticket back in the queue, and say what was there before.
 *
 * `previous_printed_at` is the load-bearing part. A reprint that looks
 * identical to the original gets cooked twice — the line has no way to know
 * the plate is already on the pass. Printing "ORIGINAL 20:14" on the reprint
 * is what actually stops that, and only the database knows the time.
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
-- 5. The sweeper
-- ---------------------------------------------------------------------

/**
 * Turn abandoned claims back into work.
 *
 * A tablet that claims a ticket and then loses power, loses Bluetooth, or gets
 * closed leaves a claim nobody will ever report on. Ninety seconds is far
 * longer than any real print takes and far shorter than anyone will wait for
 * food, so a sweep at that boundary costs at worst a duplicate ticket (visible,
 * annoying, recoverable) and saves a missing one (invisible, terminal).
 *
 * Idempotent, so calling it from every open kitchen device on a timer is fine
 * and needs no pg_cron: if no kitchen device is open there is nothing to print
 * to in the first place.
 */
CREATE OR REPLACE FUNCTION public.requeue_stale_ticket_prints(_older_than_seconds int DEFAULT 90)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows int := 0;
  v_cutoff int := GREATEST(30, LEAST(600, COALESCE(_older_than_seconds, 90)));
BEGIN
  IF NOT public.is_staff_member() THEN
    RAISE EXCEPTION 'Only staff can sweep the print queue' USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE public.order_ticket_events
     SET status = 'failed',
         last_error = 'The device that claimed this ticket never reported back',
         claimed_by_device = NULL,
         claimed_at = NULL,
         updated_at = now()
   WHERE status = 'claimed'
     AND claimed_at < now() - make_interval(secs => v_cutoff);

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$;

REVOKE ALL ON FUNCTION public.requeue_stale_ticket_prints(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.requeue_stale_ticket_prints(int) TO authenticated;

-- ---------------------------------------------------------------------
-- 6. Tickets know their station
-- ---------------------------------------------------------------------

/**
 * Build a ticket payload, optionally for one station only.
 *
 * The payload now carries `order_code` (the only string on the ticket a human
 * can match against the board), each line's station and allergens, and the
 * station the ticket is for. A bar ticket contains only bar lines: a barman
 * scanning past six food lines to find one drink is how drinks get forgotten.
 *
 * An order with nothing for a station produces no ticket for it, rather than
 * an empty one — a blank ticket sliding out of the bar printer teaches staff
 * to ignore the bar printer.
 */
CREATE OR REPLACE FUNCTION public.enqueue_order_ticket(
  _order_id uuid,
  _ticket_type text DEFAULT 'kitchen'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_type text := COALESCE(nullif(_ticket_type, ''), 'kitchen');
  v_station text;
  v_payload jsonb;
  v_items jsonb;
  v_ticket_id uuid;
BEGIN
  -- 'kitchen' and 'bar' are station tickets; anything else (e.g. a future
  -- 'receipt') gets every line.
  v_station := CASE WHEN v_type IN ('kitchen', 'bar') THEN v_type ELSE NULL END;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', oi.id,
           'menu_item_id', oi.menu_item_id,
           'name', mi.name,
           'quantity', oi.quantity,
           'notes', oi.notes,
           'status', oi.status,
           'station', oi.station,
           'allergens', COALESCE(to_jsonb(mi.allergens), '[]'::jsonb)
         ) ORDER BY oi.created_at ASC), '[]'::jsonb)
    INTO v_items
    FROM public.order_items oi
    JOIN public.menu_items mi ON mi.id = oi.menu_item_id
   WHERE oi.order_id = _order_id
     AND (v_station IS NULL OR oi.station = v_station);

  IF jsonb_array_length(v_items) = 0 THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_build_object(
           'order_id', o.id,
           'order_code', o.order_code,
           'ticket_type', v_type,
           'station', v_station,
           'created_at', o.created_at,
           'status', o.status,
           'payment_method', o.payment_method,
           'payment_status', o.payment_status,
           'guest_name', o.guest_name,
           'notes', o.notes,
           'total', o.total,
           'table_number', t.table_number,
           'section_id', t.section_id,
           'items', v_items
         )
    INTO v_payload
    FROM public.orders o
    JOIN public.table_sessions s ON s.id = o.table_session_id
    JOIN public.tables t ON t.id = s.table_id
   WHERE o.id = _order_id;

  IF v_payload IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  INSERT INTO public.order_ticket_events(order_id, ticket_type, status, format, payload)
  VALUES (_order_id, v_type, 'queued', 'json', v_payload)
  ON CONFLICT (order_id, ticket_type)
  DO UPDATE SET
    payload = EXCLUDED.payload,
    updated_at = now()
  RETURNING id INTO v_ticket_id;

  RETURN v_ticket_id;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_order_ticket(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enqueue_order_ticket(uuid, text) TO authenticated;

/**
 * Queue every station ticket an order needs, and return the primary one.
 *
 * Returns uuid rather than a count so it is a drop-in for the existing
 * enqueue_order_ticket(_, 'kitchen') call sites — including the ones that
 * assign the result to a uuid variable. Making the replacement type-identical
 * is what allows the rewrite below to be mechanical instead of a second,
 * hand-maintained copy of the release path.
 */
CREATE OR REPLACE FUNCTION public.enqueue_station_tickets(_order_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_kitchen uuid;
  v_bar uuid;
BEGIN
  v_kitchen := public.enqueue_order_ticket(_order_id, 'kitchen');
  v_bar := public.enqueue_order_ticket(_order_id, 'bar');
  RETURN COALESCE(v_kitchen, v_bar);
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_station_tickets(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enqueue_station_tickets(uuid) TO authenticated;

-- ---------------------------------------------------------------------
-- 7. Every existing release path queues both stations
-- ---------------------------------------------------------------------

/**
 * Rewrite the call sites rather than restating the functions.
 *
 * The release path is defined across several earlier migrations. Copying those
 * bodies here to change one line would fork them, and two divergent copies of
 * "how an order reaches the kitchen" is exactly the drift that ends with an
 * order released and never ticketed.
 *
 * pg_get_functiondef() gives back the complete definition — signature,
 * volatility, SECURITY DEFINER, search_path — so the replacement preserves
 * everything except the one call being changed. The substitution is
 * type-identical (uuid for uuid), so both `PERFORM` and `v := ...` sites work
 * untouched.
 */
DO $$
DECLARE
  r record;
  v_def text;
  v_changed int := 0;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname <> 'enqueue_station_tickets'
       AND p.prosrc LIKE '%enqueue_order_ticket(%''kitchen''%'
  LOOP
    v_def := pg_get_functiondef(r.oid);
  -- Line endings are not content. Git rewrites .sql to CRLF on Windows
  -- checkouts, which would make every search literal below miss silently.
  v_def := replace(v_def, chr(13) || chr(10), chr(10));

    v_def := regexp_replace(
      v_def,
      'public\.enqueue_order_ticket\(\s*([A-Za-z_][A-Za-z0-9_.]*)\s*,\s*''kitchen''\s*\)',
      'public.enqueue_station_tickets(\1)',
      'g');
    EXECUTE v_def;
    v_changed := v_changed + 1;
  END LOOP;

  IF v_changed = 0 THEN
    RAISE EXCEPTION 'No release path found calling enqueue_order_ticket — migrations are out of order';
  END IF;

  RAISE NOTICE 'Rewired % release path(s) to queue both stations', v_changed;
END $$;
