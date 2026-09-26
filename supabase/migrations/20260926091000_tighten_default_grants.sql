-- TIGHTEN DEFAULT GRANTS
-- A new Supabase project grants anon, authenticated and service_role every privilege on
-- every new table and function in public. Row-level security still blocks access, but
-- this removes the extra rights so protection does not rest on one layer alone.
-- (TRUNCATE in particular ignores row-level security.)

-- Signed-out visitors never touch these tables: the app only reads data once signed in.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;

-- Signed-in users never need to empty a table, add triggers or foreign keys.
REVOKE TRUNCATE, TRIGGER, REFERENCES ON ALL TABLES IN SCHEMA public FROM authenticated;

-- History is read-only for everyone in the app; only the audit trigger writes to it.
REVOKE INSERT, UPDATE, DELETE ON public.audit_log FROM authenticated;
REVOKE ALL ON SEQUENCE public.audit_log_id_seq FROM authenticated, anon;

-- Future tables and functions start closed; each migration grants what it needs.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon, public;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLES FROM authenticated;
