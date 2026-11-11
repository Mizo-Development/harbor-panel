CREATE TABLE "HttpLog" ("id" TEXT PRIMARY KEY, "method" TEXT NOT NULL, "path" TEXT NOT NULL, "status" INTEGER NOT NULL, "durationMs" INTEGER NOT NULL, "actorId" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX "HttpLog_createdAt_idx" ON "HttpLog"("createdAt");
CREATE INDEX "HttpLog_status_createdAt_idx" ON "HttpLog"("status","createdAt");
CREATE TABLE "SystemRun" ("id" TEXT PRIMARY KEY, "task" TEXT NOT NULL, "origin" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'RUNNING', "leaseUntil" TIMESTAMP(3), "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "finishedAt" TIMESTAMP(3), "errorCode" TEXT);
CREATE INDEX "SystemRun_task_startedAt_idx" ON "SystemRun"("task","startedAt");
CREATE UNIQUE INDEX "SystemRun_one_running_task" ON "SystemRun"("task") WHERE "status"='RUNNING';
