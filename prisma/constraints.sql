-- SalonBook.az — database guarantees Prisma's schema cannot express.
-- Apply AFTER `prisma migrate` on every environment:  pnpm db:constraints
-- Idempotent AND non-destructive: safe to run repeatedly, and a re-run never
-- leaves the table unprotected even for an instant.

-- btree_gist lets one GiST index mix scalar equality (employeeId) with the
-- range-overlap operator (the appointment time range).
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- The core safety net: two CONFIRMED appointments for the same employee can
-- never overlap in time. Enforced by the database itself, so a race condition
-- or an application bug physically cannot create a double-booking.
--
-- Added only when absent. The previous DROP-then-ADD pair was idempotent but
-- destructive, and apply-sql.ts runs each statement in its own implicit
-- transaction, so the DROP committed before the ADD began. That opened three
-- holes on every single deploy, since this file runs from preDeployCommand:
--   1. a window with no double-booking protection while the app kept accepting
--      bookings;
--   2. ADD CONSTRAINT takes ACCESS EXCLUSIVE and rebuilds the GiST index from
--      scratch, blocking writes for as long as that takes;
--   3. if an overlapping pair slipped into that window, the ADD failed, the
--      deploy failed — and production stayed with NO constraint at all, quietly.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'appointment_no_overlap'
  ) THEN
    ALTER TABLE "Appointment"
      ADD CONSTRAINT appointment_no_overlap
      EXCLUDE USING gist (
        "employeeId" WITH =,
        tstzrange("startsAt", "endsAt") WITH &&
      )
      WHERE ("status" = 'CONFIRMED');
  END IF;
END $$;
