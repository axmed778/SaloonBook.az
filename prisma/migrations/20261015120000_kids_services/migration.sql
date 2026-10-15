-- Children's services: an age axis next to the gender `audience`.
--
-- Service.forKids marks a kids' service (shown only when booking for a child).
-- Employee.worksWithKids says the master takes children; it defaults to TRUE so
-- that a salon adding its first kids' service keeps every master bookable for
-- it until the owner says otherwise. No Salon column: "does kids" and
-- "kids-only" are derived from the active services on read (src/lib/kids.ts).
--
-- Additive only, and safe to re-run (IF NOT EXISTS). The defaults leave every
-- existing salon exactly as it was: no service is a kids' service.
--
-- Rollback:
--   ALTER TABLE "Service" DROP COLUMN IF EXISTS "forKids";
--   ALTER TABLE "Employee" DROP COLUMN IF EXISTS "worksWithKids";

ALTER TABLE "Service" ADD COLUMN IF NOT EXISTS "forKids" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "worksWithKids" BOOLEAN NOT NULL DEFAULT true;
