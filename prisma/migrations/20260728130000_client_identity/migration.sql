-- Public, phone-authed consumer identity (booking clients). Created on first
-- successful OTP verification; keyed by phone. Not a tenant table.
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT,
    "consentAt" TIMESTAMPTZ(6),
    "consentVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" TIMESTAMPTZ(6),

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Client_phone_key" ON "Client"("phone");
