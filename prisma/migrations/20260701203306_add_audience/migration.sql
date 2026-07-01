-- CreateEnum
CREATE TYPE "Audience" AS ENUM ('MALE', 'FEMALE', 'ALL');

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "audience" "Audience" NOT NULL DEFAULT 'ALL';

-- AlterTable
ALTER TABLE "Salon" ADD COLUMN     "audience" "Audience" NOT NULL DEFAULT 'ALL';

-- AlterTable
ALTER TABLE "Service" ADD COLUMN     "audience" "Audience" NOT NULL DEFAULT 'ALL';
