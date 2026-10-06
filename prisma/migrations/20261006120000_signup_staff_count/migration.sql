-- How many masters the owner reported at registration.
--
-- Set at registration (src/app/api/auth/register/route.ts), where it also picks
-- the tier the no-card trial starts on (trialPlanForStaff in src/lib/plans.ts).
-- Stored so that choice stays explainable afterwards — the onboarding copy and
-- the admin panel say which tier the salon is trialling and why.
--
-- Additive only, and safe to re-run (IF NOT EXISTS). No backfill on purpose:
-- NULL is exactly "registered before the question existed".
--
-- Rollback: ALTER TABLE "Account" DROP COLUMN IF EXISTS "signupStaffCount";

ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "signupStaffCount" INTEGER;
