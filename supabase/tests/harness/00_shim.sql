-- Minimal stand-in for the Supabase-managed parts of a project database, so
-- the migrations in supabase/migrations can be applied to a plain PostgreSQL
-- instance and exercised by the integration suite.
--
-- This file is TEST-ONLY. It is never applied to a real environment (it lives
-- outside supabase/migrations for exactly that reason).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Supabase's API roles.
DO $$ BEGIN CREATE ROLE anon NOLOGIN NOINHERIT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN NOINHERIT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- auth schema: just enough of it.
CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text
);

/**
 * Test double for auth.uid(). Supabase derives it from the request JWT; here a
 * test sets `request.jwt.claim.sub` with set_config() to impersonate a user.
 */
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

-- storage schema: the migrations only DROP POLICY ... IF EXISTS on it.
CREATE SCHEMA IF NOT EXISTS storage;
CREATE TABLE IF NOT EXISTS storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text,
  name text,
  owner uuid
);
CREATE TABLE IF NOT EXISTS storage.buckets (
  id text PRIMARY KEY,
  name text,
  public boolean NOT NULL DEFAULT false
);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- Realtime publication.
DO $$ BEGIN
  CREATE PUBLICATION supabase_realtime;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- `extensions` schema is referenced by a couple of the historical migrations.
CREATE SCHEMA IF NOT EXISTS extensions;
