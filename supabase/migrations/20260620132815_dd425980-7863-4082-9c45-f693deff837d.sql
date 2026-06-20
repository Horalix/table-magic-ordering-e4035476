-- Security audit remediation. Additive / idempotent; safe to run once.

-- =====================================================================
-- 1. Realtime: stop broadcasting secret columns.
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
-- =====================================================================
ALTER TABLE public.waiters
  ADD COLUMN IF NOT EXISTS has_pin boolean GENERATED ALWAYS AS (pin_hash IS NOT NULL) STORED;

REVOKE SELECT (pin_hash) ON public.waiters FROM anon, authenticated;

-- =====================================================================
-- 3. Payment transactions (raw provider payloads) → admins only.
-- =====================================================================
DROP POLICY IF EXISTS "Staff can view payment transactions" ON public.payment_transactions;

-- =====================================================================
-- 4. menu-images public bucket: remove broad LIST policy.
-- =====================================================================
DROP POLICY IF EXISTS "Public can read menu images" ON storage.objects;

-- =====================================================================
-- 5. Defense-in-depth: revoke direct API access to internal SECURITY DEFINER helpers.
-- =====================================================================
DO $$
BEGIN
  BEGIN REVOKE ALL ON FUNCTION public.assert_guest_session(uuid, text) FROM PUBLIC, anon, authenticated; EXCEPTION WHEN undefined_function THEN NULL; END;
  BEGIN REVOKE ALL ON FUNCTION public.enqueue_order_ticket(uuid, text) FROM PUBLIC, anon; EXCEPTION WHEN undefined_function THEN NULL; END;
END $$;