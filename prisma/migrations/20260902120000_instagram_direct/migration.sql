-- Instagram Direct (Instagram API with Instagram Login).
--
-- Additive: three new tables, no changes to existing ones, so this is safe to
-- apply ahead of the code that reads them.
--
-- Not tenant-scoped — there is one Instagram account per deployment, not one
-- per salon — so no salonId and no RLS policy. prisma/security/rls-grants.sql
-- REVOKEs all three from the restricted salonbook_app role instead: it holds
-- the platform's Instagram token and every lead's DM history, and nothing the
-- RLS role serves needs either.

CREATE TABLE "IgThread" (
    "id" TEXT NOT NULL,
    "igUserId" TEXT NOT NULL,
    "username" TEXT,
    "name" TEXT,
    "phone" TEXT,
    "lastMessageAt" TIMESTAMPTZ(6),
    "lastSender" TEXT,
    "stage" TEXT NOT NULL DEFAULT 'new',

    CONSTRAINT "IgThread_pkey" PRIMARY KEY ("id")
);

-- id is Instagram's message id (mid); that is what makes a webhook retry or a
-- re-run of scripts/ig-backfill.ts an upsert instead of a duplicate.
CREATE TABLE "IgMessage" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "fromMe" BOOLEAN NOT NULL,
    "text" TEXT,
    "attach" JSONB,
    "sentAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "IgMessage_pkey" PRIMARY KEY ("id")
);

-- Single row (id = 'default') holding the live long-lived token. See
-- src/lib/ig-token.ts for why the env var alone cannot work: refreshing a
-- 60-day token returns a new string, and nothing can write it back to Railway.
CREATE TABLE "IgToken" (
    "id" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(6),
    "refreshedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "IgToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IgThread_igUserId_key" ON "IgThread"("igUserId");
CREATE INDEX "IgThread_lastMessageAt_idx" ON "IgThread"("lastMessageAt");
CREATE INDEX "IgMessage_threadId_sentAt_idx" ON "IgMessage"("threadId", "sentAt");

ALTER TABLE "IgMessage" ADD CONSTRAINT "IgMessage_threadId_fkey"
    FOREIGN KEY ("threadId") REFERENCES "IgThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
