-- AlterTable
ALTER TABLE "Schedule" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateTable
CREATE TABLE "BackfillSchedule" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "cadence" TEXT NOT NULL,
    "dayOfWeek" INTEGER,
    "dayOfMonth" TEXT,
    "timeLocal" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "nextRunAt" TIMESTAMP(3),
    "lastRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BackfillSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BackfillRun" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "scheduleId" INTEGER,
    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "cursor" TEXT,
    "itemsProcessed" INTEGER NOT NULL DEFAULT 0,
    "itemsTotal" INTEGER,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "consecutiveErrors" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "claimedAt" TIMESTAMP(3),
    "promoted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BackfillRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RawRooflinkJob" (
    "rooflinkId" TEXT NOT NULL,
    "dataVersion" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RawRooflinkJob_pkey" PRIMARY KEY ("rooflinkId","dataVersion")
);

-- CreateTable
CREATE TABLE "RawRooflinkLineItems" (
    "estimateId" TEXT NOT NULL,
    "dataVersion" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RawRooflinkLineItems_pkey" PRIMARY KEY ("estimateId","dataVersion")
);

-- CreateTable
CREATE TABLE "FailureNotificationSetting" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "opsEmail" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FailureNotificationSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BackfillSchedule_tenantId_enabled_nextRunAt_idx" ON "BackfillSchedule"("tenantId", "enabled", "nextRunAt");

-- CreateIndex
CREATE UNIQUE INDEX "BackfillSchedule_tenantId_source_key" ON "BackfillSchedule"("tenantId", "source");

-- CreateIndex
CREATE INDEX "BackfillRun_tenantId_source_status_idx" ON "BackfillRun"("tenantId", "source", "status");

-- CreateIndex
CREATE INDEX "BackfillRun_source_promoted_finishedAt_idx" ON "BackfillRun"("source", "promoted", "finishedAt");

-- CreateIndex
CREATE INDEX "RawRooflinkJob_dataVersion_idx" ON "RawRooflinkJob"("dataVersion");

-- CreateIndex
CREATE INDEX "RawRooflinkLineItems_dataVersion_idx" ON "RawRooflinkLineItems"("dataVersion");

-- CreateIndex
CREATE UNIQUE INDEX "FailureNotificationSetting_tenantId_key" ON "FailureNotificationSetting"("tenantId");

-- AddForeignKey
ALTER TABLE "BackfillSchedule" ADD CONSTRAINT "BackfillSchedule_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BackfillRun" ADD CONSTRAINT "BackfillRun_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BackfillRun" ADD CONSTRAINT "BackfillRun_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "BackfillSchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FailureNotificationSetting" ADD CONSTRAINT "FailureNotificationSetting_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
