ALTER TABLE "Product" ADD COLUMN "setupFee" INTEGER NOT NULL DEFAULT 0,
 ADD COLUMN "configuration" JSONB NOT NULL DEFAULT '{"plans":[],"options":[]}',
 ADD COLUMN "configurationVersion" INTEGER NOT NULL DEFAULT 0,
 ADD CONSTRAINT "Product_setupFee_check" CHECK ("setupFee" >= 0);
ALTER TABLE "RegionalPrice" ADD COLUMN "setupFee" INTEGER NOT NULL DEFAULT 0,
 ADD CONSTRAINT "RegionalPrice_setupFee_check" CHECK ("setupFee" >= 0);
-- Freeze the legacy term before administrators can offer additional billing periods.
UPDATE "Service" s SET "metadata" = jsonb_set(s."metadata", '{billingContract}',
 jsonb_build_object('type','RECURRING','unit',CASE WHEN p."cycle"='annual' THEN 'YEAR' ELSE 'MONTH' END,'period',1,'label',CASE WHEN p."cycle"='annual' THEN 'year' ELSE 'month' END,'name',p."name"),true)
 FROM "Product" p WHERE s."productId"=p."id" AND NOT (s."metadata" ? 'billingContract');
