-- Allow admins to delete orders, order_items, and waiters

CREATE POLICY "Admins can delete orders"
ON public.orders
FOR DELETE
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete order items"
ON public.order_items
FOR DELETE
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

-- Waiters table already has "Admins manage waiters" ALL policy, which covers delete.
-- But we need to also remove user_roles row when deleting; handled in edge function.
