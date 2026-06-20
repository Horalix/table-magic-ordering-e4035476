-- Security audit remediation. Additive / idempotent; safe to run once.

-- =====================================================================
-- 1. Realtime: stop broadcasting secret columns.
--    `tables.qr_token` and `table_sessions.token` / `host_client_id` are
--    session-auth secrets. Re-publish these tables with an explicit column
--    list so the WAL stream (and therefore every Realtime payload) excludes
--    the secrets. Other columns still drive live UI updates.
-- =====================================================================
DO $$
BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime DROP TABLE public.tables; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.tables (id, table_number, section_id, status, created_at);
  EXCEPTION WHEN duplicate_object THEN NULL; END;

  BEGIN ALTER PUBLICATION supabase_realtime DROP TABLE public.table_sessions; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.table_sessions
      (id, table_id, is_active, opened_at, closed_at, first_order_at, guest_name, assigned_waiter_id, last_heartbeat_at);
  EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

-- =====================================================================
-- 2. Waiter PIN hashes must never reach any client.
--    Expose a boolean `has_pin` (all the UI needs) and revoke SELECT on the
--    bcrypt `pin_hash` column. PIN set/verify already go through
--    SECURITY DEFINER RPCs (admin_set_waiter_pin / verify_waiter_pin), which
--    run as owner and are unaffected by the column revoke.
-- =====================================================================
ALTER TABLE public.waiters
  ADD COLUMN IF NOT EXISTS has_pin boolean GENERATED ALWAYS AS (pin_hash IS NOT NULL) STORED;

REVOKE SELECT (pin_hash) ON public.waiters FROM anon, authenticated;

-- =====================================================================
-- 3. Payment transactions (raw provider payloads) → admins only.
--    Regular staff don't need them; orders.payment_status already drives the
--    floor/waiter UI.
-- =====================================================================
DROP POLICY IF EXISTS "Staff can view payment transactions" ON public.payment_transactions;
-- "Admins can manage payment transactions" (FOR ALL) remains.

-- =====================================================================
-- 4. menu-images is a PUBLIC bucket (served via public URLs, which bypass
--    RLS). The broad object SELECT policy additionally allowed anyone to
--    LIST every file. Remove it — public URL serving is unaffected.
-- =====================================================================
DROP POLICY IF EXISTS "Public can read menu images" ON storage.objects;

-- =====================================================================
-- 5. Defense-in-depth: ensure internal SECURITY DEFINER helpers are not
--    directly callable from the API. (The guest_* RPCs + get_popular_items
--    remain anon-executable by design — that IS the secure guest API.)
-- =====================================================================
DO $$
BEGIN
  BEGIN REVOKE ALL ON FUNCTION public.assert_guest_session(uuid, text) FROM PUBLIC, anon, authenticated; EXCEPTION WHEN undefined_function THEN NULL; END;
  BEGIN REVOKE ALL ON FUNCTION public.enqueue_order_ticket(uuid, text) FROM PUBLIC, anon; EXCEPTION WHEN undefined_function THEN NULL; END;
END $$;
