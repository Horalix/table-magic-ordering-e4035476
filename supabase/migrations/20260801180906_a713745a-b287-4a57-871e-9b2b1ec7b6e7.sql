-- Order lifecycle: add the two payment-gated states.
ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'awaiting_payment' BEFORE 'pending';
ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'payment_failed' BEFORE 'pending';