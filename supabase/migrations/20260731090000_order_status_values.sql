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
