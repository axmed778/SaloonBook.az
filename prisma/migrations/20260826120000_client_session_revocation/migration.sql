-- Client session revocation + the indexes Prisma owns.
--
-- Client had no revocation mechanism at all: no equivalent of
-- User.sessionsValidFrom, and clients have no password to reset, so a client
-- cookie could not be invalidated by any means. Logout now bumps this, and
-- getClientSession rejects anything issued before it.
ALTER TABLE "Client" ADD COLUMN "sessionsValidFrom" TIMESTAMPTZ(6);

-- These three are also created by prisma/indexes.sql on environments that ran it
-- before this migration existed, hence IF NOT EXISTS. They have since moved into
-- schema.prisma so that `prisma migrate dev` stops seeing them as drift; the
-- partial indexes that Prisma cannot express stay in indexes.sql.
CREATE INDEX IF NOT EXISTS "Appointment_customerId_startsAt_idx"
  ON "Appointment"("customerId", "startsAt" DESC);
CREATE INDEX IF NOT EXISTS "Appointment_serviceId_idx" ON "Appointment"("serviceId");
CREATE INDEX IF NOT EXISTS "Customer_phone_idx" ON "Customer"("phone");
