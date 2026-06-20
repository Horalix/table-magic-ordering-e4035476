-- Track whether an order has been rung into the certified fiscal POS, so staff
-- can reconcile online/card orders against the fiscal device at close.
-- Additive; staff update it via the existing "Staff can manage orders" policy.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS fiscalized boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS fiscalized_at timestamptz;
