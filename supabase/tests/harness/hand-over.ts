/**
 * Hand the schema a test database built as the superuser to an ordinary role
 * that owns it, the way `postgres` owns it on Supabase (where it is not a
 * superuser). Run it, then `SET ROLE migrator` and apply what is pending: what
 * needs a superuser fails here as it does on the live database.
 */
export const HAND_OVER = `
  CREATE ROLE migrator NOSUPERUSER NOLOGIN;
  ALTER SCHEMA public OWNER TO migrator;
  GRANT ALL ON SCHEMA auth, storage, extensions TO migrator;
  GRANT ALL ON ALL TABLES IN SCHEMA auth, storage TO migrator;
  GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO migrator;
  DO $$
  DECLARE r record;
  BEGIN
    -- Tables, views and free-standing sequences (a column's sequence follows its table).
    FOR r IN
      SELECT c.oid::regclass AS obj,
             CASE c.relkind WHEN 'S' THEN 'SEQUENCE' WHEN 'v' THEN 'VIEW'
                            WHEN 'm' THEN 'MATERIALIZED VIEW' ELSE 'TABLE' END AS kind
        FROM pg_class c
       WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm', 'S')
         AND NOT EXISTS (SELECT 1 FROM pg_depend d
                          WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid
                            AND d.deptype IN ('a', 'i', 'e'))
    LOOP
      EXECUTE format('ALTER %s %s OWNER TO migrator', r.kind, r.obj);
    END LOOP;
    FOR r IN
      SELECT p.oid::regprocedure AS obj,
             CASE p.prokind WHEN 'p' THEN 'PROCEDURE' WHEN 'a' THEN 'AGGREGATE' ELSE 'FUNCTION' END AS kind
        FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace
         AND NOT EXISTS (SELECT 1 FROM pg_depend d
                          WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
    LOOP
      EXECUTE format('ALTER %s %s OWNER TO migrator', r.kind, r.obj);
    END LOOP;
    FOR r IN
      SELECT t.oid::regtype AS obj, CASE t.typtype WHEN 'd' THEN 'DOMAIN' ELSE 'TYPE' END AS kind
        FROM pg_type t
       WHERE t.typnamespace = 'public'::regnamespace
         AND (t.typtype IN ('e', 'd')
              OR (t.typtype = 'c' AND (SELECT relkind FROM pg_class WHERE oid = t.typrelid) = 'c'))
         AND NOT EXISTS (SELECT 1 FROM pg_depend d
                          WHERE d.classid = 'pg_type'::regclass AND d.objid = t.oid AND d.deptype = 'e')
    LOOP
      EXECUTE format('ALTER %s %s OWNER TO migrator', r.kind, r.obj);
    END LOOP;
  END $$;
`;
