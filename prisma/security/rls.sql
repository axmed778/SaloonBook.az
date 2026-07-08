-- SalonBook.az — Row-Level Security tenant isolation (optional, recommended).
-- Apply with:  pnpm db:rls
--
-- HOW IT WORKS
--   The app sets a per-transaction setting `app.current_salon` to the caller's
--   salon id (see src/lib/tenant.ts). These policies then make every query
--   transparently scoped to that salon, so a query bug cannot leak another
--   tenant's data.
--
-- IMPORTANT
--   RLS is bypassed by the table OWNER and by superusers. For RLS to actually
--   bite, the application must connect as a NON-owner role. Create one, e.g.:
--
--     CREATE ROLE salonbook_app LOGIN PASSWORD '...';
--     GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO salonbook_app;
--     GRANT USAGE ON SCHEMA public TO salonbook_app;
--
--   ...and point DATABASE_URL at that role. Run migrations as the owner.
--
-- CURRENT STATUS (decision, 2026-07-08) — NOT ENABLED IN PRODUCTION.
--   The app connects as the DB owner, so these policies do not bite; tenant
--   isolation currently relies on the salonId filter applied in every query in
--   application code. Only the booking write path sets `app.current_salon` (via
--   withTenantScope, src/lib/tenant.ts). DO NOT point DATABASE_URL at a non-owner
--   role until withTenantScope (or an equivalent app.current_salon setter) wraps
--   EVERY read/write path — otherwise the dashboard, clients, manage flow, admin,
--   payroll, and analytics would all silently return zero rows. This file is kept
--   complete and correct so enabling RLS later is a single, safe switch.

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
