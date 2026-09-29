-- In-app help: per-user guide state and guide analytics events.
--
-- Additive only, and safe to re-run (IF NOT EXISTS throughout; the foreign keys
-- are added only when missing). Both tables are keyed by user, not by salon: no
-- salonId, so no RLS policy; rls-grants.sql revokes them from salonbook_app.
--
-- Rollback: DROP TABLE IF EXISTS "GuideEvent"; DROP TABLE IF EXISTS "UserGuideState";
-- — nothing references either table.

CREATE TABLE IF NOT EXISTS "UserGuideState" (
    "userId" TEXT NOT NULL,
    "completedGuides" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "welcomeShownAt" TIMESTAMPTZ(3),
    "checklistHidden" BOOLEAN NOT NULL DEFAULT false,
    "linkCopiedAt" TIMESTAMPTZ(3),
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserGuideState_pkey" PRIMARY KEY ("userId")
);

CREATE TABLE IF NOT EXISTS "GuideEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "guideId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "step" INTEGER NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuideEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "GuideEvent_guideId_event_createdAt_idx"
    ON "GuideEvent"("guideId", "event", "createdAt");
CREATE INDEX IF NOT EXISTS "GuideEvent_userId_idx" ON "GuideEvent"("userId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'UserGuideState_userId_fkey') THEN
    ALTER TABLE "UserGuideState" ADD CONSTRAINT "UserGuideState_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'GuideEvent_userId_fkey') THEN
    ALTER TABLE "GuideEvent" ADD CONSTRAINT "GuideEvent_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;
