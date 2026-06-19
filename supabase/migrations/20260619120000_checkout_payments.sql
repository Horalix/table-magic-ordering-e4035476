-- Checkout: payment method on orders, reason on waiter calls, popular-items RPC.
-- All additive; safe to run once. The card path (Monri) is scaffolded for later.

-- 1. How a table is paying (set at checkout; payment_status flips to 'paid' once Monri confirms)
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS payment_method text,                                   -- 'card' | 'cash' | null
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'unpaid';         -- 'unpaid' | 'paid'

-- 2. Why a waiter was called (a checkout call means "wants to pay")
ALTER TABLE public.waiter_calls
  ADD COLUMN IF NOT EXISTS reason text;                                           -- 'pay' | 'assist' | null

-- 3. Popular / Chef's picks — top menu items by quantity over recent orders.
--    Security definer + anon grant so the guest menu can call it without auth.
CREATE OR REPLACE FUNCTION public.get_popular_items(_limit int DEFAULT 8, _days int DEFAULT 30)
RETURNS TABLE(menu_item_id uuid, qty bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT oi.menu_item_id, sum(oi.quantity)::bigint AS qty
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
   WHERE o.created_at > now() - make_interval(days => _days)
     AND o.status <> 'cancelled'
   GROUP BY oi.menu_item_id
   ORDER BY qty DESC
   LIMIT _limit;
$$;

GRANT EXECUTE ON FUNCTION public.get_popular_items(int, int) TO anon, authenticated;
