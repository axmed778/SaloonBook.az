-- SalonBook.az — Row-Level Security tenant isolation (OPTIONAL, NOT enabled).
-- Apply MANUALLY (deliberately, not on deploy) with:  pnpm db:rls
-- Revert with:  npx tsx scripts/apply-sql.ts prisma/security/rls-disable.sql
--
-- HOW IT WORKS
--   The app sets a per-transaction setting `app.current_salon` to the caller's
--   salon id (see src/lib/tenant.ts). These policies then make every query
--   transparently scoped to that salon, so a query bug cannot leak another
--   tenant's data.
--
-- IMPORTANT — read before enabling
--   This script uses FORCE ROW LEVEL SECURITY (below), which subjects the table
--   OWNER to the policies too. Only a SUPERUSER / BYPASSRLS role bypasses them.
--   So the moment DATABASE_URL points at ANY role that lacks BYPASSRLS (even the
--   plain table owner), every read returns ZERO rows unless the caller has set
--   `app.current_salon` — which today only the booking write path does. The
--   dashboard, clients, manage flow, admin, payroll, and analytics would all
--   silently go blank. Before enabling for real: create a dedicated app role
--   AND wrap EVERY read/write path in withTenantScope (or an equivalent
--   app.current_salon setter), then point DATABASE_URL at that role.
--
--     CREATE ROLE salonbook_app LOGIN PASSWORD '...';
--     GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO salonbook_app;
--     GRANT USAGE ON SCHEMA public TO salonbook_app;
--
-- CURRENT STATUS (decision, 2026-07-08) — NOT ENABLED IN PRODUCTION.
--   Tenant isolation relies on the salonId filter applied in every query in
--   application code (RLS off). Production currently connects as a
--   superuser/BYPASSRLS role, so even if these policies are applied they do not
--   bite — but that makes applying them a latent tripwire (see IMPORTANT). This
--   file is therefore NO LONGER re-applied on deploy; run it by hand only when
--   the full switch above is ready. Kept complete so that switch stays a single,
--   deliberate step.

DO $$
DECLARE
  t text;
  -- Every table carrying tenant data. Salon is keyed by its own id; the rest by
  -- salonId. Keep in sync with the schema when a new salon-scoped table is added.
  tenant_tables text[] := ARRAY[
    'Salon', 'Employee', 'Service', 'Customer', 'Appointment',
    'Notification', 'Payout', 'CustomerNote', 'UsageCounter'
  ];
  salon_id_tables text[] := ARRAY[
    'Employee', 'Service', 'Customer', 'Appointment',
    'Notification', 'Payout', 'CustomerNote', 'UsageCounter'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
  END LOOP;

  -- Salon is keyed by its own id; the rest carry salonId.
  EXECUTE $p$
    CREATE POLICY tenant_isolation ON "Salon"
      USING (id = current_setting('app.current_salon', true))
      WITH CHECK (id = current_setting('app.current_salon', true))
  $p$;

  FOREACH t IN ARRAY salon_id_tables LOOP
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I '
      || 'USING ("salonId" = current_setting(''app.current_salon'', true)) '
      || 'WITH CHECK ("salonId" = current_setting(''app.current_salon'', true))',
      t
    );
  END LOOP;
END
$$;
