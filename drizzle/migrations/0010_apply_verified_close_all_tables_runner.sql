DO $apply$
DECLARE v_sql text;
BEGIN
  SELECT r.content INTO v_sql
    FROM net._http_response r
   WHERE r.status_code = 200 AND md5(r.content) = '7108da065ccd9d212ad1e91e7e48c37e'
   ORDER BY r.created DESC
   LIMIT 1;
  IF v_sql IS NULL THEN
    RAISE EXCEPTION '20261110120000_close_all_tables.sql has not arrived exactly (md5 7108da065ccd9d212ad1e91e7e48c37e); run step 1 again';
  END IF;
  EXECUTE v_sql;
  RAISE NOTICE 'applied 20261110120000_close_all_tables.sql';
END $apply$;