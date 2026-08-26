-- SalonBook.az — indexes for query shapes Prisma's @@index cannot express, plus
-- the hot lookups the schema was missing entirely.
-- Apply AFTER `prisma migrate`:  pnpm db:indexes
-- Idempotent: safe to run repeatedly.
--
-- CONCURRENTLY on purpose: this file runs from preDeployCommand, and a plain
-- CREATE INDEX takes a lock that blocks writes to the table for its duration.
-- At today's size that is milliseconds, but the whole point of putting it here
-- rather than in a migration is that it stays safe once these tables are large.
-- CONCURRENTLY cannot run inside a transaction block, which is exactly why these
-- live here (applied statement-by-statement by scripts/apply-sql.ts) and not in
-- a Prisma migration, which wraps everything in one.
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

-- The client's visit history on the public profile page: looked up by phone
-- alone, so @@unique([salonId, phone]) cannot serve it — salonId is the leading
-- column. Public and refreshable, so it is trivially reachable traffic.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Customer_phone_idx"
  ON "Customer" ("phone");

-- Same page: that customer's appointments, newest first.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Appointment_customerId_startsAt_idx"
  ON "Appointment" ("customerId", "startsAt" DESC);

-- Service deletion checks and the per-service analytics breakdown.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Appointment_serviceId_idx"
  ON "Appointment" ("serviceId");

-- The hourly reconcile sweep: CONFIRMED appointments whose end time has passed.
-- Partial on status so the index stays small — CONFIRMED rows age out into
-- COMPLETED, so this indexes only the working set, not the whole history.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Appointment_confirmed_endsAt_idx"
  ON "Appointment" ("endsAt")
  WHERE "status" = 'CONFIRMED';
