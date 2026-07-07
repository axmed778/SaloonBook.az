-- Self-service manage token for the public /a/{token} page (view/cancel/reschedule).
ALTER TABLE "Appointment" ADD COLUMN "manageToken" TEXT;

UPDATE "Appointment" SET "manageToken" = gen_random_uuid();

ALTER TABLE "Appointment" ALTER COLUMN "manageToken" SET NOT NULL;

CREATE UNIQUE INDEX "Appointment_manageToken_key" ON "Appointment"("manageToken");
