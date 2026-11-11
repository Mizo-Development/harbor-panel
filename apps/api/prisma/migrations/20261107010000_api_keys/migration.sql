CREATE TABLE "ApiKey" (
 "id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
 "name" TEXT NOT NULL, "kind" TEXT NOT NULL CHECK ("kind" IN ('CLIENT','ADMIN')),
 "tokenHash" TEXT NOT NULL UNIQUE, "prefix" TEXT NOT NULL, "scopes" TEXT[] NOT NULL,
 "allowedIps" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[], "credentialFingerprint" TEXT NOT NULL,
 "expiresAt" TIMESTAMP(3) NOT NULL, "revokedAt" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "lastUsedAt" TIMESTAMP(3), "lastUsedIp" TEXT
);
CREATE INDEX "ApiKey_userId_createdAt_idx" ON "ApiKey"("userId","createdAt");
ALTER TABLE "HttpLog" ADD COLUMN "apiKeyId" TEXT;
CREATE INDEX "HttpLog_apiKeyId_createdAt_idx" ON "HttpLog"("apiKeyId","createdAt");
