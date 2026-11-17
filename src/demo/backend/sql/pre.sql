-- Demo mode only (src/demo). Applied to the in-browser PostgreSQL after the
-- test shim (supabase/tests/harness/00_shim.sql) and BEFORE the migrations.
--
-- A Supabase project grants its API roles everything on new objects in
-- `public` and leaves the gating to row level security; the migrations assume
-- that and only REVOKE what must be closed. The shim alone leaves anon and
-- authenticated without any table privilege, so nothing would be readable.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;

-- What the demo's sign-in needs to know about an account.
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS demo_password text;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS raw_user_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb;

-- On Supabase pgcrypto lives in the `extensions` schema, and the PIN functions
-- name it there (extensions.crypt). Here it is installed in `public`.
CREATE OR REPLACE FUNCTION extensions.gen_salt(text) RETURNS text LANGUAGE sql AS 'SELECT public.gen_salt($1)';
CREATE OR REPLACE FUNCTION extensions.gen_salt(text, integer) RETURNS text LANGUAGE sql AS 'SELECT public.gen_salt($1, $2)';
CREATE OR REPLACE FUNCTION extensions.crypt(text, text) RETURNS text LANGUAGE sql AS 'SELECT public.crypt($1, $2)';
CREATE OR REPLACE FUNCTION extensions.gen_random_bytes(integer) RETURNS bytea LANGUAGE sql AS 'SELECT public.gen_random_bytes($1)';
CREATE OR REPLACE FUNCTION extensions.digest(text, text) RETURNS bytea LANGUAGE sql AS 'SELECT public.digest($1, $2)';
GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role;
