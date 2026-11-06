DO $apply$
DECLARE v_sql text;
BEGIN
  SELECT r.content INTO v_sql
    FROM net._http_response r
   WHERE r.status_code = 200 AND md5(r.content) = '95cb308aca427d28dddf71c3d4119085'
   ORDER BY r.created DESC
   LIMIT 1;
  IF v_sql IS NULL THEN
    RAISE EXCEPTION '20261106120000_admin_of_both_restaurants.sql has not arrived exactly (md5 95cb308aca427d28dddf71c3d4119085); run step 1 again';
  END IF;
  EXECUTE v_sql;
  RAISE NOTICE 'applied 20261106120000_admin_of_both_restaurants.sql';
END $apply$;