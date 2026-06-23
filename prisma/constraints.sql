-- SalonBook.az — database guarantees Prisma's schema cannot express.
-- Apply AFTER `prisma migrate` on every environment:  pnpm db:constraints
-- Idempotent: safe to run repeatedly.

-- btree_gist lets one GiST index mix scalar equality (employeeId) with the
-- range-overlap operator (the appointment time range).
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- The core safety net: two CONFIRMED appointments for the same employee can
-- never overlap in time. Enforced by the database itself, so a race condition
-- or an application bug physically cannot create a double-booking.
ALTER TABLE "Appointment" DROP CONSTRAINT IF EXISTS appointment_no_overlap;

ALTER TABLE "Appointment"
  ADD CONSTRAINT appointment_no_overlap
  EXCLUDE USING gist (
    "employeeId" WITH =,
    tstzrange("startsAt", "endsAt") WITH &&
  )
  WHERE ("status" = 'CONFIRMED');
