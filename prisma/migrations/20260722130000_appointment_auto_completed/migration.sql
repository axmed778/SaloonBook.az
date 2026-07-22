-- Flag for the 48h reconcile fallback: a past CONFIRMED appointment the salon
-- never closed is auto-set to COMPLETED with autoCompleted=true, so revenue and
-- payroll aren't stuck at zero while the "unconfirmed" state stays visible.
ALTER TABLE "Appointment" ADD COLUMN "autoCompleted" BOOLEAN NOT NULL DEFAULT false;
