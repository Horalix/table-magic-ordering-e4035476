-- Demo mode only (src/demo). Applied AFTER the migrations.

CREATE SCHEMA IF NOT EXISTS demo;
GRANT USAGE ON SCHEMA demo TO anon, authenticated, service_role;

-- Facts about this demo database: when it was seeded, for which day.
CREATE TABLE IF NOT EXISTS demo.meta (
  key text PRIMARY KEY,
  value jsonb NOT NULL
);

/**
 * One API request, the way PostgREST runs it: as the caller's role, with the
 * caller's JWT claims and request headers visible to the SQL, and with any
 * error handed back as data (and its writes undone) instead of thrown.
 *
 * `_sql` is built by src/demo/backend/postgrest.ts from identifiers checked
 * against the schema; every value travels in `_params` and is read as `$1`.
 */
CREATE OR REPLACE FUNCTION demo.run(_sql text, _params jsonb, _role text, _sub text, _claims text, _headers text)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_out text;
  v_code text;
  v_message text;
  v_detail text;
  v_hint text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', COALESCE(_sub, ''), true),
          set_config('request.jwt.claim.role', _role, true),
          set_config('request.jwt.claims', COALESCE(_claims, ''), true),
          set_config('request.headers', COALESCE(_headers, '{}'), true);
  BEGIN
    EXECUTE format('SET LOCAL ROLE %I', _role);
    EXECUTE _sql INTO v_out USING _params;
    RESET ROLE;
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS
      v_code = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT,
      v_detail = PG_EXCEPTION_DETAIL, v_hint = PG_EXCEPTION_HINT;
    RESET ROLE;
    RETURN json_build_object('error', json_build_object(
      'code', v_code, 'message', v_message,
      'details', NULLIF(v_detail, ''), 'hint', NULLIF(v_hint, '')))::text;
  END;
  RETURN v_out;
END;
$$;

/**
 * The live feed. Supabase Realtime reads the write-ahead log; here a trigger
 * on each table of the `supabase_realtime` publication announces the change
 * on a channel the demo's fake socket listens to. Screens only use the event
 * to refetch (src/lib/realtime.ts), so the table, the operation and the
 * restaurant are all it carries.
 */
CREATE OR REPLACE FUNCTION demo.announce_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row jsonb := to_jsonb(CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END);
BEGIN
  PERFORM pg_notify('demo_changes', json_build_object(
    't', TG_TABLE_NAME, 'e', TG_OP, 'v', v_row ->> 'venue_id', 'id', v_row ->> 'id')::text);
  RETURN NULL;
END;
$$;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS demo_announce ON public.%I', r.tablename);
    EXECUTE format(
      'CREATE TRIGGER demo_announce AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION demo.announce_change()',
      r.tablename);
  END LOOP;
END $$;
