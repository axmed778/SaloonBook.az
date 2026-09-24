-- Daily Instagram Direct digest (worker/processors/ig-digest.ts).
--
-- Additive only, and safe to re-run (IF NOT EXISTS throughout). Platform-level
-- like the other Ig* tables: no salonId, outside RLS, and REVOKEd from the
-- restricted salonbook_app role in prisma/security/rls-grants.sql.
--
-- Rollback: DROP TABLE IF EXISTS "IgDigest"; — nothing references it, and the
-- rows are regenerated every morning.

CREATE TABLE IF NOT EXISTS "IgDigest" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "items" JSONB NOT NULL,

    CONSTRAINT "IgDigest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "IgDigest_createdAt_idx" ON "IgDigest"("createdAt");
