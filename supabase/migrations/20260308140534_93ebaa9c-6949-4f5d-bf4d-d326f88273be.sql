
-- Drop the overly permissive policies
DROP POLICY IF EXISTS "Anyone can create sessions" ON public.table_sessions;
DROP POLICY IF EXISTS "Anyone can create orders" ON public.orders;
DROP POLICY IF EXISTS "Anyone can create order items" ON public.order_items;

-- More restrictive: sessions can only be created for existing tables
CREATE POLICY "Sessions created for valid tables" ON public.table_sessions 
FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.tables WHERE id = table_id)
);

-- Orders can only be created for active sessions
CREATE POLICY "Orders for active sessions only" ON public.orders 
FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.table_sessions WHERE id = table_session_id AND is_active = true)
);

-- Order items can only be created for existing orders with available menu items
CREATE POLICY "Order items for valid orders and items" ON public.order_items 
FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.orders WHERE id = order_id)
  AND EXISTS (SELECT 1 FROM public.menu_items WHERE id = menu_item_id AND is_available = true)
);
