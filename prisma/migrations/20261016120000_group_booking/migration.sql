-- Group booking: one appointment for several people having the same service
-- with the same master, back to back ("3 friends, 1 h of manicure each" = one
-- 3 h booking). The booking's length and price are the per-person service
-- (+ add-ons) times this count; the buffer stays once, at the end.
--
-- Additive only, and safe to re-run. The default keeps every existing booking
-- a one-person booking.
--
-- Rollback:
--   ALTER TABLE "Appointment" DROP CONSTRAINT IF EXISTS "Appointment_peopleCount_check";
--   ALTER TABLE "Appointment" DROP COLUMN IF EXISTS "peopleCount";

ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "peopleCount" INTEGER NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Appointment_peopleCount_check'
  ) THEN
    ALTER TABLE "Appointment"
      ADD CONSTRAINT "Appointment_peopleCount_check" CHECK ("peopleCount" BETWEEN 1 AND 20);
  END IF;
END $$;
