ALTER TABLE "User" ADD COLUMN "billingAddress" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "Setting" ADD COLUMN "companyBilling" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "Invoice" ADD COLUMN "billingSnapshot" JSONB NOT NULL DEFAULT '{}';
CREATE TABLE "Wallet" ("id" TEXT NOT NULL PRIMARY KEY,"userId" TEXT NOT NULL UNIQUE REFERENCES "User"("id"),"currency" TEXT NOT NULL,"balance" INTEGER NOT NULL DEFAULT 0 CHECK ("balance" >= 0));
CREATE TABLE "WalletEntry" ("id" TEXT NOT NULL PRIMARY KEY,"walletId" TEXT NOT NULL REFERENCES "Wallet"("id"),"amount" INTEGER NOT NULL,"balanceAfter" INTEGER NOT NULL CHECK ("balanceAfter" >= 0),"kind" TEXT NOT NULL,"reference" TEXT NOT NULL UNIQUE,"description" TEXT NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX "WalletEntry_walletId_createdAt_idx" ON "WalletEntry"("walletId","createdAt");
CREATE TABLE "WalletTopup" ("id" TEXT NOT NULL PRIMARY KEY,"userId" TEXT NOT NULL REFERENCES "User"("id"),"amount" INTEGER NOT NULL,"currency" TEXT NOT NULL,"reference" TEXT NOT NULL,"status" TEXT NOT NULL DEFAULT 'PENDING',"reviewNote" TEXT,"reviewedBy" TEXT,"reviewedAt" TIMESTAMP(3),"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE UNIQUE INDEX "WalletTopup_userId_reference_key" ON "WalletTopup"("userId","reference");
