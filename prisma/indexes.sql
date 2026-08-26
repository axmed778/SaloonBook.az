-- SalonBook.az — indexes Prisma's @@index cannot express.
-- Apply AFTER `prisma migrate`:  pnpm db:indexes
-- Idempotent: safe to run repeatedly.
--
-- Only PARTIAL indexes live here. Anything Prisma can express belongs in
-- schema.prisma, where a normal migration creates it — keeping it here instead
-- makes `prisma migrate dev` report permanent phantom drift and offer to reset
-- the database, which is a trap for the next person to touch the schema.
-- Prisma's drift detection ignores partial indexes, so these three are invisible
-- to it and safe to own out here.
--
-- CONCURRENTLY on purpose: this file runs from preDeployCommand, and a plain
-- CREATE INDEX takes a lock that blocks writes to the table for its duration. At
-- today's size that is milliseconds, but it stays safe once these tables are
-- large. CONCURRENTLY cannot run inside a transaction block, which is the other
-- reason these are applied statement-by-statement by scripts/apply-sql.ts rather
-- than by a Prisma migration, which wraps everything in one.
--
-- GOTCHA: a CONCURRENTLY build that fails midway leaves an INVALID index behind,
-- and `IF NOT EXISTS` then treats it as present and never retries. After a failed
-- deploy, check for invalid leftovers and drop them before re-running:
--   SELECT c.relname FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
--   WHERE NOT i.indisvalid AND c.relkind = 'i';

-- Meta delivery/read callbacks look a notification up by its wamid. Without this
-- every callback sequentially scans Notification — and one booking produces up to
-- nine callbacks (confirmation + reminder, each with sent/delivered/read).
-- Partial: providerMsgId is NULL until the worker actually sends.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Notification_providerMsgId_idx"
  ON "Notification" ("providerMsgId")
  WHERE "providerMsgId" IS NOT NULL;

-- Cascade path when an appointment is deleted (deleteCustomer, deleteBranch),
-- and the notification list for one appointment.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Notification_appointmentId_idx"
  ON "Notification" ("appointmentId")
  WHERE "appointmentId" IS NOT NULL;

-- The hourly reconcile sweep: CONFIRMED appointments whose end time has passed.
-- Partial on status so the index stays small — CONFIRMED rows age out into
-- COMPLETED, so this indexes only the working set, not the whole history.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Appointment_confirmed_endsAt_idx"
  ON "Appointment" ("endsAt")
  WHERE "status" = 'CONFIRMED';
