-- SalonBook.az — privileges for the restricted RLS role.
--
-- Runs on EVERY deploy via `pnpm db:setup` (railway.json preDeployCommand), as
-- the owner, so a table added by a new migration can never end up
-- granted-but-forgotten. It is a no-op when the role does not exist — local dev,
-- CI, and production before the role is created.
--
-- CREATE THE ROLE IN SQL, NEVER VIA THE NEON CONSOLE/API/CLI. Console-created
-- Neon roles are auto-granted `neon_superuser`, which carries BYPASSRLS; the app
-- would then enforce nothing while every policy check below still looks correct.
--
--   CREATE ROLE salonbook_app LOGIN PASSWORD '<generated>'
--     NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
--
-- Verify before trusting it (both must be false):
--   SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'salonbook_app';
--   SELECT pg_has_role('salonbook_app', 'neon_superuser', 'member');

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'salonbook_app') THEN
    RAISE NOTICE 'salonbook_app absent - skipping RLS grants';
    RETURN;
  END IF;

  EXECUTE 'GRANT USAGE ON SCHEMA public TO salonbook_app';
  EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO salonbook_app';

  -- ALL TABLES only covers the tables that exist right now; this covers the
  -- next migration's. The implicit FOR ROLE is the current role, which is
  -- always the owner because migrations only ever run on DATABASE_URL.
  EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public
             GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO salonbook_app';

  -- The app must never be able to rewrite migration history.
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = '_prisma_migrations'
  ) THEN
    EXECUTE 'REVOKE ALL ON TABLE "_prisma_migrations" FROM salonbook_app';
  END IF;

  -- NOTE: there is deliberately no `ALTER ROLE salonbook_app SET
  -- app.rls_strict = 'on'` here. Setting a CUSTOM parameter that way requires a
  -- real superuser, which managed Postgres does not give you — on Neon it fails
  -- with "permission denied to set parameter" (SQLSTATE 42501), and because
  -- this is one atomic DO block, that failure would roll back the grants above
  -- too. Strict mode is instead bound to the role identity inside
  -- app_rls_strict() (prisma/security/rls.sql), which needs no special
  -- privilege and cannot be switched off from the app connection.
END
$$;
