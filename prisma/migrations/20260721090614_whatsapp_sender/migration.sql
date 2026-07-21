-- CreateEnum
CREATE TYPE "WhatsAppSenderStatus" AS ENUM ('PLATFORM_DEFAULT', 'PENDING', 'ACTIVE', 'DISABLED');

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "phoneNumberId" TEXT;

-- CreateTable
CREATE TABLE "WhatsAppSender" (
    "salonId" TEXT NOT NULL,
    "status" "WhatsAppSenderStatus" NOT NULL DEFAULT 'PLATFORM_DEFAULT',
    "phoneNumberId" TEXT,
    "wabaId" TEXT,
    "accessTokenEnc" TEXT,
    "displayPhone" TEXT,
    "verifiedName" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppSender_pkey" PRIMARY KEY ("salonId")
);

-- CreateIndex
CREATE INDEX "WhatsAppSender_phoneNumberId_idx" ON "WhatsAppSender"("phoneNumberId");

-- AddForeignKey
ALTER TABLE "WhatsAppSender" ADD CONSTRAINT "WhatsAppSender_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;
