ALTER TABLE "Setting" ADD COLUMN "taxEnabled" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "taxInclusive" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "taxExempt" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Product" ADD COLUMN "taxable" BOOLEAN NOT NULL DEFAULT true;
CREATE TABLE "TaxRate" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "country" TEXT NOT NULL,
  "basisPoints" INTEGER NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "TaxRate_basisPoints_check" CHECK ("basisPoints" >= 0 AND "basisPoints" <= 10000)
);
CREATE UNIQUE INDEX "TaxRate_country_key" ON "TaxRate"("country");
