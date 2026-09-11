-- Service add-ons ("French +5 ₼", "Nail art +3 ₼"): optional extras a customer
-- picks on top of a main service, priced and timed on their own.
--
-- Additive: three new tables, nothing existing is altered, so this is safe to
-- apply ahead of the code that reads them.
--
-- Tenant-scoped. The RLS policies live in prisma/security/rls.sql (ServiceAddon
-- and AppointmentAddon by salonId, the link table through both parents) and are
-- NOT created here: that file owns the helper functions they call, and it is
-- applied by hand, not by migrate. Until it is re-applied the new tables are
-- plain tables — readable, like before RLS existed — not broken ones.
--
-- The CHECKs are here rather than in prisma/checks.sql because the tables are
-- new: there is no existing row a constraint could fail on, so they can ship
-- with the table instead of being bolted on afterwards.

-- CreateTable
CREATE TABLE "ServiceAddon" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priceMinor" INTEGER NOT NULL,
    "durationMin" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceAddon_pkey" PRIMARY KEY ("id"),
    -- Zero price is legal (a free extra); zero minutes is the common case (the
    -- extra fits inside the main service's time).
    CONSTRAINT service_addon_price_nonneg CHECK ("priceMinor" >= 0),
    CONSTRAINT service_addon_duration_nonneg CHECK ("durationMin" >= 0)
);

-- CreateTable
CREATE TABLE "ServiceAddonLink" (
    "serviceId" TEXT NOT NULL,
    "addonId" TEXT NOT NULL,

    CONSTRAINT "ServiceAddonLink_pkey" PRIMARY KEY ("serviceId","addonId")
);

-- CreateTable
CREATE TABLE "AppointmentAddon" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "addonId" TEXT,
    "name" TEXT NOT NULL,
    "priceMinor" INTEGER NOT NULL,
    "durationMin" INTEGER NOT NULL,

    CONSTRAINT "AppointmentAddon_pkey" PRIMARY KEY ("id"),
    -- Same floor as the catalog row it is copied from: payroll sums these.
    CONSTRAINT appointment_addon_price_nonneg CHECK ("priceMinor" >= 0),
    CONSTRAINT appointment_addon_duration_nonneg CHECK ("durationMin" >= 0)
);

-- CreateIndex
CREATE INDEX "ServiceAddon_salonId_idx" ON "ServiceAddon"("salonId");

-- CreateIndex
CREATE INDEX "ServiceAddonLink_addonId_idx" ON "ServiceAddonLink"("addonId");

-- CreateIndex
CREATE INDEX "AppointmentAddon_appointmentId_idx" ON "AppointmentAddon"("appointmentId");

-- CreateIndex
CREATE INDEX "AppointmentAddon_addonId_idx" ON "AppointmentAddon"("addonId");

-- CreateIndex
CREATE INDEX "AppointmentAddon_salonId_idx" ON "AppointmentAddon"("salonId");

-- AddForeignKey
ALTER TABLE "ServiceAddon" ADD CONSTRAINT "ServiceAddon_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceAddonLink" ADD CONSTRAINT "ServiceAddonLink_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceAddonLink" ADD CONSTRAINT "ServiceAddonLink_addonId_fkey" FOREIGN KEY ("addonId") REFERENCES "ServiceAddon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppointmentAddon" ADD CONSTRAINT "AppointmentAddon_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppointmentAddon" ADD CONSTRAINT "AppointmentAddon_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppointmentAddon" ADD CONSTRAINT "AppointmentAddon_addonId_fkey" FOREIGN KEY ("addonId") REFERENCES "ServiceAddon"("id") ON DELETE SET NULL ON UPDATE CASCADE;
