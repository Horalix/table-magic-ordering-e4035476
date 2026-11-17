DO $apply$
DECLARE v_sql text;
BEGIN
  SELECT r.content INTO v_sql
    FROM net._http_response r
   WHERE r.status_code = 200 AND md5(r.content) = '7573a39e17dd3d9072ffb2252a3150b1'
   ORDER BY r.created DESC
   LIMIT 1;
  IF v_sql IS NULL THEN
    RAISE EXCEPTION '20261116120000_reco_always_measured.sql has not arrived exactly (md5 7573a39e17dd3d9072ffb2252a3150b1); run step 1 again';
  END IF;
  EXECUTE v_sql;
  RAISE NOTICE 'applied 20261116120000_reco_always_measured.sql';
END $apply$;
UPDATE public.restaurant_settings SET reco_auto_holdout_pct = 0 WHERE reco_auto_holdout_pct <> 0;