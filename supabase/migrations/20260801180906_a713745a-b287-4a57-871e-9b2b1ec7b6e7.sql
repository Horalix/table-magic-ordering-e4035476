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

-- Order lifecycle: add the two payment-gated states.
--
-- These live in their own migration on purpose: PostgreSQL will not let a
-- newly added enum value be USED in the same transaction that added it, so the
-- migration that references 'awaiting_payment' / 'payment_failed' must run
-- afterwards. See docs/order-state-machine.md.
--
--   awaiting_payment  card order created, money not yet confirmed.
--                     Never printed, never visible to the kitchen.
--   payment_failed    card declined/cancelled/expired. Guest may retry or
--                     switch to pay-at-table. Never visible to the kitchen.

ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'awaiting_payment' BEFORE 'pending';
ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'payment_failed' BEFORE 'pending';
