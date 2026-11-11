ALTER TABLE "Setting"
 ADD COLUMN "settingsVersion" INTEGER NOT NULL DEFAULT 0,
 ADD COLUMN "experience" JSONB NOT NULL DEFAULT '{}',
 ADD COLUMN "access" JSONB NOT NULL DEFAULT '{}',
 ADD COLUMN "automation" JSONB NOT NULL DEFAULT '{}',
 ADD COLUMN "supportPolicy" JSONB NOT NULL DEFAULT '{}',
 ADD COLUMN "notifications" JSONB NOT NULL DEFAULT '{}',
 ADD COLUMN "mailConfig" TEXT;
ALTER TABLE "User" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3), ADD COLUMN "autoPayWallet" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "notificationPreferences" JSONB NOT NULL DEFAULT '{}';
CREATE TABLE "VerificationToken" ("id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE, "email" TEXT NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX "VerificationToken_userId_idx" ON "VerificationToken"("userId");
CREATE TABLE "MailLog" ("id" TEXT PRIMARY KEY, "recipient" TEXT NOT NULL, "subject" TEXT NOT NULL, "kind" TEXT NOT NULL DEFAULT 'transactional', "status" TEXT NOT NULL, "messageId" TEXT, "errorCode" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX "MailLog_createdAt_idx" ON "MailLog"("createdAt");
CREATE TABLE "NotificationTemplate" ("key" TEXT PRIMARY KEY, "subject" TEXT NOT NULL, "body" TEXT NOT NULL, "updatedAt" TIMESTAMP(3) NOT NULL);
