-- SalonBook.az — DISABLE Row-Level Security (full revert of rls.sql).
-- Apply ONCE against the target DB with DATABASE_URL exported:
--   npx tsx scripts/apply-sql.ts prisma/security/rls-disable.sql
--
-- WHEN YOU NEED THIS
--   Applying rls.sql is a no-op for the owner connection, so a bad deploy is
--   normally reverted by simply unsetting RLS_DATABASE_URL on the web service
--   (withTenantScope then falls back to the owner client — see
--   src/lib/prisma.ts). Reach for this file only to remove the policies
--   themselves, e.g. to rule RLS out while debugging, or before dropping the
--   salonbook_app role.
--
--   Must match the table list in rls.sql. Also clears the role-level strict
--   switch and the helper functions, so the revert leaves no half state.

DO $$
DECLARE
  t text;
  tenant_tables text[] := ARRAY[
    'Salon', 'Employee', 'Service', 'Customer', 'Appointment',
    'Notification', 'Payout', 'CustomerNote', 'UsageCounter', 'Review'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('ALTER TABLE %I NO FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I DISABLE ROW LEVEL SECURITY', t);
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'salonbook_app') THEN
    EXECUTE 'ALTER ROLE salonbook_app RESET app.rls_strict';
  END IF;
END
$$;

-- Dropped last: the policies above reference them.
DROP FUNCTION IF EXISTS app_current_salon();
DROP FUNCTION IF EXISTS app_rls_strict();
