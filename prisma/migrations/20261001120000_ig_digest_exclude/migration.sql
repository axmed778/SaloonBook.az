-- "Исключить" on the Instagram digest page: a lead the founder has given up on
-- stops being sent to Claude every morning, until the lead writes again.
--
-- The column holds WHEN the lead was excluded, not a flag: a lead message newer
-- than it brings the thread back (src/lib/ig-digest.ts, isExcludedFromDigest),
-- so a lead who revives is never lost to an old click.
--
-- Additive only, and safe to re-run (IF NOT EXISTS). No backfill: NULL is
-- "included", which is every thread today. IgThread is already REVOKEd from the
-- restricted role at table level (prisma/security/rls-grants.sql), which covers
-- a new column too.
--
-- Rollback: ALTER TABLE "IgThread" DROP COLUMN IF EXISTS "digestExcludedAt";

ALTER TABLE "IgThread" ADD COLUMN IF NOT EXISTS "digestExcludedAt" TIMESTAMPTZ(6);
