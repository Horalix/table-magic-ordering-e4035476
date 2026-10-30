-- READ-ONLY preflight: does the live database have what the pending
-- migrations build on, and are the names they create still free? Changes
-- nothing. Every row should say found = true.
--
-- Pending: 20261028090000_two_restaurants_foundation.sql (docs/two-restaurants.md),
-- applied through docs/migration-runner.sql. Everything before it is live
-- (20261027090000_waiter_take_table.sql applied 26 October 2026); the
-- preflight that checked that file is in git history.
--
-- Each check passes before the file is applied and after it, so it can be run
-- again to confirm. CASE, not OR, wherever the second half needs the first to
-- hold: SQL does not promise to skip it.
SELECT rewrite, found
  FROM (
  SELECT '20261027090000 is live: staff_take_table exists' AS rewrite,
         to_regprocedure('public.staff_take_table(uuid)') IS NOT NULL AS found
  UNION ALL
  SELECT 'user_roles(user_id, role) exists',
         (SELECT count(*) = 2 FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'user_roles' AND column_name IN ('user_id', 'role'))
  UNION ALL
  SELECT 'La Soul''s settings row (id 1) exists',
         EXISTS (SELECT 1 FROM public.restaurant_settings WHERE id = 1)
  UNION ALL
  SELECT 'has_role, is_staff_member, business_day, day_reconciliation, write_audit exist',
         to_regprocedure('public.has_role(uuid, public.app_role)') IS NOT NULL
         AND to_regprocedure('public.is_staff_member()') IS NOT NULL
         AND to_regprocedure('public.business_day(timestamp with time zone)') IS NOT NULL
         AND to_regprocedure('public.day_reconciliation(date)') IS NOT NULL
         AND EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'write_audit' AND pronamespace = 'public'::regnamespace)
  UNION ALL
  -- Through the catalog: naming public.venues itself fails before it exists.
  SELECT 'venues is free (or already applied)',
         to_regclass('public.venues') IS NULL
         OR EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema = 'public' AND table_name = 'venues' AND column_name = 'slug')
  UNION ALL
  SELECT 'next_order_code: the old one, or the per-restaurant one',
         to_regprocedure('public.next_order_code()') IS NOT NULL
         OR to_regprocedure('public.next_order_code(uuid)') IS NOT NULL
  UNION ALL
  SELECT 'close_shift and shift_close_for: the old ones, or the per-restaurant ones',
         (to_regprocedure('public.close_shift(date, numeric, numeric, text, text, boolean)') IS NOT NULL
          OR to_regprocedure('public.close_shift(date, numeric, numeric, text, text, boolean, uuid)') IS NOT NULL)
         AND (to_regprocedure('public.shift_close_for(date)') IS NOT NULL
              OR to_regprocedure('public.shift_close_for(date, uuid)') IS NOT NULL)
  UNION ALL
  SELECT 'every table the file gives a restaurant exists',
         (SELECT count(*) = 37 FROM information_schema.tables
           WHERE table_schema = 'public' AND table_name IN (
             'categories', 'sections', 'tables', 'waiters', 'printers', 'restaurant_settings', 'shift_closes',
             'order_code_counters', 'audit_log', 'analytics_events', 'subcategories', 'menu_items',
             'menu_combo_slots', 'menu_combo_options', 'menu_item_availability_log', 'section_assignments',
             'table_sessions', 'orders', 'order_items', 'waiter_calls', 'bill_requests',
             'session_join_requests', 'ratings', 'server_ratings', 'payment_transactions', 'order_refunds',
             'order_ticket_events', 'payment_callback_events', 'user_roles', 'menu_item_recommendations',
             'experiments', 'guest_profiles', 'reco_learning', 'suggestion_stats', 'suggestion_priors',
             'recommendation_decisions', 'item_section_share'))
  ) checks;
