-- Append-only journal of legal-document acceptances.
--
-- Account.offerVersion / privacyVersion and Client.consentVersion hold only the
-- CURRENT version, so re-accepting a new revision would overwrite the proof that
-- the party ever accepted the previous one. This table keeps every acceptance;
-- the columns above stay as a denormalized "current version" for the gate check.
CREATE TABLE "LegalConsent" (
    "id" TEXT NOT NULL,
    "accountId" TEXT,
    "clientId" TEXT,
    "doc" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "acceptedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LegalConsent_pkey" PRIMARY KEY ("id"),
    -- Exactly one subject: a partner account or a booking client, never both.
    CONSTRAINT "LegalConsent_subject_check"
        CHECK (("accountId" IS NULL) <> ("clientId" IS NULL))
);

CREATE INDEX "LegalConsent_accountId_doc_acceptedAt_idx"
    ON "LegalConsent"("accountId", "doc", "acceptedAt");
CREATE INDEX "LegalConsent_clientId_doc_acceptedAt_idx"
    ON "LegalConsent"("clientId", "doc", "acceptedAt");

ALTER TABLE "LegalConsent" ADD CONSTRAINT "LegalConsent_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LegalConsent" ADD CONSTRAINT "LegalConsent_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: consents already recorded on Account/Client become the first journal
-- entries, so history does not start empty at the moment this ships. Rows with a
-- NULL version predate consent capture and are skipped (nothing to prove).
INSERT INTO "LegalConsent" ("id", "accountId", "doc", "version", "acceptedAt")
SELECT gen_random_uuid()::text, "id", 'salonOffer', "offerVersion",
       COALESCE("legalAcceptedAt", "createdAt")
FROM "Account" WHERE "offerVersion" IS NOT NULL;

INSERT INTO "LegalConsent" ("id", "accountId", "doc", "version", "acceptedAt")
SELECT gen_random_uuid()::text, "id", 'salonConsents', "privacyVersion",
       COALESCE("legalAcceptedAt", "createdAt")
FROM "Account" WHERE "privacyVersion" IS NOT NULL;

INSERT INTO "LegalConsent" ("id", "clientId", "doc", "version", "acceptedAt")
SELECT gen_random_uuid()::text, "id", 'clientConsents', "consentVersion",
       COALESCE("consentAt", "createdAt")
FROM "Client" WHERE "consentVersion" IS NOT NULL;
