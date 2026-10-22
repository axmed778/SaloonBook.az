-- Sales agents and referral codes: who brought a salon in, and whether the
-- agent's one-off reward (paid only after the salon pays) has been paid out.
--
-- Additive only, and safe to re-run.
--
-- Rollback:
--   ALTER TABLE "Account" DROP CONSTRAINT IF EXISTS "Account_agentId_fkey";
--   ALTER TABLE "Account" DROP COLUMN IF EXISTS "agentId",
--     DROP COLUMN IF EXISTS "agentRewardPaidAt", DROP COLUMN IF EXISTS "agentRewardMinor";
--   DROP TABLE IF EXISTS "Agent";

CREATE TABLE IF NOT EXISTS "Agent" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Agent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Agent_code_key" ON "Agent"("code");

ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "agentId" TEXT;
ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "agentRewardPaidAt" TIMESTAMPTZ(6);
ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "agentRewardMinor" INTEGER;

CREATE INDEX IF NOT EXISTS "Account_agentId_idx" ON "Account"("agentId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Account_agentId_fkey') THEN
    ALTER TABLE "Account" ADD CONSTRAINT "Account_agentId_fkey"
      FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
