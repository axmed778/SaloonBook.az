-- Timestamped private CRM notes per customer.
CREATE TABLE "CustomerNote" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerNote_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CustomerNote_customerId_createdAt_idx" ON "CustomerNote"("customerId", "createdAt");

CREATE INDEX "CustomerNote_salonId_idx" ON "CustomerNote"("salonId");

ALTER TABLE "CustomerNote" ADD CONSTRAINT "CustomerNote_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CustomerNote" ADD CONSTRAINT "CustomerNote_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Preserve anything already stored in the legacy Customer.notes column.
INSERT INTO "CustomerNote" ("id", "salonId", "customerId", "body", "createdAt")
SELECT gen_random_uuid(), "salonId", "id", "notes", CURRENT_TIMESTAMP
FROM "Customer"
WHERE "notes" IS NOT NULL AND btrim("notes") <> '';
