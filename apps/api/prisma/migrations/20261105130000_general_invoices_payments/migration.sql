ALTER TABLE "Setting" ADD COLUMN "invoicePrefix" TEXT NOT NULL DEFAULT 'INV';
ALTER TABLE "Invoice" ALTER COLUMN "serviceId" DROP NOT NULL,
 ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'HOSTING',
 ADD COLUMN "description" TEXT NOT NULL DEFAULT '',
 ADD COLUMN "number" TEXT, ADD COLUMN "requestKey" TEXT, ADD COLUMN "requestFingerprint" TEXT,
 ADD COLUMN "paidAmount" INTEGER NOT NULL DEFAULT 0,
 ADD COLUMN "walletCreditedAt" TIMESTAMP(3), ADD COLUMN "voidReason" TEXT;
UPDATE "Invoice" SET "paidAmount"="amount" WHERE "status"='PAID';
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_balance_check" CHECK ("paidAmount">=0 AND "paidAmount"<="amount"),
 ADD CONSTRAINT "Invoice_kind_check" CHECK (("kind"='HOSTING' AND "serviceId" IS NOT NULL) OR ("kind" IN ('ADHOC','WALLET_FUNDING') AND "serviceId" IS NULL));
CREATE UNIQUE INDEX "Invoice_number_key" ON "Invoice"("number");
CREATE UNIQUE INDEX "Invoice_requestKey_key" ON "Invoice"("requestKey");
CREATE TABLE "InvoiceSequence" ("id" TEXT NOT NULL PRIMARY KEY, "lastNumber" INTEGER NOT NULL DEFAULT 0);
CREATE TABLE "InvoiceItem" (
 "id" TEXT NOT NULL PRIMARY KEY, "invoiceId" TEXT NOT NULL REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "description" TEXT NOT NULL, "kind" TEXT NOT NULL DEFAULT 'CUSTOM', "quantity" INTEGER NOT NULL,
 "unitAmount" INTEGER NOT NULL, "total" INTEGER NOT NULL, "taxable" BOOLEAN NOT NULL DEFAULT true,
 CONSTRAINT "InvoiceItem_amount_check" CHECK ("quantity">=0 AND "unitAmount">=0 AND "total">=0 AND "quantity"::bigint*"unitAmount"="total")
);
CREATE INDEX "InvoiceItem_invoiceId_idx" ON "InvoiceItem"("invoiceId");
INSERT INTO "InvoiceItem" ("id","invoiceId","description","kind","quantity","unitAmount","total")
 SELECT gen_random_uuid()::text,i."id",COALESCE(NULLIF(l.value->>'name',''),s."name",'Invoice item'),COALESCE(l.value->>'kind','PLAN'),
 COALESCE((l.value->>'quantity')::int,1),
 COALESCE((l.value->>'unitAmount')::int, CASE WHEN COALESCE((l.value->>'quantity')::int,1)>0 THEN (l.value->>'amount')::int/COALESCE((l.value->>'quantity')::int,1) ELSE 0 END),
 (l.value->>'amount')::int
 FROM "Invoice" i LEFT JOIN "Service" s ON s."id"=i."serviceId"
 CROSS JOIN LATERAL jsonb_array_elements(COALESCE(i."billingSnapshot"->'pricing'->'lines','[]'::jsonb)) l;
INSERT INTO "InvoiceItem" ("id","invoiceId","description","kind","quantity","unitAmount","total")
 SELECT gen_random_uuid()::text,i."id",COALESCE(s."name",'Invoice item'),'PLAN',1,
 COALESCE((i."billingSnapshot"->'pricing'->>'subtotal')::int,i."amount"),COALESCE((i."billingSnapshot"->'pricing'->>'subtotal')::int,i."amount")
 FROM "Invoice" i LEFT JOIN "Service" s ON s."id"=i."serviceId" WHERE NOT EXISTS (SELECT 1 FROM "InvoiceItem" li WHERE li."invoiceId"=i."id");
ALTER TABLE "Payment" ADD COLUMN "appliedAmount" INTEGER NOT NULL DEFAULT 0;
UPDATE "Payment" SET "appliedAmount"="amount" WHERE NOT "reviewRequired";
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_applied_check" CHECK ("appliedAmount">=0 AND "appliedAmount"<="amount");
ALTER TABLE "Checkout" ADD COLUMN "amount" INTEGER, ADD COLUMN "currency" TEXT;
UPDATE "Checkout" c SET "amount"=i."amount","currency"=i."currency" FROM "Invoice" i WHERE c."invoiceId"=i."id";
