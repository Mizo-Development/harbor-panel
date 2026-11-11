ALTER TABLE "Invoice" DROP CONSTRAINT "Invoice_kind_check";
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_kind_check" CHECK (("kind"='HOSTING' AND "serviceId" IS NOT NULL) OR ("kind" IN ('ADHOC','WALLET_FUNDING','CART') AND "serviceId" IS NULL));
CREATE TABLE "Cart" ("id" TEXT PRIMARY KEY,"userId" TEXT NOT NULL REFERENCES "User"("id"),"status" TEXT NOT NULL DEFAULT 'OPEN' CHECK("status" IN ('OPEN','CHECKED_OUT','CANCELLED')),"items" JSONB NOT NULL DEFAULT '[]',"version" INTEGER NOT NULL DEFAULT 0,"requestKey" TEXT,"requestFingerprint" TEXT,"invoiceId" TEXT UNIQUE REFERENCES "Invoice"("id"),"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL);
CREATE UNIQUE INDEX "Cart_userId_requestKey_key" ON "Cart"("userId","requestKey");
CREATE UNIQUE INDEX "Cart_one_open_customer" ON "Cart"("userId") WHERE "status"='OPEN';
CREATE INDEX "Cart_userId_status_idx" ON "Cart"("userId","status");
CREATE TABLE "InvoiceService" ("invoiceId" TEXT NOT NULL REFERENCES "Invoice"("id"),"serviceId" TEXT NOT NULL REFERENCES "Service"("id"),"amount" INTEGER NOT NULL CHECK("amount">=0),PRIMARY KEY("invoiceId","serviceId"));
CREATE INDEX "InvoiceService_serviceId_idx" ON "InvoiceService"("serviceId");
