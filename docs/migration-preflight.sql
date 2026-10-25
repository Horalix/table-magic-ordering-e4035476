-- READ-ONLY preflight: does every text rewrite in the pending migrations
-- find its search text in the live function? Changes nothing.
SELECT rewrite, function, found
  FROM (
  SELECT '20260804090300_session_context.sql:149' AS rewrite, 'rank_recommendations' AS function, (position('      public.cart_has_drink(_cart_item_ids) AS has_drink
  ),' in replace(COALESCE((SELECT string_agg(pg_get_functiondef(p.oid), E'\n') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'rank_recommendations'), ''), chr(13) || chr(10), chr(10))) > 0) AS found
  UNION ALL
  SELECT '20260804090300_session_context.sql:177' AS rewrite, 'rank_recommendations' AS function, (position('     WHERE a.item_a = ANY(p.cart)
       AND p.placement <> ''after_meal''' in replace(COALESCE((SELECT string_agg(pg_get_functiondef(p.oid), E'\n') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'rank_recommendations'), ''), chr(13) || chr(10), chr(10))) > 0) AS found
  UNION ALL
  SELECT '20260804090300_session_context.sql:185' AS rewrite, 'rank_recommendations' AS function, (position('             AND (r.source_item_id = ANY(p.cart)' in replace(COALESCE((SELECT string_agg(pg_get_functiondef(p.oid), E'\n') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'rank_recommendations'), ''), chr(13) || chr(10), chr(10))) > 0) AS found
  UNION ALL
  SELECT '20260804090300_session_context.sql:192' AS rewrite, 'rank_recommendations' AS function, (position('      AND NOT (mi.id = ANY(p.cart))' in replace(COALESCE((SELECT string_agg(pg_get_functiondef(p.oid), E'\n') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'rank_recommendations'), ''), chr(13) || chr(10), chr(10))) > 0) AS found
  UNION ALL
  SELECT '20260804090300_session_context.sql:209' AS rewrite, 'rank_recommendations' AS function, (replace(COALESCE((SELECT string_agg(pg_get_functiondef(p.oid), E'\n') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'rank_recommendations'), ''), chr(13) || chr(10), chr(10)) ~ '(\n[[:blank:]]*--[^\n]*)*\n[[:blank:]]*AND \(p\.diet IS NULL[[:space:]]+OR \(p\.diet = ''vegan'' AND ''vegan'' = ANY\(mi\.dietary_tags\)\)[[:space:]]+OR \(p\.diet = ''vegetarian'' AND \(''vegetarian'' = ANY\(mi\.dietary_tags\) OR ''vegan'' = ANY\(mi\.dietary_tags\)\)\)\)') AS found
  UNION ALL
  SELECT '20260804090300_session_context.sql:227' AS rewrite, 'rank_recommendations' AS function, (position('      ) AS score' in replace(COALESCE((SELECT string_agg(pg_get_functiondef(p.oid), E'\n') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'rank_recommendations'), ''), chr(13) || chr(10), chr(10))) > 0) AS found
  UNION ALL
  SELECT '20260804090400_session_affinity.sql:170' AS rewrite, 'refresh_menu_intelligence' AS function, (position('  v_pairs int;' in replace(COALESCE((SELECT string_agg(pg_get_functiondef(p.oid), E'\n') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'refresh_menu_intelligence'), ''), chr(13) || chr(10), chr(10))) > 0) AS found
  UNION ALL
  SELECT '20260804090400_session_affinity.sql:177' AS rewrite, 'refresh_menu_intelligence' AS function, (position('v_pairs := public.refresh_menu_affinity(90, 3);' in replace(COALESCE((SELECT string_agg(pg_get_functiondef(p.oid), E'\n') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'refresh_menu_intelligence'), ''), chr(13) || chr(10), chr(10))) > 0) AS found
  UNION ALL
  SELECT '20260804090400_session_affinity.sql:184' AS rewrite, 'refresh_menu_intelligence' AS function, (position('''pairs'', v_pairs,' in replace(COALESCE((SELECT string_agg(pg_get_functiondef(p.oid), E'\n') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'refresh_menu_intelligence'), ''), chr(13) || chr(10), chr(10))) > 0) AS found
  UNION ALL
  SELECT '20260804090400_session_affinity.sql:220' AS rewrite, 'rank_recommendations' AS function, (position('  observed AS (
    SELECT a.item_b AS item_id,' in replace(COALESCE((SELECT string_agg(pg_get_functiondef(p.oid), E'\n') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'rank_recommendations'), ''), chr(13) || chr(10), chr(10))) > 0) AS found
  UNION ALL
  SELECT '20260804090400_session_affinity.sql:238' AS rewrite, 'rank_recommendations' AS function, (position('    SELECT item_id, source_item_id, rtype, 0::numeric, observed_score FROM observed
    UNION ALL' in replace(COALESCE((SELECT string_agg(pg_get_functiondef(p.oid), E'\n') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'rank_recommendations'), ''), chr(13) || chr(10), chr(10))) > 0) AS found
  UNION ALL
  SELECT '20260804090900_thompson_sampling.sql:216' AS rewrite, 'rank_recommendations' AS function, (position('public.daypart_acceptance(mi.id, p.placement, r.source_item_id, p.daypart)' in replace(COALESCE((SELECT string_agg(pg_get_functiondef(p.oid), E'\n') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'rank_recommendations'), ''), chr(13) || chr(10), chr(10))) > 0) AS found
  UNION ALL
  SELECT '20260805090000_business_day.sql:191' AS rewrite, 'sales_analytics' AS function, (position('v_from := _from::timestamptz;' in replace(COALESCE((SELECT string_agg(pg_get_functiondef(p.oid), E'\n') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'sales_analytics'), ''), chr(13) || chr(10), chr(10))) > 0) AS found
  UNION ALL
  SELECT '20260805090000_business_day.sql:197' AS rewrite, 'sales_analytics' AS function, (position('v_to := (_to + 1)::timestamptz;' in replace(COALESCE((SELECT string_agg(pg_get_functiondef(p.oid), E'\n') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'sales_analytics'), ''), chr(13) || chr(10), chr(10))) > 0) AS found
  UNION ALL
  SELECT '20260805090000_business_day.sql:203' AS rewrite, 'sales_analytics' AS function, (position('_from date DEFAULT (CURRENT_DATE - 6)' in replace(COALESCE((SELECT string_agg(pg_get_functiondef(p.oid), E'\n') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'sales_analytics'), ''), chr(13) || chr(10), chr(10))) > 0) AS found
  UNION ALL
  SELECT '20260805090000_business_day.sql:205' AS rewrite, 'sales_analytics' AS function, (position('_to date DEFAULT CURRENT_DATE' in replace(COALESCE((SELECT string_agg(pg_get_functiondef(p.oid), E'\n') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'sales_analytics'), ''), chr(13) || chr(10), chr(10))) > 0) AS found
  UNION ALL
  SELECT '20261024130000_suggestion_guardrails.sql:234' AS rewrite, 'rank_recommendations' AS function, (position('      LOCALTIME AS now_time,' in replace(COALESCE((SELECT string_agg(pg_get_functiondef(p.oid), E'\n') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'rank_recommendations'), ''), chr(13) || chr(10), chr(10))) > 0) AS found
  UNION ALL
  SELECT '20261024130000_suggestion_guardrails.sql:249' AS rewrite, 'rank_recommendations' AS function, (position('     WHERE p.placement = ''cart''
       AND cardinality(p.cart) > 0
       AND NOT p.has_drink
       AND mi.station = ''bar''' in replace(COALESCE((SELECT string_agg(pg_get_functiondef(p.oid), E'\n') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'rank_recommendations'), ''), chr(13) || chr(10), chr(10))) > 0) AS found
  UNION ALL
  SELECT '20261024130000_suggestion_guardrails.sql:266' AS rewrite, 'rank_recommendations' AS function, (position('CASE WHEN p.placement = ''after_meal'' THEN ''after_meal'' ELSE ''frequently_bought_together'' END::text AS rtype,' in replace(COALESCE((SELECT string_agg(pg_get_functiondef(p.oid), E'\n') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'rank_recommendations'), ''), chr(13) || chr(10), chr(10))) > 0) AS found
  UNION ALL
  SELECT '20261024130000_suggestion_guardrails.sql:280' AS rewrite, 'rank_recommendations' AS function, (position('      AND NOT (mi.allergens && p.blocked_allergens)
  )' in replace(COALESCE((SELECT string_agg(pg_get_functiondef(p.oid), E'\n') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'rank_recommendations'), ''), chr(13) || chr(10), chr(10))) > 0) AS found
  UNION ALL
  SELECT '20261024130000_suggestion_guardrails.sql:328' AS rewrite, 'guest_get_substitutes' AS function, (position('public.menu_item_orderable(mi, LOCALTIME)' in replace(COALESCE((SELECT string_agg(pg_get_functiondef(p.oid), E'\n') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'guest_get_substitutes'), ''), chr(13) || chr(10), chr(10))) > 0) AS found
  UNION ALL
  SELECT '20261024160000_guest_ordering_safety.sql:87' AS rewrite, 'guest_place_order' AS function, (replace(COALESCE((SELECT string_agg(pg_get_functiondef(p.oid), E'\n') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'guest_place_order'), ''), chr(13) || chr(10), chr(10)) ~ '_tip numeric DEFAULT 0(::numeric)?\)') AS found
  UNION ALL
  SELECT '20261024160000_guest_ordering_safety.sql:95' AS rewrite, 'guest_place_order' AS function, (position('  v_session := public.assert_guest_session(_session_id, _session_token);
' in replace(COALESCE((SELECT string_agg(pg_get_functiondef(p.oid), E'\n') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'guest_place_order'), ''), chr(13) || chr(10), chr(10))) > 0) AS found
  UNION ALL
  SELECT '20261024160000_guest_ordering_safety.sql:124' AS rewrite, 'guest_place_order' AS function, (position('payment_method, payment_status, order_code, released_to_kitchen_at
  )' in replace(COALESCE((SELECT string_agg(pg_get_functiondef(p.oid), E'\n') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'guest_place_order'), ''), chr(13) || chr(10), chr(10))) > 0) AS found
  UNION ALL
  SELECT '20261024160000_guest_ordering_safety.sql:129' AS rewrite, 'guest_place_order' AS function, (position('    CASE WHEN v_is_card THEN NULL ELSE now() END
  )
  RETURNING * INTO v_order;' in replace(COALESCE((SELECT string_agg(pg_get_functiondef(p.oid), E'\n') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'guest_place_order'), ''), chr(13) || chr(10), chr(10))) > 0) AS found
  UNION ALL
  SELECT '20261024160000_guest_ordering_safety.sql:144' AS rewrite, 'guest_place_order' AS function, (position('  SELECT string_agg(COALESCE(mi.name, ''Unknown item''), '', '')
    INTO v_unavailable
    FROM requested r
    LEFT JOIN public.menu_items mi ON mi.id = r.menu_item_id
   WHERE mi.id IS NULL OR mi.is_available = false;

  IF v_unavailable IS NOT NULL THEN
    RAISE EXCEPTION ''Unavailable: %'', v_unavailable USING ERRCODE = ''no_data_found'';
  END IF;' in replace(COALESCE((SELECT string_agg(pg_get_functiondef(p.oid), E'\n') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'guest_place_order'), ''), chr(13) || chr(10), chr(10))) > 0) AS found
  UNION ALL
  SELECT '20261024160000_guest_ordering_safety.sql:168' AS rewrite, 'guest_place_order' AS function, (position('  v_unavailable text;
' in replace(COALESCE((SELECT string_agg(pg_get_functiondef(p.oid), E'\n') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'guest_place_order'), ''), chr(13) || chr(10), chr(10))) > 0) AS found
  UNION ALL
  SELECT '20261024160000_guest_ordering_safety.sql:178' AS rewrite, 'guest_place_order' AS function, (position('IF v_order_count >= 10 THEN' in replace(COALESCE((SELECT string_agg(pg_get_functiondef(p.oid), E'\n') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'guest_place_order'), ''), chr(13) || chr(10), chr(10))) > 0) AS found
  UNION ALL
  SELECT '20261024170000_analytics_safe_reads.sql:33' AS rewrite, 'refresh_suggestion_stats' AS function, (position('nullif(e.props->>''source_item_id'', '''')::uuid' in replace(COALESCE((SELECT string_agg(pg_get_functiondef(p.oid), E'\n') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'refresh_suggestion_stats'), ''), chr(13) || chr(10), chr(10))) > 0) AS found
  UNION ALL
  SELECT '20261024170000_analytics_safe_reads.sql:34' AS rewrite, 'refresh_suggestion_stats' AS function, (position('nullif(e.props->>''item_id'', '''')::uuid' in replace(COALESCE((SELECT string_agg(pg_get_functiondef(p.oid), E'\n') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'refresh_suggestion_stats'), ''), chr(13) || chr(10), chr(10))) > 0) AS found
  UNION ALL
  SELECT '20261024170000_analytics_safe_reads.sql:35' AS rewrite, 'refresh_suggestion_stats' AS function, (position('AND nullif(e.props->>''item_id'', '''') IS NOT NULL' in replace(COALESCE((SELECT string_agg(pg_get_functiondef(p.oid), E'\n') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'refresh_suggestion_stats'), ''), chr(13) || chr(10), chr(10))) > 0) AS found
  UNION ALL
  SELECT '20261024170000_analytics_safe_reads.sql:55' AS rewrite, 'decision_performance' AS function, (position('  LEFT JOIN public.suggestion_conversions sc ON sc.decision_id = d.id
  LEFT JOIN public.completed_orders co ON co.id = sc.order_id AND co.id IS NOT NULL' in replace(COALESCE((SELECT string_agg(pg_get_functiondef(p.oid), E'\n') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'decision_performance'), ''), chr(13) || chr(10), chr(10))) > 0) AS found
  UNION ALL
  SELECT '20261024180000_house_pairings.sql:252' AS rewrite, 'rank_recommendations' AS function, (position('    SELECT r.recommended_item_id AS item_id,
           r.source_item_id,
           r.recommendation_type AS rtype,
           max(r.priority)::numeric / 100 AS curated_score' in replace(COALESCE((SELECT string_agg(pg_get_functiondef(p.oid), E'\n') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'rank_recommendations'), ''), chr(13) || chr(10), chr(10))) > 0) AS found
  UNION ALL
  SELECT '20261024190000_order_abuse_guards.sql:623' AS rewrite, 'assert_guest_session' AS function, (position('     AND token = _session_token
     AND is_active = true
' in replace(COALESCE((SELECT string_agg(pg_get_functiondef(p.oid), E'\n') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'assert_guest_session'), ''), chr(13) || chr(10), chr(10))) > 0) AS found
  UNION ALL
  SELECT '20261024190000_order_abuse_guards.sql:666' AS rewrite, 'guest_place_order' AS function, (position('  IF v_item_count < 1 OR v_item_count > 40 THEN
    RAISE EXCEPTION ''Invalid order size'';
  END IF;
' in replace(COALESCE((SELECT string_agg(pg_get_functiondef(p.oid), E'\n') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'guest_place_order'), ''), chr(13) || chr(10), chr(10))) > 0) AS found
  UNION ALL
  SELECT '20261024190000_order_abuse_guards.sql:695' AS rewrite, 'guest_place_order' AS function, (position('  v_status := CASE WHEN v_is_card THEN ''awaiting_payment''::public.order_status
                   ELSE ''pending''::public.order_status END;
' in replace(COALESCE((SELECT string_agg(pg_get_functiondef(p.oid), E'\n') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'guest_place_order'), ''), chr(13) || chr(10), chr(10))) > 0) AS found
  UNION ALL
  SELECT '20261024190000_order_abuse_guards.sql:734' AS rewrite, 'guest_place_order' AS function, (position('  IF NOT v_is_card THEN
    v_ticket_id := public.enqueue_station_tickets(v_order.id);' in replace(COALESCE((SELECT string_agg(pg_get_functiondef(p.oid), E'\n') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'guest_place_order'), ''), chr(13) || chr(10), chr(10))) > 0) AS found
  UNION ALL
  SELECT '20261024190000_order_abuse_guards.sql:743' AS rewrite, 'guest_place_order' AS function, (position('    ''ticket_id'', v_ticket_id
  );' in replace(COALESCE((SELECT string_agg(pg_get_functiondef(p.oid), E'\n') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'guest_place_order'), ''), chr(13) || chr(10), chr(10))) > 0) AS found
  UNION ALL
  SELECT '20261024190000_order_abuse_guards.sql:783' AS rewrite, 'guest_get_tab' AS function, (position('             ''created_at'', o.created_at,
' in replace(COALESCE((SELECT string_agg(pg_get_functiondef(p.oid), E'\n') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'guest_get_tab'), ''), chr(13) || chr(10), chr(10))) > 0) AS found
  UNION ALL
  SELECT '20261024190000_order_abuse_guards.sql:814' AS rewrite, 'guest_start_table_session' AS function, (position('  IF v_table.id IS NULL THEN
    RETURN jsonb_build_object(''status'', ''invalid'');
  END IF;
' in replace(COALESCE((SELECT string_agg(pg_get_functiondef(p.oid), E'\n') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'guest_start_table_session'), ''), chr(13) || chr(10), chr(10))) > 0) AS found
  UNION ALL
  SELECT '20261024190000_order_abuse_guards.sql:890' AS rewrite, 'guest_auto_approve_join_request' AS function, (position('     AND created_at <= now() - interval ''30 seconds''
   RETURNING * INTO v_request;' in replace(COALESCE((SELECT string_agg(pg_get_functiondef(p.oid), E'\n') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'guest_auto_approve_join_request'), ''), chr(13) || chr(10), chr(10))) > 0) AS found
  UNION ALL
  SELECT '20261024190000_order_abuse_guards.sql:900' AS rewrite, 'guest_auto_approve_join_request' AS function, (position('  RETURN jsonb_build_object(
    ''status'', ''approved'',' in replace(COALESCE((SELECT string_agg(pg_get_functiondef(p.oid), E'\n') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'guest_auto_approve_join_request'), ''), chr(13) || chr(10), chr(10))) > 0) AS found
  UNION ALL
  SELECT '20261024190000_order_abuse_guards.sql:933' AS rewrite, 'enforce_join_request_limits' AS function, (position('  v_pending int;
' in replace(COALESCE((SELECT string_agg(pg_get_functiondef(p.oid), E'\n') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'enforce_join_request_limits'), ''), chr(13) || chr(10), chr(10))) > 0) AS found
  UNION ALL
  SELECT '20261024190000_order_abuse_guards.sql:943' AS rewrite, 'enforce_join_request_limits' AS function, (position('  IF v_pending > 0 THEN
    RAISE EXCEPTION ''You already have a pending request'';
  END IF;
' in replace(COALESCE((SELECT string_agg(pg_get_functiondef(p.oid), E'\n') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'enforce_join_request_limits'), ''), chr(13) || chr(10), chr(10))) > 0) AS found
  UNION ALL
  SELECT '20261025120000-127000 (analytics): column used' AS rewrite, 'order_items.station' AS function, EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'order_items' AND column_name = 'station') AS found
  UNION ALL
  SELECT '20261025120000-127000 (analytics): column used' AS rewrite, 'order_items.ready_at' AS function, EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'order_items' AND column_name = 'ready_at') AS found
  UNION ALL
  SELECT '20261025120000-127000 (analytics): column used' AS rewrite, 'table_sessions.covers' AS function, EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'table_sessions' AND column_name = 'covers') AS found
  UNION ALL
  SELECT '20261025120000-127000 (analytics): column used' AS rewrite, 'menu_items.meal_role' AS function, EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'menu_items' AND column_name = 'meal_role') AS found
  UNION ALL
  SELECT '20261025120000-127000 (analytics): column used' AS rewrite, 'suggestion_conversions.decision_id' AS function, EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'suggestion_conversions' AND column_name = 'decision_id') AS found
  UNION ALL
  SELECT '20261025120000-127000 (analytics): column used' AS rewrite, 'recommendation_impressions.decision_id' AS function, EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'recommendation_impressions' AND column_name = 'decision_id') AS found
  UNION ALL
  SELECT '20261025120000-127000 (analytics): column used' AS rewrite, 'menu_item_affinity.a_orders' AS function, EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'menu_item_affinity' AND column_name = 'a_orders') AS found
  UNION ALL
  SELECT '20261025120000-127000 (analytics): new names are free' AS rewrite, 'no live function already uses them' AS function, NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname IN ('analytics_trading_days','analytics_item_days','wilson_interval','menu_engineering','sales_components','sales_change_terms','sales_decomposition','item_trends','station_timings','daily_anomalies','reco_funnel','management_insights','log_menu_item_availability','prep_history')) AS found
  UNION ALL
  SELECT '20261025120000_item_availability_days.sql' AS rewrite, 'menu_item_availability_log is new' AS function, to_regclass('public.menu_item_availability_log') IS NULL AS found
  UNION ALL
  SELECT '20261025100000_reco_learning_v3.sql:478' AS rewrite, 'guest_place_order' AS function, (position('decision_id' in replace(COALESCE((SELECT string_agg(pg_get_functiondef(p.oid), E'
') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'guest_place_order'), ''), chr(13) || chr(10), chr(10))) > 0) AS found
  UNION ALL
  SELECT '20261025100000_reco_learning_v3.sql:501' AS rewrite, 'guest_mark_suggestion_seen' AS function, (position('recommendation_impressions' in replace(COALESCE((SELECT string_agg(pg_get_functiondef(p.oid), E'
') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'guest_mark_suggestion_seen'), ''), chr(13) || chr(10), chr(10))) > 0) AS found
  UNION ALL
  SELECT '20261025100000_reco_learning_v3.sql:459' AS rewrite, 'refresh_suggestion_stats' AS function, (to_regprocedure('public.refresh_suggestion_stats(integer)') IS NOT NULL) AS found
  UNION ALL
  SELECT '20261025100000_reco_learning_v3.sql:1338' AS rewrite, 'rank_recommendations' AS function, (to_regprocedure('public.rank_recommendations(uuid[],text,text,integer,uuid,text[])') IS NOT NULL) AS found
  UNION ALL
  SELECT '20261025100000_reco_learning_v3.sql:66' AS rewrite, 'suggestion_stats.daypart' AS function, EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'suggestion_stats' AND column_name = 'daypart') AS found
  UNION ALL
  SELECT '20261025110000_reco_measurement.sql:274' AS rewrite, 'session_outcomes(covers, net_sales, opened_at)' AS function, (SELECT count(*) = 3 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'session_outcomes' AND column_name IN ('covers', 'net_sales', 'opened_at')) AS found
  UNION ALL
  SELECT '20261025100000-110000 (reco v3): new names are free' AS rewrite, 'no live object already uses them' AS function, NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname IN ('basket_weight','eb_lower05','eb_posterior_mean','pair_strength','acceptance_upper95','acceptance_retired','suggestion_prior','refresh_suggestion_priors','popular_items_for_daypart','two_proportion_interval','ancova_interval')) AND to_regclass('public.suggestion_priors') IS NULL AND to_regclass('public.subcategory_affinity') IS NULL AND to_regclass('public.item_section_share') IS NULL AS found
  UNION ALL
  SELECT '20261025160000_reco_profit.sql: new names are free' AS rewrite, 'no live object already uses them' AS function, NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname IN ('reco_now','reco_kind','reco_vetoed')) AND to_regclass('public.reco_fit') IS NULL AND to_regclass('public.reco_clash') IS NULL AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'recommendation_decisions' AND column_name = 'suggested_quantity') AS found
  UNION ALL
  SELECT '20261025160000_reco_profit.sql:house pairings' AS rewrite, 'menu_item_recommendations, subcategories' AS function, (to_regclass('public.menu_item_recommendations') IS NOT NULL AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'menu_item_recommendations' AND column_name = 'source_subcategory_id')) AS found
  UNION ALL
  SELECT '20261026110000_reco_adaptive.sql: new names are free' AS rewrite, 'no live object already uses them' AS function, NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname IN ('reco_decayed','reco_learning_keys','reco_learn_visit','trg_reco_learn','rebuild_reco_learning','reco_learned_pairs','maybe_refresh_menu_intelligence','run_scheduled_learning_refresh')) AND to_regclass('public.reco_learning') IS NULL AND to_regclass('public.reco_learned_visits') IS NULL AND NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname IN ('trg_reco_learn_order_insert','trg_reco_learn_order_release','trg_reco_learn_item')) AS found
  UNION ALL
  SELECT '20261026110000_reco_adaptive.sql: what the learner reads' AS rewrite, 'orders, order_items, suggestion_conversions, completed_orders' AS function, (SELECT count(*) = 8 FROM information_schema.columns WHERE table_schema = 'public' AND ((table_name = 'orders' AND column_name IN ('table_session_id', 'released_to_kitchen_at', 'status', 'created_at')) OR (table_name = 'order_items' AND column_name IN ('order_id', 'menu_item_id')) OR (table_name = 'suggestion_conversions' AND column_name IN ('order_id', 'recommended_item_id')))) AND to_regclass('public.completed_orders') IS NOT NULL AS found
  UNION ALL
  SELECT '20261026100100_promotions_ordering.sql:47 (a)' AS rewrite, 'guest_place_order' AS function, ((SELECT count(*) FROM regexp_matches(replace(COALESCE((SELECT string_agg(pg_get_functiondef(p.oid), E'\n') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'guest_place_order'), ''), chr(13) || chr(10), chr(10)), 'SELECT[[:space:]]+round\(sum\(mi\.price[[:space:]]*\*[[:space:]]*r\.quantity\)::numeric,[[:space:]]*2\)[[:space:]]+INTO[[:space:]]+v_items_total[[:space:]]+FROM[[:space:]]+requested[[:space:]]+r[[:space:]]+JOIN[[:space:]]+public\.menu_items[[:space:]]+mi[[:space:]]+ON[[:space:]]+mi\.id[[:space:]]*=[[:space:]]*r\.menu_item_id[[:space:]]+AND[[:space:]]+mi\.is_available[[:space:]]*=[[:space:]]*true[[:space:]]*;', 'g')) = 1) AS found
  UNION ALL
  SELECT '20261026100100_promotions_ordering.sql:58 (b)' AS rewrite, 'guest_place_order' AS function, ((SELECT count(*) FROM regexp_matches(replace(COALESCE((SELECT string_agg(pg_get_functiondef(p.oid), E'\n') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'guest_place_order'), ''), chr(13) || chr(10), chr(10)), 'INSERT[[:space:]]+INTO[[:space:]]+public\.order_items[[:space:]]*\([[:space:]]*order_id,[[:space:]]*menu_item_id,[[:space:]]*quantity,[[:space:]]*unit_price,[[:space:]]*notes,[[:space:]]*status[[:space:]]*\)[[:space:]]+SELECT[[:space:]]+v_order\.id,[[:space:]]*r\.menu_item_id,[[:space:]]*r\.quantity,[[:space:]]*mi\.price,[[:space:]]*r\.notes,[[:space:]]*''pending''[[:space:]]+FROM[[:space:]]+requested[[:space:]]+r[[:space:]]+JOIN[[:space:]]+public\.menu_items[[:space:]]+mi[[:space:]]+ON[[:space:]]+mi\.id[[:space:]]*=[[:space:]]*r\.menu_item_id[[:space:]]+AND[[:space:]]+mi\.is_available[[:space:]]*=[[:space:]]*true[[:space:]]*;', 'g')) = 1) AS found
  UNION ALL
  SELECT '20261026100100_promotions_ordering.sql:70 (c, optional)' AS rewrite, 'guest_place_order' AS function, (replace(COALESCE((SELECT string_agg(pg_get_functiondef(p.oid), E'\n') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'guest_place_order'), ''), chr(13) || chr(10), chr(10)) ~ 'round\(mi\.price[[:space:]]*\*[[:space:]]*LEAST\(GREATEST\(COALESCE\(\(item->>''quantity''\)::int,[[:space:]]*1\),[[:space:]]*1\),[[:space:]]*10\),[[:space:]]*2\)') AS found
  UNION ALL
  SELECT '20261026100100_promotions_ordering.sql:89 (tab, optional)' AS rewrite, 'guest_get_tab' AS function, ((SELECT count(*) FROM regexp_matches(replace(COALESCE((SELECT string_agg(pg_get_functiondef(p.oid), E'\n') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'guest_get_tab'), ''), chr(13) || chr(10), chr(10)), '''notes'',[[:space:]]*oi\.notes,', 'g')) = 1) AS found
  UNION ALL
  SELECT '20261026100000_promotions.sql: new names are free' AS rewrite, 'no live object already uses them' AS function, NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname IN ('menu_item_sale_price','menu_item_unit_price','guest_get_combos','admin_save_combo','price_order_lines','guard_order_item_promotion')) AND to_regclass('public.menu_combo_slots') IS NULL AND to_regclass('public.menu_combo_options') IS NULL AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND ((table_name = 'menu_items' AND column_name IN ('sale_kind','sale_value','sale_starts_at','sale_ends_at','sale_label','new_until','featured_rank','featured_note','featured_note_bs','featured_note_ar')) OR (table_name = 'order_items' AND column_name IN ('regular_unit_price','components')))) AS found
  UNION ALL
  SELECT '20261026120000_cloud_printers.sql' AS rewrite, 'printers is new' AS function, to_regclass('public.printers') IS NULL AS found
  UNION ALL
  SELECT '20261026120000_cloud_printers.sql' AS rewrite, 'new function names are free' AS function, NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname IN ('printer_ticket_types','cloud_print_candidates','cloud_printer_checkin','cloud_print_claim','cloud_print_report','cloud_printer_test_done','printer_health')) AS found
  UNION ALL
  SELECT '20261026120000_cloud_printers.sql' AS rewrite, 'requeue_ticket_print(uuid, text) returns jsonb' AS function, EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'requeue_ticket_print' AND pg_get_function_identity_arguments(p.oid) = '_order_id uuid, _ticket_type text' AND pg_get_function_result(p.oid) = 'jsonb') AS found
  UNION ALL
  SELECT '20261026120000_cloud_printers.sql' AS rewrite, 'order_ticket_events claim columns' AS function, (SELECT count(*) = 5 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'order_ticket_events' AND column_name IN ('claimed_by_device','claimed_at','print_verified','attempts','last_error')) AS found
  UNION ALL
  SELECT '20261026120000_cloud_printers.sql' AS rewrite, 'order_ticket_events status allows claimed' AS function, EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_ticket_events_status_check' AND pg_get_constraintdef(oid) LIKE '%claimed%') AS found
  UNION ALL
  SELECT '20261026120000_cloud_printers.sql' AS rewrite, 'cloudprnt reads these columns' AS function, (SELECT count(*) = 4 FROM information_schema.columns WHERE table_schema = 'public' AND ((table_name = 'orders' AND column_name IN ('order_code','released_to_kitchen_at')) OR (table_name = 'table_sessions' AND column_name = 'assigned_waiter_id') OR (table_name = 'restaurant_settings' AND column_name = 'print_header'))) AS found
  UNION ALL
  SELECT '20261026120000_cloud_printers.sql' AS rewrite, 'helpers it calls exist' AS function, (SELECT count(DISTINCT p.proname) = 3 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname IN ('is_staff_member','has_role','write_audit')) AS found
  ) checks
 ORDER BY found, rewrite;
