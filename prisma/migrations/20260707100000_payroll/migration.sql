-- PRO payroll: per-employee compensation model + payout ledger.
ALTER TABLE "Employee" ADD COLUMN "baseSalaryMinor" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Employee" ADD COLUMN "commissionPct" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "Payout" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "periodYm" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "note" TEXT,
    "paidAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payout_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Payout_salonId_periodYm_idx" ON "Payout"("salonId", "periodYm");

CREATE INDEX "Payout_employeeId_periodYm_idx" ON "Payout"("employeeId", "periodYm");

ALTER TABLE "Payout" ADD CONSTRAINT "Payout_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Payout" ADD CONSTRAINT "Payout_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
