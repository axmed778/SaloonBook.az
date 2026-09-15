-- Reception (ADMIN) and finance (FINANCE) logins, and a way to switch a login
-- off without deleting it.
--
-- Additive only, and safe to re-run: ADD VALUE and ADD COLUMN both use IF NOT
-- EXISTS (as add_start_plan does). ADD VALUE appends, matching the enum order in
-- schema.prisma. No statement here uses the new values, so they may be added
-- inside the migration's transaction.
--
-- Rollback:
--   1. Revoke all ADMIN/FINANCE logins before rolling back the code — main cannot
--      read those rows and its deleteBranch would fail on them.
--   2. ALTER TABLE "Membership" DROP COLUMN "disabledAt";
--   Enum values cannot be dropped; once no row uses them they are inert.

ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'ADMIN';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'FINANCE';

-- Set by the owner to close a login while keeping it on the books; null = active.
ALTER TABLE "Membership" ADD COLUMN IF NOT EXISTS "disabledAt" TIMESTAMPTZ(6);
