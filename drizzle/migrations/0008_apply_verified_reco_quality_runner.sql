DO $apply$
DECLARE v_sql text;
BEGIN
  SELECT r.content INTO v_sql
    FROM net._http_response r
   WHERE r.status_code = 200 AND md5(r.content) = 'fd1966207814ae786cc75aaa711b0c61'
   ORDER BY r.created DESC
   LIMIT 1;
  IF v_sql IS NULL THEN
    RAISE EXCEPTION '20261031120000_reco_quality.sql has not arrived exactly (md5 fd1966207814ae786cc75aaa711b0c61); run step 1 again';
  END IF;
  EXECUTE v_sql;
  RAISE NOTICE 'applied 20261031120000_reco_quality.sql';
END $apply$;