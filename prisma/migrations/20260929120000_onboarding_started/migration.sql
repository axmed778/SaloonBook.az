-- First-run onboarding: marks the people who signed up through it.
--
-- Set at registration (src/app/api/auth/register/route.ts). The welcome dialog
-- is shown only when it is set, so accounts that existed before this shipped
-- never see it; they get the data-driven checklist alone.
--
-- Additive only, and safe to re-run (IF NOT EXISTS). No backfill on purpose:
-- NULL is exactly "existed before".
--
-- Rollback: ALTER TABLE "UserGuideState" DROP COLUMN IF EXISTS "onboardingStartedAt";

ALTER TABLE "UserGuideState" ADD COLUMN IF NOT EXISTS "onboardingStartedAt" TIMESTAMPTZ(3);
