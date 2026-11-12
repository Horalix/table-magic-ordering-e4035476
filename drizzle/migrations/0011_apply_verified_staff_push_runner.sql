DO $apply$
DECLARE v_sql text;
BEGIN
  SELECT r.content INTO v_sql
    FROM net._http_response r
   WHERE r.status_code = 200 AND md5(r.content) = '4df33a4fd1d8d6f200fef89cadea29df'
   ORDER BY r.created DESC
   LIMIT 1;
  IF v_sql IS NULL THEN
    RAISE EXCEPTION '20261112090000_staff_push.sql has not arrived exactly (md5 4df33a4fd1d8d6f200fef89cadea29df); run step 1 again';
  END IF;
  EXECUTE v_sql;
  RAISE NOTICE 'applied 20261112090000_staff_push.sql';
END $apply$;