-- SalonBook.az — Row-Level Security tenant isolation.
-- Apply MANUALLY (deliberately, not on deploy) with:  pnpm db:rls
-- Revert with:  npx tsx scripts/apply-sql.ts prisma/security/rls-disable.sql
--
-- HOW IT WORKS
--   withTenantScope (src/lib/tenant.ts) opens a transaction and sets the
--   per-transaction setting `app.current_salon` to the caller's salon id. These
--   policies then scope every query in that transaction to that salon, so a
--   missing `where: { salonId }` returns zero rows instead of another tenant's
--   data.
--
-- WHY THIS FILE IS SAFE TO APPLY (changed 2026-08-13)
--   Deny-when-unset is keyed to the ROLE, not to the policy. Only connections
--   authenticated as `salonbook_app` are denied rows when `app.current_salon`
--   is unset (see app_rls_strict() below). For the owner role (migrations, the
--   worker, the admin panel, and every query NOT routed through
--   withTenantScope) both policy branches are permissive, so applying this file
--   is a NO-OP for it, with or without BYPASSRLS.
--
--   The previous version of this file keyed denial to "is the GUC set", which
--   made it a latent tripwire: the moment DATABASE_URL pointed at any role
--   lacking BYPASSRLS, every unscoped read returned ZERO rows and the whole
--   dashboard silently went blank. That trap is gone.
--
-- WHAT IS ACTUALLY ENFORCED
--   Enforcement follows the connection, and only `withTenantScope` uses the
--   restricted client (`prismaRls`, src/lib/prisma.ts). Every other query in the
--   app keeps the owner connection and gets NO database-level tenant
--   enforcement. "Policies exist" and "the database enforces tenancy" are not
--   the same statement here — see the security section of README.md for the
--   current enforced surface, and rls-strict.sql for the path to the strict
--   end-state.

-- NULLIF is load-bearing. After a transaction that ran
-- set_config('app.current_salon', X, true) commits, Postgres leaves the
-- placeholder GUC defined on that session with a reset value of the EMPTY
-- STRING rather than NULL. A bare `IS NULL` test would then deny unscoped
-- queries on whichever pooled connection happened to serve them — blank pages
-- for some requests, no error anywhere. Collapsing '' and unset into one case
-- makes the policy correct under both behaviours.
CREATE OR REPLACE FUNCTION app_current_salon() RETURNS text
  LANGUAGE sql STABLE PARALLEL SAFE AS
$fn$ SELECT NULLIF(current_setting('app.current_salon', true), '') $fn$;

-- Strict mode is bound to the role IDENTITY, not to a settable parameter.
--
-- The obvious alternative — `ALTER ROLE salonbook_app SET app.rls_strict='on'`
-- — does not work on managed Postgres: setting a CUSTOM (placeholder) GUC that
-- way requires a real superuser, and Neon's `neondb_owner` is only a member of
-- `neon_superuser`, so it fails with "permission denied to set parameter"
-- (SQLSTATE 42501).
--
-- Binding to current_user is also strictly stronger. A role-level GUC could be
-- turned off for a session by anyone holding the credentials
-- (`SET app.rls_strict='off'`), which made it a guard against our own missing
-- `where: { salonId }` but not against a leaked password. This cannot be turned
-- off from the app connection at all: salonbook_app is created NOCREATEROLE
-- with no role memberships, so it has nothing to SET ROLE to.
--
-- Emergency SQL-level disable (the normal rollback is unsetting
-- RLS_DATABASE_URL, which needs no database change at all):
--   CREATE OR REPLACE FUNCTION app_rls_strict() RETURNS boolean
--     LANGUAGE sql STABLE PARALLEL SAFE AS $x$ SELECT false $x$;
CREATE OR REPLACE FUNCTION app_rls_strict() RETURNS boolean
  LANGUAGE sql STABLE PARALLEL SAFE AS
$fn$ SELECT current_user = 'salonbook_app' $fn$;

DO $$
DECLARE
  t text;
  -- Every table carrying tenant data. Salon is keyed by its own id; the rest by
  -- salonId. Keep in sync with the schema when a new salon-scoped table is
  -- added — the drift assertion in src/lib/tenant.rls.test.ts fails CI if you
  -- forget.
  --
  -- DELIBERATELY EXEMPT, each for a reason:
  --   WhatsAppSender   — admin/worker/billing managed, accessed outside
  --                      withTenantScope, and holds an encrypted secret
  --                      (schema.prisma:423). Protected by encryption, not RLS.
  --   PushSubscription — keyed by a globally-unique push endpoint by design.
  --   Membership       — salonId is NULLABLE (schema.prisma:75): OWNER rows
  --                      carry NULL, so a salonId-keyed policy would hide every
  --                      owner from getSession(). Account-scoped, not salon-scoped.
  --   WorkingHour, TimeOff, ServiceEmployee — no salonId column at all; they
  --                      hang off employeeId/serviceId. Would need a
  --                      denormalizing migration first.
  --   Account, Subscription, Payment, Invite, AuditLog — account-scoped; a
  --                      single-valued app.current_salon cannot express them.
  --   User, PasswordResetToken, Client — not tenant data.
  tenant_tables text[] := ARRAY[
    'Salon', 'Employee', 'Service', 'Customer', 'Appointment',
    'Notification', 'Payout', 'CustomerNote', 'UsageCounter', 'Review'
  ];
  salon_id_tables text[] := ARRAY[
    'Employee', 'Service', 'Customer', 'Appointment',
    'Notification', 'Payout', 'CustomerNote', 'UsageCounter', 'Review'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
  END LOOP;

  -- The (SELECT ...) wrappers make the planner evaluate each helper once per
  -- query as an InitPlan instead of once per row.
  EXECUTE $p$
    CREATE POLICY tenant_isolation ON "Salon"
      USING (id = (SELECT app_current_salon())
             OR ((SELECT app_current_salon()) IS NULL AND NOT (SELECT app_rls_strict())))
      WITH CHECK (id = (SELECT app_current_salon())
             OR ((SELECT app_current_salon()) IS NULL AND NOT (SELECT app_rls_strict())))
  $p$;

  FOREACH t IN ARRAY salon_id_tables LOOP
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I '
      || 'USING ("salonId" = (SELECT app_current_salon()) '
      || '  OR ((SELECT app_current_salon()) IS NULL AND NOT (SELECT app_rls_strict()))) '
      || 'WITH CHECK ("salonId" = (SELECT app_current_salon()) '
      || '  OR ((SELECT app_current_salon()) IS NULL AND NOT (SELECT app_rls_strict())))',
      t
    );
  END LOOP;
END
$$;
