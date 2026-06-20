ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS fiscalized boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS fiscalized_at timestamptz;