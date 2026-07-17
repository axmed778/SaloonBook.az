-- Legal consent capture.
-- Account: salon accepts the user agreement (offer) + data-processing consent
-- at registration; marketing is opt-in. Versions kept for auditability.
ALTER TABLE "Account" ADD COLUMN "legalAcceptedAt" TIMESTAMP(3);
ALTER TABLE "Account" ADD COLUMN "offerVersion" TEXT;
ALTER TABLE "Account" ADD COLUMN "privacyVersion" TEXT;
ALTER TABLE "Account" ADD COLUMN "marketingOptIn" BOOLEAN NOT NULL DEFAULT false;

-- Appointment: customer's data-processing consent on a public self-booking.
ALTER TABLE "Appointment" ADD COLUMN "consentAt" TIMESTAMPTZ(6);
ALTER TABLE "Appointment" ADD COLUMN "consentVersion" TEXT;
