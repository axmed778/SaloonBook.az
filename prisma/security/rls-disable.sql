-- SalonBook.az — DISABLE Row-Level Security (revert rls.sql).
-- Apply ONCE against the target DB with DATABASE_URL exported:
--   npx tsx scripts/apply-sql.ts prisma/security/rls-disable.sql
--
-- WHY
--   rls.sql was previously re-applied on every deploy and uses FORCE ROW LEVEL
--   SECURITY, which subjects even the table owner to the policies. Production is
--   unaffected today ONLY because its connection role is superuser/BYPASSRLS —
--   the instant that role loses BYPASSRLS (or DATABASE_URL is repointed at a
--   "safer" non-owner role), all reads would silently return zero rows. The
--   documented decision is app-level tenant filtering with RLS OFF, so this
--   drops the policies and clears the FORCE/ENABLE flags to defuse that trap.
--   Re-enable later — deliberately — by running rls.sql again.

DO $$
DECLARE
  t text;
  -- Must match the table list in rls.sql.
  tenant_tables text[] := ARRAY[
    'Salon', 'Employee', 'Service', 'Customer', 'Appointment',
    'Notification', 'Payout', 'CustomerNote', 'UsageCounter'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('ALTER TABLE %I NO FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I DISABLE ROW LEVEL SECURITY', t);
  END LOOP;
END
$$;
