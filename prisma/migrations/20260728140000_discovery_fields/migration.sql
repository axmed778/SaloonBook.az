-- Discovery map: salon district label, denormalized review aggregate for the
-- min-rating filter, a bounding-box index, and a broad service category.

-- Salon: district + rating aggregate.
ALTER TABLE "Salon" ADD COLUMN "district" TEXT;
ALTER TABLE "Salon" ADD COLUMN "ratingCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Salon" ADD COLUMN "ratingSum" INTEGER NOT NULL DEFAULT 0;

-- Bounding-box viewport scans.
CREATE INDEX "Salon_latitude_longitude_idx" ON "Salon"("latitude", "longitude");

-- Service category enum + column (default OTHER for existing rows).
CREATE TYPE "ServiceCategory" AS ENUM ('HAIR', 'NAILS', 'BROWS_LASHES', 'MAKEUP', 'SPA', 'BARBER', 'OTHER');
ALTER TABLE "Service" ADD COLUMN "category" "ServiceCategory" NOT NULL DEFAULT 'OTHER';
