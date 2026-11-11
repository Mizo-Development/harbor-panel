ALTER TABLE "User" ADD COLUMN "passwordChangedAt" TIMESTAMP(3), ADD COLUMN "lastLoginAt" TIMESTAMP(3), ADD COLUMN "lastLoginIp" TEXT, ADD COLUMN "lastLoginUserAgent" TEXT, ADD COLUMN "adminNotes" TEXT NOT NULL DEFAULT '';
UPDATE "User" u SET "lastLoginAt" = a.latest FROM (SELECT "actorId", MAX("createdAt") AS latest FROM "AuditLog" WHERE "action"='auth.login' GROUP BY "actorId") a WHERE u.id=a."actorId";
CREATE INDEX "AuditLog_actorId_action_createdAt_idx" ON "AuditLog"("actorId", "action", "createdAt");
