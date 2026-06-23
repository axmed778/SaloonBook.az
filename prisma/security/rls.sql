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
--   This is optional for local dev; enable it for staging/production.

DO $$
DECLARE
  t text;
  tenant_tables text[] := ARRAY['Salon', 'Employee', 'Service', 'Customer', 'Appointment'];
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

  FOREACH t IN ARRAY ARRAY['Employee', 'Service', 'Customer', 'Appointment'] LOOP
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I '
      || 'USING ("salonId" = current_setting(''app.current_salon'', true)) '
      || 'WITH CHECK ("salonId" = current_setting(''app.current_salon'', true))',
      t
    );
  END LOOP;
END
$$;
