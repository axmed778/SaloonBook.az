-- Local email/password auth: Clerk no longer required.
-- Hand-written to match prisma/schema.prisma (the Neon DB isn't reachable from here).
-- The User table is empty in dev/seed, so SETting email NOT NULL is safe.

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "clerkId" DROP NOT NULL;
ALTER TABLE "User" ADD COLUMN "passwordHash" TEXT;
ALTER TABLE "User" ALTER COLUMN "email" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
