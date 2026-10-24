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
  ) checks
 ORDER BY found, rewrite;
