-- Salon geolocation for the public discovery map.
-- Nullable: a salon only appears on the map once its owner pins a location.
-- Stored as WGS84 degrees (double precision), placed by hand or via device GPS.
ALTER TABLE "Salon" ADD COLUMN "latitude" DOUBLE PRECISION;
ALTER TABLE "Salon" ADD COLUMN "longitude" DOUBLE PRECISION;
