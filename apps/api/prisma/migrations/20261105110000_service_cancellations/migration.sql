ALTER TABLE "Service" ADD COLUMN "cancelAt" TIMESTAMP(3);
CREATE TABLE "ServiceCancellation" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "serviceId" TEXT NOT NULL REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "requestedById" TEXT NOT NULL,
 "mode" TEXT NOT NULL CHECK ("mode" IN ('IMMEDIATE','END_OF_TERM')),
 "reason" TEXT NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'PENDING' CHECK ("status" IN ('PENDING','APPROVED','PROCESSING','COMPLETE','FAILED','REJECTED','WITHDRAWN')),
 "effectiveAt" TIMESTAMP(3),
 "reviewedById" TEXT,
 "reviewNote" TEXT NOT NULL DEFAULT '',
 "reviewedAt" TIMESTAMP(3),
 "completedAt" TIMESTAMP(3),
 "operationId" TEXT REFERENCES "Operation"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "ServiceCancellation_operationId_key" ON "ServiceCancellation"("operationId");
CREATE UNIQUE INDEX "ServiceCancellation_active_service_key" ON "ServiceCancellation"("serviceId") WHERE "status" IN ('PENDING','APPROVED','PROCESSING','FAILED');
CREATE INDEX "ServiceCancellation_status_effectiveAt_idx" ON "ServiceCancellation"("status","effectiveAt");
CREATE INDEX "ServiceCancellation_serviceId_createdAt_idx" ON "ServiceCancellation"("serviceId","createdAt");
ALTER TABLE "Invoice" ADD COLUMN "cancellationId" TEXT REFERENCES "ServiceCancellation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD COLUMN "reviewRequired" BOOLEAN NOT NULL DEFAULT false,
 ADD COLUMN "reviewReason" TEXT, ADD COLUMN "reviewedAt" TIMESTAMP(3), ADD COLUMN "reviewedById" TEXT, ADD COLUMN "reviewResolution" TEXT;
-- Preserve the pre-existing extra-charge audit flags in the new review queue.
UPDATE "Payment" p SET "reviewRequired" = true, "reviewReason" = 'Additional charge against an already paid invoice'
 WHERE EXISTS (SELECT 1 FROM "AuditLog" a WHERE a."action" = 'payment.extra-charge-review-required'
 AND a."targetId" = p."invoiceId" AND a."details"->>'paymentId' = p."externalId" AND a."details"->>'gateway' = p."gateway");
