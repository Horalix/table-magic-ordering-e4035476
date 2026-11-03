-- "Menu only": a restaurant shows its menu and nothing else (Admin → Service).
--
-- La Soul is moving its printed QR codes and its own address onto this app
-- before the owner has decided to take orders through it. Guests must then get
-- the menu, and nothing that promises more: no ordering, no calling the
-- waiter, no asking for the bill, no checking in at a table.
--
-- The app hides all of that once guest_get_service_status says menu_only
-- (src/hooks/useMenuOnly.ts). The database refuses it on its own as well, so
-- an app still open from before the switch, or a request made by hand, cannot
-- put a ticket on a kitchen screen nobody is watching: a new table, order,
-- waiter call or bill request at a restaurant in menu-only mode is refused.
-- The trigger runs after aa_inherit_venue (20261028090000), which fills
-- venue_id, because triggers on the same event fire in name order.
--
-- Off for every restaurant until an admin switches it on. Running this again
-- changes nothing.

ALTER TABLE public.restaurant_settings
  ADD COLUMN IF NOT EXISTS menu_only boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.restaurant_settings.menu_only IS
  'The guest app shows the menu only: no ordering, waiter calls, bills or table check-in (refused by zz_menu_only).';

-- Latest before this: 20261031100500_service_separation.sql. Only menu_only is new.
CREATE OR REPLACE FUNCTION public.guest_get_service_status()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'ordering_enabled', COALESCE(s.ordering_enabled, true),
    'online_card_enabled', COALESCE(s.online_card_enabled, false),
    'pay_at_table_enabled', COALESCE(s.pay_at_table_enabled, true),
    'paused_message', s.ordering_paused_message,
    'last_order_time', s.last_order_time,
    'kitchen_delay_minutes', COALESCE(s.kitchen_delay_minutes, 0),
    'recommendations_enabled', COALESCE(s.recommendations_enabled, true),
    'menu_only', COALESCE(s.menu_only, false)
  )
  FROM public.restaurant_settings s
  WHERE s.venue_id = public.menu_venue();
$$;

CREATE OR REPLACE FUNCTION public.refuse_when_menu_only()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE((SELECT s.menu_only FROM public.restaurant_settings s WHERE s.venue_id = NEW.venue_id), false) THEN
    RAISE EXCEPTION 'This restaurant shows its menu only: % are switched off (Admin → Service)', TG_TABLE_NAME
      USING ERRCODE = 'P0001', HINT = 'menu_only';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.refuse_when_menu_only() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS zz_menu_only ON public.table_sessions;
CREATE TRIGGER zz_menu_only BEFORE INSERT ON public.table_sessions
  FOR EACH ROW EXECUTE FUNCTION public.refuse_when_menu_only();

DROP TRIGGER IF EXISTS zz_menu_only ON public.orders;
CREATE TRIGGER zz_menu_only BEFORE INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.refuse_when_menu_only();

DROP TRIGGER IF EXISTS zz_menu_only ON public.waiter_calls;
CREATE TRIGGER zz_menu_only BEFORE INSERT ON public.waiter_calls
  FOR EACH ROW EXECUTE FUNCTION public.refuse_when_menu_only();

DROP TRIGGER IF EXISTS zz_menu_only ON public.bill_requests;
CREATE TRIGGER zz_menu_only BEFORE INSERT ON public.bill_requests
  FOR EACH ROW EXECUTE FUNCTION public.refuse_when_menu_only();
