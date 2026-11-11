-- DropIndex
DROP INDEX "Checkout_invoiceId_gateway_key";

-- CreateIndex
CREATE INDEX "Checkout_invoiceId_gateway_createdAt_idx" ON "Checkout"("invoiceId", "gateway", "createdAt");
