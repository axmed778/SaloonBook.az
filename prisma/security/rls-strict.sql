-- SalonBook.az — STRICT tenant isolation, one table at a time. NOT WIRED TO ANY
-- npm SCRIPT ON PURPOSE. Apply deliberately, per table, with:
--   npx tsx scripts/apply-sql.ts prisma/security/rls-strict.sql
--
-- WHAT "STRICT" MEANS HERE
--   rls.sql gives every table a policy with a permissive branch: when
--   `app.current_salon` is unset AND the role is not marked strict, the row is
--   visible. That is what makes rls.sql a no-op for the owner connection and
--   therefore safe to run on a live app.
--
--   This file removes the permissive branch for the tables you list below. From
--   then on, EVERY connection — owner included, migrations included, the worker
--   included — sees zero rows in that table unless it has set
--   `app.current_salon`. Only a SUPERUSER/BYPASSRLS role still bypasses.
--
--   That is the real end-state, and it is irreversible-in-practice during an
--   incident: get it wrong and the affected screens go blank with HTTP 200 and
--   no error to alert on. Revert is `pnpm db:rls` (which recreates the
--   permissive policy for every table).
--
-- READINESS CHECKLIST — a table is ready only when ALL of these hold:
--   1. Every call site touching it is listed in the inventory below and is
--      routed through withTenantScope on prismaRls.
--   2. src/lib/tenant.rls.test.ts passes for it against a NOBYPASSRLS role.
--   3. No worker job, admin screen, public-discovery query, or migration reads
--      or writes it outside a scope.
--   4. You have checked that a zero-row result on that table FAILS CLOSED in the
--      app. This is the one people miss: availability.ts reads an empty overlap
--      result as "slot is free", so making Appointment strict before threading
--      salonId through getAvailableSlots/isSlotBookable converts a silent RLS
--      denial into DOUBLE BOOKINGS.
--
-- MIGRATION ORDER (verified against the 2026-08-13 call-site inventory; the
-- numbers are the paths that must be closed first):
--   1. CustomerNote — ZERO blockers. 6 sites: dashboard/clients/actions.ts
--      111/150/163/224, dashboard/clients/[id]/page.tsx:110,
--      dashboard/settings/actions.ts:361. Private notes about clients: the
--      highest sensitivity per byte in the product. Do this one first.
--   2. Payout — ZERO blockers. 5 sites: dashboard/payroll/actions.ts 86/110,
--      dashboard/payroll/page.tsx:103, dashboard/clients/actions.ts:205,
--      dashboard/settings/actions.ts:362. Salary and commission data.
--      Note settings/actions.ts:357's branch-delete transaction keys on the
--      BRANCH id — wrap it as withTenantScope(branchId, ...).
--   3. UsageCounter — 1 blocker: dashboard/admin/page.tsx:69 reads it
--      platform-wide. Needs an admin bypass role or a policy carve-out.
--   4. Customer — 2 blockers: the WhatsApp STOP handler
--      (api/webhooks/whatsapp/route.ts:112) is deliberately global by phone (a
--      Meta obligation), and the client profile history is phone-keyed across
--      every salon a client has visited.
--   5. Notification — blockers: the wamid-only fallback at
--      api/webhooks/whatsapp/route.ts:152, and the entire worker/ tree.
--   6. Appointment — hardest. 3 blockers: the manage-token read (salonId is an
--      OUTPUT of the query, not an input), the client profile history, and
--      availability.ts 121/180 which take no salonId and fail OPEN (see item 4
--      of the checklist).
--   7. Employee / Service / Salon — Phase 3. Public booking and discovery need
--      cross-tenant reads, so these need command-split policies instead:
--        CREATE POLICY tenant_read ON "Salon" FOR SELECT
--          USING (status = 'ACTIVE'
--                 OR id = (SELECT app_current_salon())
--                 OR "accountId" = (SELECT app_current_account()));
--      with INSERT/UPDATE/DELETE staying salon-keyed. That single clause
--      unblocks slug resolution, the discovery map, the sitemap,
--      opengraph-image AND getSession()'s nested ACTIVE read — with no bypass
--      role at all. It needs a second GUC (app.current_account).
--
--   Phase 3 (repointing the MAIN DATABASE_URL at salonbook_app) additionally
--   requires: `directUrl = env("MIGRATE_DATABASE_URL")` on the datasource,
--   scripts/apply-sql.ts building its own client from that URL instead of
--   importing the shared singleton, and a prismaAdmin module with a fixed
--   export surface for the by-design cross-tenant paths. Without those,
--   railway.json's `preDeployCommand: pnpm db:setup` fails on the next deploy —
--   `prisma migrate deploy` and prisma/constraints.sql both need DDL rights.

DO $$
DECLARE
  t text;
  -- ADD ONE TABLE AT A TIME, in the order above, only when the checklist holds.
  -- Empty by default: running this file as-is does nothing.
  strict_tables text[] := ARRAY[]::text[];
BEGIN
  IF array_length(strict_tables, 1) IS NULL THEN
    RAISE NOTICE 'strict_tables is empty - nothing to do';
    RETURN;
  END IF;

  FOREACH t IN ARRAY strict_tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    -- No permissive branch: the salonId must match, full stop.
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I '
      || 'USING ("salonId" = (SELECT app_current_salon())) '
      || 'WITH CHECK ("salonId" = (SELECT app_current_salon()))',
      t
    );
    RAISE NOTICE 'STRICT: %', t;
  END LOOP;
END
$$;
