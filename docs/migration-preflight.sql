-- READ-ONLY preflight: does the live database have what the pending
-- migrations build on, and are the names they create still free? Changes
-- nothing. Every row should say found = true.
--
-- Pending: 20261027090000_waiter_take_table.sql, applied through
-- docs/migration-runner.sql. Everything before it is live (the October batch,
-- applied 25 October 2026); the preflight that checked that batch's text
-- rewrites against the live functions is in git history (commit 1575767).
SELECT rewrite, found
  FROM (
  SELECT 'waiters.user_id exists' AS rewrite,
         EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'waiters' AND column_name = 'user_id') AS found
  UNION ALL
  SELECT 'table_sessions.assigned_waiter_id and staff_seen_at exist',
         (SELECT count(*) = 2 FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'table_sessions'
             AND column_name IN ('assigned_waiter_id', 'staff_seen_at'))
  UNION ALL
  SELECT 'restaurant_settings.hold_burst_sessions exists',
         EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'restaurant_settings' AND column_name = 'hold_burst_sessions')
  UNION ALL
  SELECT 'is_staff_member() exists', to_regprocedure('public.is_staff_member()') IS NOT NULL
  UNION ALL
  SELECT '20261027090000_waiter_take_table.sql: staff_take_table is free (or already applied)',
         -- CASE, not OR: SQL does not promise to skip the second half, and
         -- pg_get_functiondef needs a function that exists.
         CASE WHEN to_regprocedure('public.staff_take_table(uuid)') IS NULL THEN true
              ELSE position('staff_seen_at = COALESCE(staff_seen_at, now())'
                            in pg_get_functiondef(to_regprocedure('public.staff_take_table(uuid)'))) > 0
         END
  ) checks;
