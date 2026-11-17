DO $apply$
DECLARE v_sql text;
BEGIN
  SELECT r.content INTO v_sql
    FROM net._http_response r
   WHERE r.status_code = 200 AND md5(r.content) = 'e59178f9af34d97ad9220750149349f1'
   ORDER BY r.created DESC
   LIMIT 1;
  IF v_sql IS NULL THEN
    RAISE EXCEPTION '20261116130000_reco_learner_v4.sql has not arrived exactly (md5 e59178f9af34d97ad9220750149349f1); run step 1 again';
  END IF;
  EXECUTE v_sql;
  RAISE NOTICE 'applied 20261116130000_reco_learner_v4.sql';
END $apply$;