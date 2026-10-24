-- =====================================================================
-- The last readers of raw analytics ids, and conversions that never paid
--
-- 20261024150000 made ingest drop item ids that are not uuids and gave the
-- read side a safe parser, public.analytics_uuid(). Three functions written
-- elsewhere still cast props straight to uuid or counted unpaid orders:
--
--   app_impact_summary        one malformed event made /admin/impact throw
--   refresh_suggestion_stats  one malformed event stopped the nightly learning
--   decision_performance      joined completed_orders without filtering on it,
--                             so a cancelled order still counted as a sale
--
-- Each is rewritten in place from its live definition, as the other
-- migrations in this chain do, and each rewrite must match or it raises.
-- =====================================================================

DO $$
DECLARE
  v_fn text;
  v_def text;
  v_before text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY['app_impact_summary', 'refresh_suggestion_stats'] LOOP
    SELECT pg_get_functiondef(p.oid) INTO v_def
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = v_fn;
    IF v_def IS NULL THEN
      RAISE EXCEPTION '% is missing — migrations are out of order', v_fn;
    END IF;
    v_def := replace(v_def, chr(13) || chr(10), chr(10));
    v_before := v_def;

    v_def := replace(v_def, 'nullif(e.props->>''source_item_id'', '''')::uuid', 'public.analytics_uuid(e.props->>''source_item_id'')');
    v_def := replace(v_def, 'nullif(e.props->>''item_id'', '''')::uuid', 'public.analytics_uuid(e.props->>''item_id'')');
    v_def := replace(v_def, 'AND nullif(e.props->>''item_id'', '''') IS NOT NULL', 'AND public.analytics_uuid(e.props->>''item_id'') IS NOT NULL');

    IF v_def = v_before THEN
      RAISE EXCEPTION '%: no raw uuid cast found to replace', v_fn;
    END IF;
    IF position('::uuid' in v_def) > 0 AND position('e.props->>' in v_def) > 0
       AND v_def ~ 'e\.props->>''[a-z_]+'', ''''\)::uuid' THEN
      RAISE EXCEPTION '%: a raw props uuid cast survived the rewrite', v_fn;
    END IF;
    EXECUTE v_def;
  END LOOP;

  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'decision_performance';
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'decision_performance is missing — migrations are out of order';
  END IF;
  v_def := replace(v_def, chr(13) || chr(10), chr(10));
  v_before := v_def;
  v_def := replace(v_def,
    '  LEFT JOIN public.suggestion_conversions sc ON sc.decision_id = d.id
  LEFT JOIN public.completed_orders co ON co.id = sc.order_id AND co.id IS NOT NULL',
    '  -- Only conversions on orders that became sales: a cancelled or abandoned
  -- order is not money the suggestion earned.
  LEFT JOIN (SELECT sc0.*
               FROM public.suggestion_conversions sc0
               JOIN public.completed_orders co ON co.id = sc0.order_id) sc ON sc.decision_id = d.id');
  IF v_def = v_before THEN
    RAISE EXCEPTION 'decision_performance rewrite: conversion join not found';
  END IF;
  EXECUTE v_def;
END $$;
