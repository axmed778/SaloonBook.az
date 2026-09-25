-- What a subscription Payment bought: "plan" (extended currentPeriodEnd) or
-- "branches" (extra branch slots — never touched the period). Needed so that
-- deleting a mistaken payment only ever shortens the period for plan payments.
--
-- Additive only, and safe to re-run (IF NOT EXISTS; the backfill is idempotent).
--
-- Backfill: branch-slot payments were written in the same transaction as their
-- "subscription.extra_branches" AuditLog row, so both carry the transaction's
-- CURRENT_TIMESTAMP. A few seconds of slack covers any clock/precision drift.
--
-- Rollback: ALTER TABLE "Payment" DROP COLUMN IF EXISTS "purpose";

ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "purpose" TEXT NOT NULL DEFAULT 'plan';

UPDATE "Payment" p
SET "purpose" = 'branches'
WHERE p."purpose" = 'plan'
  AND EXISTS (
    SELECT 1 FROM "AuditLog" a
    WHERE a."action" = 'subscription.extra_branches'
      AND a."target" = p."subscriptionId"
      AND a."createdAt" BETWEEN p."paidAt" - INTERVAL '5 seconds'
                            AND p."paidAt" + INTERVAL '5 seconds'
  );
