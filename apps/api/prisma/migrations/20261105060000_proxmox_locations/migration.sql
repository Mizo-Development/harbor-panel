CREATE TABLE "Location" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "city" TEXT NOT NULL,
  "country" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "Connection" ADD COLUMN "locationId" TEXT;
ALTER TABLE "Connection" ADD CONSTRAINT "Connection_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
