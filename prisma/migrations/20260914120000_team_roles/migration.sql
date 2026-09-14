-- Reception (ADMIN) and finance (FINANCE) logins, and a way to switch a login
-- off without deleting it.
--
-- Additive only. ADD VALUE appends, matching the enum order in schema.prisma, and
-- IF NOT EXISTS keeps a re-run safe (as in add_start_plan). No statement here
-- uses the new values, so they may be added inside the migration's transaction.
--
-- Rollback: DROP the column. Enum values cannot be dropped; unused ones are inert.
--   ALTER TABLE "Membership" DROP COLUMN "disabledAt";

ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'ADMIN';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'FINANCE';

-- Set by the owner to close a login while keeping it on the books; null = active.
ALTER TABLE "Membership" ADD COLUMN "disabledAt" TIMESTAMPTZ(6);
