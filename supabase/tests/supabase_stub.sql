-- Minimal stand-in for the parts of Supabase the migrations use, so they can run on a
-- plain Postgres (locally or in CI). Never run this against a real Supabase project.

-- Roles belong to the whole server, not one database, so they may already exist
-- from an earlier run.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
END;
$$;

CREATE SCHEMA auth;
CREATE SCHEMA storage;
GRANT USAGE ON SCHEMA public, auth, storage TO anon, authenticated, service_role;

CREATE TABLE auth.users (
  id uuid PRIMARY KEY,
  email text,
  aud text,
  role text,
  instance_id uuid
);

-- Same definition as Supabase: the user id comes from the request's JWT claims.
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

CREATE TABLE storage.buckets (
  id text PRIMARY KEY,
  name text,
  public boolean,
  file_size_limit bigint,
  allowed_mime_types text[]
);
CREATE TABLE storage.objects (id uuid DEFAULT gen_random_uuid(), bucket_id text, name text);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT string_to_array(name, '/')
$$;

CREATE SCHEMA supabase_migrations;
CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY, statements text[], name text);

-- ---------------------------------------------------------------------------
-- Test helpers. Each test file runs inside a transaction that is rolled back.
-- ---------------------------------------------------------------------------
CREATE SCHEMA tests;
GRANT USAGE ON SCHEMA tests TO anon, authenticated;

-- Act as a signed-in user for the rest of the transaction (null = signed out).
CREATE FUNCTION tests.as_user(_user_id uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', coalesce(_user_id::text, ''), true);
$$;

-- Create a Supabase user. Run as the table owner (before SET ROLE).
CREATE FUNCTION tests.create_user(_user_id uuid, _email text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO auth.users (id, email, aud, role) VALUES (_user_id, _email, 'authenticated', 'authenticated');
$$;

CREATE FUNCTION tests.eq(_label text, _got anyelement, _expected anyelement) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF _got IS DISTINCT FROM _expected THEN
    RAISE EXCEPTION 'FAIL %: got %, expected %', _label, _got, _expected;
  END IF;
  RAISE NOTICE 'ok   %', _label;
END;
$$;

-- The statement must fail; optionally its error message must contain _expect.
CREATE FUNCTION tests.fails(_label text, _sql text, _expect text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE _sql;
  EXCEPTION WHEN OTHERS THEN
    IF _expect IS NOT NULL AND position(lower(_expect) IN lower(SQLERRM)) = 0 THEN
      RAISE EXCEPTION 'FAIL %: failed with the wrong error: %', _label, SQLERRM;
    END IF;
    RAISE NOTICE 'ok   % (refused: %)', _label, SQLERRM;
    RETURN;
  END;
  RAISE EXCEPTION 'FAIL %: statement succeeded but should have been refused', _label;
END;
$$;

-- Run a statement and return how many rows it touched (e.g. 0 when RLS hides them).
CREATE FUNCTION tests.rows(_sql text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE
  _n bigint;
BEGIN
  EXECUTE _sql;
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END;
$$;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA tests TO anon, authenticated;
