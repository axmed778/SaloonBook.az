-- CreateEnum
CREATE TYPE "Role" AS ENUM ('OWNER', 'STAFF');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "SalonStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DELETED');

-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "BookingSource" AS ENUM ('PUBLIC', 'DASHBOARD');

-- CreateEnum
CREATE TYPE "NotifStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED');

-- CreateEnum
CREATE TYPE "Plan" AS ENUM ('FREE', 'BASIC', 'PRO');

-- CreateEnum
CREATE TYPE "SubStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELLED', 'FREE_DOWNGRADED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "clerkId" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "fullName" TEXT,
    "isPlatformAdmin" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "salonId" TEXT,
    "employeeId" TEXT,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Salon" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "logoUrl" TEXT,
    "address" TEXT,
    "phone" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Baku',
    "currency" TEXT NOT NULL DEFAULT 'AZN',
    "status" "SalonStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Salon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "position" TEXT,
    "avatarUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Service" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "priceMinor" INTEGER NOT NULL,
    "durationMin" INTEGER NOT NULL,
    "bufferMin" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Service_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceEmployee" (
    "serviceId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,

    CONSTRAINT "ServiceEmployee_pkey" PRIMARY KEY ("serviceId","employeeId")
);

-- CreateTable
CREATE TABLE "WorkingHour" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "startMin" INTEGER NOT NULL,
    "endMin" INTEGER NOT NULL,

    CONSTRAINT "WorkingHour_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimeOff" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "startsAt" TIMESTAMPTZ(6) NOT NULL,
    "endsAt" TIMESTAMPTZ(6) NOT NULL,
    "reason" TEXT,

    CONSTRAINT "TimeOff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "notes" TEXT,
    "waOptIn" BOOLEAN NOT NULL DEFAULT false,
    "totalVisits" INTEGER NOT NULL DEFAULT 0,
    "lastVisitAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Appointment" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "startsAt" TIMESTAMPTZ(6) NOT NULL,
    "endsAt" TIMESTAMPTZ(6) NOT NULL,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'CONFIRMED',
    "priceMinor" INTEGER NOT NULL,
    "source" "BookingSource" NOT NULL DEFAULT 'PUBLIC',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "appointmentId" TEXT,
    "channel" TEXT NOT NULL DEFAULT 'whatsapp',
    "template" TEXT NOT NULL,
    "toPhone" TEXT NOT NULL,
    "status" "NotifStatus" NOT NULL DEFAULT 'QUEUED',
    "providerMsgId" TEXT,
    "payload" JSONB NOT NULL,
    "sendAfter" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "plan" "Plan" NOT NULL DEFAULT 'FREE',
    "status" "SubStatus" NOT NULL DEFAULT 'TRIALING',
    "trialEndsAt" TIMESTAMPTZ(6),
    "currentPeriodEnd" TIMESTAMPTZ(6),
    "providerCustomerId" TEXT,
    "providerSubId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'AZN',
    "method" TEXT NOT NULL DEFAULT 'manual',
    "recordedBy" TEXT,
    "periodMonths" INTEGER NOT NULL DEFAULT 1,
    "paidAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageCounter" (
    "salonId" TEXT NOT NULL,
    "periodYm" TEXT NOT NULL,
    "bookings" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "UsageCounter_pkey" PRIMARY KEY ("salonId","periodYm")
);

-- CreateTable
CREATE TABLE "Invite" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "grantsTrial" BOOLEAN NOT NULL DEFAULT true,
    "maxUses" INTEGER NOT NULL DEFAULT 1,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "redeemedBy" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "note" TEXT,
    "createdBy" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "accountId" TEXT,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "target" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_clerkId_key" ON "User"("clerkId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_employeeId_key" ON "Membership"("employeeId");

-- CreateIndex
CREATE INDEX "Membership_accountId_idx" ON "Membership"("accountId");

-- CreateIndex
CREATE INDEX "Membership_salonId_idx" ON "Membership"("salonId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_userId_accountId_key" ON "Membership"("userId", "accountId");

-- CreateIndex
CREATE UNIQUE INDEX "Salon_slug_key" ON "Salon"("slug");

-- CreateIndex
CREATE INDEX "Salon_accountId_idx" ON "Salon"("accountId");

-- CreateIndex
CREATE INDEX "Salon_slug_idx" ON "Salon"("slug");

-- CreateIndex
CREATE INDEX "Employee_salonId_idx" ON "Employee"("salonId");

-- CreateIndex
CREATE INDEX "Service_salonId_idx" ON "Service"("salonId");

-- CreateIndex
CREATE INDEX "ServiceEmployee_employeeId_idx" ON "ServiceEmployee"("employeeId");

-- CreateIndex
CREATE INDEX "WorkingHour_employeeId_weekday_idx" ON "WorkingHour"("employeeId", "weekday");

-- CreateIndex
CREATE INDEX "TimeOff_employeeId_startsAt_idx" ON "TimeOff"("employeeId", "startsAt");

-- CreateIndex
CREATE INDEX "Customer_salonId_idx" ON "Customer"("salonId");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_salonId_phone_key" ON "Customer"("salonId", "phone");

-- CreateIndex
CREATE INDEX "Appointment_employeeId_startsAt_endsAt_idx" ON "Appointment"("employeeId", "startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "Appointment_salonId_startsAt_idx" ON "Appointment"("salonId", "startsAt");

-- CreateIndex
CREATE INDEX "Notification_status_sendAfter_idx" ON "Notification"("status", "sendAfter");

-- CreateIndex
CREATE INDEX "Notification_salonId_idx" ON "Notification"("salonId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_accountId_key" ON "Subscription"("accountId");

-- CreateIndex
CREATE INDEX "Subscription_status_trialEndsAt_idx" ON "Subscription"("status", "trialEndsAt");

-- CreateIndex
CREATE INDEX "Payment_subscriptionId_idx" ON "Payment"("subscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "Invite_code_key" ON "Invite"("code");

-- CreateIndex
CREATE INDEX "AuditLog_accountId_createdAt_idx" ON "AuditLog"("accountId", "createdAt");

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Salon" ADD CONSTRAINT "Salon_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Service" ADD CONSTRAINT "Service_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceEmployee" ADD CONSTRAINT "ServiceEmployee_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceEmployee" ADD CONSTRAINT "ServiceEmployee_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkingHour" ADD CONSTRAINT "WorkingHour_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeOff" ADD CONSTRAINT "TimeOff_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
