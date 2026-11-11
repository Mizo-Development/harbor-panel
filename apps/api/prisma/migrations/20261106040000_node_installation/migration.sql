CREATE TABLE "NodeInstallation" (
 "id" TEXT PRIMARY KEY, "connectionId" TEXT NOT NULL REFERENCES "Connection"("id") ON DELETE CASCADE,
 "tokenHash" TEXT NOT NULL UNIQUE, "machineHash" TEXT, "fingerprint" TEXT NOT NULL, "options" JSONB NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'WAITING' CHECK ("status" IN ('WAITING','RUNNING','FAILED','COMPLETE','REVOKED')),
 "step" TEXT NOT NULL DEFAULT 'waiting', "createdBy" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "expiresAt" TIMESTAMP(3) NOT NULL,
 "claimedAt" TIMESTAMP(3), "lastSeenAt" TIMESTAMP(3), "completedAt" TIMESTAMP(3)
);
CREATE INDEX "NodeInstallation_connectionId_createdAt_idx" ON "NodeInstallation"("connectionId","createdAt");
CREATE UNIQUE INDEX "NodeInstallation_one_active" ON "NodeInstallation"("connectionId") WHERE "status" IN ('WAITING','RUNNING');
